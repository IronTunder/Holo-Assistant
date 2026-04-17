from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class OperationalTicket(Base):
    __tablename__ = "operational_tickets"

    id = Column(Integer, primary_key=True, index=True)
    workflow_type = Column(String(64), nullable=False, index=True)
    status = Column(String(32), nullable=False, default="open", index=True)
    priority = Column(String(32), nullable=False, default="normal", index=True)
    summary = Column(String(255), nullable=False)
    details = Column(Text, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    working_station_id = Column(Integer, ForeignKey("working_stations.id"), nullable=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True, index=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=True, index=True)
    interaction_log_id = Column(Integer, ForeignKey("interaction_logs.id"), nullable=True, index=True)
    conversation_state_id = Column(Integer, ForeignKey("operator_conversation_states.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    working_station = relationship("WorkingStation")
    machine = relationship("Machine")
    material = relationship("Material")
    interaction_log = relationship("InteractionLog")
    conversation_state = relationship("OperatorConversationState")
