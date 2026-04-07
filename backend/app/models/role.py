from sqlalchemy import Column, Integer, String, Text
from app.database import Base

class Role(Base):
    __tablename__ = "roles"
    
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False, unique=True)
    permessi = Column(Text, nullable=True)  # JSON string o lista separata da virgole