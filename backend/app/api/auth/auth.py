# backend/app/api/auth/auth.py

from fastapi import APIRouter, HTTPException, Request, Response, status, Depends, Header, Cookie
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
from typing import Literal, Optional
from pydantic import BaseModel
import asyncio
import os
from dotenv import load_dotenv
import secrets

from app.core.database import get_db
from app.models.interaction_log import InteractionLog
from app.models.operator_chat_session import OperatorChatSession
from app.models.user import User, RefreshToken, Ruolo
from app.models.role import (
    ADMIN_DEFAULT_PERMISSIONS,
    ALL_PERMISSIONS,
    MAINTENANCE_TECH_DEFAULT_PERMISSIONS,
)
from app.models.machine import Machine
from app.models.working_station import WorkingStation
from app.schemas.user import UserResponse
from app.schemas.machine import MachineResponse
from app.schemas.working_station import WorkingStationResponse
from app.api.presenters import serialize_machine, serialize_operator, serialize_user, serialize_working_station
from app.services.session_events import ADMIN_MACHINE_EVENTS_CHANNEL, session_event_bus

load_dotenv()

router = APIRouter()

# Usa solo pbkdf2_sha256
pwd_context = CryptContext(
    schemes=["pbkdf2_sha256"],
    deprecated="auto",
    pbkdf2_sha256__default_rounds=29000  # Round per sicurezza
)

# Configurazione JWT
INSECURE_SECRET_PLACEHOLDERS = {
    "",
    "your-secret-key-change-this-in-production",
    "your-super-secret-key-change-this-in-production",
    "dev-secret-key",
}


def _allow_insecure_defaults() -> bool:
    return os.getenv("HOLO_ASSISTANT_ALLOW_INSECURE_DEFAULTS", "false").lower() == "true"


def _require_secret_key() -> str:
    secret_key = os.getenv("SECRET_KEY", "")
    is_placeholder = (
        secret_key in INSECURE_SECRET_PLACEHOLDERS
        or secret_key.startswith("dev-secret-key")
        or len(secret_key) < 32
    )
    if secret_key and not is_placeholder:
        return secret_key
    if _allow_insecure_defaults():
        return secret_key or "test-secret-key-for-isolated-tests-only"
    raise RuntimeError(
        "SECRET_KEY must be set to a strong non-placeholder value. "
        "Set HOLO_ASSISTANT_ALLOW_INSECURE_DEFAULTS=true only for isolated tests or demos."
    )


SECRET_KEY = _require_secret_key()
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))  # 8 hours
ADMIN_TOKEN_EXPIRE_MINUTES = int(os.getenv("ADMIN_TOKEN_EXPIRE_MINUTES", "120"))
OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES = int(os.getenv("OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES", "480"))
ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES = int(os.getenv("ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES", "120"))
SSE_TOKEN_EXPIRE_MINUTES = int(os.getenv("SSE_TOKEN_EXPIRE_MINUTES", "5"))
REFRESH_TOKEN_COOKIE_NAME = os.getenv("REFRESH_TOKEN_COOKIE_NAME", "holo_assistant_refresh_token")
REFRESH_TOKEN_COOKIE_SECURE = os.getenv("REFRESH_TOKEN_COOKIE_SECURE", "false").lower() == "true"
REFRESH_TOKEN_COOKIE_SAMESITE = os.getenv("REFRESH_TOKEN_COOKIE_SAMESITE", "lax")
OPERATOR_INTERFACE_PERMISSION = "operator.interface.access"

class BadgeLoginRequest(BaseModel):
    badge_id: str
    working_station_id: Optional[int] = None
    machine_id: Optional[int] = None

class CredentialsLoginRequest(BaseModel):
    username: str
    password: str
    working_station_id: Optional[int] = None
    machine_id: Optional[int] = None

class AdminLoginRequest(BaseModel):
    username: str
    password: str

class RefreshTokenRequest(BaseModel):
    refresh_token: Optional[str] = None


class RefreshTokenStatusRequest(BaseModel):
    refresh_token: Optional[str] = None

