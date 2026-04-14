import asyncio
import logging
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session, joinedload

from app.api.auth.auth import (
    get_password_hash,
    publish_admin_working_station_event,
    publish_admin_machine_event,
    publish_machine_session_event,
    verify_admin,
    verify_permission,
)
from app.core.database import get_db
from app.models.category import Category
from app.models.department import Department
from app.models.interaction_log import InteractionLog
from app.models.knowledge_item import KnowledgeItem, MachineKnowledgeItem, WorkingStationKnowledgeItem
from app.models.machine import Machine
from app.models.working_station import WorkingStation
from app.models.role import (
    ADMIN_ROLE_CODE,
    ADMIN_DEFAULT_PERMISSIONS,
    ALL_PERMISSIONS,
    Role,
    normalize_permissions,
)
from app.models.user import LivelloEsperienza, Ruolo, Turno, User
from app.schemas.interaction import FeedbackStatus, InteractionActionType, InteractionPriority
from app.api.presenters import (
    serialize_category,
    serialize_department,
    serialize_knowledge_item,
    serialize_machine,
    serialize_role,
    serialize_user,
    serialize_working_station,
)
from app.services.cache import admin_metadata_cache, cache_stats_payload
from app.services.admin_settings import SettingsValidationError, get_settings_payload, update_env_file
from app.services.knowledge_retrieval import knowledge_retrieval_service
from app.services.session_events import ADMIN_MACHINE_EVENTS_CHANNEL, session_event_bus

router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger(__name__)


class UserCreateRequest(BaseModel):
    nome: str
    badge_id: str
    password: str
    role_id: Optional[int] = None
    ruolo: str = "operaio"
    livello_esperienza: str
    department_id: int
    turno: str


class UserUpdateRequest(BaseModel):
    nome: Optional[str] = None
    badge_id: Optional[str] = None
    role_id: Optional[int] = None
    ruolo: Optional[str] = None
    livello_esperienza: Optional[str] = None
    department_id: Optional[int] = None
    turno: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    new_password: str


def _normalize_startup_checklist(items: List[str]) -> List[str]:
    normalized_items = [item.strip() for item in items if isinstance(item, str)]
    if len(normalized_items) != len(items) or not normalized_items or any(not item for item in normalized_items):
        raise ValueError("La checklist deve contenere almeno un controllo non vuoto")
    return normalized_items


def _user_has_active_machine_session(db: Session, user_id: int) -> bool:
    return (
        db.query(Machine)
        .filter(
            Machine.operatore_attuale_id == user_id,
            Machine.in_uso.is_(True),
        )
        .first()
        is not None
    )


def _ensure_machine_is_not_in_use(machine: Machine) -> None:
    if machine.in_uso:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Non puoi modificare o eliminare un macchinario mentre e in uso",
        )


def _ensure_working_station_is_not_in_use(working_station: WorkingStation) -> None:
    if working_station.in_uso:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Non puoi modificare o eliminare una postazione mentre e in uso",
        )


def _ensure_user_has_no_active_machine_session(db: Session, user_id: int) -> None:
    if _user_has_active_machine_session(db, user_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Non puoi modificare o eliminare un utente mentre sta usando un macchinario",
        )


class MachineCreateRequest(BaseModel):
    nome: str
    department_id: int
    working_station_id: Optional[int] = None
    descrizione: Optional[str] = None
    id_postazione: str
    startup_checklist: List[str]

    @field_validator("startup_checklist")
    @classmethod
    def validate_startup_checklist(cls, items: List[str]) -> List[str]:
        return _normalize_startup_checklist(items)


class MachineUpdateRequest(BaseModel):
    nome: Optional[str] = None
    department_id: Optional[int] = None
    working_station_id: Optional[int] = None
    descrizione: Optional[str] = None
    id_postazione: Optional[str] = None
    startup_checklist: Optional[List[str]] = None

    @field_validator("startup_checklist")
    @classmethod
    def validate_startup_checklist(cls, items: Optional[List[str]]) -> Optional[List[str]]:
        if items is None:
            return None
        return _normalize_startup_checklist(items)


class CategoryRequest(BaseModel):
    name: str
    description: Optional[str] = None


class DepartmentRequest(BaseModel):
    name: str
    code: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True


class WorkingStationRequest(BaseModel):
    name: str
    department_id: int
    description: Optional[str] = None
    station_code: str
    startup_checklist: List[str]

    @field_validator("startup_checklist")
    @classmethod
    def validate_startup_checklist(cls, items: List[str]) -> List[str]:
        return _normalize_startup_checklist(items)


class WorkingStationUpdateRequest(BaseModel):
    name: Optional[str] = None
    department_id: Optional[int] = None
    description: Optional[str] = None
    station_code: Optional[str] = None
    startup_checklist: Optional[List[str]] = None

    @field_validator("startup_checklist")
    @classmethod
    def validate_startup_checklist(cls, items: Optional[List[str]]) -> Optional[List[str]]:
        if items is None:
            return None
        return _normalize_startup_checklist(items)


class RoleRequest(BaseModel):
    name: str
    code: Optional[str] = None
    description: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)
    is_active: bool = True

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, permissions: List[str]) -> List[str]:
        normalized_permissions = normalize_permissions(permissions)
        invalid_permissions = [
            permission for permission in normalized_permissions if permission not in ALL_PERMISSIONS
        ]
        if invalid_permissions:
            raise ValueError(f"Permessi non validi: {', '.join(invalid_permissions)}")
        return normalized_permissions


class AdminSettingsUpdateRequest(BaseModel):
    settings: dict[str, str | int | float | bool]


class KnowledgeItemRequest(BaseModel):
    category_id: int
    question_title: str
    answer_text: str
    keywords: Optional[str] = None
    example_questions: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0
    working_station_ids: List[int] = Field(default_factory=list)


class DashboardSummaryResponse(BaseModel):
    total_users: int
    total_machines: int
    total_working_stations: int = 0
    machines_in_use: int
    machines_available: int
    active_departments: int
    knowledge_items: int
    recent_interactions: int


