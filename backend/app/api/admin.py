# backend/app/api/admin.py

from fastapi import APIRouter, HTTPException, status, Depends, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User, Ruolo, LivelloEsperienza, Turno
from app.models.machine import Machine
from app.models.interaction_log import InteractionLog
from app.schemas.user import UserResponse
from app.schemas.machine import MachineResponse
from app.api.auth.auth import verify_admin, get_password_hash

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
    id: int
    nome: str
    reparto: str
    descrizione: Optional[str]
    id_postazione: Optional[str]
    in_uso: bool
    operatore_attuale_id: Optional[int]

class InteractionLogResponse(BaseModel):
    id: int
    user_id: int
    machine_id: int
    domanda: str
    risposta: str
    timestamp: datetime

class ErrorResponse(BaseModel):
    detail: str

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
    return [
        MachineListResponse(
            id=m.id,
            nome=m.nome,
            reparto=m.reparto,
            descrizione=m.descrizione,
            id_postazione=m.id_postazione,
            in_uso=m.in_uso,
            operatore_attuale_id=m.operatore_attuale_id
        )
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
    return MachineListResponse(
        id=machine.id,
        nome=machine.nome,
        reparto=machine.reparto,
        descrizione=machine.descrizione,
        id_postazione=machine.id_postazione,
        in_uso=machine.in_uso,
        operatore_attuale_id=machine.operatore_attuale_id
    )

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
    
    return MachineListResponse(
        id=machine.id,
        nome=machine.nome,
        reparto=machine.reparto,
        descrizione=machine.descrizione,
        id_postazione=machine.id_postazione,
        in_uso=machine.in_uso,
        operatore_attuale_id=machine.operatore_attuale_id
    )

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
    
    return MachineListResponse(
        id=machine.id,
        nome=machine.nome,
        reparto=machine.reparto,
        descrizione=machine.descrizione,
        id_postazione=machine.id_postazione,
        in_uso=machine.in_uso,
        operatore_attuale_id=machine.operatore_attuale_id
    )

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
    
    db.delete(machine)
    db.commit()
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
    
    return {"message": f"Macchinario {machine.nome} liberato"}

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
