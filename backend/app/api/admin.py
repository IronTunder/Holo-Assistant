import asyncio
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.api.auth.auth import (
    get_password_hash,
    publish_admin_machine_event,
    publish_machine_session_event,
    verify_admin,
)
from app.core.database import get_db
from app.models.category import Category
from app.models.department import Department
from app.models.interaction_log import InteractionLog
from app.models.knowledge_item import KnowledgeItem, MachineKnowledgeItem
from app.models.machine import Machine
from app.models.user import LivelloEsperienza, Ruolo, Turno, User
from app.schemas.interaction import FeedbackStatus, InteractionActionType, InteractionPriority
from app.api.presenters import (
    serialize_category,
    serialize_department,
    serialize_knowledge_item,
    serialize_machine,
    serialize_user,
)
from app.services.knowledge_retrieval import knowledge_retrieval_service
from app.services.session_events import ADMIN_MACHINE_EVENTS_CHANNEL, session_event_bus

router = APIRouter(prefix="/admin", tags=["admin"])


class UserCreateRequest(BaseModel):
    nome: str
    badge_id: str
    password: str
    ruolo: str = "operaio"
    livello_esperienza: str
    department_id: int
    turno: str


class UserUpdateRequest(BaseModel):
    nome: Optional[str] = None
    badge_id: Optional[str] = None
    ruolo: Optional[str] = None
    livello_esperienza: Optional[str] = None
    department_id: Optional[int] = None
    turno: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    new_password: str


class MachineCreateRequest(BaseModel):
    nome: str
    department_id: int
    descrizione: Optional[str] = None
    id_postazione: str


class MachineUpdateRequest(BaseModel):
    nome: Optional[str] = None
    department_id: Optional[int] = None
    descrizione: Optional[str] = None
    id_postazione: Optional[str] = None


class CategoryRequest(BaseModel):
    name: str
    description: Optional[str] = None


class KnowledgeItemRequest(BaseModel):
    category_id: int
    question_title: str
    answer_text: str
    keywords: Optional[str] = None
    example_questions: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0
    machine_ids: List[int] = Field(default_factory=list)


class DashboardSummaryResponse(BaseModel):
    total_users: int
    total_machines: int
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


def _build_machine_response(machine: Machine, operator: Optional[User] = None, deleted: bool = False) -> dict:
    return serialize_machine(machine, operator=operator, deleted=deleted)


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
    machine_ids: List[int],
) -> None:
    unique_machine_ids = sorted(set(machine_ids))
    if unique_machine_ids:
        machine_count = db.query(Machine).filter(Machine.id.in_(unique_machine_ids)).count()
        if machine_count != len(unique_machine_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uno o piu macchinari selezionati non esistono",
            )

    db.query(MachineKnowledgeItem).filter(
        MachineKnowledgeItem.knowledge_item_id == knowledge_item.id
    ).delete(synchronize_session=False)

    for machine_id in unique_machine_ids:
        db.add(
            MachineKnowledgeItem(
                machine_id=machine_id,
                knowledge_item_id=knowledge_item.id,
                is_enabled=True,
            )
        )


def _invalidate_knowledge_cache(machine_ids: List[int] | None = None) -> None:
    if machine_ids is None:
        knowledge_retrieval_service.invalidate_all()
        return
    knowledge_retrieval_service.invalidate_machines(machine_ids)


@router.get("/dashboard-summary", response_model=DashboardSummaryResponse)
async def dashboard_summary(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    total_users = db.query(User).count()
    total_machines = db.query(Machine).count()
    machines_in_use = db.query(Machine).filter(Machine.in_uso.is_(True)).count()
    active_departments = db.query(Department).filter(Department.is_active.is_(True)).count()
    knowledge_items = db.query(KnowledgeItem).count()
    recent_interactions = (
        db.query(InteractionLog)
        .filter(InteractionLog.timestamp >= datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0))
        .count()
    )

    return DashboardSummaryResponse(
        total_users=total_users,
        total_machines=total_machines,
        machines_in_use=machines_in_use,
        machines_available=max(total_machines - machines_in_use, 0),
        active_departments=active_departments,
        knowledge_items=knowledge_items,
        recent_interactions=recent_interactions,
    )


