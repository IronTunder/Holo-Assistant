from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.user import LivelloEsperienza, Turno


class UserBase(BaseModel):
    nome: str
    badge_id: str
    livello_esperienza: LivelloEsperienza
    turno: Turno


class UserCreate(UserBase):
    password: Optional[str] = None
    department_id: Optional[int] = None
    reparto: Optional[str] = None


class UserResponse(UserBase):
    id: int
    role_id: Optional[int] = None
    role_name: Optional[str] = None
    role_code: Optional[str] = None
    permissions: list[str] = Field(default_factory=list)
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    reparto: Optional[str] = None
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
