# backend/app/api/auth/auth.py

from fastapi import APIRouter, HTTPException, Request, Response, status, Depends, Header, Cookie
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
from typing import Literal, Optional
from pydantic import BaseModel
import asyncio
import os
from dotenv import load_dotenv
import secrets

from app.database import get_db
from app.models.user import User, RefreshToken, Ruolo
from app.models.machine import Machine
from app.schemas.user import UserResponse
from app.schemas.machine import MachineResponse
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
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))  # 8 hours
ADMIN_TOKEN_EXPIRE_MINUTES = int(os.getenv("ADMIN_TOKEN_EXPIRE_MINUTES", "120"))
OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES = int(os.getenv("OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES", "480"))
ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES = int(os.getenv("ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES", "120"))
SSE_TOKEN_EXPIRE_MINUTES = int(os.getenv("SSE_TOKEN_EXPIRE_MINUTES", "5"))
REFRESH_TOKEN_COOKIE_NAME = os.getenv("REFRESH_TOKEN_COOKIE_NAME", "ditto_refresh_token")
REFRESH_TOKEN_COOKIE_SECURE = os.getenv("REFRESH_TOKEN_COOKIE_SECURE", "false").lower() == "true"
REFRESH_TOKEN_COOKIE_SAMESITE = os.getenv("REFRESH_TOKEN_COOKIE_SAMESITE", "lax")

class BadgeLoginRequest(BaseModel):
    badge_id: str
    machine_id: int

class CredentialsLoginRequest(BaseModel):
    username: str
    password: str
    machine_id: int

class AdminLoginRequest(BaseModel):
    username: str
    password: str

class RefreshTokenRequest(BaseModel):
    refresh_token: Optional[str] = None


class RefreshTokenStatusRequest(BaseModel):
    refresh_token: Optional[str] = None

class SSETokenRequest(BaseModel):
    machine_id: int

class LogoutRequest(BaseModel):
    user_id: Optional[int] = None
    machine_id: Optional[int] = None
    refresh_token: Optional[str] = None

class LoginResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str
    expires_in: int  # secondi fino a scadenza access token
    user: UserResponse
    machine: MachineResponse
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
    if user.ruolo == Ruolo.ADMIN:
        return timedelta(minutes=ADMIN_TOKEN_EXPIRE_MINUTES)
    return timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)


def get_refresh_token_expires_delta(user: User) -> timedelta:
    if user.ruolo == Ruolo.ADMIN:
        return timedelta(minutes=ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES)
    return timedelta(minutes=OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES)


class SessionStatusResponse(BaseModel):
    session_valid: bool
    machine_assigned: bool
    machine_in_use: bool
    operator_matches: bool
    should_logout: bool
    reason: Literal["ok", "machine_released", "machine_reassigned", "machine_not_found"]


def _build_operator_payload(user: Optional[User]) -> Optional[dict]:
    if user is None:
        return None

    return {
        "id": user.id,
        "nome": user.nome,
        "badge_id": user.badge_id,
        "reparto": user.reparto,
        "turno": user.turno.value,
        "livello_esperienza": user.livello_esperienza.value,
    }


def build_admin_machine_event_payload(
    machine: Machine,
    operator: Optional[User] = None,
    deleted: bool = False,
) -> dict:
    return {
        "id": machine.id,
        "nome": machine.nome,
        "reparto": machine.reparto,
        "descrizione": machine.descrizione,
        "id_postazione": machine.id_postazione,
        "in_uso": machine.in_uso,
        "operatore_attuale_id": machine.operatore_attuale_id,
        "operator": _build_operator_payload(operator),
        "deleted": deleted,
    }


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = utc_now() + expires_delta
    else:
        expire = utc_now() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_sse_token(user_id: int, machine_id: int) -> str:
    expire = utc_now() + timedelta(minutes=SSE_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "machine_id": machine_id,
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
) -> str:
    """Genera un refresh token e lo salva nel database."""
    token = secrets.token_urlsafe(32)
    expires_at = utc_now() + expires_delta
    
    refresh_token_db = RefreshToken(
        user_id=user_id,
        machine_id=machine_id,
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
    
    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise credentials_exception
    return user

async def verify_admin(current_user: User = Depends(get_current_user)) -> User:
    """Dipendenza per verificare che l'utente sia un admin."""
    if current_user.ruolo != Ruolo.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso admin richiesto"
        )
    return current_user