class SSETokenRequest(BaseModel):
    working_station_id: Optional[int] = None
    machine_id: Optional[int] = None

class LogoutRequest(BaseModel):
    user_id: Optional[int] = None
    working_station_id: Optional[int] = None
    machine_id: Optional[int] = None
    refresh_token: Optional[str] = None

class LoginResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str
    expires_in: int  # secondi fino a scadenza access token
    user: UserResponse
    working_station: WorkingStationResponse
    assigned_machine: Optional[MachineResponse] = None
    chat_session_id: Optional[int] = None
    machine: Optional[MachineResponse] = None
    message: Optional[str] = None

class AdminLoginResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str
    expires_in: int  # secondi fino a scadenza access token
    user: UserResponse
    is_admin: bool = True
    message: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int

class CurrentUserResponse(BaseModel):
    user: UserResponse
    is_admin: bool


class RefreshTokenStatusResponse(BaseModel):
    valid: bool
    user_id: int
    is_admin: bool

class SSETokenResponse(BaseModel):
    token: str
    expires_in: int

class TokenData(BaseModel):
    user_id: Optional[int] = None
    username: Optional[str] = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def get_access_token_expires_delta(user: User) -> timedelta:
    if user_has_permission(user, "backoffice.access"):
        return timedelta(minutes=ADMIN_TOKEN_EXPIRE_MINUTES)
    return timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)


def get_refresh_token_expires_delta(user: User) -> timedelta:
    if user_has_permission(user, "backoffice.access"):
        return timedelta(minutes=ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES)
    return timedelta(minutes=OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES)


def user_has_permission(user: User, permission: str) -> bool:
    if user.role is not None and user.role.is_active:
        return permission in user.role.permissions
    if user.ruolo == Ruolo.ADMIN:
        return permission in ADMIN_DEFAULT_PERMISSIONS
    if getattr(user.livello_esperienza, "value", user.livello_esperienza) == "manutentore":
        return permission in MAINTENANCE_TECH_DEFAULT_PERMISSIONS
    return False


def verify_permission(permission: str):
    async def dependency(current_user: User = Depends(get_current_user)) -> User:
        if not user_has_permission(current_user, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permesso insufficiente",
            )
        return current_user

    return dependency


class SessionStatusResponse(BaseModel):
    session_valid: bool
    working_station_assigned: bool
    working_station_in_use: bool
    operator_matches: bool
    should_logout: bool
    reason: Literal["ok", "working_station_released", "working_station_reassigned", "working_station_not_found"]


def _build_operator_payload(user: Optional[User]) -> Optional[dict]:
    return serialize_operator(user)


def build_admin_machine_event_payload(
    machine: Machine,
    operator: Optional[User] = None,
    deleted: bool = False,
) -> dict:
    return serialize_machine(machine, operator=operator, deleted=deleted)


def build_user_response_model(user: User) -> UserResponse:
    payload = serialize_user(user)
    return UserResponse(
        id=payload["id"],
        nome=payload["nome"],
        badge_id=payload["badge_id"],
        role_id=payload["role_id"],
        role_name=payload["role_name"],
        role_code=payload["role_code"],
        permissions=payload["permissions"],
        livello_esperienza=payload["livello_esperienza"],
        department_id=payload["department_id"],
        department_name=payload["department_name"],
        reparto=payload["reparto"],
        turno=payload["turno"],
        created_at=payload["created_at"],
    )


def build_machine_response_model(machine: Machine) -> MachineResponse:
    payload = serialize_machine(machine)
    return MachineResponse(
        id=payload["id"],
        nome=payload["nome"],
        department_id=payload["department_id"],
        working_station_id=payload["working_station_id"],
        department_name=payload["department_name"],
        reparto=payload["reparto"],
        descrizione=payload["descrizione"],
        id_postazione=payload["id_postazione"],
        startup_checklist=payload["startup_checklist"],
        in_uso=payload["in_uso"],
        operatore_attuale_id=payload["operatore_attuale_id"],
    )


