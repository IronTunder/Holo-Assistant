from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import relationship

from app.database import Base


class WorkingStation(Base):
    __tablename__ = "working_stations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False, unique=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True, index=True)
    description = Column(Text, nullable=True)
    station_code = Column(String(120), nullable=False, unique=True, index=True)
    startup_checklist = Column(JSON, nullable=False, default=list)
    in_uso = Column(Boolean, default=False, nullable=False)
    operatore_attuale_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    department = relationship("Department")
    operator = relationship("User", foreign_keys=[operatore_attuale_id])
    assigned_machine = relationship("Machine", back_populates="working_station", uselist=False)
    knowledge_assignments = relationship(
        "WorkingStationKnowledgeItem",
        back_populates="working_station",
        cascade="all, delete-orphan",
    )
