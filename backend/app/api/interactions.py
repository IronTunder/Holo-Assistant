import logging
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.auth.auth import ADMIN_MACHINE_EVENTS_CHANNEL
from app.core.database import get_db
from app.models.interaction_log import InteractionLog
from app.models.machine import Machine
from app.schemas.interaction import AskQuestionRequest, AskQuestionResponse
from app.services.knowledge_retrieval import FALLBACK_MESSAGE, knowledge_retrieval_service
from app.services.session_events import session_event_bus

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/interactions", tags=["interactions"])


def _build_response(
    mode: str,
    reason_code: str,
    response: str,
    confidence: float,
    selected_response: dict | None = None,
    clarification_options: list[dict] | None = None,
) -> AskQuestionResponse:
    clarification_options = clarification_options or []
    selected_response = selected_response or {}
    return AskQuestionResponse(
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
        )
        db.add(interaction)
        db.commit()

        await session_event_bus.publish(
            ADMIN_MACHINE_EVENTS_CHANNEL,
            "interaction_created",
            {
                "interaction_id": interaction.id,
                "user_id": request.user_id,
                "machine_id": request.machine_id,
                "category_id": selected_response.get("category_id") if selected_response else None,
                "category_name": selected_response.get("category_name") if selected_response else None,
                "knowledge_item_id": selected_response.get("knowledge_item_id") if selected_response else None,
                "knowledge_item_title": selected_response.get("knowledge_item_title") if selected_response else None,
                "question": request.question,
                "response": response_text,
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


@router.get("/health")
async def health_check():
    return {"status": "ok"}
