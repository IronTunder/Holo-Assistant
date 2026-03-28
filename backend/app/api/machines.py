from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.auth.auth import publish_admin_machine_event, publish_machine_session_event, verify_admin
from app.database import get_db
from app.models.department import Department
from app.models.machine import Machine
from app.models.user import User
from app.schemas.machine import MachineCreate, MachineResponse, MachineUpdate

router = APIRouter(tags=["machines"])


def _require_department(db: Session, department_id: int | None) -> Department:
    if department_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="department_id obbligatorio")
    department = db.query(Department).filter(Department.id == department_id).first()
    if department is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reparto non valido")
    return department


@router.get("/", response_model=List[MachineResponse])
async def get_machines(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    return (
        db.query(Machine)
        .options(joinedload(Machine.department))
        .order_by(Machine.nome.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/available", response_model=List[MachineResponse])
async def get_available_machines(
    db: Session = Depends(get_db),
):
    return (
        db.query(Machine)
        .options(joinedload(Machine.department))
        .filter(Machine.in_uso.is_(False))
        .order_by(Machine.nome.asc())
        .all()
    )


@router.get("/{machine_id}", response_model=MachineResponse)
async def get_machine(
    machine_id: int,
    db: Session = Depends(get_db),
):
    machine = (
        db.query(Machine)
        .options(joinedload(Machine.department))
        .filter(Machine.id == machine_id)
        .first()
    )
    if machine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macchinario non trovato")
    return machine


@router.post("/", response_model=MachineResponse, status_code=status.HTTP_201_CREATED)
async def create_machine(
    machine: MachineCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(verify_admin),
):
    del admin
    existing = db.query(Machine).filter(
        (Machine.nome == machine.nome) | (Machine.id_postazione == machine.id_postazione)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Macchinario con questo nome o ID postazione gia esistente",
        )

    department = _require_department(db, machine.department_id)
    db_machine = Machine(
        nome=machine.nome,
        department_id=department.id,
        reparto_legacy=department.name,
        descrizione=machine.descrizione,
        id_postazione=machine.id_postazione,
    )
    db.add(db_machine)
    db.commit()
    db.refresh(db_machine)
    await publish_admin_machine_event(db, db_machine)
    return db_machine


@router.put("/{machine_id}", response_model=MachineResponse)
async def update_machine(
    machine_id: int,
    machine: MachineUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(verify_admin),
):
    del admin
    db_machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if db_machine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macchinario non trovato")

    update_data = machine.model_dump(exclude_unset=True)
    department_id = update_data.pop("department_id", None)
    update_data.pop("reparto", None)

    for field, value in update_data.items():
        setattr(db_machine, field, value)

    if department_id is not None:
        department = _require_department(db, department_id)
        db_machine.department_id = department.id
        db_machine.reparto_legacy = department.name

    db.commit()
    db.refresh(db_machine)
    await publish_admin_machine_event(db, db_machine)
    return db_machine


@router.patch("/{machine_id}/status")
async def update_machine_status(
    machine_id: int,
    in_uso: bool,
    operatore_id: int = None,
    db: Session = Depends(get_db),
    admin: User = Depends(verify_admin),
):
    del admin
    db_machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if db_machine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macchinario non trovato")

    db_machine.in_uso = in_uso
    db_machine.operatore_attuale_id = operatore_id if in_uso else None
    db.commit()
    await publish_machine_session_event(db_machine, -1, db=db)
    return {"success": True, "message": f"Macchinario {'in uso' if in_uso else 'liberato'} con successo"}


@router.delete("/{machine_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_machine(
    machine_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(verify_admin),
):
    del admin
    db_machine = db.query(Machine).options(joinedload(Machine.department)).filter(Machine.id == machine_id).first()
    if db_machine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macchinario non trovato")

    deleted_machine_id = db_machine.id
    deleted_payload_machine = Machine(
        id=db_machine.id,
        nome=db_machine.nome,
        department_id=db_machine.department_id,
        reparto_legacy=db_machine.reparto_legacy,
        descrizione=db_machine.descrizione,
        id_postazione=db_machine.id_postazione,
        in_uso=db_machine.in_uso,
        operatore_attuale_id=db_machine.operatore_attuale_id,
    )
    deleted_payload_machine.department = db_machine.department
    db.delete(db_machine)
    db.commit()
    await publish_admin_machine_event(db, deleted_payload_machine, deleted=True)
    await publish_machine_session_event(None, -1, machine_id=deleted_machine_id)
    return None