class InteractionLogResponse(BaseModel):
    id: int
    user_id: int
    user_name: str
    machine_id: int
    machine_name: str
    department_name: Optional[str] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    knowledge_item_id: Optional[int] = None
    knowledge_item_title: Optional[str] = None
    domanda: str
    risposta: Optional[str] = None
    feedback_status: Optional[FeedbackStatus] = None
    feedback_timestamp: Optional[datetime] = None
    resolved_by_user_id: Optional[int] = None
    resolved_by_user_name: Optional[str] = None
    resolution_note: Optional[str] = None
    resolution_timestamp: Optional[datetime] = None
    action_type: InteractionActionType = "question"
    priority: InteractionPriority = "normal"
    timestamp: datetime


def _parse_role(value: str) -> Ruolo:
    try:
        return Ruolo[value.upper()]
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ruolo non valido: {value}",
        ) from exc


def _parse_experience(value: str) -> LivelloEsperienza:
    try:
        return LivelloEsperienza[value.upper()]
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Livello esperienza non valido: {value}",
        ) from exc


def _parse_shift(value: str) -> Turno:
    try:
        return Turno[value.upper()]
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Turno non valido: {value}",
        ) from exc


def _require_department(db: Session, department_id: Optional[int]) -> Department:
    if department_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="department_id obbligatorio",
        )

    department = db.query(Department).filter(Department.id == department_id).first()
    if department is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reparto non valido",
        )
    return department


def _require_role(db: Session, role_id: Optional[int]) -> Role:
    if role_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="role_id obbligatorio",
        )

    role = db.query(Role).filter(Role.id == role_id).first()
    if role is None or not role.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ruolo non valido",
        )
    return role


def _role_from_legacy_value(db: Session, role_value: str) -> Role:
    parsed_role = _parse_role(role_value)
    role_code = ADMIN_ROLE_CODE if parsed_role == Ruolo.ADMIN else "operaio"
    role = db.query(Role).filter(Role.code == role_code, Role.is_active.is_(True)).first()
    if role is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ruolo di sistema non configurato")
    return role


def _legacy_role_for_role(role: Role) -> Ruolo:
    return Ruolo.ADMIN if role.code == ADMIN_ROLE_CODE else Ruolo.OPERAIO


def _ensure_last_admin_access_is_preserved(
    db: Session,
    user: Optional[User] = None,
    next_role: Optional[Role] = None,
) -> None:
    admin_role = db.query(Role).filter(Role.code == ADMIN_ROLE_CODE).first()
    if admin_role is None:
        return

    admin_user_count = db.query(User).filter(User.role_id == admin_role.id).count()
    if user is None:
        if admin_user_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Deve restare almeno un utente con ruolo Admin",
            )
        return

    if user.role_id != admin_role.id:
        return
    if next_role is not None and next_role.id == admin_role.id:
        return
    if admin_user_count <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Non puoi rimuovere l'ultimo accesso Admin",
        )


def _apply_role_request(role: Role, request: RoleRequest) -> None:
    role.name = request.name.strip()
    role.description = request.description
    role.permissions = request.permissions
    role.is_active = request.is_active
    if request.code is not None:
        role.code = request.code.strip() or None


def _build_machine_response(machine: Machine, operator: Optional[User] = None, deleted: bool = False) -> dict:
    return serialize_machine(machine, operator=operator, deleted=deleted)


def _build_working_station_response(
    working_station: WorkingStation,
    operator: Optional[User] = None,
    deleted: bool = False,
) -> dict:
    return serialize_working_station(working_station, operator=operator, deleted=deleted)


def _load_operator_map(db: Session, machines: List[Machine]) -> dict[int, User]:
    operator_ids = {
        machine.operatore_attuale_id
        for machine in machines
        if machine.operatore_attuale_id is not None
    }
    if not operator_ids:
        return {}
    operators = (
        db.query(User)
        .options(joinedload(User.department))
        .filter(User.id.in_(operator_ids))
        .all()
    )
    return {operator.id: operator for operator in operators}


def _apply_machine_assignments(
    db: Session,
    knowledge_item: KnowledgeItem,
    working_station_ids: List[int],
) -> list[int]:
    unique_working_station_ids = sorted(set(working_station_ids))
    if unique_working_station_ids:
        working_stations = (
            db.query(WorkingStation)
            .options(joinedload(WorkingStation.assigned_machine))
            .filter(WorkingStation.id.in_(unique_working_station_ids))
            .all()
        )
        if len(working_stations) != len(unique_working_station_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Una o piu postazioni selezionate non esistono",
            )
        unique_machine_ids = sorted(
            {
                working_station.assigned_machine.id
                for working_station in working_stations
                if working_station.assigned_machine is not None
            }
        )
    else:
        unique_machine_ids = []

    db.query(WorkingStationKnowledgeItem).filter(
        WorkingStationKnowledgeItem.knowledge_item_id == knowledge_item.id
    ).delete(synchronize_session=False)

    for working_station_id in unique_working_station_ids:
        db.add(
            WorkingStationKnowledgeItem(
                working_station_id=working_station_id,
                knowledge_item_id=knowledge_item.id,
                is_enabled=True,
            )
        )

    return unique_machine_ids


def _invalidate_knowledge_cache(machine_ids: List[int] | None = None) -> None:
    if machine_ids is None:
        knowledge_retrieval_service.invalidate_all()
    else:
        knowledge_retrieval_service.invalidate_machines(machine_ids)
    _invalidate_admin_metadata_cache()


def _get_admin_metadata_cache(key: tuple) -> Optional[Any]:
    cached = admin_metadata_cache.get(key)
    if cached is None:
        return None
    logger.debug("admin metadata cache hit key=%s", key)
    return cached


def _set_admin_metadata_cache(key: tuple, payload: Any) -> Any:
    admin_metadata_cache.set(key, payload)
    return payload


def _invalidate_admin_metadata_cache() -> None:
    deleted = admin_metadata_cache.clear()
    if deleted:
        logger.info("invalidated admin metadata cache entries=%s", deleted)


