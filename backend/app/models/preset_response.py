from sqlalchemy import Column, Integer, String, Text, ForeignKey
from app.database import Base


class PresetResponse(Base):
    __tablename__ = "preset_responses"
    
    id = Column(Integer, primary_key=True, index=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True)  # Se NULL: valida per tutti i macchinari
    text = Column(Text, nullable=False)
    keywords = Column(String(500), nullable=True)