def build_working_station_response_model(working_station: WorkingStation) -> WorkingStationResponse:
    payload = serialize_working_station(working_station)
    return WorkingStationResponse(
        id=payload["id"],
        name=payload["name"],
        description=payload["description"],
        station_code=payload["station_code"],
        startup_checklist=payload["startup_checklist"],
        department_id=payload["department_id"],
        department_name=payload["department_name"],
        reparto=payload["reparto"],
        in_uso=payload["in_uso"],
        operatore_attuale_id=payload["operatore_attuale_id"],
        operator=payload["operator"],
        assigned_machine=payload["assigned_machine"],
        deleted=payload["deleted"],
    )


def resolve_requested_working_station_id(
    working_station_id: Optional[int] = None,
    machine_id: Optional[int] = None,
) -> int:
    resolved_id = working_station_id or machine_id
    if resolved_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="working_station_id obbligatorio",
        )
    return resolved_id


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = utc_now() + expires_delta
    else:
        expire = utc_now() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_sse_token(user_id: int, working_station_id: int) -> str:
    expire = utc_now() + timedelta(minutes=SSE_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "working_station_id": working_station_id,
        "type": "sse",
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def set_refresh_token_cookie(response: Response, refresh_token: str, expires_delta: timedelta) -> None:
    response.set_cookie(
        key=REFRESH_TOKEN_COOKIE_NAME,
        value=refresh_token,
        max_age=int(expires_delta.total_seconds()),
        httponly=True,
        secure=REFRESH_TOKEN_COOKIE_SECURE,
        samesite=REFRESH_TOKEN_COOKIE_SAMESITE,
        path="/",
    )


def clear_refresh_token_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_TOKEN_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=REFRESH_TOKEN_COOKIE_SECURE,
        samesite=REFRESH_TOKEN_COOKIE_SAMESITE,
    )


def resolve_refresh_token(
    cookie_refresh_token: Optional[str],
    request_refresh_token: Optional[str] = None,
) -> str:
    resolved_refresh_token = cookie_refresh_token or request_refresh_token

    if not resolved_refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token non fornito"
        )

    return resolved_refresh_token

def create_refresh_token(
    user_id: int,
    db: Session,
    expires_delta: timedelta,
    machine_id: Optional[int] = None,
    working_station_id: Optional[int] = None,
) -> str:
    """Genera un refresh token e lo salva nel database."""
    token = secrets.token_urlsafe(32)
    expires_at = utc_now() + expires_delta
    
    refresh_token_db = RefreshToken(
        user_id=user_id,
        machine_id=machine_id,
        working_station_id=working_station_id,
        token=token,
        expires_at=expires_at,
        is_revoked=False
    )
    db.add(refresh_token_db)
    db.commit()
    return token


def cleanup_refresh_tokens(
    db: Session,
    user_id: Optional[int] = None,
    remove_other_active: bool = False,
    preserve_token: Optional[str] = None,
) -> None:
    """Elimina refresh token scaduti, revocati e token attivi precedenti dello stesso utente."""
    now = utc_now()
    query = db.query(RefreshToken)

    if user_id is not None:
        query = query.filter(RefreshToken.user_id == user_id)

    tokens_to_delete = query.filter(
        (RefreshToken.is_revoked.is_(True)) | (RefreshToken.expires_at < now)
    ).all()

    if user_id is not None and remove_other_active:
        active_tokens = query.filter(
            RefreshToken.is_revoked.is_(False),
            RefreshToken.expires_at >= now,
        ).all()
        for active_token in active_tokens:
            if preserve_token is not None and active_token.token == preserve_token:
                continue
            tokens_to_delete.append(active_token)

    unique_tokens = {
        token.id: token
        for token in tokens_to_delete
        if preserve_token is None or token.token != preserve_token
    }
    if not unique_tokens:
        return

    for token in unique_tokens.values():
        db.delete(token)

    db.commit()