@router.get("/cache-status")
async def cache_status(
    admin: User = Depends(verify_admin),
):
    del admin
    return {
        **cache_stats_payload(),
        "knowledge": knowledge_retrieval_service.cache_stats(),
    }


@router.get("/settings")
async def get_admin_settings(
    admin: User = Depends(verify_permission("settings.view")),
):
    del admin
    return get_settings_payload()


@router.put("/settings")
async def update_admin_settings(
    request: AdminSettingsUpdateRequest,
    admin: User = Depends(verify_permission("settings.edit")),
):
    del admin
    try:
        return update_env_file(request.settings)
    except SettingsValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": "Impostazioni non valide", "errors": exc.errors},
        ) from exc


@router.get("/dashboard-summary", response_model=DashboardSummaryResponse)
async def dashboard_summary(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    cache_key = ("dashboard_summary",)
    cached = _get_admin_metadata_cache(cache_key)
    if cached is not None:
        return cached

    total_users = db.query(User).count()
    total_machines = db.query(Machine).count()
    total_working_stations = db.query(WorkingStation).count()
    machines_in_use = db.query(Machine).filter(Machine.in_uso.is_(True)).count()
    active_departments = db.query(Department).filter(Department.is_active.is_(True)).count()
    knowledge_items = db.query(KnowledgeItem).count()
    recent_interactions = (
        db.query(InteractionLog)
        .filter(InteractionLog.timestamp >= datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0))
        .count()
    )

    return _set_admin_metadata_cache(cache_key, DashboardSummaryResponse(
        total_users=total_users,
        total_machines=total_machines,
        total_working_stations=total_working_stations,
        machines_in_use=machines_in_use,
        machines_available=max(total_machines - machines_in_use, 0),
        active_departments=active_departments,
        knowledge_items=knowledge_items,
        recent_interactions=recent_interactions,
    ))


