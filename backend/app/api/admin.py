# backend/app/api/admin.py

import asyncio
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.api.auth.auth import (
    build_admin_machine_event_payload,
    get_password_hash,
    publish_admin_machine_event,
    publish_machine_session_event,
    verify_admin,
)
from app.schemas.user import UserResponse
from app.schemas.machine import MachineResponse
from app.models.interaction_log import InteractionLog
from app.models.machine import Machine
from app.models.user import LivelloEsperienza, Ruolo, Turno, User
from app.services.session_events import ADMIN_MACHINE_EVENTS_CHANNEL, session_event_bus

router = APIRouter(prefix="/admin", tags=["admin"])

# ============ Request/Response Models ============

class UserCreateRequest(BaseModel):
    nome: str
    badge_id: str
    password: str
    ruolo: str = "operaio"  # "operaio" ou "admin"
    livello_esperienza: str
    reparto: str
    turno: str

class UserUpdateRequest(BaseModel):
    nome: Optional[str] = None
    badge_id: Optional[str] = None
    ruolo: Optional[str] = None
    livello_esperienza: Optional[str] = None
    reparto: Optional[str] = None
    turno: Optional[str] = None

class ResetPasswordRequest(BaseModel):
    new_password: str

class MachineCreateRequest(BaseModel):
    nome: str
    reparto: str
    descrizione: Optional[str] = None
    id_postazione: Optional[str] = None

class MachineUpdateRequest(BaseModel):
    nome: Optional[str] = None
    reparto: Optional[str] = None
    descrizione: Optional[str] = None
    id_postazione: Optional[str] = None

class LogFilterParams(BaseModel):
    user_id: Optional[int] = None
    machine_id: Optional[int] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None

class UserListResponse(BaseModel):
    id: int
    nome: str
    badge_id: str
    ruolo: str
    livello_esperienza: str
    reparto: str
    turno: str
    created_at: datetime

class MachineListResponse(BaseModel):
    class OperatorResponse(BaseModel):
        id: int
        nome: str
        badge_id: str
        reparto: str
        turno: str
        livello_esperienza: str

    id: int
    nome: str
    reparto: str
    descrizione: Optional[str]
    id_postazione: Optional[str]
    in_uso: bool
    operatore_attuale_id: Optional[int]
    operator: Optional[OperatorResponse] = None
    deleted: bool = False

class InteractionLogResponse(BaseModel):
    id: int
    user_id: int
    machine_id: int
    domanda: str
    risposta: str
    timestamp: datetime

class ErrorResponse(BaseModel):
    detail: str


def _build_machine_response(
    machine: Machine,
    operator: Optional[User] = None,
    deleted: bool = False,
) -> MachineListResponse:
    return MachineListResponse(**build_admin_machine_event_payload(machine, operator=operator, deleted=deleted))


def _load_operator_map(db: Session, machines: List[Machine]) -> dict[int, User]:
    operator_ids = {
        machine.operatore_attuale_id
        for machine in machines
        if machine.operatore_attuale_id is not None
    }

    if not operator_ids:
        return {}

    operators = db.query(User).filter(User.id.in_(operator_ids)).all()
    return {operator.id: operator for operator in operators}

# ============ Users Management ============

@router.get("/users", response_model=List[UserListResponse])
async def list_users(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Lista tutti gli utenti con paginazione."""
    skip = (page - 1) * size
    users = db.query(User).offset(skip).limit(size).all()
    return [
        UserListResponse(
            id=u.id,
            nome=u.nome,
            badge_id=u.badge_id,
            ruolo=u.ruolo.value,
            livello_esperienza=u.livello_esperienza.value,
            reparto=u.reparto,
            turno=u.turno.value,
            created_at=u.created_at
        )
        for u in users
    ]

@router.get("/users/{user_id}", response_model=UserListResponse)
async def get_user(
    user_id: int,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Ottieni i dettagli di un utente."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utente non trovato"
        )
    return UserListResponse(
        id=user.id,
        nome=user.nome,
        badge_id=user.badge_id,
        ruolo=user.ruolo.value,
        livello_esperienza=user.livello_esperienza.value,
        reparto=user.reparto,
        turno=user.turno.value,
        created_at=user.created_at
    )

@router.post("/users", response_model=UserListResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    request: UserCreateRequest,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Crea un nuovo utente."""
    
    # Check if user already exists
    existing_user = db.query(User).filter(User.nome == request.nome).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Utente con questo nome già esiste"
        )
    
    existing_badge = db.query(User).filter(User.badge_id == request.badge_id).first()
    if existing_badge:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Badge ID già utilizzato"
        )
    
    # Validate enums
    try:
        ruolo_enum = Ruolo[request.ruolo.upper()]
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ruolo non valido: {request.ruolo}"
        )
    
    try:
        livello_enum = LivelloEsperienza[request.livello_esperienza.upper()]
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Livello esperienza non valido: {request.livello_esperienza}"
        )
    
    try:
        turno_enum = Turno[request.turno.upper()]
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Turno non valido: {request.turno}"
        )
    
    # Create user
    user = User(
        nome=request.nome,
        badge_id=request.badge_id,
        password_hash=get_password_hash(request.password),
        ruolo=ruolo_enum,
        livello_esperienza=livello_enum,
        reparto=request.reparto,
        turno=turno_enum
    )
    
    db.add(user)
    db.commit()
    db.refresh(user)
    
    return UserListResponse(
        id=user.id,
        nome=user.nome,
        badge_id=user.badge_id,
        ruolo=user.ruolo.value,
        livello_esperienza=user.livello_esperienza.value,
        reparto=user.reparto,
        turno=user.turno.value,
        created_at=user.created_at
    )

