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

class MachineResponse(MachineBase):
    id: int
    
    class Config:
        from_attributes = True