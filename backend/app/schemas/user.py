from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from app.models.user import LivelloEsperienza, Turno

class UserBase(BaseModel):
    nome: str
    badge_id: str
    livello_esperienza: LivelloEsperienza
    reparto: str
    turno: Turno

class UserCreate(UserBase):
    pass

class UserResponse(UserBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

class BadgeLoginRequest(BaseModel):
    badge_id: str
    postazione_id: str  # ID della postazione (es. POST-001)

class BadgeLoginResponse(BaseModel):
    success: bool
    user: UserResponse
    machine: Optional["MachineResponse"] = None
    message: str

from app.schemas.machine import MachineResponse
BadgeLoginResponse.model_rebuild()