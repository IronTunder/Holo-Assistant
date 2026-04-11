from typing import Optional, List

from pydantic import BaseModel, field_validator


class MachineBase(BaseModel):
    nome: str
    descrizione: Optional[str] = None
    id_postazione: Optional[str] = None
    startup_checklist: List[str]


class MachineCreate(MachineBase):
    department_id: Optional[int] = None
    working_station_id: Optional[int] = None
    reparto: Optional[str] = None

    @field_validator('startup_checklist')
    @classmethod
    def validate_checklist(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError('startup_checklist must contain at least one item')
        for item in v:
            if not isinstance(item, str):
                raise ValueError('all checklist items must be strings')
            if not item.strip():
                raise ValueError('checklist items cannot be empty strings')
        return v


class MachineUpdate(BaseModel):
    nome: Optional[str] = None
    department_id: Optional[int] = None
    working_station_id: Optional[int] = None
    reparto: Optional[str] = None
    descrizione: Optional[str] = None
    id_postazione: Optional[str] = None
    startup_checklist: Optional[List[str]] = None
    in_uso: Optional[bool] = None

    @field_validator('startup_checklist')
    @classmethod
    def validate_checklist(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        if not v:
            raise ValueError('startup_checklist must contain at least one item')
        for item in v:
            if not isinstance(item, str):
                raise ValueError('all checklist items must be strings')
            if not item.strip():
                raise ValueError('checklist items cannot be empty strings')
        return v


class MachineResponse(MachineBase):
    id: int
    department_id: Optional[int] = None
    working_station_id: Optional[int] = None
    department_name: Optional[str] = None
    reparto: Optional[str] = None
    startup_checklist: List[str]
    in_uso: bool = False
    operatore_attuale_id: Optional[int] = None

    class Config:
        from_attributes = True