def delete_refresh_token(db: Session, refresh_token_db: RefreshToken) -> None:
    db.delete(refresh_token_db)
    db.commit()

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def get_token_from_header(authorization: str = Header(None)) -> str:
    """Estrae il token JWT dall'header Authorization."""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Header Authorization non fornito"
        )
    
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Header Authorization non valido"
        )
    
    return parts[1]

async def get_current_user(
    token: str = Depends(get_token_from_header),
    db: Session = Depends(get_db)
) -> User:
    """Dipendenza per validare il JWT token e restituire l'utente."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenziali non valide",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(User).options(joinedload(User.role)).filter(User.id == int(user_id)).first()
    if user is None:
        raise credentials_exception
    return user

async def verify_admin(current_user: User = Depends(get_current_user)) -> User:
    """Dipendenza per verificare che l'utente sia un admin."""
    if not user_has_permission(current_user, "backoffice.access"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso admin richiesto"
        )
    return current_user


def build_session_status_payload(
    machine: Optional[Machine],
    expected_user_id: int,
) -> SessionStatusResponse:
    working_station = machine if isinstance(machine, WorkingStation) else None
    if working_station is None and isinstance(machine, Machine):
        working_station = machine.working_station

    if not working_station:
        return SessionStatusResponse(
            session_valid=True,
            working_station_assigned=False,
            working_station_in_use=False,
            operator_matches=False,
            should_logout=True,
            reason="working_station_not_found",
        )

    if not working_station.in_uso:
        return SessionStatusResponse(
            session_valid=True,
            working_station_assigned=False,
            working_station_in_use=False,
            operator_matches=False,
            should_logout=True,
            reason="working_station_released",
        )

    if working_station.operatore_attuale_id is None:
        return SessionStatusResponse(
            session_valid=True,
            working_station_assigned=False,
            working_station_in_use=True,
            operator_matches=False,
            should_logout=True,
            reason="working_station_released",
        )

    if working_station.operatore_attuale_id != expected_user_id:
        return SessionStatusResponse(
            session_valid=True,
            working_station_assigned=True,
            working_station_in_use=True,
            operator_matches=False,
            should_logout=True,
            reason="working_station_reassigned",
        )

    return SessionStatusResponse(
        session_valid=True,
        working_station_assigned=True,
        working_station_in_use=True,
        operator_matches=True,
        should_logout=False,
        reason="ok",
    )


async def publish_machine_session_event(
    machine: Optional[Machine],
    expected_user_id: int,
    machine_id: Optional[int] = None,
    db: Optional[Session] = None,
) -> None:
    working_station = machine if isinstance(machine, WorkingStation) else None
    if working_station is None and machine is not None:
        working_station = machine.working_station
    if working_station is None and machine_id is not None and db is not None:
        resolved_machine = (
            db.query(Machine)
            .options(joinedload(Machine.working_station))
            .filter(Machine.id == machine_id)
            .first()
        )
        if resolved_machine is not None:
            working_station = resolved_machine.working_station

    if working_station is None:
        return

    payload = build_session_status_payload(working_station, expected_user_id).model_dump()
    await session_event_bus.publish(working_station.id, "session_status", payload)

    if db is not None:
        await publish_admin_working_station_event(db, working_station)


async def publish_admin_machine_event(
    db: Session,
    machine: Machine,
    deleted: bool = False,
) -> None:
    operator = None
    if machine.operatore_attuale_id is not None:
        operator = db.query(User).filter(User.id == machine.operatore_attuale_id).first()

    payload = build_admin_machine_event_payload(machine, operator=operator, deleted=deleted)
    await session_event_bus.publish(
        ADMIN_MACHINE_EVENTS_CHANNEL,
        "machine_status",
        payload,
    )


async def publish_admin_working_station_event(
    db: Session,
    working_station: WorkingStation,
    deleted: bool = False,
) -> None:
    operator = None
    if working_station.operatore_attuale_id is not None:
        operator = db.query(User).filter(User.id == working_station.operatore_attuale_id).first()

    payload = serialize_working_station(working_station, operator=operator, deleted=deleted)
    await session_event_bus.publish(
        ADMIN_MACHINE_EVENTS_CHANNEL,
        "working_station_status",
        payload,
    )


