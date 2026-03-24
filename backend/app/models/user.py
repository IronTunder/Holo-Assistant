# backend/app/models/user.py

from sqlalchemy import Column, Integer, String, Enum, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from app.database import Base
import enum

class LivelloEsperienza(str, enum.Enum):
    APPRENDISTA = "apprendista"
    OPERAIO = "operaio"
    SENIOR = "senior"
    MANUTENTORE = "manutentore"

class Turno(str, enum.Enum):
    MATTINA = "mattina"
    POMERIGGIO = "pomeriggio"
    NOTTE = "notte"

class Ruolo(str, enum.Enum):
    OPERAIO = "operaio"
    ADMIN = "admin"

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    badge_id = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=True)  # Nuovo campo per la password
    ruolo = Column(Enum(Ruolo), default=Ruolo.OPERAIO, nullable=False)  # OPERAIO o ADMIN
    livello_esperienza = Column(Enum(LivelloEsperienza), nullable=False)
    reparto = Column(String, nullable=False)
    turno = Column(Enum(Turno), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    token = Column(String, unique=True, index=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())