def build_session_status_payload(
    machine: Optional[Machine],
    expected_user_id: int,
) -> SessionStatusResponse:
    if not machine:
        return SessionStatusResponse(
            session_valid=True,
            machine_assigned=False,
            machine_in_use=False,
            operator_matches=False,
            should_logout=True,
            reason="machine_not_found",
        )

    if not machine.in_uso:
        return SessionStatusResponse(
            session_valid=True,
            machine_assigned=False,
            machine_in_use=False,
            operator_matches=False,
            should_logout=True,
            reason="machine_released",
        )

    if machine.operatore_attuale_id is None:
        return SessionStatusResponse(
            session_valid=True,
            machine_assigned=False,
            machine_in_use=True,
            operator_matches=False,
            should_logout=True,
            reason="machine_released",
        )

    if machine.operatore_attuale_id != expected_user_id:
        return SessionStatusResponse(
            session_valid=True,
            machine_assigned=True,
            machine_in_use=True,
            operator_matches=False,
            should_logout=True,
            reason="machine_reassigned",
        )

    return SessionStatusResponse(
        session_valid=True,
        machine_assigned=True,
        machine_in_use=True,
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
    target_machine_id = machine.id if machine is not None else machine_id
    if target_machine_id is None:
        return

    payload = build_session_status_payload(machine, expected_user_id).model_dump()
    await session_event_bus.publish(target_machine_id, "session_status", payload)

    if machine is not None and db is not None:
        await publish_admin_machine_event(db, machine)


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

    if payload.get("sub") is None or payload.get("machine_id") is None:
        raise credentials_exception

    return payload


@router.get("/session-status", response_model=SessionStatusResponse)
async def session_status(
    machine_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Controlla lo stato minimo della sessione operatore e dell'assegnazione macchina."""
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    return build_session_status_payload(machine, current_user.id)


@router.get("/me", response_model=CurrentUserResponse)
async def get_current_session_user(
    current_user: User = Depends(get_current_user),
):
    return CurrentUserResponse(
        user=UserResponse(
            id=current_user.id,
            nome=current_user.nome,
            badge_id=current_user.badge_id,
            livello_esperienza=current_user.livello_esperienza.value,
            reparto=current_user.reparto,
            turno=current_user.turno.value,
            created_at=current_user.created_at,
        ),
        is_admin=current_user.ruolo == Ruolo.ADMIN,
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
        is_admin=current_user.ruolo == Ruolo.ADMIN,
    )


@router.post("/sse-token", response_model=SSETokenResponse)
async def create_operator_sse_token(
    request: SSETokenRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.ruolo == Ruolo.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Canale SSE disponibile solo per operatori",
        )

    machine = db.query(Machine).filter(Machine.id == request.machine_id).first()
    session_status_payload = build_session_status_payload(machine, current_user.id)
    if session_status_payload.should_logout:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La sessione macchina non e valida per aprire SSE",
        )

    token = create_sse_token(current_user.id, request.machine_id)
    return SSETokenResponse(
        token=token,
        expires_in=SSE_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/session-events")
async def session_events(
    request: Request,
    machine_id: int,
    token: str,
    db: Session = Depends(get_db),
):
    token_payload = decode_sse_token(token)
    token_machine_id = int(token_payload["machine_id"])
    token_user_id = int(token_payload["sub"])

    if token_machine_id != machine_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Machine ID SSE non valido",
        )

    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    initial_payload = build_session_status_payload(machine, token_user_id).model_dump()

    async def event_generator():
        stream = session_event_bus.stream(machine_id, initial_payload)
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
    # Verifica macchinario
    machine = db.query(Machine).filter(Machine.id == request.machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Macchinario non trovato"
        )
    
    if machine.in_uso:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Macchinario già in uso da un altro operatore"
        )
    
    # Cerca utente
    user = db.query(User).filter(User.badge_id == request.badge_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Badge non riconosciuto"
        )
    
    # Prepara risposta
    user_response = UserResponse(
        id=user.id,
        nome=user.nome,
        badge_id=user.badge_id,
        livello_esperienza=user.livello_esperienza.value,
        reparto=user.reparto,
        turno=user.turno.value,
        created_at=user.created_at
    )
    
    # Occupa macchinario
    machine.in_uso = True
    machine.operatore_attuale_id = user.id
    db.commit()
    await publish_machine_session_event(machine, user.id, db=db)
    
    # Crea token di accesso e refresh token
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome}
    )
    cleanup_refresh_tokens(db, user_id=user.id, remove_other_active=True)
    refresh_token_expires_delta = get_refresh_token_expires_delta(user)
    refresh_token = create_refresh_token(
        user.id,
        db,
        expires_delta=refresh_token_expires_delta,
        machine_id=machine.id,
    )
    set_refresh_token_cookie(response, refresh_token, refresh_token_expires_delta)
    
    machine_response = MachineResponse(
        id=machine.id,
        nome=machine.nome,
        reparto=machine.reparto,
        descrizione=machine.descrizione,
        id_postazione=machine.id_postazione,
        in_uso=True
    )
    
    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # secondi
        user=user_response,
        machine=machine_response,
        message=f"Benvenuto {user_response.nome}!"
    )