def _sync_working_station_machine_state(working_station: WorkingStation) -> None:
    assigned_machine = working_station.assigned_machine
    if assigned_machine is None:
        return
    assigned_machine.in_uso = working_station.in_uso
    assigned_machine.operatore_attuale_id = working_station.operatore_attuale_id


def _delete_chat_session_logs(db: Session, chat_session_ids: list[int]) -> None:
    if not chat_session_ids:
        return
    db.query(InteractionLog).filter(InteractionLog.chat_session_id.in_(chat_session_ids)).delete(
        synchronize_session=False
    )


def _close_active_chat_sessions(
    db: Session,
    user_id: int,
    working_station_id: Optional[int] = None,
) -> None:
    query = db.query(OperatorChatSession).filter(
        OperatorChatSession.user_id == user_id,
        OperatorChatSession.is_active.is_(True),
    )
    if working_station_id is not None:
        query = query.filter(OperatorChatSession.working_station_id == working_station_id)

    sessions = query.all()
    if not sessions:
        return

    chat_session_ids = [session.id for session in sessions]
    for session in sessions:
        session.is_active = False
        session.ended_at = utc_now()

    _delete_chat_session_logs(db, chat_session_ids)
    db.flush()


def _create_operator_chat_session(
    db: Session,
    user_id: int,
    working_station_id: int,
    refresh_token_id: Optional[int] = None,
) -> OperatorChatSession:
    _close_active_chat_sessions(db, user_id, working_station_id)
    chat_session = OperatorChatSession(
        user_id=user_id,
        working_station_id=working_station_id,
        refresh_token_id=refresh_token_id,
        is_active=True,
    )
    db.add(chat_session)
    db.flush()
    return chat_session


async def release_user_machine_sessions(
    db: Session,
    user_id: int,
    requested_machine_id: Optional[int] = None,
) -> None:
    query = db.query(WorkingStation).options(joinedload(WorkingStation.assigned_machine)).filter(
        WorkingStation.operatore_attuale_id == user_id
    )
    if requested_machine_id is not None:
        query = query.filter((WorkingStation.id == requested_machine_id) | (WorkingStation.in_uso.is_(True)))
    else:
        query = query.filter(WorkingStation.in_uso.is_(True))

    working_stations = query.all()
    if not working_stations:
        return

    released_ids: list[int] = []
    for working_station in working_stations:
        released_ids.append(working_station.id)
        working_station.in_uso = False
        working_station.operatore_attuale_id = None
        _sync_working_station_machine_state(working_station)

    _close_active_chat_sessions(db, user_id, None if requested_machine_id is None else requested_machine_id)

    db.commit()

    for working_station in working_stations:
        await publish_machine_session_event(working_station, user_id, db=db)


def decode_sse_token(token: str) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token SSE non valido",
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise credentials_exception from exc

    if payload.get("type") != "sse":
        raise credentials_exception

    if payload.get("sub") is None or payload.get("working_station_id") is None:
        raise credentials_exception

    return payload


@router.get("/session-status", response_model=SessionStatusResponse)
async def session_status(
    working_station_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Controlla lo stato minimo della sessione operatore e dell'assegnazione postazione."""
    working_station = (
        db.query(WorkingStation)
        .options(joinedload(WorkingStation.assigned_machine))
        .filter(WorkingStation.id == working_station_id)
        .first()
    )
    return build_session_status_payload(working_station, current_user.id)


@router.get("/me", response_model=CurrentUserResponse)
async def get_current_session_user(
    current_user: User = Depends(get_current_user),
):
    return CurrentUserResponse(
        user=build_user_response_model(current_user),
        is_admin=user_has_permission(current_user, "backoffice.access"),
    )


@router.post("/refresh-token-status", response_model=RefreshTokenStatusResponse)
async def refresh_token_status(
    request: Optional[RefreshTokenStatusRequest] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    refresh_token_cookie: Optional[str] = Cookie(default=None, alias=REFRESH_TOKEN_COOKIE_NAME),
):
    refresh_token_value = resolve_refresh_token(
        refresh_token_cookie,
        request.refresh_token if request else None,
    )
    cleanup_refresh_tokens(db, user_id=current_user.id, preserve_token=refresh_token_value)
    refresh_token_db = db.query(RefreshToken).filter(
        RefreshToken.token == refresh_token_value
    ).first()

    if not refresh_token_db:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token non valido"
        )

    if refresh_token_db.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token non associato all'utente corrente"
        )

    if refresh_token_db.is_revoked:
        delete_refresh_token(db, refresh_token_db)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token revocato"
        )

    if refresh_token_db.expires_at < utc_now():
        delete_refresh_token(db, refresh_token_db)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token scaduto"
        )

    return RefreshTokenStatusResponse(
        valid=True,
        user_id=current_user.id,
        is_admin=user_has_permission(current_user, "backoffice.access"),
    )


