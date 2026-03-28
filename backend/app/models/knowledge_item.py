from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class KnowledgeItem(Base):
    __tablename__ = "knowledge_items"

    id = Column(Integer, primary_key=True, index=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False, index=True)
    question_title = Column(String(255), nullable=False)
    answer_text = Column(Text, nullable=False)
    keywords = Column(String(500), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)

    category = relationship("Category", back_populates="knowledge_items")
    machine_assignments = relationship(
        "MachineKnowledgeItem",
        back_populates="knowledge_item",
        cascade="all, delete-orphan",
    )


class MachineKnowledgeItem(Base):
    __tablename__ = "machine_knowledge_items"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False, index=True)
    knowledge_item_id = Column(Integer, ForeignKey("knowledge_items.id"), nullable=False, index=True)
    is_enabled = Column(Boolean, nullable=False, default=True)

    machine = relationship("Machine", back_populates="knowledge_assignments")
    knowledge_item = relationship("KnowledgeItem", back_populates="machine_assignments")
