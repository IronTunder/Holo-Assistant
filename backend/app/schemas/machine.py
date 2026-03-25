# backend/app/schemas/machine.py

from pydantic import BaseModel
from typing import Optional

class MachineBase(BaseModel):
    nome: str
    reparto: str
    descrizione: Optional[str] = None
    id_postazione: str

class MachineCreate(MachineBase):
    pass

class MachineUpdate(BaseModel):
    nome: Optional[str] = None
    reparto: Optional[str] = None
    descrizione: Optional[str] = None
    id_postazione: Optional[str] = None
    in_uso: Optional[bool] = None

class MachineResponse(MachineBase):
    id: int
    in_uso: bool = False
    operatore_attuale_id: Optional[int] = None
    
    class Config:
        from_attributes = True