@router.post("/sse-token", response_model=SSETokenResponse)
async def create_operator_sse_token(
    request: SSETokenRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not user_has_permission(current_user, OPERATOR_INTERFACE_PERMISSION):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accesso interfaccia operatore non consentito",
        )

    working_station_id = resolve_requested_working_station_id(
        request.working_station_id,
        request.machine_id,
    )
    working_station = (
        db.query(WorkingStation)
        .options(joinedload(WorkingStation.assigned_machine))
        .filter(WorkingStation.id == working_station_id)
        .first()
    )
    session_status_payload = build_session_status_payload(working_station, current_user.id)
    if session_status_payload.should_logout:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La sessione postazione non e valida per aprire SSE",
        )

    token = create_sse_token(current_user.id, working_station_id)
    return SSETokenResponse(
        token=token,
        expires_in=SSE_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/session-events")
async def session_events(
    request: Request,
    working_station_id: int,
    token: str,
    db: Session = Depends(get_db),
):
    token_payload = decode_sse_token(token)
    token_working_station_id = int(token_payload["working_station_id"])
    token_user_id = int(token_payload["sub"])

    if token_working_station_id != working_station_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Working station ID SSE non valido",
        )

    working_station = (
        db.query(WorkingStation)
        .options(joinedload(WorkingStation.assigned_machine))
        .filter(WorkingStation.id == working_station_id)
        .first()
    )
    initial_payload = build_session_status_payload(working_station, token_user_id).model_dump()

    async def event_generator():
        stream = session_event_bus.stream(working_station_id, initial_payload)
        async for message in stream:
            if await request.is_disconnected():
                break
            yield message
            await asyncio.sleep(0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.post("/badge-login", response_model=LoginResponse)
async def badge_login(
    request: BadgeLoginRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    working_station_id = resolve_requested_working_station_id(
        request.working_station_id,
        request.machine_id,
    )
    working_station = (
        db.query(WorkingStation)
        .options(joinedload(WorkingStation.assigned_machine), joinedload(WorkingStation.department))
        .filter(WorkingStation.id == working_station_id)
        .first()
    )
    if not working_station:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Postazione non trovata"
        )

    user = db.query(User).options(joinedload(User.role)).filter(User.badge_id == request.badge_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenziali non valide"
        )

    if not user_has_permission(user, OPERATOR_INTERFACE_PERMISSION):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accesso interfaccia operatore non consentito",
        )

    if (
        working_station.in_uso
        and working_station.operatore_attuale_id is not None
        and working_station.operatore_attuale_id != user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Postazione gia in uso da un altro operatore"
        )

    user_response = build_user_response_model(user)
    await release_user_machine_sessions(db, user.id, working_station.id)

    db.refresh(working_station)
    working_station.in_uso = True
    working_station.operatore_attuale_id = user.id
    _sync_working_station_machine_state(working_station)
    db.commit()
    await publish_machine_session_event(working_station, user.id, db=db)

    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome}
    )
    cleanup_refresh_tokens(db, user_id=user.id, remove_other_active=True)
    refresh_token_expires_delta = get_refresh_token_expires_delta(user)
    refresh_token_value = create_refresh_token(
        user.id,
        db,
        expires_delta=refresh_token_expires_delta,
        machine_id=working_station.assigned_machine.id if working_station.assigned_machine else None,
        working_station_id=working_station.id,
    )
    set_refresh_token_cookie(response, refresh_token_value, refresh_token_expires_delta)
    refresh_token_db = db.query(RefreshToken).filter(RefreshToken.token == refresh_token_value).first()
    chat_session = _create_operator_chat_session(
        db,
        user.id,
        working_station.id,
        refresh_token_id=refresh_token_db.id if refresh_token_db else None,
    )
    db.commit()

    assigned_machine_response = (
        build_machine_response_model(working_station.assigned_machine)
        if working_station.assigned_machine is not None
        else None
    )
    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=user_response,
        working_station=build_working_station_response_model(working_station),
        assigned_machine=assigned_machine_response,
        chat_session_id=chat_session.id,
        machine=assigned_machine_response,
        message=f"Benvenuto {user_response.nome}!"
    )

