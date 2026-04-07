from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import relationship

from app.database import Base


class Machine(Base):
    __tablename__ = "machines"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False, unique=True)
    reparto_legacy = Column("reparto", String, nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True, index=True)
    descrizione = Column(Text, nullable=True)
    id_postazione = Column(String, unique=True, index=True, nullable=False)
    startup_checklist = Column(JSON, nullable=False, default=list)
    in_uso = Column(Boolean, default=False)
    operatore_attuale_id = Column(Integer, nullable=True)

    department = relationship("Department", back_populates="machines")
    knowledge_assignments = relationship(
        "MachineKnowledgeItem",
        back_populates="machine",
        cascade="all, delete-orphan",
    )

    @property
    def reparto(self) -> str:
        if self.department is not None:
            return self.department.name
        return self.reparto_legacy or ""

    @property
    def department_name(self) -> str:
        return self.reparto
