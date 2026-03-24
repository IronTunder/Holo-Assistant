# backend/app/api/auth/auth.py

from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from jose import jwt
from passlib.context import CryptContext
from typing import Optional
from pydantic import BaseModel
import os
from dotenv import load_dotenv

from app.database import get_db
from app.models.user import User
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
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

class BadgeLoginRequest(BaseModel):
    badge_id: str
    machine_id: int

class CredentialsLoginRequest(BaseModel):
    username: str
    password: str
    machine_id: int

class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse
    machine: MachineResponse
    message: Optional[str] = None

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

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
    
    # Crea token
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome}
    )
    
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
    
    # Crea token
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.nome}
    )
    
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
        user=user_response,
        machine=machine_response,
        message=f"Benvenuto {user_response.nome}!"
    )

@router.post("/logout")
async def logout(
    user_id: int,
    machine_id: int,
    db: Session = Depends(get_db)
):
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if machine and machine.operatore_attuale_id == user_id:
        machine.in_uso = False
        machine.operatore_attuale_id = None
        db.commit()
    
    return {"message": "Logout effettuato con successo"}