@router.get("/metadata/departments")
async def list_departments_metadata(
    include_inactive: bool = False,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    query = db.query(Department).order_by(Department.name.asc())
    if not include_inactive:
        query = query.filter(Department.is_active.is_(True))
    return [serialize_department(department) for department in query.all()]


@router.get("/metadata/categories")
async def list_categories_metadata(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    categories = db.query(Category).order_by(Category.name.asc()).all()
    return [serialize_category(category) for category in categories]


@router.get("/metadata/machines")
async def list_machine_metadata(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    machines = db.query(Machine).options(joinedload(Machine.department)).order_by(Machine.nome.asc()).all()
    return [serialize_machine(machine) for machine in machines]


@router.get("/metadata/users")
async def list_user_metadata(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    users = db.query(User).options(joinedload(User.department)).order_by(User.nome.asc()).all()
    return [serialize_user(user) for user in users]


@router.get("/users")
async def list_users(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    department_id: Optional[int] = None,
    ruolo: Optional[str] = None,
    turno: Optional[str] = None,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    query = db.query(User).options(joinedload(User.department))
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
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    user = (
        db.query(User)
        .options(joinedload(User.department))
        .filter(User.id == user_id)
        .first()
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")
    return serialize_user(user)


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(
    request: UserCreateRequest,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    if db.query(User).filter(User.nome == request.nome).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Utente con questo nome gia esiste")
    if db.query(User).filter(User.badge_id == request.badge_id).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Badge ID gia utilizzato")

    department = _require_department(db, request.department_id)
    user = User(
        nome=request.nome,
        badge_id=request.badge_id,
        password_hash=get_password_hash(request.password),
        ruolo=_parse_role(request.ruolo),
        livello_esperienza=_parse_experience(request.livello_esperienza),
        department_id=department.id,
        reparto_legacy=department.name,
        turno=_parse_shift(request.turno),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.refresh(department)
    return serialize_user(user)


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    request: UserUpdateRequest,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    user = db.query(User).options(joinedload(User.department)).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

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
    if request.ruolo is not None:
        user.ruolo = _parse_role(request.ruolo)
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
    return serialize_user(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")
    db.delete(user)
    db.commit()
    return None


@router.post("/users/{user_id}/reset-password", response_model=dict)
async def reset_user_password(
    user_id: int,
    request: ResetPasswordRequest,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")
    user.password_hash = get_password_hash(request.new_password)
    db.commit()
    return {"message": "Password resettata con successo"}


@router.get("/machines")
async def list_machines(
    department_id: Optional[int] = None,
    in_use: Optional[bool] = None,
    admin: User = Depends(verify_admin),
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
    admin: User = Depends(verify_admin),
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
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    if db.query(Machine).filter(Machine.nome == request.nome).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Macchinario con questo nome gia esiste")
    if db.query(Machine).filter(Machine.id_postazione == request.id_postazione).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID postazione gia utilizzato")

    department = _require_department(db, request.department_id)
    machine = Machine(
        nome=request.nome,
        department_id=department.id,
        reparto_legacy=department.name,
        descrizione=request.descrizione,
        id_postazione=request.id_postazione,
        in_uso=False,
    )
    db.add(machine)
    db.commit()
    db.refresh(machine)
    await publish_admin_machine_event(db, machine)
    return _build_machine_response(machine)


@router.put("/machines/{machine_id}")
async def update_machine(
    machine_id: int,
    request: MachineUpdateRequest,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    machine = db.query(Machine).options(joinedload(Machine.department)).filter(Machine.id == machine_id).first()
    if machine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macchinario non trovato")

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
    if request.department_id is not None:
        department = _require_department(db, request.department_id)
        machine.department_id = department.id
        machine.reparto_legacy = department.name

    db.commit()
    db.refresh(machine)
    await publish_admin_machine_event(db, machine)
    return _build_machine_response(machine)


@router.delete("/machines/{machine_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_machine(
    machine_id: int,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    machine = db.query(Machine).options(joinedload(Machine.department)).filter(Machine.id == machine_id).first()
    if machine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macchinario non trovato")

    deleted_machine_id = machine.id
    deleted_payload_machine = Machine(
        id=machine.id,
        nome=machine.nome,
        department_id=machine.department_id,
        reparto_legacy=machine.reparto_legacy,
        descrizione=machine.descrizione,
        id_postazione=machine.id_postazione,
        in_uso=machine.in_uso,
        operatore_attuale_id=machine.operatore_attuale_id,
    )
    deleted_payload_machine.department = machine.department
    db.delete(machine)
    db.commit()
    knowledge_retrieval_service.invalidate_machine(deleted_machine_id)
    await publish_admin_machine_event(db, deleted_payload_machine, deleted=True)
    await publish_machine_session_event(None, -1, machine_id=deleted_machine_id)
    return None


@router.post("/machines/{machine_id}/reset-status", response_model=dict)
async def reset_machine_status(
    machine_id: int,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if machine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macchinario non trovato")

    machine.in_uso = False
    machine.operatore_attuale_id = None
    db.commit()
    await publish_machine_session_event(machine, -1, db=db)
    return {"message": f"Macchinario {machine.nome} liberato"}


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
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    return [serialize_category(category) for category in db.query(Category).order_by(Category.name.asc()).all()]


@router.post("/categories", status_code=status.HTTP_201_CREATED)
async def create_category(
    request: CategoryRequest,
    admin: User = Depends(verify_admin),
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
    admin: User = Depends(verify_admin),
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
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    query = db.query(KnowledgeItem).options(
        joinedload(KnowledgeItem.category),
        joinedload(KnowledgeItem.machine_assignments),
    )
    if category_id is not None:
        query = query.filter(KnowledgeItem.category_id == category_id)
    if not include_inactive:
        query = query.filter(KnowledgeItem.is_active.is_(True))

    knowledge_items = query.order_by(KnowledgeItem.sort_order.asc(), KnowledgeItem.question_title.asc()).all()
    payload = []
    for knowledge_item in knowledge_items:
        assigned_machine_ids = [
            assignment.machine_id
            for assignment in knowledge_item.machine_assignments
            if assignment.is_enabled
        ]
        if machine_id is not None and machine_id not in assigned_machine_ids:
            continue
        payload.append(
            serialize_knowledge_item(
                knowledge_item,
                assigned_machine_ids=assigned_machine_ids,
                assignment_count=len(assigned_machine_ids),
            )
        )
    return payload


@router.get("/machines/{machine_id}/knowledge")
async def list_machine_knowledge(
    machine_id: int,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    assignments = (
        db.query(MachineKnowledgeItem)
        .options(
            joinedload(MachineKnowledgeItem.knowledge_item).joinedload(KnowledgeItem.category)
        )
        .filter(
            MachineKnowledgeItem.machine_id == machine_id,
            MachineKnowledgeItem.is_enabled.is_(True),
        )
        .all()
    )
    return [
        {
            **serialize_knowledge_item(assignment.knowledge_item, assigned_machine_ids=[machine_id], assignment_count=1),
            "assignment_id": assignment.id,
        }
        for assignment in assignments
    ]


@router.post("/knowledge-items", status_code=status.HTTP_201_CREATED)
async def create_knowledge_item(
    request: KnowledgeItemRequest,
    admin: User = Depends(verify_admin),
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
    _apply_machine_assignments(db, knowledge_item, request.machine_ids)
    db.commit()
    db.refresh(knowledge_item)
    _invalidate_knowledge_cache(request.machine_ids)
    knowledge_item = (
        db.query(KnowledgeItem)
        .options(joinedload(KnowledgeItem.category), joinedload(KnowledgeItem.machine_assignments))
        .filter(KnowledgeItem.id == knowledge_item.id)
        .first()
    )
    return serialize_knowledge_item(knowledge_item)


@router.put("/knowledge-items/{knowledge_item_id}")
async def update_knowledge_item(
    knowledge_item_id: int,
    request: KnowledgeItemRequest,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    knowledge_item = (
        db.query(KnowledgeItem)
        .options(joinedload(KnowledgeItem.machine_assignments))
        .filter(KnowledgeItem.id == knowledge_item_id)
        .first()
    )
    if knowledge_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge item non trovato")

    if db.query(Category).filter(Category.id == request.category_id).first() is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Categoria non valida")

    previous_machine_ids = [
        assignment.machine_id for assignment in knowledge_item.machine_assignments if assignment.is_enabled
    ]
    knowledge_item.category_id = request.category_id
    knowledge_item.question_title = request.question_title.strip()
    knowledge_item.answer_text = request.answer_text.strip()
    knowledge_item.keywords = request.keywords
    knowledge_item.example_questions = request.example_questions.strip() if request.example_questions else None
    knowledge_item.is_active = request.is_active
    knowledge_item.sort_order = request.sort_order
    _apply_machine_assignments(db, knowledge_item, request.machine_ids)
    db.commit()
    _invalidate_knowledge_cache(previous_machine_ids + request.machine_ids)

    knowledge_item = (
        db.query(KnowledgeItem)
        .options(joinedload(KnowledgeItem.category), joinedload(KnowledgeItem.machine_assignments))
        .filter(KnowledgeItem.id == knowledge_item_id)
        .first()
    )
    return serialize_knowledge_item(knowledge_item)


@router.delete("/knowledge-items/{knowledge_item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_item(
    knowledge_item_id: int,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    del admin
    knowledge_item = db.query(KnowledgeItem).filter(KnowledgeItem.id == knowledge_item_id).first()
    if knowledge_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge item non trovato")
    machine_ids = [
        assignment.machine_id
        for assignment in db.query(MachineKnowledgeItem)
        .filter(
            MachineKnowledgeItem.knowledge_item_id == knowledge_item_id,
            MachineKnowledgeItem.is_enabled.is_(True),
        )
        .all()
    ]
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
    admin: User = Depends(verify_admin),
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
                action_type=log.action_type or "question",
                priority=log.priority or "normal",
                timestamp=log.timestamp,
            )
        )
    return response