@router.get("/metadata/departments")
async def list_departments_metadata(
    include_inactive: bool = False,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    cache_key = ("metadata_departments", include_inactive)
    cached = _get_admin_metadata_cache(cache_key)
    if cached is not None:
        return cached

    query = db.query(Department).order_by(Department.name.asc())
    if not include_inactive:
        query = query.filter(Department.is_active.is_(True))
    return _set_admin_metadata_cache(cache_key, [serialize_department(department) for department in query.all()])


@router.get("/metadata/categories")
async def list_categories_metadata(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    cache_key = ("metadata_categories",)
    cached = _get_admin_metadata_cache(cache_key)
    if cached is not None:
        return cached

    categories = db.query(Category).order_by(Category.name.asc()).all()
    return _set_admin_metadata_cache(cache_key, [serialize_category(category) for category in categories])


@router.get("/metadata/machines")
async def list_machine_metadata(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    cache_key = ("metadata_machines",)
    cached = _get_admin_metadata_cache(cache_key)
    if cached is not None:
        return cached

    machines = db.query(Machine).options(joinedload(Machine.department)).order_by(Machine.nome.asc()).all()
    return _set_admin_metadata_cache(cache_key, [serialize_machine(machine) for machine in machines])


@router.get("/metadata/working-stations")
async def list_working_station_metadata(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    cache_key = ("metadata_working_stations",)
    cached = _get_admin_metadata_cache(cache_key)
    if cached is not None:
        return cached

    working_stations = (
        db.query(WorkingStation)
        .options(joinedload(WorkingStation.department), joinedload(WorkingStation.assigned_machine))
        .order_by(WorkingStation.name.asc())
        .all()
    )
    return _set_admin_metadata_cache(
        cache_key,
        [serialize_working_station(working_station) for working_station in working_stations],
    )


@router.get("/metadata/users")
async def list_user_metadata(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    cache_key = ("metadata_users",)
    cached = _get_admin_metadata_cache(cache_key)
    if cached is not None:
        return cached

    users = db.query(User).options(joinedload(User.department), joinedload(User.role)).order_by(User.nome.asc()).all()
    return _set_admin_metadata_cache(cache_key, [serialize_user(user) for user in users])


@router.get("/metadata/roles")
async def list_roles_metadata(
    include_inactive: bool = False,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    cache_key = ("metadata_roles", include_inactive)
    cached = _get_admin_metadata_cache(cache_key)
    if cached is not None:
        return cached

    query = db.query(Role).order_by(Role.name.asc())
    if not include_inactive:
        query = query.filter(Role.is_active.is_(True))
    return _set_admin_metadata_cache(cache_key, [serialize_role(role) for role in query.all()])


@router.get("/roles")
async def list_roles(
    include_inactive: bool = True,
    admin: User = Depends(verify_permission("roles.manage")),
    db: Session = Depends(get_db),
):
    del admin
    query = db.query(Role).order_by(Role.is_system.desc(), Role.name.asc())
    if not include_inactive:
        query = query.filter(Role.is_active.is_(True))
    return [serialize_role(role) for role in query.all()]


@router.get("/roles/{role_id}")
async def get_role(
    role_id: int,
    admin: User = Depends(verify_permission("roles.manage")),
    db: Session = Depends(get_db),
):
    del admin
    role = db.query(Role).filter(Role.id == role_id).first()
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ruolo non trovato")
    return serialize_role(role)


@router.post("/roles", status_code=status.HTTP_201_CREATED)
async def create_role(
    request: RoleRequest,
    admin: User = Depends(verify_permission("roles.manage")),
    db: Session = Depends(get_db),
):
    del admin
    role_name = request.name.strip()
    role_code = request.code.strip() if request.code else role_name.lower().replace(" ", "-")
    if db.query(Role).filter(Role.name == role_name).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ruolo gia esistente")
    if db.query(Role).filter(Role.code == role_code).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Codice ruolo gia esistente")

    role = Role(name=role_name, code=role_code, description=request.description, is_system=False, is_active=request.is_active)
    role.permissions = request.permissions
    db.add(role)
    db.commit()
    db.refresh(role)
    _invalidate_admin_metadata_cache()
    return serialize_role(role)


@router.put("/roles/{role_id}")
async def update_role(
    role_id: int,
    request: RoleRequest,
    admin: User = Depends(verify_permission("roles.manage")),
    db: Session = Depends(get_db),
):
    del admin
    role = db.query(Role).filter(Role.id == role_id).first()
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ruolo non trovato")
    if role.is_system and role.code == ADMIN_ROLE_CODE:
        if not request.is_active or set(request.permissions) != set(ADMIN_DEFAULT_PERMISSIONS):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Il ruolo Admin di sistema deve restare attivo con tutti i permessi")
    duplicate_name = db.query(Role).filter(Role.name == request.name.strip(), Role.id != role_id).first()
    if duplicate_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ruolo gia esistente")
    if request.code is not None:
        duplicate_code = db.query(Role).filter(Role.code == request.code.strip(), Role.id != role_id).first()
        if duplicate_code:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Codice ruolo gia esistente")

    _apply_role_request(role, request)
    if role.is_system and role.code == ADMIN_ROLE_CODE:
        role.permissions = ADMIN_DEFAULT_PERMISSIONS
        role.is_active = True
    db.commit()
    db.refresh(role)
    _invalidate_admin_metadata_cache()
    return serialize_role(role)


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: int,
    admin: User = Depends(verify_permission("roles.manage")),
    db: Session = Depends(get_db),
):
    del admin
    role = db.query(Role).filter(Role.id == role_id).first()
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ruolo non trovato")
    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="I ruoli di sistema non possono essere eliminati")
    if db.query(User).filter(User.role_id == role_id).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ruolo assegnato ad almeno un utente")
    db.delete(role)
    db.commit()
    _invalidate_admin_metadata_cache()
    return None


@router.get("/departments")
async def list_departments(
    include_inactive: bool = True,
    admin: User = Depends(verify_permission("departments.manage")),
    db: Session = Depends(get_db),
):
    del admin
    query = db.query(Department).order_by(Department.name.asc())
    if not include_inactive:
        query = query.filter(Department.is_active.is_(True))
    return [serialize_department(department) for department in query.all()]


@router.post("/departments", status_code=status.HTTP_201_CREATED)
async def create_department(
    request: DepartmentRequest,
    admin: User = Depends(verify_permission("departments.manage")),
    db: Session = Depends(get_db),
):
    del admin
    department_name = request.name.strip()
    department_code = request.code.strip() if request.code else department_name.lower().replace(" ", "-")
    if db.query(Department).filter(Department.name == department_name).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reparto gia esistente")
    if db.query(Department).filter(Department.code == department_code).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Codice reparto gia esistente")
    department = Department(
        name=department_name,
        code=department_code,
        description=request.description,
        is_active=request.is_active,
    )
    db.add(department)
    db.commit()
    db.refresh(department)
    _invalidate_admin_metadata_cache()
    return serialize_department(department)


@router.put("/departments/{department_id}")
async def update_department(
    department_id: int,
    request: DepartmentRequest,
    admin: User = Depends(verify_permission("departments.manage")),
    db: Session = Depends(get_db),
):
    del admin
    department = db.query(Department).filter(Department.id == department_id).first()
    if department is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reparto non trovato")
    duplicate_name = db.query(Department).filter(Department.name == request.name.strip(), Department.id != department_id).first()
    if duplicate_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reparto gia esistente")
    if request.code is not None:
        duplicate_code = db.query(Department).filter(Department.code == request.code.strip(), Department.id != department_id).first()
        if duplicate_code:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Codice reparto gia esistente")

    department.name = request.name.strip()
    department.code = request.code.strip() if request.code else department.code
    department.description = request.description
    department.is_active = request.is_active
    db.commit()
    db.refresh(department)
    _invalidate_admin_metadata_cache()
    return serialize_department(department)


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_department(
    department_id: int,
    admin: User = Depends(verify_permission("departments.manage")),
    db: Session = Depends(get_db),
):
    del admin
    department = db.query(Department).filter(Department.id == department_id).first()
    if department is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reparto non trovato")
    has_users = db.query(User).filter(User.department_id == department_id).first() is not None
    has_machines = db.query(Machine).filter(Machine.department_id == department_id).first() is not None
    if has_users or has_machines:
        department.is_active = False
        db.commit()
        _invalidate_admin_metadata_cache()
        return None
    db.delete(department)
    db.commit()
    _invalidate_admin_metadata_cache()
    return None


@router.get("/users")
async def list_users(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    department_id: Optional[int] = None,
    ruolo: Optional[str] = None,
    turno: Optional[str] = None,
    admin: User = Depends(verify_permission("users.manage")),
    db: Session = Depends(get_db),
):
    del admin
    query = db.query(User).options(joinedload(User.department), joinedload(User.role))
    if department_id is not None:
        query = query.filter(User.department_id == department_id)
    if ruolo:
        query = query.filter(User.ruolo == _parse_role(ruolo))
    if turno:
        query = query.filter(User.turno == _parse_shift(turno))

    users = query.order_by(User.nome.asc()).offset((page - 1) * size).limit(size).all()
    return [serialize_user(user) for user in users]


@router.get("/users/{user_id}")
async def get_user(
    user_id: int,
    admin: User = Depends(verify_permission("users.manage")),
    db: Session = Depends(get_db),
):
    del admin
    user = (
        db.query(User)
        .options(joinedload(User.department), joinedload(User.role))
        .filter(User.id == user_id)
        .first()
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")
    return serialize_user(user)


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(
    request: UserCreateRequest,
    admin: User = Depends(verify_permission("users.manage")),
    db: Session = Depends(get_db),
):
    del admin
    if db.query(User).filter(User.nome == request.nome).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Utente con questo nome gia esiste")
    if db.query(User).filter(User.badge_id == request.badge_id).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Badge ID gia utilizzato")

    department = _require_department(db, request.department_id)
    role = _require_role(db, request.role_id) if request.role_id is not None else _role_from_legacy_value(db, request.ruolo)
    user = User(
        nome=request.nome,
        badge_id=request.badge_id,
        password_hash=get_password_hash(request.password),
        ruolo=_legacy_role_for_role(role),
        role_id=role.id,
        livello_esperienza=_parse_experience(request.livello_esperienza),
        department_id=department.id,
        reparto_legacy=department.name,
        turno=_parse_shift(request.turno),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.refresh(department)
    db.refresh(role)
    _invalidate_admin_metadata_cache()
    return serialize_user(user)


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    request: UserUpdateRequest,
    admin: User = Depends(verify_permission("users.manage")),
    db: Session = Depends(get_db),
):
    del admin
    user = db.query(User).options(joinedload(User.department), joinedload(User.role)).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")
    _ensure_user_has_no_active_machine_session(db, user_id)

    if request.nome is not None:
        user.nome = request.nome
    if request.badge_id is not None:
        duplicate_badge = (
            db.query(User)
            .filter(User.badge_id == request.badge_id, User.id != user_id)
            .first()
        )
        if duplicate_badge:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Badge ID gia utilizzato")
        user.badge_id = request.badge_id
    next_role: Optional[Role] = None
    if request.role_id is not None:
        next_role = _require_role(db, request.role_id)
    elif request.ruolo is not None:
        next_role = _role_from_legacy_value(db, request.ruolo)
    if next_role is not None:
        _ensure_last_admin_access_is_preserved(db, user=user, next_role=next_role)
        user.role_id = next_role.id
        user.ruolo = _legacy_role_for_role(next_role)
    if request.livello_esperienza is not None:
        user.livello_esperienza = _parse_experience(request.livello_esperienza)
    if request.turno is not None:
        user.turno = _parse_shift(request.turno)
    if request.department_id is not None:
        department = _require_department(db, request.department_id)
        user.department_id = department.id
        user.reparto_legacy = department.name

    db.commit()
    db.refresh(user)
    _invalidate_admin_metadata_cache()
    return serialize_user(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    admin: User = Depends(verify_permission("users.manage")),
    db: Session = Depends(get_db),
):
    del admin
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")
    _ensure_user_has_no_active_machine_session(db, user_id)
    _ensure_last_admin_access_is_preserved(db, user=user, next_role=None)
    db.delete(user)
    db.commit()
    _invalidate_admin_metadata_cache()
    return None


@router.post("/users/{user_id}/reset-password", response_model=dict)
async def reset_user_password(
    user_id: int,
    request: ResetPasswordRequest,
    admin: User = Depends(verify_permission("users.manage")),
    db: Session = Depends(get_db),
):
    del admin
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")
    user.password_hash = get_password_hash(request.new_password)
    db.commit()
    _invalidate_admin_metadata_cache()
    return {"message": "Password resettata con successo"}


@router.get("/machines")
async def list_machines(
    department_id: Optional[int] = None,
    in_use: Optional[bool] = None,
    admin: User = Depends(verify_permission("machines.manage")),
    db: Session = Depends(get_db),
):
    del admin
    query = db.query(Machine).options(joinedload(Machine.department))
    if department_id is not None:
        query = query.filter(Machine.department_id == department_id)
    if in_use is not None:
        query = query.filter(Machine.in_uso.is_(in_use))

    machines = query.order_by(Machine.nome.asc()).all()
    operator_map = _load_operator_map(db, machines)
    return [_build_machine_response(machine, operator_map.get(machine.operatore_attuale_id)) for machine in machines]


@router.get("/machines/{machine_id}")
async def get_machine(
    machine_id: int,
    admin: User = Depends(verify_permission("machines.manage")),
    db: Session = Depends(get_db),
):
    del admin
    machine = (
        db.query(Machine)
        .options(joinedload(Machine.department))
        .filter(Machine.id == machine_id)
        .first()
    )
    if machine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macchinario non trovato")
    operator = None
    if machine.operatore_attuale_id is not None:
        operator = (
            db.query(User)
            .options(joinedload(User.department))
            .filter(User.id == machine.operatore_attuale_id)
            .first()
        )
    return _build_machine_response(machine, operator)


@router.post("/machines", status_code=status.HTTP_201_CREATED)
async def create_machine(
    request: MachineCreateRequest,
    admin: User = Depends(verify_permission("machines.manage")),
    db: Session = Depends(get_db),
):
    del admin
    if db.query(Machine).filter(Machine.nome == request.nome).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Macchinario con questo nome gia esiste")
    if db.query(Machine).filter(Machine.id_postazione == request.id_postazione).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID postazione gia utilizzato")
    if request.working_station_id is not None:
        duplicate_station = db.query(Machine).filter(Machine.working_station_id == request.working_station_id).first()
        if duplicate_station is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Postazione gia associata a un altro macchinario")

    department = _require_department(db, request.department_id)
    working_station = None
    if request.working_station_id is not None:
        working_station = (
            db.query(WorkingStation)
            .options(joinedload(WorkingStation.assigned_machine))
            .filter(WorkingStation.id == request.working_station_id)
            .first()
        )
        if working_station is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Postazione non valida")
    machine = Machine(
        nome=request.nome,
        department_id=department.id,
        working_station_id=working_station.id if working_station else None,
        reparto_legacy=department.name,
        descrizione=request.descrizione,
        id_postazione=request.id_postazione,
        startup_checklist=request.startup_checklist,
        in_uso=False,
    )
    db.add(machine)
    db.commit()
    db.refresh(machine)
    _invalidate_admin_metadata_cache()
    await publish_admin_machine_event(db, machine)
    if working_station is not None:
        await publish_admin_working_station_event(db, working_station)
    return _build_machine_response(machine)


@router.put("/machines/{machine_id}")
async def update_machine(
    machine_id: int,
    request: MachineUpdateRequest,
    admin: User = Depends(verify_permission("machines.manage")),
    db: Session = Depends(get_db),
):
    del admin
    machine = db.query(Machine).options(joinedload(Machine.department)).filter(Machine.id == machine_id).first()
    if machine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macchinario non trovato")
    _ensure_machine_is_not_in_use(machine)

    if request.nome is not None:
        machine.nome = request.nome
    if request.descrizione is not None:
        machine.descrizione = request.descrizione
    if request.id_postazione is not None:
        duplicate_station = (
            db.query(Machine)
            .filter(Machine.id_postazione == request.id_postazione, Machine.id != machine_id)
            .first()
        )
        if duplicate_station:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID postazione gia utilizzato")
        machine.id_postazione = request.id_postazione
    if request.working_station_id is not None:
        if request.working_station_id:
            duplicate_station = (
                db.query(Machine)
                .filter(Machine.working_station_id == request.working_station_id, Machine.id != machine_id)
                .first()
            )
            if duplicate_station is not None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Postazione gia associata a un altro macchinario")
            working_station = db.query(WorkingStation).filter(WorkingStation.id == request.working_station_id).first()
            if working_station is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Postazione non valida")
            machine.working_station_id = working_station.id
        else:
            machine.working_station_id = None
    if request.startup_checklist is not None:
        machine.startup_checklist = request.startup_checklist
    if request.department_id is not None:
        department = _require_department(db, request.department_id)
        machine.department_id = department.id
        machine.reparto_legacy = department.name

    db.commit()
    db.refresh(machine)
    _invalidate_admin_metadata_cache()
    await publish_admin_machine_event(db, machine)
    return _build_machine_response(machine)


@router.delete("/machines/{machine_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_machine(
    machine_id: int,
    admin: User = Depends(verify_permission("machines.manage")),
    db: Session = Depends(get_db),
):
    del admin
    machine = db.query(Machine).options(joinedload(Machine.department)).filter(Machine.id == machine_id).first()
    if machine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macchinario non trovato")
    _ensure_machine_is_not_in_use(machine)

    deleted_machine_id = machine.id
    deleted_payload_machine = Machine(
        id=machine.id,
        nome=machine.nome,
        department_id=machine.department_id,
        reparto_legacy=machine.reparto_legacy,
        descrizione=machine.descrizione,
        id_postazione=machine.id_postazione,
        startup_checklist=machine.startup_checklist,
        in_uso=machine.in_uso,
        operatore_attuale_id=machine.operatore_attuale_id,
    )
    deleted_payload_machine.department = machine.department
    db.delete(machine)
    db.commit()
    knowledge_retrieval_service.invalidate_machine(deleted_machine_id)
    _invalidate_admin_metadata_cache()
    await publish_admin_machine_event(db, deleted_payload_machine, deleted=True)
    await publish_machine_session_event(None, -1, machine_id=deleted_machine_id)
    return None


@router.post("/machines/{machine_id}/reset-status", response_model=dict)
async def reset_machine_status(
    machine_id: int,
    admin: User = Depends(verify_permission("machines.manage")),
    db: Session = Depends(get_db),
):
    del admin
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if machine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macchinario non trovato")

    machine.in_uso = False
    machine.operatore_attuale_id = None
    db.commit()
    _invalidate_admin_metadata_cache()
    await publish_machine_session_event(machine, -1, db=db)
    return {"message": f"Macchinario {machine.nome} liberato"}


@router.get("/working-stations")
async def list_working_stations(
    department_id: Optional[int] = None,
    in_use: Optional[bool] = None,
    admin: User = Depends(verify_permission("machines.manage")),
    db: Session = Depends(get_db),
):
    del admin
    query = db.query(WorkingStation).options(
        joinedload(WorkingStation.department),
        joinedload(WorkingStation.assigned_machine),
    )
    if department_id is not None:
        query = query.filter(WorkingStation.department_id == department_id)
    if in_use is not None:
        query = query.filter(WorkingStation.in_uso.is_(in_use))
    return [
        _build_working_station_response(working_station)
        for working_station in query.order_by(WorkingStation.name.asc()).all()
    ]


@router.post("/working-stations", status_code=status.HTTP_201_CREATED)
async def create_working_station(
    request: WorkingStationRequest,
    admin: User = Depends(verify_permission("machines.manage")),
    db: Session = Depends(get_db),
):
    del admin
    if db.query(WorkingStation).filter(WorkingStation.name == request.name.strip()).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Postazione gia esistente")
    if db.query(WorkingStation).filter(WorkingStation.station_code == request.station_code.strip()).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Codice postazione gia utilizzato")

    department = _require_department(db, request.department_id)
    working_station = WorkingStation(
        name=request.name.strip(),
        department_id=department.id,
        description=request.description,
        station_code=request.station_code.strip(),
        startup_checklist=request.startup_checklist,
        in_uso=False,
    )
    db.add(working_station)
    db.commit()
    db.refresh(working_station)
    _invalidate_admin_metadata_cache()
    await publish_admin_working_station_event(db, working_station)
    return _build_working_station_response(working_station)


@router.put("/working-stations/{working_station_id}")
async def update_working_station(
    working_station_id: int,
    request: WorkingStationUpdateRequest,
    admin: User = Depends(verify_permission("machines.manage")),
    db: Session = Depends(get_db),
):
    del admin
    working_station = (
        db.query(WorkingStation)
        .options(joinedload(WorkingStation.assigned_machine), joinedload(WorkingStation.department))
        .filter(WorkingStation.id == working_station_id)
        .first()
    )
    if working_station is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Postazione non trovata")
    _ensure_working_station_is_not_in_use(working_station)

    if request.name is not None:
        duplicate_name = (
            db.query(WorkingStation)
            .filter(WorkingStation.name == request.name.strip(), WorkingStation.id != working_station_id)
            .first()
        )
        if duplicate_name is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Postazione gia esistente")
        working_station.name = request.name.strip()
    if request.station_code is not None:
        duplicate_code = (
            db.query(WorkingStation)
            .filter(WorkingStation.station_code == request.station_code.strip(), WorkingStation.id != working_station_id)
            .first()
        )
        if duplicate_code is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Codice postazione gia utilizzato")
        working_station.station_code = request.station_code.strip()
    if request.description is not None:
        working_station.description = request.description
    if request.startup_checklist is not None:
        working_station.startup_checklist = request.startup_checklist
    if request.department_id is not None:
        department = _require_department(db, request.department_id)
        working_station.department_id = department.id

    db.commit()
    db.refresh(working_station)
    _invalidate_admin_metadata_cache()
    await publish_admin_working_station_event(db, working_station)
    return _build_working_station_response(working_station)


@router.delete("/working-stations/{working_station_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_working_station(
    working_station_id: int,
    admin: User = Depends(verify_permission("machines.manage")),
    db: Session = Depends(get_db),
):
    del admin
    working_station = (
        db.query(WorkingStation)
        .options(joinedload(WorkingStation.assigned_machine), joinedload(WorkingStation.department))
        .filter(WorkingStation.id == working_station_id)
        .first()
    )
    if working_station is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Postazione non trovata")
    _ensure_working_station_is_not_in_use(working_station)
    if working_station.assigned_machine is not None:
        working_station.assigned_machine.working_station_id = None

    payload = WorkingStation(
        id=working_station.id,
        name=working_station.name,
        department_id=working_station.department_id,
        description=working_station.description,
        station_code=working_station.station_code,
        startup_checklist=working_station.startup_checklist,
        in_uso=working_station.in_uso,
        operatore_attuale_id=working_station.operatore_attuale_id,
    )
    payload.department = working_station.department
    db.delete(working_station)
    db.commit()
    _invalidate_admin_metadata_cache()
    await publish_admin_working_station_event(db, payload, deleted=True)
    return None


@router.get("/machine-events")
async def machine_events(
    request: Request,
    admin: User = Depends(verify_admin),
):
    del admin

    async def event_generator():
        stream = session_event_bus.stream(
            ADMIN_MACHINE_EVENTS_CHANNEL,
            initial_payload=None,
            initial_event_name="machine_status",
            send_initial=False,
        )
        async for message in stream:
            if await request.is_disconnected():
                break
            yield message
            await asyncio.sleep(0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.get("/categories")
async def list_categories(
    admin: User = Depends(verify_permission("knowledge.manage")),
    db: Session = Depends(get_db),
):
    del admin
    return [serialize_category(category) for category in db.query(Category).order_by(Category.name.asc()).all()]


@router.post("/categories", status_code=status.HTTP_201_CREATED)
async def create_category(
    request: CategoryRequest,
    admin: User = Depends(verify_permission("knowledge.manage")),
    db: Session = Depends(get_db),
):
    del admin
    existing = db.query(Category).filter(Category.name == request.name.strip()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Categoria gia esistente")
    category = Category(name=request.name.strip(), description=request.description)
    db.add(category)
    db.commit()
    db.refresh(category)
    _invalidate_knowledge_cache()
    return serialize_category(category)


@router.put("/categories/{category_id}")
async def update_category(
    category_id: int,
    request: CategoryRequest,
    admin: User = Depends(verify_permission("knowledge.manage")),
    db: Session = Depends(get_db),
):
    del admin
    category = db.query(Category).filter(Category.id == category_id).first()
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Categoria non trovata")
    category.name = request.name.strip()
    category.description = request.description
    db.commit()
    db.refresh(category)
    _invalidate_knowledge_cache()
    return serialize_category(category)


@router.get("/knowledge-items")
async def list_knowledge_items(
    category_id: Optional[int] = None,
    machine_id: Optional[int] = None,
    include_inactive: bool = False,
    admin: User = Depends(verify_permission("knowledge.manage")),
    db: Session = Depends(get_db),
):
    del admin
    query = db.query(KnowledgeItem).options(
        joinedload(KnowledgeItem.category),
        joinedload(KnowledgeItem.working_station_assignments),
    )
    if category_id is not None:
        query = query.filter(KnowledgeItem.category_id == category_id)
    if not include_inactive:
        query = query.filter(KnowledgeItem.is_active.is_(True))

    knowledge_items = query.order_by(KnowledgeItem.sort_order.asc(), KnowledgeItem.question_title.asc()).all()
    payload = []
    for knowledge_item in knowledge_items:
        assigned_working_station_ids = sorted(
            {
                assignment.working_station_id
                for assignment in knowledge_item.working_station_assignments
                if assignment.is_enabled
            }
        )
        if machine_id is not None:
            machine = db.query(Machine).filter(Machine.id == machine_id).first()
            if machine is None or machine.working_station_id is None or machine.working_station_id not in assigned_working_station_ids:
                continue
        payload.append(
            serialize_knowledge_item(
                knowledge_item,
                assigned_working_station_ids=assigned_working_station_ids,
                assignment_count=len(assigned_working_station_ids),
            )
        )
    return payload


@router.get("/machines/{machine_id}/knowledge")
async def list_machine_knowledge(
    machine_id: int,
    admin: User = Depends(verify_permission("knowledge.manage")),
    db: Session = Depends(get_db),
):
    del admin
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if machine is None or machine.working_station_id is None:
        return []
    assignments = (
        db.query(WorkingStationKnowledgeItem)
        .options(
            joinedload(WorkingStationKnowledgeItem.knowledge_item).joinedload(KnowledgeItem.category)
        )
        .filter(
            WorkingStationKnowledgeItem.working_station_id == machine.working_station_id,
            WorkingStationKnowledgeItem.is_enabled.is_(True),
        )
        .all()
    )
    return [
        {
            **serialize_knowledge_item(
                assignment.knowledge_item,
                assigned_working_station_ids=[machine.working_station_id],
                assignment_count=1,
            ),
            "assignment_id": assignment.id,
        }
        for assignment in assignments
    ]


@router.post("/knowledge-items", status_code=status.HTTP_201_CREATED)
async def create_knowledge_item(
    request: KnowledgeItemRequest,
    admin: User = Depends(verify_permission("knowledge.manage")),
    db: Session = Depends(get_db),
):
    del admin
    category = db.query(Category).filter(Category.id == request.category_id).first()
    if category is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Categoria non valida")

    knowledge_item = KnowledgeItem(
        category_id=request.category_id,
        question_title=request.question_title.strip(),
        answer_text=request.answer_text.strip(),
        keywords=request.keywords,
        example_questions=request.example_questions.strip() if request.example_questions else None,
        is_active=request.is_active,
        sort_order=request.sort_order,
    )
    db.add(knowledge_item)
    db.flush()
    resolved_machine_ids = _apply_machine_assignments(db, knowledge_item, request.working_station_ids)
    db.commit()
    db.refresh(knowledge_item)
    _invalidate_knowledge_cache(resolved_machine_ids)
    knowledge_item = (
        db.query(KnowledgeItem)
        .options(
            joinedload(KnowledgeItem.category),
            joinedload(KnowledgeItem.working_station_assignments),
        )
        .filter(KnowledgeItem.id == knowledge_item.id)
        .first()
    )
    return serialize_knowledge_item(knowledge_item)


@router.put("/knowledge-items/{knowledge_item_id}")
async def update_knowledge_item(
    knowledge_item_id: int,
    request: KnowledgeItemRequest,
    admin: User = Depends(verify_permission("knowledge.manage")),
    db: Session = Depends(get_db),
):
    del admin
    knowledge_item = (
        db.query(KnowledgeItem)
        .options(
            joinedload(KnowledgeItem.working_station_assignments),
        )
        .filter(KnowledgeItem.id == knowledge_item_id)
        .first()
    )
    if knowledge_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge item non trovato")

    if db.query(Category).filter(Category.id == request.category_id).first() is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Categoria non valida")

    previous_machine_ids = sorted(
        {
            assignment.working_station.assigned_machine.id
            for assignment in knowledge_item.working_station_assignments
            if assignment.is_enabled
            and assignment.working_station is not None
            and assignment.working_station.assigned_machine is not None
        }
    )
    knowledge_item.category_id = request.category_id
    knowledge_item.question_title = request.question_title.strip()
    knowledge_item.answer_text = request.answer_text.strip()
    knowledge_item.keywords = request.keywords
    knowledge_item.example_questions = request.example_questions.strip() if request.example_questions else None
    knowledge_item.is_active = request.is_active
    knowledge_item.sort_order = request.sort_order
    resolved_machine_ids = _apply_machine_assignments(db, knowledge_item, request.working_station_ids)
    db.commit()
    _invalidate_knowledge_cache(previous_machine_ids + resolved_machine_ids)

    knowledge_item = (
        db.query(KnowledgeItem)
        .options(
            joinedload(KnowledgeItem.category),
            joinedload(KnowledgeItem.working_station_assignments),
        )
        .filter(KnowledgeItem.id == knowledge_item_id)
        .first()
    )
    return serialize_knowledge_item(knowledge_item)


@router.delete("/knowledge-items/{knowledge_item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_item(
    knowledge_item_id: int,
    admin: User = Depends(verify_permission("knowledge.manage")),
    db: Session = Depends(get_db),
):
    del admin
    knowledge_item = db.query(KnowledgeItem).filter(KnowledgeItem.id == knowledge_item_id).first()
    if knowledge_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge item non trovato")
    machine_ids = sorted(
        {
            assignment.working_station.assigned_machine.id
            for assignment in db.query(WorkingStationKnowledgeItem)
            .options(joinedload(WorkingStationKnowledgeItem.working_station).joinedload(WorkingStation.assigned_machine))
            .filter(
                WorkingStationKnowledgeItem.knowledge_item_id == knowledge_item_id,
                WorkingStationKnowledgeItem.is_enabled.is_(True),
            )
            .all()
            if assignment.working_station is not None and assignment.working_station.assigned_machine is not None
        }
    )
    db.delete(knowledge_item)
    db.commit()
    _invalidate_knowledge_cache(machine_ids)
    return None


@router.get("/logs")
async def list_logs(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    user_id: Optional[int] = None,
    machine_id: Optional[int] = None,
    category_id: Optional[int] = None,
    department_id: Optional[int] = None,
    feedback_status: Optional[FeedbackStatus] = None,
    admin: User = Depends(verify_permission("logs.view")),
    db: Session = Depends(get_db),
):
    del admin

    query = (
        db.query(InteractionLog)
        .options(
            joinedload(InteractionLog.user).joinedload(User.department),
            joinedload(InteractionLog.machine).joinedload(Machine.department),
            joinedload(InteractionLog.category),
            joinedload(InteractionLog.knowledge_item),
            joinedload(InteractionLog.resolved_by_user),
        )
    )
    if user_id is not None:
        query = query.filter(InteractionLog.user_id == user_id)
    if machine_id is not None:
        query = query.filter(InteractionLog.machine_id == machine_id)
    if category_id is not None:
        query = query.filter(InteractionLog.category_id == category_id)
    if feedback_status is not None:
        query = query.filter(InteractionLog.feedback_status == feedback_status)

    logs = (
        query.order_by(InteractionLog.timestamp.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    response = []
    for log in logs:
        user = log.user
        machine = log.machine
        department_name = None
        if machine and machine.department:
            department_name = machine.department.name
        elif user and user.department:
            department_name = user.department.name

        if department_id is not None:
            if not machine or machine.department_id != department_id:
                continue

        response.append(
            InteractionLogResponse(
                id=log.id,
                user_id=log.user_id,
                user_name=user.nome if user else f"Utente {log.user_id}",
                machine_id=log.machine_id,
                machine_name=machine.nome if machine else f"Macchina {log.machine_id}",
                department_name=department_name,
                category_id=log.category_id,
                category_name=log.category.name if log.category else None,
                knowledge_item_id=log.knowledge_item_id,
                knowledge_item_title=log.knowledge_item.question_title if log.knowledge_item else None,
                domanda=log.domanda,
                risposta=log.risposta,
                feedback_status=log.feedback_status,
                feedback_timestamp=log.feedback_timestamp,
                resolved_by_user_id=log.resolved_by_user_id,
                resolved_by_user_name=log.resolved_by_user.nome if log.resolved_by_user else None,
                resolution_note=log.resolution_note,
                resolution_timestamp=log.resolution_timestamp,
                action_type=log.action_type or "question",
                priority=log.priority or "normal",
                timestamp=log.timestamp,
            )
        )
    return response
