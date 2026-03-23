from sqlalchemy import Column, Integer, String, Enum, DateTime
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

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    badge_id = Column(String, unique=True, index=True, nullable=False)
    livello_esperienza = Column(Enum(LivelloEsperienza), nullable=False)
    reparto = Column(String, nullable=False)
    turno = Column(Enum(Turno), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())