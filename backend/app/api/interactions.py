import logging
from datetime import datetime, timezone
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, joinedload

from app.api.auth.auth import ADMIN_MACHINE_EVENTS_CHANNEL, get_current_user
from app.core.database import get_db
from app.models.interaction_log import InteractionLog
from app.models.machine import Machine
from app.models.user import User
from app.models.user import Ruolo
from app.schemas.interaction import (
    AskQuestionRequest,
    AskQuestionResponse,
    InteractionFeedbackRequest,
    InteractionFeedbackResponse,
    QuickActionRequest,
    QuickActionResponse,
)
from app.services.knowledge_retrieval import FALLBACK_MESSAGE, knowledge_retrieval_service
from app.services.session_events import session_event_bus

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/interactions", tags=["interactions"])

QUICK_ACTION_COPY = {
    "maintenance": {
        "domanda": "Richiesta manutenzione inviata dall'operatore.",
        "risposta": "La richiesta di manutenzione e stata inviata. Un tecnico prendera in carico la segnalazione.",
        "priority": "normal",
        "message": "La richiesta di manutenzione e stata inviata.",
    },
    "emergency": {
        "domanda": "EMERGENZA: segnale critico inviato dall'operatore.",
        "risposta": "Emergenza inviata. Allontanati dalla macchina e segui le procedure di sicurezza del reparto.",
        "priority": "critical",
        "message": "Emergenza inviata. Allontanati dalla macchina e segui le procedure di sicurezza del reparto.",
    },
}


def _build_response(
    mode: str,
    reason_code: str,
    response: str,
    confidence: float,
    interaction_id: int | None = None,
    selected_response: dict | None = None,
    clarification_options: list[dict] | None = None,
) -> AskQuestionResponse:
    clarification_options = clarification_options or []
    selected_response = selected_response or {}
    return AskQuestionResponse(
        interaction_id=interaction_id,
        response=response,
        mode=mode,
        reason_code=reason_code,
        confidence=confidence,
        clarification_options=clarification_options,
        category_id=selected_response.get("category_id"),
        category_name=selected_response.get("category_name"),
        knowledge_item_id=selected_response.get("knowledge_item_id"),
        knowledge_item_title=selected_response.get("knowledge_item_title"),
    )


def _build_interaction_event_payload(interaction: InteractionLog) -> dict:
    return {
        "interaction_id": interaction.id,
        "user_id": interaction.user_id,
        "user_name": interaction.user.nome if interaction.user else f"Utente {interaction.user_id}",
        "machine_id": interaction.machine_id,
        "machine_name": interaction.machine.nome if interaction.machine else f"Macchina {interaction.machine_id}",
        "category_id": interaction.category_id,
        "category_name": interaction.category.name if interaction.category else None,
        "knowledge_item_id": interaction.knowledge_item_id,
        "knowledge_item_title": interaction.knowledge_item.question_title if interaction.knowledge_item else None,
        "question": interaction.domanda,
        "response": interaction.risposta,
        "feedback_status": interaction.feedback_status,
        "feedback_timestamp": interaction.feedback_timestamp.isoformat() if interaction.feedback_timestamp else None,
        "action_type": interaction.action_type or "question",
        "priority": interaction.priority or "normal",
        "timestamp": interaction.timestamp.isoformat() if interaction.timestamp else None,
    }


