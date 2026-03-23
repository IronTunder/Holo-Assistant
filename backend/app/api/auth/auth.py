from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models.user import User
from app.models.machine import Machine
from app.schemas.user import BadgeLoginRequest, BadgeLoginResponse, UserResponse
from app.schemas.machine import MachineResponse

router = APIRouter(prefix="/auth", tags=["autenticazione"])

@router.post("/badge-login", response_model=BadgeLoginResponse)
def badge_login(
    request: BadgeLoginRequest,
    db: Session = Depends(get_db)
):
    """
    Login con badge RFID/NFC
    Riceve badge_id e postazione_id, restituisce utente e macchina associata
    """
    # Cerca utente per badge_id
    user = db.query(User).filter(User.badge_id == request.badge_id).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Badge non riconosciuto"
        )
    
    # Cerca macchina per id_postazione
    machine = db.query(Machine).filter(
        Machine.id_postazione == request.postazione_id
    ).first()
    
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Postazione non trovata"
        )
    
    # Aggiorna stato postazione (da implementare con Redis o tabella apposita)
    # Per ora restituiamo solo successo
    
    return BadgeLoginResponse(
        success=True,
        user=UserResponse.model_validate(user),
        machine=MachineResponse.model_validate(machine) if machine else None,
        message=f"Benvenuto {user.nome}"
    )

@router.post("/logout")
def logout(
    badge_id: str,
    db: Session = Depends(get_db)
):
    """Termina il turno dell'operatore"""
    # Aggiorna stato postazione (da implementare)
    return {"success": True, "message": "Logout effettuato"}