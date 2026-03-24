# backend/app/schemas/user.py

from pydantic import BaseModel
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
    password: Optional[str] = None  # Password opzionale per il login

class UserResponse(UserBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

class BadgeLoginRequest(BaseModel):
    badge_id: str
    machine_id: int

class CredentialsLoginRequest(BaseModel):
    username: str
    password: str
    machine_id: int

class BadgeLoginResponse(BaseModel):
    success: bool
    user: UserResponse
    machine: Optional["MachineResponse"] = None
    message: str

from app.schemas.machine import MachineResponse
BadgeLoginResponse.model_rebuild()