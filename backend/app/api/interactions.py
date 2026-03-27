import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.category import Category
from app.models.interaction_log import InteractionLog
from app.models.machine import Machine
from app.models.preset_response import PresetResponse
from app.schemas.interaction import AskQuestionRequest, AskQuestionResponse
from app.services.ollama_service import (
    OllamaServiceError,
    classify_question,
    select_best_response,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/interactions", tags=["interactions"])

FALLBACK_RESPONSE = {
    "response": (
        "Mi dispiace, non sono riuscito a trovare una risposta appropriata alla tua domanda. "
        "Ti consiglio di contattare direttamente l'assistenza per ricevere aiuto."
    ),
    "category_id": None,
    "category_name": "Fallback",
}
WORD_PATTERN = re.compile(r"\w+", re.UNICODE)
MIN_TOKEN_LENGTH = 3


def _tokenize(text: str) -> set[str]:
    return {
        token.lower()
        for token in WORD_PATTERN.findall(text or "")
        if len(token) >= MIN_TOKEN_LENGTH
    }


def _keyword_score(question_tokens: set[str], response: dict) -> int:
    response_tokens = _tokenize(response.get("text", ""))
    keyword_tokens = _tokenize(response.get("keywords", ""))

    score = 0
    score += len(question_tokens & keyword_tokens) * 4
    score += len(question_tokens & response_tokens)

    if response.get("machine_id") is not None:
        score += 1

    return score


def _format_preset_response(response: PresetResponse, category_name: str | None = None) -> dict:
    return {
        "id": response.id,
        "text": response.text,
        "keywords": response.keywords,
        "category_id": response.category_id,
        "category_name": category_name,
        "machine_id": response.machine_id,
    }


def _select_response_by_keywords(question: str, preset_responses: list[dict]) -> dict | None:
    question_tokens = _tokenize(question)
    if not question_tokens:
        return None

    scored_responses = []
    for response in preset_responses:
        score = _keyword_score(question_tokens, response)
        if score > 0:
            scored_responses.append((score, response))

    if not scored_responses:
        return None

    scored_responses.sort(
        key=lambda item: (item[0], item[1].get("machine_id") is not None, item[1].get("id", 0)),
        reverse=True,
    )
    return scored_responses[0][1]


def _build_fallback_response(reason: str) -> AskQuestionResponse:
    logger.warning("Returning fallback interaction response: %s", reason)
    return AskQuestionResponse(**FALLBACK_RESPONSE)


@router.post("/ask", response_model=AskQuestionResponse)
async def ask_question(
    request: AskQuestionRequest,
    db: Session = Depends(get_db),
):
    """
    Processa una domanda da parte dell'operatore.

    1. Verifica il macchinario e le sue categorie disponibili
    2. Classifica la domanda in una categoria usando Ollama
    3. Seleziona la migliore risposta preset per quella categoria e macchinario
    4. Salva l'interazione nel database
    5. Ritorna la risposta al frontend
    6. Se fallisce, ritorna una risposta di fallback
    """

    try:
        machine = db.query(Machine).filter(Machine.id == request.machine_id).first()
        if not machine:
            logger.warning("Machine %s not found", request.machine_id)
            raise HTTPException(status_code=404, detail="Machine not found")

        categories_for_machine = machine.categories
        if not categories_for_machine:
            logger.warning("No categories assigned to machine %s", machine.nome)
            categories_for_machine = db.query(Category).all()

        if not categories_for_machine:
            logger.warning(
                "No categories found in database for machine_id=%s question=%r",
                request.machine_id,
                request.question,
            )
            return _build_fallback_response("no categories found")

        category_map = {category.id: category.name for category in categories_for_machine}
        all_preset_responses = db.query(PresetResponse).filter(
            and_(
                PresetResponse.category_id.in_(list(category_map.keys())),
                (
                    (PresetResponse.machine_id == request.machine_id) |
                    (PresetResponse.machine_id == None)
                ),
            )
        ).all()

        if not all_preset_responses:
            logger.warning(
                "No preset responses available for machine_id=%s question=%r",
                request.machine_id,
                request.question,
            )
            return _build_fallback_response("no preset responses available")

        selected_response = None
        fallback_reason = None

        try:
            category_names = [category.name for category in categories_for_machine]
            classified_category = await classify_question(request.question, category_names)
            category = next(
                (
                    candidate
                    for candidate in categories_for_machine
                    if candidate.name.lower() == classified_category.lower()
                ),
                None,
            )
            if not category:
                raise OllamaServiceError(
                    f"Categoria classificata non valida per il macchinario: {classified_category}"
                )

            preset_responses = [
                response
                for response in all_preset_responses
                if response.category_id == category.id
            ]
            if not preset_responses:
                raise OllamaServiceError(
                    f"Nessuna risposta preset per la categoria {category.name}"
                )

            selected_response = await select_best_response(
                request.question,
                [
                    _format_preset_response(response, category.name)
                    for response in preset_responses
                ],
            )
        except OllamaServiceError as exc:
            fallback_reason = f"ollama degraded: {exc}"
            logger.warning(
                "Falling back from Ollama for machine_id=%s question=%r reason=%s",
                request.machine_id,
                request.question,
                exc,
            )

        if selected_response is None:
            selected_response = _select_response_by_keywords(
                request.question,
                [
                    _format_preset_response(response, category_map.get(response.category_id))
                    for response in all_preset_responses
                ],
            )
            if selected_response is None:
                logger.warning(
                    "No heuristic response match for machine_id=%s question=%r reason=%s",
                    request.machine_id,
                    request.question,
                    fallback_reason or "no keyword match",
                )
                return _build_fallback_response(fallback_reason or "no keyword match")

            logger.warning(
                "Using keyword fallback for machine_id=%s question=%r selected_response_id=%s reason=%s",
                request.machine_id,
                request.question,
                selected_response.get("id"),
                fallback_reason or "keyword heuristic",
            )

        interaction = InteractionLog(
            user_id=request.user_id,
            machine_id=request.machine_id,
            category_id=selected_response.get("category_id"),
            domanda=request.question,
            risposta=selected_response["text"],
        )

        db.add(interaction)
        db.commit()
        db.refresh(interaction)

        logger.info(
            "Question processed - User: %s, Machine: %s, Category: %s, Response ID: %s",
            request.user_id,
            machine.nome,
            selected_response.get("category_name") or "Fallback",
            selected_response.get("id"),
        )

        return AskQuestionResponse(
            response=selected_response["text"],
            category_id=selected_response.get("category_id"),
            category_name=selected_response.get("category_name"),
        )
    except OperationalError as exc:
        db.rollback()
        logger.error(
            "Database error processing question=%r machine_id=%s: %s",
            request.question,
            request.machine_id,
            exc,
            exc_info=True,
        )
        raise HTTPException(
            status_code=503,
            detail="Database temporarily unavailable",
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.error(
            "Unexpected error processing question=%r machine_id=%s: %s",
            request.question,
            request.machine_id,
            exc,
            exc_info=True,
        )
        return _build_fallback_response("unexpected interaction error")


@router.get("/health")
async def health_check():
    """Verifica che il servizio e Ollama siano disponibili."""
    ollama_available = await is_ollama_available()

    return {
        "status": "ok" if ollama_available else "degraded",
        "ollama_available": ollama_available,
    }