@router.post("/credentials-login", response_model=LoginResponse)
async def credentials_login(
    request: CredentialsLoginRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    working_station_id = resolve_requested_working_station_id(
        request.working_station_id,
        request.machine_id,
    )
    working_station = (
        db.query(WorkingStation)
        .options(joinedload(WorkingStation.assigned_machine), joinedload(WorkingStation.department))
        .filter(WorkingStation.id == working_station_id)
        .first()
    )
    if not working_station:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Postazione non trovata"
        )

    user = db.query(User).options(joinedload(User.role)).filter(User.nome == request.username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenziali non valide"
        )

    if not user_has_permission(user, OPERATOR_INTERFACE_PERMISSION):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accesso interfaccia operatore non consentito",
        )
    
    # Verifica password
    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenziali non valide"
        )
    
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenziali non valide"
        )

    if (
        working_station.in_uso
        and working_station.operatore_attuale_id is not None
        and working_station.operatore_attuale_id != user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Postazione gia in uso da un altro operatore"
        )

    user_response = build_user_response_model(user)
    await release_user_machine_sessions(db, user.id, working_station.id)

    db.refresh(working_station)
    working_station.in_uso = True
    working_station.operatore_attuale_id = user.id
    _sync_working_station_machine_state(working_station)
    db.commit()
    await publish_machine_session_event(working_station, user.id, db=db)

    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome}
    )
    cleanup_refresh_tokens(db, user_id=user.id, remove_other_active=True)
    refresh_token_expires_delta = get_refresh_token_expires_delta(user)
    refresh_token_value = create_refresh_token(
        user.id,
        db,
        expires_delta=refresh_token_expires_delta,
        machine_id=working_station.assigned_machine.id if working_station.assigned_machine else None,
        working_station_id=working_station.id,
    )
    set_refresh_token_cookie(response, refresh_token_value, refresh_token_expires_delta)
    refresh_token_db = db.query(RefreshToken).filter(RefreshToken.token == refresh_token_value).first()
    chat_session = _create_operator_chat_session(
        db,
        user.id,
        working_station.id,
        refresh_token_id=refresh_token_db.id if refresh_token_db else None,
    )
    db.commit()

    assigned_machine_response = (
        build_machine_response_model(working_station.assigned_machine)
        if working_station.assigned_machine is not None
        else None
    )
    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=user_response,
        working_station=build_working_station_response_model(working_station),
        assigned_machine=assigned_machine_response,
        chat_session_id=chat_session.id,
        machine=assigned_machine_response,
        message=f"Benvenuto {user_response.nome}!"
    )

