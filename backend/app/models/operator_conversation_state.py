from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class OperatorConversationState(Base):
    __tablename__ = "operator_conversation_states"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    working_station_id = Column(Integer, ForeignKey("working_stations.id"), nullable=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True, index=True)
    chat_session_id = Column(Integer, ForeignKey("operator_chat_sessions.id"), nullable=True, index=True)
    workflow_type = Column(String(64), nullable=False, index=True)
    state_status = Column(String(64), nullable=False, index=True)
    pending_action = Column(String(64), nullable=True)
    state_payload = Column(JSON, nullable=False, default=dict)
    last_user_message = Column(Text, nullable=True)
    last_assistant_message = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    user = relationship("User", foreign_keys=[user_id])
    working_station = relationship("WorkingStation")
    machine = relationship("Machine")
    chat_session = relationship("OperatorChatSession")
