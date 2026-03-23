from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

# Modelli per le richieste/risposte
class BadgeLoginRequest(BaseModel):
    badge_id: str

class UserResponse(BaseModel):
    id: int
    nome: str
    badge_id: str
    livello_esperienza: str
    reparto: str
    turno: str

class MachineResponse(BaseModel):
    id: int
    nome: str
    reparto: str
    descrizione: str
    id_postazione: str
    stato: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse
    machine: MachineResponse
    message: Optional[str] = None

@router.post("/badge-login", response_model=LoginResponse)
async def badge_login(request: BadgeLoginRequest):
    """
    Login con badge RFID.
    Per ora restituisce dati di esempio.
    """
    # DATI DI ESEMPIO (da sostituire con la logica reale del database)
    if request.badge_id == "NFT-001":
        user = UserResponse(
            id=1,
            nome="Mario Rossi",
            badge_id="NFT-001",
            livello_esperienza="manutentore",
            reparto="Tecnico",
            turno="mattina"
        )
        machine = MachineResponse(
            id=1,
            nome="Pressa A7",
            reparto="Stampaggio",
            descrizione="Pressa idraulica 200 ton",
            id_postazione="POST-001",
            stato="libera"
        )
        return LoginResponse(
            access_token="fake-jwt-token",
            token_type="bearer",
            user=user,
            machine=machine,
            message="Benvenuto Mario!"
        )
    elif request.badge_id == "NFT-002":
        user = UserResponse(
            id=2,
            nome="Luigi Verdi",
            badge_id="NFT-002",
            livello_esperienza="senior",
            reparto="Stampaggio",
            turno="mattina"
        )
        machine = MachineResponse(
            id=1,
            nome="Pressa A7",
            reparto="Stampaggio",
            descrizione="Pressa idraulica 200 ton",
            id_postazione="POST-001",
            stato="libera"
        )
        return LoginResponse(
            access_token="fake-jwt-token",
            token_type="bearer",
            user=user,
            machine=machine,
            message="Benvenuto Luigi!"
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Badge non riconosciuto. Verifica il codice o contatta l'amministratore."
        )

@router.post("/logout")
async def logout():
    """
    Logout dell'operatore.
    """
    return {"message": "Logout effettuato con successo"}