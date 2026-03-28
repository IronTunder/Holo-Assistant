from typing import Optional

from pydantic import BaseModel


class MachineBase(BaseModel):
    nome: str
    descrizione: Optional[str] = None
    id_postazione: Optional[str] = None


class MachineCreate(MachineBase):
    department_id: Optional[int] = None
    reparto: Optional[str] = None


class MachineUpdate(BaseModel):
    nome: Optional[str] = None
    department_id: Optional[int] = None
    reparto: Optional[str] = None
    descrizione: Optional[str] = None
    id_postazione: Optional[str] = None
    in_uso: Optional[bool] = None


class MachineResponse(MachineBase):
    id: int
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    reparto: Optional[str] = None
    in_uso: bool = False
    operatore_attuale_id: Optional[int] = None

    class Config:
        from_attributes = True