@router.post("/credentials-login", response_model=LoginResponse)
async def credentials_login(
    request: CredentialsLoginRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    # Verifica macchinario
    machine = db.query(Machine).filter(Machine.id == request.machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Macchinario non trovato"
        )
    
    if machine.in_uso:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Macchinario già in uso da un altro operatore"
        )
    
    # Cerca utente per username
    user = db.query(User).filter(User.nome == request.username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username non trovato"
        )
    
    # Verifica password
    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password non configurata per questo utente"
        )
    
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password non valida"
        )
    
    # Prepara risposta
    user_response = UserResponse(
        id=user.id,
        nome=user.nome,
        badge_id=user.badge_id,
        livello_esperienza=user.livello_esperienza.value,
        reparto=user.reparto,
        turno=user.turno.value,
        created_at=user.created_at
    )
    
    # Occupa macchinario
    machine.in_uso = True
    machine.operatore_attuale_id = user.id
    db.commit()
    await publish_machine_session_event(machine, user.id, db=db)
    
    # Crea token di accesso e refresh token
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome}
    )
    cleanup_refresh_tokens(db, user_id=user.id, remove_other_active=True)
    refresh_token_expires_delta = get_refresh_token_expires_delta(user)
    refresh_token = create_refresh_token(
        user.id,
        db,
        expires_delta=refresh_token_expires_delta,
        machine_id=machine.id,
    )
    set_refresh_token_cookie(response, refresh_token, refresh_token_expires_delta)
    
    machine_response = MachineResponse(
        id=machine.id,
        nome=machine.nome,
        reparto=machine.reparto,
        descrizione=machine.descrizione,
        id_postazione=machine.id_postazione,
        in_uso=True
    )
    
    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # secondi
        user=user_response,
        machine=machine_response,
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
        data={"sub": str(user.id), "username": user.nome, "is_admin": user.ruolo == Ruolo.ADMIN},
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
    db: Session = Depends(get_db),
    refresh_token_cookie: Optional[str] = Cookie(default=None, alias=REFRESH_TOKEN_COOKIE_NAME),
):
    """Endpoint per fare logout - libera la macchina e revoca il refresh token."""
    
    # Libera la macchina
    machine = None
    if request.machine_id is not None and request.user_id is not None:
        machine = db.query(Machine).filter(Machine.id == request.machine_id).first()

    if machine and machine.operatore_attuale_id == request.user_id:
        machine.in_uso = False
        machine.operatore_attuale_id = None
        db.commit()
        await publish_machine_session_event(machine, request.user_id, db=db)
    
    # Revoca il refresh token se fornito
    if request.user_id is not None:
        cleanup_refresh_tokens(db, user_id=request.user_id)

    refresh_token_value = refresh_token_cookie or request.refresh_token
    if refresh_token_value:
        refresh_token_db = db.query(RefreshToken).filter(
            RefreshToken.token == refresh_token_value
        ).first()
        if refresh_token_db:
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
    
    # Cerca utente per username con ruolo ADMIN
    user = db.query(User).filter(
        User.nome == request.username.strip(),
        User.ruolo == Ruolo.ADMIN
    ).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin username non trovato"
        )
    
    # Verifica password
    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password non configurata per questo utente"
        )
    
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password non valida"
        )
    
    # Prepara risposta
    user_response = UserResponse(
        id=user.id,
        nome=user.nome,
        badge_id=user.badge_id,
        livello_esperienza=user.livello_esperienza.value,
        reparto=user.reparto,
        turno=user.turno.value,
        created_at=user.created_at
    )
    
    # Crea token di accesso (2 ore per admin, più corto)
    admin_access_token_expiry = ADMIN_TOKEN_EXPIRE_MINUTES
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome, "is_admin": True},
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
