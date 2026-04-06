from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class InteractionLog(Base):
    __tablename__ = "interaction_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    knowledge_item_id = Column(Integer, ForeignKey("knowledge_items.id"), nullable=True)
    domanda = Column(Text, nullable=False)
    risposta = Column(Text, nullable=True)
    feedback_status = Column(String(32), nullable=True, index=True)
    feedback_timestamp = Column(DateTime(timezone=True), nullable=True)
    action_type = Column(String(32), nullable=False, default="question", index=True)
    priority = Column(String(32), nullable=False, default="normal", index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")
    machine = relationship("Machine")
    category = relationship("Category")
    knowledge_item = relationship("KnowledgeItem")
