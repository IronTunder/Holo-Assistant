import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.category import Category
from app.models.interaction_log import InteractionLog
from app.models.knowledge_item import KnowledgeItem, MachineKnowledgeItem
from app.models.machine import Machine
from app.schemas.interaction import AskQuestionRequest, AskQuestionResponse
from app.services.ollama_service import OllamaServiceError, classify_question, select_best_response

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/interactions", tags=["interactions"])

FALLBACK_RESPONSE = {
    "response": (
        "Mi dispiace, non sono riuscito a trovare una risposta appropriata alla tua domanda. "
        "Ti consiglio di contattare direttamente l'assistenza per ricevere aiuto."
    ),
    "category_id": None,
    "category_name": "Fallback",
    "knowledge_item_id": None,
    "knowledge_item_title": None,
}
WORD_PATTERN = re.compile(r"\w+", re.UNICODE)
MIN_TOKEN_LENGTH = 3


def _tokenize(text: str) -> set[str]:
    return {
        token.lower()
        for token in WORD_PATTERN.findall(text or "")
        if len(token) >= MIN_TOKEN_LENGTH
    }


def _knowledge_score(question_tokens: set[str], item: dict) -> int:
    title_tokens = _tokenize(item.get("question_title", ""))
    answer_tokens = _tokenize(item.get("answer_text", ""))
    keyword_tokens = _tokenize(item.get("keywords", ""))

    score = 0
    score += len(question_tokens & keyword_tokens) * 4
    score += len(question_tokens & title_tokens) * 3
    score += len(question_tokens & answer_tokens)
    return score


def _format_knowledge_item(item: KnowledgeItem) -> dict:
    return {
        "id": item.id,
        "category_id": item.category_id,
        "category_name": item.category.name if item.category else None,
        "question_title": item.question_title,
        "text": item.answer_text,
        "answer_text": item.answer_text,
        "keywords": item.keywords,
        "knowledge_item_id": item.id,
        "knowledge_item_title": item.question_title,
    }


def _select_response_by_keywords(question: str, knowledge_items: list[dict]) -> dict | None:
    question_tokens = _tokenize(question)
    if not question_tokens:
        return None

    scored_items = []
    for item in knowledge_items:
        score = _knowledge_score(question_tokens, item)
        if score > 0:
            scored_items.append((score, item))

    if not scored_items:
        return None

    scored_items.sort(key=lambda payload: (payload[0], payload[1].get("id", 0)), reverse=True)
    return scored_items[0][1]


def _build_fallback_response(reason: str) -> AskQuestionResponse:
    logger.warning("Returning fallback interaction response: %s", reason)
    return AskQuestionResponse(**FALLBACK_RESPONSE)


@router.post("/ask", response_model=AskQuestionResponse)
async def ask_question(
    request: AskQuestionRequest,
    db: Session = Depends(get_db),
):
    try:
        machine = db.query(Machine).filter(Machine.id == request.machine_id).first()
        if machine is None:
            logger.warning("Machine %s not found", request.machine_id)
            raise HTTPException(status_code=404, detail="Machine not found")

        categories = db.query(Category).order_by(Category.name.asc()).all()
        if not categories:
            return _build_fallback_response("no categories found")

        category_names = [category.name for category in categories]
        knowledge_query = (
            db.query(KnowledgeItem)
            .join(MachineKnowledgeItem, MachineKnowledgeItem.knowledge_item_id == KnowledgeItem.id)
            .options(joinedload(KnowledgeItem.category))
            .filter(
                MachineKnowledgeItem.machine_id == request.machine_id,
                MachineKnowledgeItem.is_enabled.is_(True),
                KnowledgeItem.is_active.is_(True),
            )
        )
        all_knowledge_items = knowledge_query.order_by(KnowledgeItem.sort_order.asc(), KnowledgeItem.id.asc()).all()
        if not all_knowledge_items:
            logger.warning("No knowledge items assigned to machine %s", request.machine_id)
            return _build_fallback_response("no knowledge items available")

        selected_response = None
        fallback_reason = None

        try:
            classified_category = await classify_question(request.question, category_names)
            selected_category = next(
                (category for category in categories if category.name.lower() == classified_category.lower()),
                None,
            )
            if selected_category is None:
                raise OllamaServiceError(f"Categoria classificata non valida: {classified_category}")

            category_items = [
                item for item in all_knowledge_items if item.category_id == selected_category.id
            ]
            if not category_items:
                raise OllamaServiceError(
                    f"Nessun knowledge item assegnato alla macchina nella categoria {selected_category.name}"
                )

            selected_response = await select_best_response(
                request.question,
                [_format_knowledge_item(item) for item in category_items],
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
                [_format_knowledge_item(item) for item in all_knowledge_items],
            )
            if selected_response is None:
                return _build_fallback_response(fallback_reason or "no keyword match")

        interaction = InteractionLog(
            user_id=request.user_id,
            machine_id=request.machine_id,
            category_id=selected_response.get("category_id"),
            knowledge_item_id=selected_response.get("knowledge_item_id"),
            domanda=request.question,
            risposta=selected_response["text"],
        )
        db.add(interaction)
        db.commit()

        return AskQuestionResponse(
            response=selected_response["text"],
            category_id=selected_response.get("category_id"),
            category_name=selected_response.get("category_name"),
            knowledge_item_id=selected_response.get("knowledge_item_id"),
            knowledge_item_title=selected_response.get("knowledge_item_title"),
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
        return _build_fallback_response("unexpected interaction error")


@router.get("/health")
async def health_check():
    return {"status": "ok"}
