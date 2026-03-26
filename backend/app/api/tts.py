from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.services.piper_tts import tts_service


router = APIRouter(tags=["tts"])


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)


@router.get("/health")
async def tts_health():
    """Stato del servizio TTS."""
    return tts_service.get_status()


@router.post("/synthesize")
async def synthesize_speech(request: TTSRequest):
    """Restituisce un file WAV sintetizzato con Piper."""
    try:
        audio_bytes = tts_service.synthesize_wav(request.text)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return Response(
        content=audio_bytes,
        media_type="audio/wav",
        headers={"Content-Disposition": 'inline; filename="tts.wav"'},
    )
