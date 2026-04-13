import base64
import json
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.auth.auth import get_current_user
from app.models.user import User
from app.services.piper_tts import tts_service
from app.services.tts_models import TtsSynthesisResult


router = APIRouter(tags=["tts"])


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    language: Optional[str] = Field(default=None, max_length=100)


class TTSResponse(BaseModel):
    audio_base64: str
    mime_type: str
    duration_ms: int
    words: list[str]
    wtimes: list[int]
    wdurations: list[int]
    visemes: list[str] = Field(default_factory=list)
    vtimes: list[int] = Field(default_factory=list)
    vdurations: list[int] = Field(default_factory=list)


def _build_tts_metadata(synthesis: TtsSynthesisResult) -> dict:
    return {
        "mime_type": synthesis.mime_type,
        "duration_ms": synthesis.duration_ms,
        "words": synthesis.words,
        "wtimes": synthesis.wtimes,
        "wdurations": synthesis.wdurations,
        "visemes": synthesis.visemes,
        "vtimes": synthesis.vtimes,
        "vdurations": synthesis.vdurations,
    }


def _build_multipart_tts_response(synthesis: TtsSynthesisResult) -> Response:
    boundary = f"holo-assistant-tts-{secrets.token_hex(12)}"
    metadata = json.dumps(_build_tts_metadata(synthesis), separators=(",", ":")).encode("utf-8")
    filename = "speech.wav" if synthesis.mime_type == "audio/wav" else "speech.bin"
    body = bytearray()

    body.extend(f"--{boundary}\r\n".encode("ascii"))
    body.extend(b'Content-Disposition: form-data; name="metadata"\r\n')
    body.extend(b"Content-Type: application/json; charset=utf-8\r\n\r\n")
    body.extend(metadata)
    body.extend(b"\r\n")

    body.extend(f"--{boundary}\r\n".encode("ascii"))
    body.extend(f'Content-Disposition: form-data; name="audio"; filename="{filename}"\r\n'.encode("ascii"))
    body.extend(f"Content-Type: {synthesis.mime_type}\r\n\r\n".encode("ascii"))
    body.extend(synthesis.audio_bytes)
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("ascii"))

    return Response(
        content=bytes(body),
        media_type=f"multipart/form-data; boundary={boundary}",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/health")
async def tts_health():
    """Stato del servizio TTS."""
    return tts_service.get_status()


@router.post("/synthesize", response_model=TTSResponse)
async def synthesize_speech(
    request: TTSRequest,
    x_browser_language: Optional[str] = Header(default=None),
    accept: Optional[str] = Header(default=None),
    current_user: User = Depends(get_current_user),
):
    """Restituisce audio TTS con metadati per il lip-sync."""
    del current_user
    try:
        synthesis = tts_service.synthesize_with_lipsync(
            request.text,
            language=request.language or x_browser_language,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    if accept and "multipart/form-data" in accept.lower():
        return _build_multipart_tts_response(synthesis)

    metadata = _build_tts_metadata(synthesis)
    return TTSResponse(
        audio_base64=base64.b64encode(synthesis.audio_bytes).decode("ascii"),
        mime_type=metadata["mime_type"],
        duration_ms=metadata["duration_ms"],
        words=metadata["words"],
        wtimes=metadata["wtimes"],
        wdurations=metadata["wdurations"],
        visemes=metadata["visemes"],
        vtimes=metadata["vtimes"],
        vdurations=metadata["vdurations"],
    )