@router.put("/users/{user_id}", response_model=UserListResponse)
async def update_user(
    user_id: int,
    request: UserUpdateRequest,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Aggiorna i dettagli di un utente."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utente non trovato"
        )
    
    # Update fields if provided
    if request.nome:
        user.nome = request.nome
    if request.badge_id:
        user.badge_id = request.badge_id
    if request.ruolo:
        try:
            user.ruolo = Ruolo[request.ruolo.upper()]
        except KeyError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ruolo non valido: {request.ruolo}"
            )
    if request.livello_esperienza:
        try:
            user.livello_esperienza = LivelloEsperienza[request.livello_esperienza.upper()]
        except KeyError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Livello esperienza non valido: {request.livello_esperienza}"
            )
    if request.reparto:
        user.reparto = request.reparto
    if request.turno:
        try:
            user.turno = Turno[request.turno.upper()]
        except KeyError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Turno non valido: {request.turno}"
            )
    
    db.commit()
    db.refresh(user)
    
    return UserListResponse(
        id=user.id,
        nome=user.nome,
        badge_id=user.badge_id,
        ruolo=user.ruolo.value,
        livello_esperienza=user.livello_esperienza.value,
        reparto=user.reparto,
        turno=user.turno.value,
        created_at=user.created_at
    )

@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Elimina un utente."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utente non trovato"
        )
    
    db.delete(user)
    db.commit()
    return None

@router.post("/users/{user_id}/reset-password", response_model=dict)
async def reset_user_password(
    user_id: int,
    request: ResetPasswordRequest,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Resetta la password di un utente."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utente non trovato"
        )
    
    user.password_hash = get_password_hash(request.new_password)
    db.commit()
    
    return {"message": "Password resettata con successo"}

# ============ Machines Management ============

@router.get("/machines", response_model=List[MachineListResponse])
async def list_machines(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Lista tutti i macchinari."""
    machines = db.query(Machine).all()
    operator_map = _load_operator_map(db, machines)
    return [
        _build_machine_response(m, operator_map.get(m.operatore_attuale_id))
        for m in machines
    ]

@router.get("/machines/{machine_id}", response_model=MachineListResponse)
async def get_machine(
    machine_id: int,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Ottieni i dettagli di un macchinario."""
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Macchinario non trovato"
        )
    operator = None
    if machine.operatore_attuale_id is not None:
        operator = db.query(User).filter(User.id == machine.operatore_attuale_id).first()
    return _build_machine_response(machine, operator)

@router.post("/machines", response_model=MachineListResponse, status_code=status.HTTP_201_CREATED)
async def create_machine(
    request: MachineCreateRequest,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Crea un nuovo macchinario."""
    
    machine = Machine(
        nome=request.nome,
        reparto=request.reparto,
        descrizione=request.descrizione,
        id_postazione=request.id_postazione,
        in_uso=False
    )
    
    db.add(machine)
    db.commit()
    db.refresh(machine)
    await publish_admin_machine_event(db, machine)

    return _build_machine_response(machine)

@router.put("/machines/{machine_id}", response_model=MachineListResponse)
async def update_machine(
    machine_id: int,
    request: MachineUpdateRequest,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Aggiorna i dettagli di un macchinario."""
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Macchinario non trovato"
        )
    
    if request.nome:
        machine.nome = request.nome
    if request.reparto:
        machine.reparto = request.reparto
    if request.descrizione is not None:
        machine.descrizione = request.descrizione
    if request.id_postazione is not None:
        machine.id_postazione = request.id_postazione
    
    db.commit()
    db.refresh(machine)
    
    await publish_admin_machine_event(db, machine)
    return _build_machine_response(machine)

@router.delete("/machines/{machine_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_machine(
    machine_id: int,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Elimina un macchinario."""
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Macchinario non trovato"
        )
    
    deleted_machine_id = machine.id
    deleted_payload_machine = Machine(
        id=machine.id,
        nome=machine.nome,
        reparto=machine.reparto,
        descrizione=machine.descrizione,
        id_postazione=machine.id_postazione,
        in_uso=machine.in_uso,
        operatore_attuale_id=machine.operatore_attuale_id,
    )
    db.delete(machine)
    db.commit()
    await publish_admin_machine_event(db, deleted_payload_machine, deleted=True)
    await publish_machine_session_event(None, -1, machine_id=deleted_machine_id)
    return None

@router.post("/machines/{machine_id}/reset-status", response_model=dict)
async def reset_machine_status(
    machine_id: int,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Forza lo stato di un macchinario a libero."""
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Macchinario non trovato"
        )
    
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

# ============ Audit Logs ============

@router.get("/logs", response_model=List[InteractionLogResponse])
async def list_logs(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    user_id: Optional[int] = None,
    machine_id: Optional[int] = None,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Lista i log di interazione con filtri e paginazione."""
    query = db.query(InteractionLog)
    
    if user_id:
        query = query.filter(InteractionLog.user_id == user_id)
    if machine_id:
        query = query.filter(InteractionLog.machine_id == machine_id)
    
    # Order by timestamp descending
    logs = query.order_by(InteractionLog.timestamp.desc()).offset(
        (page - 1) * size
    ).limit(size).all()
    
    return [
        InteractionLogResponse(
            id=log.id,
            user_id=log.user_id,
            machine_id=log.machine_id,
            domanda=log.domanda,
            risposta=log.risposta,
            timestamp=log.timestamp
        )
        for log in logs
    ]
