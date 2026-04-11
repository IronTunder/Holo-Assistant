from typing import Optional

from pydantic import BaseModel, field_validator


def _validate_checklist(items: list[str]) -> list[str]:
    normalized = [item.strip() for item in items if isinstance(item, str)]
    if len(normalized) != len(items) or not normalized or any(not item for item in normalized):
        raise ValueError("startup_checklist must contain at least one non-empty item")
    return normalized


class WorkingStationBase(BaseModel):
    name: str
    description: Optional[str] = None
    station_code: str
    startup_checklist: list[str]


class WorkingStationCreate(WorkingStationBase):
    department_id: Optional[int] = None

    @field_validator("startup_checklist")
    @classmethod
    def validate_startup_checklist(cls, items: list[str]) -> list[str]:
        return _validate_checklist(items)


class WorkingStationUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    station_code: Optional[str] = None
    startup_checklist: Optional[list[str]] = None
    department_id: Optional[int] = None

    @field_validator("startup_checklist")
    @classmethod
    def validate_startup_checklist(cls, items: Optional[list[str]]) -> Optional[list[str]]:
        if items is None:
            return None
        return _validate_checklist(items)


class WorkingStationOperatorResponse(BaseModel):
    id: int
    nome: str
    badge_id: str
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    reparto: Optional[str] = None
    turno: str
    livello_esperienza: str


class WorkingStationAssignedMachineResponse(BaseModel):
    id: int
    nome: str
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    reparto: Optional[str] = None
    descrizione: Optional[str] = None
    id_postazione: Optional[str] = None
    startup_checklist: list[str]
    in_uso: bool = False
    operatore_attuale_id: Optional[int] = None


class WorkingStationResponse(WorkingStationBase):
    id: int
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    reparto: Optional[str] = None
    in_uso: bool = False
    operatore_attuale_id: Optional[int] = None
    operator: Optional[WorkingStationOperatorResponse] = None
    assigned_machine: Optional[WorkingStationAssignedMachineResponse] = None
    deleted: bool = False

    class Config:
        from_attributes = True
