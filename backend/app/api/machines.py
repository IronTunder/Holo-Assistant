# backend/app/api/machines.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.machine import Machine
from app.schemas.machine import MachineCreate, MachineUpdate, MachineResponse

router = APIRouter(tags=["macchinari"])

@router.get("/", response_model=List[MachineResponse])
def get_machines(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Lista tutti i macchinari"""
    machines = db.query(Machine).offset(skip).limit(limit).all()
    return machines

@router.get("/available", response_model=List[MachineResponse])
def get_available_machines(
    db: Session = Depends(get_db)
):
    """Lista solo i macchinari non in uso"""
    machines = db.query(Machine).filter(Machine.in_uso == False).all()
    return machines

@router.get("/{machine_id}", response_model=MachineResponse)
def get_machine(
    machine_id: int,
    db: Session = Depends(get_db)
):
    """Dettaglio di un macchinario"""
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Macchinario non trovato"
        )
    return machine

@router.post("/", response_model=MachineResponse, status_code=status.HTTP_201_CREATED)
def create_machine(
    machine: MachineCreate,
    db: Session = Depends(get_db)
):
    """Crea un nuovo macchinario"""
    # Verifica se esiste già con lo stesso nome o id_postazione
    existing = db.query(Machine).filter(
        (Machine.nome == machine.nome) | (Machine.id_postazione == machine.id_postazione)
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Macchinario con questo nome o ID postazione già esistente"
        )
    
    db_machine = Machine(**machine.model_dump())
    db.add(db_machine)
    db.commit()
    db.refresh(db_machine)
    return db_machine

@router.put("/{machine_id}", response_model=MachineResponse)
def update_machine(
    machine_id: int,
    machine: MachineUpdate,
    db: Session = Depends(get_db)
):
    """Aggiorna un macchinario"""
    db_machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not db_machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Macchinario non trovato"
        )
    
    update_data = machine.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_machine, field, value)
    
    db.commit()
    db.refresh(db_machine)
    return db_machine

@router.patch("/{machine_id}/status")
def update_machine_status(
    machine_id: int,
    in_uso: bool,
    operatore_id: int = None,
    db: Session = Depends(get_db)
):
    """Aggiorna lo stato di utilizzo del macchinario"""
    db_machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not db_machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Macchinario non trovato"
        )
    
    db_machine.in_uso = in_uso
    db_machine.operatore_attuale_id = operatore_id if in_uso else None
    
    db.commit()
    
    return {
        "success": True,
        "message": f"Macchinario {'in uso' if in_uso else 'liberato'} con successo"
    }

@router.delete("/{machine_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_machine(
    machine_id: int,
    db: Session = Depends(get_db)
):
    """Elimina un macchinario"""
    db_machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not db_machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Macchinario non trovato"
        )
    
    db.delete(db_machine)
    db.commit()
    return None