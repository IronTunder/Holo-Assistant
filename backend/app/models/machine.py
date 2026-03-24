from sqlalchemy import Column, Integer, String, Text, Boolean
from app.database import Base

class Machine(Base):
    __tablename__ = "machines"
    
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False, unique=True)
    reparto = Column(String, nullable=False)
    descrizione = Column(Text, nullable=True)
    id_postazione = Column(String, unique=True, index=True, nullable=False)
    in_uso = Column(Boolean, default=False)  
    operatore_attuale_id = Column(Integer, nullable=True)  