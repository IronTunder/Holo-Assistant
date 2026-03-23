from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base

class InteractionLog(Base):
    __tablename__ = "interaction_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    domanda = Column(Text, nullable=False)
    risposta = Column(Text, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())