@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: Optional[RefreshTokenRequest] = None,
    db: Session = Depends(get_db),
    refresh_token_cookie: Optional[str] = Cookie(default=None, alias=REFRESH_TOKEN_COOKIE_NAME),
):
    """Endpoint per rinnovare l'access token usando un refresh token."""
    refresh_token_value = resolve_refresh_token(
        refresh_token_cookie,
        request.refresh_token if request else None,
    )
    cleanup_refresh_tokens(db, preserve_token=refresh_token_value)
    
    # Cerca il refresh token nel database
    refresh_token_db = db.query(RefreshToken).filter(
        RefreshToken.token == refresh_token_value
    ).first()
    
    if not refresh_token_db:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token non valido"
        )
    
    # Verifica se è stato revocato
    if refresh_token_db.is_revoked:
        delete_refresh_token(db, refresh_token_db)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token revocato"
        )
    
    # Verifica se è scaduto
    if refresh_token_db.expires_at < utc_now():
        delete_refresh_token(db, refresh_token_db)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token scaduto"
        )
    
    # Genera nuovo access token
    user = db.query(User).filter(User.id == refresh_token_db.user_id).first()
    if not user:
        delete_refresh_token(db, refresh_token_db)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Utente non trovato"
        )
    
    access_token_expires_delta = get_access_token_expires_delta(user)
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome, "is_admin": user_has_permission(user, "backoffice.access")},
        expires_delta=access_token_expires_delta,
    )
    
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=int(access_token_expires_delta.total_seconds())
    )

@router.post("/logout")
async def logout(
    request: LogoutRequest,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    refresh_token_cookie: Optional[str] = Cookie(default=None, alias=REFRESH_TOKEN_COOKIE_NAME),
):
    """Endpoint per fare logout - libera solo la sessione dell'utente autenticato."""

    refresh_token_value = refresh_token_cookie or request.refresh_token
    refresh_token_working_station_id = None
    refresh_token_db = None
    if refresh_token_value:
        refresh_token_db = db.query(RefreshToken).filter(
            RefreshToken.token == refresh_token_value
        ).first()
        if refresh_token_db and refresh_token_db.user_id == current_user.id:
            refresh_token_working_station_id = refresh_token_db.working_station_id or refresh_token_db.machine_id

    requested_working_station_id = (
        request.working_station_id
        or request.machine_id
        or refresh_token_working_station_id
    )
    await release_user_machine_sessions(db, current_user.id, requested_working_station_id)
    
    cleanup_refresh_tokens(db, user_id=current_user.id)

    if refresh_token_value:
        refresh_token_db = db.query(RefreshToken).filter(
            RefreshToken.token == refresh_token_value
        ).first()
        if refresh_token_db and refresh_token_db.user_id == current_user.id:
            delete_refresh_token(db, refresh_token_db)

    clear_refresh_token_cookie(response)
    return {"message": "Logout effettuato con successo"}

@router.post("/admin-login", response_model=AdminLoginResponse)
async def admin_login(
    request: AdminLoginRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    """Endpoint per il login degli amministratori."""
    
    # Cerca utente per username con permesso di backoffice
    user = db.query(User).options(joinedload(User.role)).filter(
        User.nome == request.username.strip(),
    ).first()
    
    if not user or not user_has_permission(user, "backoffice.access"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenziali non valide"
        )
    
    # Verifica password
    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenziali non valide"
        )
    
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenziali non valide"
        )
    
    # Prepara risposta
    user_response = build_user_response_model(user)
    
    # Crea token di accesso (2 ore per admin, più corto)
    admin_access_token_expiry = ADMIN_TOKEN_EXPIRE_MINUTES
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome, "is_admin": user_has_permission(user, "backoffice.access")},
        expires_delta=timedelta(minutes=admin_access_token_expiry)
    )
    
    cleanup_refresh_tokens(db, user_id=user.id, remove_other_active=True)
    refresh_token_expires_delta = get_refresh_token_expires_delta(user)
    refresh_token = create_refresh_token(
        user.id,
        db,
        expires_delta=refresh_token_expires_delta,
        machine_id=None,
    )
    set_refresh_token_cookie(response, refresh_token, refresh_token_expires_delta)
    
    return AdminLoginResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=admin_access_token_expiry * 60,  # secondi
        user=user_response,
        is_admin=True,
        message=f"Benvenuto admin {user_response.nome}!"
    )
