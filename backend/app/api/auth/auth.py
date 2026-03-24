# backend/app/api/auth/auth.py

from fastapi import APIRouter, HTTPException, status, Depends, Header
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from jose import jwt, JWTError
from passlib.context import CryptContext
from typing import Optional
from pydantic import BaseModel
import os
from dotenv import load_dotenv
import secrets

from app.database import get_db
from app.models.user import User, RefreshToken, Ruolo
from app.models.machine import Machine
from app.schemas.user import UserResponse
from app.schemas.machine import MachineResponse

load_dotenv()

router = APIRouter()

# Usa solo pbkdf2_sha256 - NON usare bcrypt
pwd_context = CryptContext(
    schemes=["pbkdf2_sha256"],
    deprecated="auto",
    pbkdf2_sha256__default_rounds=29000  # Round per sicurezza
)

# Configurazione JWT
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))  # 8 hours
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))

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
    refresh_token: str

class LogoutRequest(BaseModel):
    user_id: int
    machine_id: int
    refresh_token: Optional[str] = None

class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int  # secondi fino a scadenza access token
    user: UserResponse
    machine: MachineResponse
    message: Optional[str] = None

class AdminLoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int  # secondi fino a scadenza access token
    user: UserResponse
    is_admin: bool = True
    message: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int

class TokenData(BaseModel):
    user_id: Optional[int] = None
    username: Optional[str] = None

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(user_id: int, machine_id: int, db: Session) -> str:
    """Genera un refresh token e lo salva nel database."""
    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    
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


@router.post("/badge-login", response_model=LoginResponse)
async def badge_login(
    request: BadgeLoginRequest,
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
    
    # Crea token di accesso e refresh token
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome}
    )
    refresh_token = create_refresh_token(user.id, machine.id, db)
    
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
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # secondi
        user=user_response,
        machine=machine_response,
        message=f"Benvenuto {user_response.nome}!"
    )

@router.post("/credentials-login", response_model=LoginResponse)
async def credentials_login(
    request: CredentialsLoginRequest,
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
    
    # Crea token di accesso e refresh token
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome}
    )
    refresh_token = create_refresh_token(user.id, machine.id, db)
    
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
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # secondi
        user=user_response,
        machine=machine_response,
        message=f"Benvenuto {user_response.nome}!"
    )

@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: RefreshTokenRequest,
    db: Session = Depends(get_db)
):
    """Endpoint per rinnovare l'access token usando un refresh token."""
    
    # Cerca il refresh token nel database
    refresh_token_db = db.query(RefreshToken).filter(
        RefreshToken.token == request.refresh_token
    ).first()
    
    if not refresh_token_db:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token non valido"
        )
    
    # Verifica se è stato revocato
    if refresh_token_db.is_revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token revocato"
        )
    
    # Verifica se è scaduto
    if refresh_token_db.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token scaduto"
        )
    
    # Genera nuovo access token
    user = db.query(User).filter(User.id == refresh_token_db.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Utente non trovato"
        )
    
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome}
    )
    
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )

@router.post("/logout")
async def logout(
    request: LogoutRequest,
    db: Session = Depends(get_db)
):
    """Endpoint per fare logout - libera la macchina e revoca il refresh token."""
    
    # Libera la macchina
    machine = db.query(Machine).filter(Machine.id == request.machine_id).first()
    if machine and machine.operatore_attuale_id == request.user_id:
        machine.in_uso = False
        machine.operatore_attuale_id = None
        db.commit()
    
    # Revoca il refresh token se fornito
    if request.refresh_token:
        refresh_token_db = db.query(RefreshToken).filter(
            RefreshToken.token == request.refresh_token
        ).first()
        if refresh_token_db:
            refresh_token_db.is_revoked = True
            db.commit()
    
    return {"message": "Logout effettuato con successo"}

@router.post("/admin-login", response_model=AdminLoginResponse)
async def admin_login(
    request: AdminLoginRequest,
    db: Session = Depends(get_db)
):
    """Endpoint per il login degli amministratori."""
    
    # Cerca utente per username con ruolo ADMIN
    user = db.query(User).filter(
        User.nome == request.username,
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
    admin_access_token_expiry = int(os.getenv("ADMIN_TOKEN_EXPIRE_MINUTES", "120"))
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome, "is_admin": True},
        expires_delta=timedelta(minutes=admin_access_token_expiry)
    )
    
    # Crea refresh token (non associato a macchina per admin)
    refresh_token_db = RefreshToken(
        user_id=user.id,
        machine_id=1,  # Dummy machine_id (admin non usa macchine)
        token=secrets.token_urlsafe(32),
        expires_at=datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        is_revoked=False
    )
    db.add(refresh_token_db)
    db.commit()
    
    return AdminLoginResponse(
        access_token=access_token,
        refresh_token=refresh_token_db.token,
        token_type="bearer",
        expires_in=admin_access_token_expiry * 60,  # secondi
        user=user_response,
        is_admin=True,
        message=f"Benvenuto admin {user_response.nome}!"
    )