@router.post("/ask", response_model=AskQuestionResponse)
async def ask_question(
    request: AskQuestionRequest,
    db: Session = Depends(get_db),
):
    overall_start = perf_counter()
    try:
        machine = db.query(Machine).filter(Machine.id == request.machine_id).first()
        if machine is None:
            logger.warning("Machine %s not found", request.machine_id)
            raise HTTPException(status_code=404, detail="Machine not found")

        retrieval_result = await knowledge_retrieval_service.resolve_question(
            db,
            machine_id=request.machine_id,
            question=request.question,
            selected_knowledge_item_id=request.selected_knowledge_item_id,
        )

        total_latency_ms = round((perf_counter() - overall_start) * 1000, 2)
        top_candidates = [
            {
                "knowledge_item_id": candidate.item.knowledge_item_id,
                "title": candidate.item.question_title,
                "score": candidate.score,
            }
            for candidate in retrieval_result.top_candidates
        ]
        logger.info(
            "interaction route=%s machine_id=%s user_id=%s confidence=%.3f latency_ms=%.2f ollama_latency_ms=%s top_candidates=%s",
            retrieval_result.route,
            request.machine_id,
            request.user_id,
            retrieval_result.confidence,
            total_latency_ms,
            retrieval_result.ollama_latency_ms,
            top_candidates,
        )

        if retrieval_result.mode == "clarification":
            return _build_response(
                mode="clarification",
                reason_code=retrieval_result.reason_code,
                response=retrieval_result.response,
                confidence=retrieval_result.confidence,
                clarification_options=retrieval_result.clarification_options,
            )

        selected_response = retrieval_result.response_payload
        response_text = retrieval_result.response
        if selected_response is None and retrieval_result.reason_code != "out_of_scope":
            response_text = FALLBACK_MESSAGE

        interaction = InteractionLog(
            user_id=request.user_id,
            machine_id=request.machine_id,
            category_id=selected_response.get("category_id") if selected_response else None,
            knowledge_item_id=selected_response.get("knowledge_item_id") if selected_response else None,
            domanda=request.question,
            risposta=response_text,
            action_type="question",
            priority="normal",
        )
        db.add(interaction)
        db.commit()
        db.refresh(interaction)
        interaction = (
            db.query(InteractionLog)
            .options(
                joinedload(InteractionLog.user),
                joinedload(InteractionLog.machine),
                joinedload(InteractionLog.category),
                joinedload(InteractionLog.knowledge_item),
            )
            .filter(InteractionLog.id == interaction.id)
            .first()
        )

        await session_event_bus.publish(
            ADMIN_MACHINE_EVENTS_CHANNEL,
            "interaction_created",
            {
                **_build_interaction_event_payload(interaction),
                "mode": retrieval_result.mode,
                "reason_code": retrieval_result.reason_code,
                "confidence": retrieval_result.confidence,
                "route": retrieval_result.route,
            },
        )

        return _build_response(
            mode=retrieval_result.mode,
            reason_code=retrieval_result.reason_code,
            response=response_text,
            confidence=retrieval_result.confidence,
            interaction_id=interaction.id,
            selected_response=selected_response,
        )
    except OperationalError as exc:
        db.rollback()
        logger.error("Database error processing interaction: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.error("Unexpected interaction error: %s", exc, exc_info=True)
        return _build_response(
            mode="fallback",
            reason_code="no_match",
            response=FALLBACK_MESSAGE,
            confidence=0.0,
        )


@router.post("/quick-action", response_model=QuickActionResponse)
async def submit_quick_action(
    request: QuickActionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.ruolo != Ruolo.ADMIN and current_user.id != request.user_id:
        raise HTTPException(status_code=403, detail="Non puoi creare una segnalazione per un altro utente")

    try:
        machine = db.query(Machine).filter(Machine.id == request.machine_id).first()
        if machine is None:
            raise HTTPException(status_code=404, detail="Macchinario non trovato")

        user = db.query(User).filter(User.id == request.user_id).first()
        if user is None:
            raise HTTPException(status_code=404, detail="Utente non trovato")

        quick_action = QUICK_ACTION_COPY[request.action_type]
        interaction = InteractionLog(
            user_id=request.user_id,
            machine_id=request.machine_id,
            domanda=quick_action["domanda"],
            risposta=quick_action["risposta"],
            feedback_status="unresolved",
            feedback_timestamp=datetime.now(timezone.utc),
            action_type=request.action_type,
            priority=quick_action["priority"],
        )
        db.add(interaction)
        db.commit()
        db.refresh(interaction)
        interaction = (
            db.query(InteractionLog)
            .options(
                joinedload(InteractionLog.user),
                joinedload(InteractionLog.machine),
                joinedload(InteractionLog.category),
                joinedload(InteractionLog.knowledge_item),
            )
            .filter(InteractionLog.id == interaction.id)
            .first()
        )

        await session_event_bus.publish(
            ADMIN_MACHINE_EVENTS_CHANNEL,
            "interaction_created",
            {
                **_build_interaction_event_payload(interaction),
                "mode": "quick_action",
                "reason_code": request.action_type,
                "confidence": 1.0,
                "route": "quick_action",
            },
        )

        return QuickActionResponse(
            interaction_id=interaction.id,
            action_type=request.action_type,
            priority=quick_action["priority"],
            feedback_status=interaction.feedback_status,
            message=quick_action["message"],
            timestamp=interaction.timestamp,
        )
    except HTTPException:
        raise
    except OperationalError as exc:
        db.rollback()
        logger.error("Database error creating quick action: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc
    except Exception as exc:
        db.rollback()
        logger.error("Unexpected quick action error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Errore creando la segnalazione") from exc


@router.post("/{interaction_id}/feedback", response_model=InteractionFeedbackResponse)
async def submit_interaction_feedback(
    interaction_id: int,
    request: InteractionFeedbackRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        interaction = (
            db.query(InteractionLog)
            .options(
                joinedload(InteractionLog.user),
                joinedload(InteractionLog.machine),
                joinedload(InteractionLog.category),
                joinedload(InteractionLog.knowledge_item),
            )
            .filter(InteractionLog.id == interaction_id)
            .first()
        )
        if interaction is None:
            raise HTTPException(status_code=404, detail="Interazione non trovata")
        if current_user.ruolo != Ruolo.ADMIN and interaction.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Non puoi aggiornare questa interazione")

        interaction.feedback_status = request.feedback_status
        interaction.feedback_timestamp = datetime.now(timezone.utc)
        db.commit()
        db.refresh(interaction)

        await session_event_bus.publish(
            ADMIN_MACHINE_EVENTS_CHANNEL,
            "interaction_feedback_updated",
            _build_interaction_event_payload(interaction),
        )

        return InteractionFeedbackResponse(
            interaction_id=interaction.id,
            feedback_status=interaction.feedback_status,
            feedback_timestamp=interaction.feedback_timestamp,
        )
    except HTTPException:
        raise
    except OperationalError as exc:
        db.rollback()
        logger.error("Database error updating interaction feedback: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc
    except Exception as exc:
        db.rollback()
        logger.error("Unexpected interaction feedback error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Errore aggiornando il feedback") from exc


@router.get("/health")
async def health_check():
    return {"status": "ok"}
