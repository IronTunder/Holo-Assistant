from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class OperatorChatSession(Base):
    __tablename__ = "operator_chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    working_station_id = Column(Integer, ForeignKey("working_stations.id"), nullable=False, index=True)
    refresh_token_id = Column(Integer, ForeignKey("refresh_tokens.id"), nullable=True, index=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    ended_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    working_station = relationship("WorkingStation")
    refresh_token = relationship("RefreshToken", foreign_keys=[refresh_token_id])
