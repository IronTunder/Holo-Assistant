import logging
from datetime import datetime, timezone
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, joinedload

from app.api.auth.auth import (
    ADMIN_MACHINE_EVENTS_CHANNEL,
    _create_operator_chat_session,
    get_current_user,
    resolve_requested_session_target,
    user_has_permission,
    verify_password,
)
from app.core.database import get_db
from app.models.interaction_log import InteractionLog
from app.models.machine import Machine
from app.models.operator_chat_session import OperatorChatSession
from app.models.user import User
from app.models.working_station import WorkingStation
from app.schemas.interaction import (
    AskQuestionRequest,
    AskQuestionResponse,
    InteractionFeedbackRequest,
    InteractionFeedbackResponse,
    InteractionTargetRequest,
    OperatorChatMessage,
    OperatorChatSessionResponse,
    InteractionResolutionRequest,
    InteractionResolutionResponse,
    PendingQuickActionResponse,
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
        "working_station_id": interaction.working_station_id,
        "working_station_name": (
            interaction.working_station.name
            if interaction.working_station
            else f"Postazione {interaction.working_station_id}"
        ),
        "machine_id": interaction.machine_id,
        "machine_name": (
            interaction.machine.nome
            if interaction.machine
            else (f"Macchina {interaction.machine_id}" if interaction.machine_id is not None else None)
        ),
        "category_id": interaction.category_id,
        "category_name": interaction.category.name if interaction.category else None,
        "knowledge_item_id": interaction.knowledge_item_id,
        "knowledge_item_title": interaction.knowledge_item.question_title if interaction.knowledge_item else None,
        "question": interaction.domanda,
        "response": interaction.risposta,
        "feedback_status": interaction.feedback_status,
        "feedback_timestamp": interaction.feedback_timestamp.isoformat() if interaction.feedback_timestamp else None,
        "resolved_by_user_id": interaction.resolved_by_user_id,
        "resolved_by_user_name": interaction.resolved_by_user.nome if interaction.resolved_by_user else None,
        "resolution_note": interaction.resolution_note,
        "resolution_timestamp": interaction.resolution_timestamp.isoformat() if interaction.resolution_timestamp else None,
        "action_type": interaction.action_type or "question",
        "priority": interaction.priority or "normal",
        "timestamp": interaction.timestamp.isoformat() if interaction.timestamp else None,
    }


def _is_technician(user: User) -> bool:
    return user_has_permission(user, "interactions.resolve")


def _get_open_quick_action(
    db: Session,
    user_id: int,
    working_station_id: int | None = None,
    machine_id: int | None = None,
) -> InteractionLog | None:
    if working_station_id is None and machine_id is None:
        return None

    filters = [
        InteractionLog.user_id == user_id,
        InteractionLog.action_type.in_(("maintenance", "emergency")),
        InteractionLog.feedback_status == "unresolved",
    ]
    if working_station_id is not None:
        filters.append(InteractionLog.working_station_id == working_station_id)
    else:
        filters.extend(
            [
                InteractionLog.working_station_id.is_(None),
                InteractionLog.machine_id == machine_id,
            ]
        )

    return (
        db.query(InteractionLog)
        .options(
            joinedload(InteractionLog.user),
            joinedload(InteractionLog.machine),
            joinedload(InteractionLog.working_station),
            joinedload(InteractionLog.category),
            joinedload(InteractionLog.knowledge_item),
            joinedload(InteractionLog.resolved_by_user),
        )
        .filter(*filters)
        .order_by(InteractionLog.timestamp.desc(), InteractionLog.id.desc())
        .first()
    )


def _build_pending_quick_action_response(interaction: InteractionLog) -> PendingQuickActionResponse:
    default_message = QUICK_ACTION_COPY[interaction.action_type]["message"]
    message = (
        "Emergenza aperta: attendi il tecnico e conferma la risoluzione dopo l intervento."
        if interaction.action_type == "emergency"
        else "Richiesta manutenzione aperta: il tecnico potra confermare la risoluzione da questa postazione."
    )
    return PendingQuickActionResponse(
        interaction_id=interaction.id,
        action_type=interaction.action_type,
        priority=interaction.priority,
        feedback_status=interaction.feedback_status,
        message=message if interaction.feedback_status == "unresolved" else default_message,
        timestamp=interaction.timestamp,
        resolved_by_user_id=interaction.resolved_by_user_id,
        resolved_by_user_name=interaction.resolved_by_user.nome if interaction.resolved_by_user else None,
        resolution_timestamp=interaction.resolution_timestamp,
    )


def _resolve_technician_user(
    request: InteractionResolutionRequest,
    current_user: User,
    db: Session,
) -> User:
    if _is_technician(current_user):
        return current_user

    technician: User | None = None
    if request.technician_username and request.technician_password:
        technician = db.query(User).filter(User.nome == request.technician_username.strip()).first()
        if technician is None or not technician.password_hash or not verify_password(
            request.technician_password,
            technician.password_hash,
        ):
            raise HTTPException(status_code=401, detail="Credenziali tecnico non valide")

    if technician is None:
        raise HTTPException(status_code=403, detail="Autenticazione tecnico richiesta")

    if not _is_technician(technician):
        raise HTTPException(status_code=403, detail="L'utente autenticato non e un manutentore")

    return technician


def _load_working_station(
    db: Session,
    working_station_id: int,
) -> WorkingStation | None:
    return (
        db.query(WorkingStation)
        .options(
            joinedload(WorkingStation.assigned_machine),
            joinedload(WorkingStation.department),
        )
        .filter(WorkingStation.id == working_station_id)
        .first()
    )


def _load_active_chat_session(
    db: Session,
    user_id: int,
    working_station_id: int,
) -> OperatorChatSession | None:
    return (
        db.query(OperatorChatSession)
        .filter(
            OperatorChatSession.user_id == user_id,
            OperatorChatSession.working_station_id == working_station_id,
            OperatorChatSession.is_active.is_(True),
        )
        .order_by(OperatorChatSession.started_at.desc(), OperatorChatSession.id.desc())
        .first()
    )


def _resolve_operator_session_target(
    db: Session,
    current_user_id: int,
    working_station_id: int | None = None,
    machine_id: int | None = None,
) -> tuple[WorkingStation | None, Machine | None, OperatorChatSession | None]:
    working_station, machine = resolve_requested_session_target(
        db,
        working_station_id=working_station_id,
        machine_id=machine_id,
    )

    if working_station is not None:
        if not working_station.in_uso or working_station.operatore_attuale_id != current_user_id:
            raise HTTPException(status_code=403, detail="Postazione non assegnata all'utente corrente")
        machine = working_station.assigned_machine or machine
        chat_session = _load_active_chat_session(db, current_user_id, working_station.id)
        return working_station, machine, chat_session

    if machine is None:
        raise HTTPException(status_code=404, detail="Macchina non trovata")
    if not machine.in_uso or machine.operatore_attuale_id != current_user_id:
        raise HTTPException(status_code=403, detail="Macchina non assegnata all'utente corrente")
    return None, machine, None


def _build_chat_messages(interactions: list[InteractionLog]) -> list[OperatorChatMessage]:
    messages: list[OperatorChatMessage] = []
    for interaction in interactions:
        timestamp = interaction.timestamp or datetime.now(timezone.utc)
        messages.append(
            OperatorChatMessage(
                id=f"user-{interaction.id}",
                role="user",
                content=interaction.domanda,
                timestamp=timestamp,
                interaction_id=interaction.id,
                action_type=interaction.action_type,
                feedback_status=interaction.feedback_status,
            )
        )
        if interaction.risposta:
            messages.append(
                OperatorChatMessage(
                    id=f"assistant-{interaction.id}",
                    role="assistant",
                    content=interaction.risposta,
                    timestamp=timestamp,
                    interaction_id=interaction.id,
                    action_type=interaction.action_type,
                    feedback_status=interaction.feedback_status,
                )
            )
        if interaction.feedback_status == "resolved" and interaction.resolution_timestamp:
            messages.append(
                OperatorChatMessage(
                    id=f"system-{interaction.id}",
                    role="system",
                    content=(
                        f"Intervento confermato da {interaction.resolved_by_user.nome}"
                        if interaction.resolved_by_user
                        else "Intervento confermato"
                    ),
                    timestamp=interaction.resolution_timestamp,
                    interaction_id=interaction.id,
                    action_type=interaction.action_type,
                    feedback_status=interaction.feedback_status,
                )
            )
    return messages


@router.post("/ask", response_model=AskQuestionResponse)
async def ask_question(
    request: AskQuestionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    overall_start = perf_counter()
    try:
        if not isinstance(current_user, User):
            if request.user_id is None:
                raise HTTPException(status_code=401, detail="Autenticazione richiesta")
            current_user = db.query(User).filter(User.id == request.user_id).first()
            if current_user is None:
                raise HTTPException(status_code=401, detail="Utente non valido")

        working_station, machine, chat_session = _resolve_operator_session_target(
            db,
            current_user.id,
            working_station_id=request.working_station_id,
            machine_id=request.machine_id,
        )

        if machine is None:
            response_text = (
                "Questa postazione non ha un macchinario associato. Posso gestire la sessione e le segnalazioni, "
                "ma per risposte tecniche serve associare un macchinario in amministrazione."
            )
            interaction = InteractionLog(
                user_id=current_user.id,
                working_station_id=working_station.id if working_station else None,
                chat_session_id=chat_session.id if chat_session else None,
                domanda=request.question,
                risposta=response_text,
                action_type="question",
                priority="normal",
                feedback_status="not_applicable",
                feedback_timestamp=datetime.now(timezone.utc),
            )
            db.add(interaction)
            db.commit()
            db.refresh(interaction)
            return _build_response(
                mode="fallback",
                reason_code="out_of_scope",
                response=response_text,
                confidence=0.0,
                interaction_id=interaction.id,
            )

        retrieval_result = await knowledge_retrieval_service.resolve_question(
            db,
            machine_id=machine.id,
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
            "interaction route=%s working_station_id=%s machine_id=%s user_id=%s confidence=%.3f latency_ms=%.2f ollama_latency_ms=%s top_candidates=%s",
            retrieval_result.route,
            working_station.id if working_station is not None else None,
            machine.id,
            current_user.id,
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
            user_id=current_user.id,
            machine_id=machine.id,
            working_station_id=working_station.id if working_station else None,
            chat_session_id=chat_session.id if chat_session else None,
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
                joinedload(InteractionLog.working_station),
                joinedload(InteractionLog.category),
                joinedload(InteractionLog.knowledge_item),
                joinedload(InteractionLog.resolved_by_user),
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
    if not user_has_permission(current_user, "backoffice.access") and current_user.id != request.user_id:
        raise HTTPException(status_code=403, detail="Non puoi creare una segnalazione per un altro utente")

    try:
        working_station, machine, chat_session = _resolve_operator_session_target(
            db,
            request.user_id,
            working_station_id=request.working_station_id,
            machine_id=request.machine_id,
        )

        user = db.query(User).filter(User.id == request.user_id).first()
        if user is None:
            raise HTTPException(status_code=404, detail="Utente non trovato")

        existing_open_quick_action = _get_open_quick_action(
            db,
            request.user_id,
            working_station_id=working_station.id if working_station else None,
            machine_id=machine.id if machine else None,
        )
        if existing_open_quick_action is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": (
                        "Esiste gia una segnalazione aperta per questa postazione"
                        if working_station is not None
                        else "Esiste gia una segnalazione aperta per questa macchina"
                    ),
                    "interaction_id": existing_open_quick_action.id,
                    "action_type": existing_open_quick_action.action_type,
                    "feedback_status": existing_open_quick_action.feedback_status,
                },
            )

        quick_action = QUICK_ACTION_COPY[request.action_type]
        interaction = InteractionLog(
            user_id=request.user_id,
            machine_id=machine.id if machine else None,
            working_station_id=working_station.id if working_station else None,
            chat_session_id=chat_session.id if chat_session else None,
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
                joinedload(InteractionLog.working_station),
                joinedload(InteractionLog.category),
                joinedload(InteractionLog.knowledge_item),
                joinedload(InteractionLog.resolved_by_user),
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


@router.get("/pending-quick-action", response_model=PendingQuickActionResponse | None)
async def get_pending_quick_action(
    working_station_id: int | None = None,
    machine_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    working_station, machine = resolve_requested_session_target(
        db,
        working_station_id=working_station_id,
        machine_id=machine_id,
    )
    interaction = _get_open_quick_action(
        db,
        current_user.id,
        working_station_id=working_station.id if working_station else None,
        machine_id=machine.id if machine else None,
    )
    if interaction is None:
        return None
    return _build_pending_quick_action_response(interaction)


@router.get("/session-history", response_model=OperatorChatSessionResponse)
async def get_session_history(
    working_station_id: int | None = None,
    machine_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    working_station, machine, chat_session = _resolve_operator_session_target(
        db,
        current_user.id,
        working_station_id=working_station_id,
        machine_id=machine_id,
    )
    resolved_working_station_id = working_station.id if working_station else None
    if chat_session is None and working_station is not None:
        return OperatorChatSessionResponse(
            chat_session_id=None,
            working_station_id=resolved_working_station_id,
            machine_id=machine.id if machine else None,
            messages=[],
        )

    interactions_query = (
        db.query(InteractionLog)
        .options(
            joinedload(InteractionLog.resolved_by_user),
        )
        .order_by(InteractionLog.timestamp.asc(), InteractionLog.id.asc())
    )
    if chat_session is not None:
        interactions_query = interactions_query.filter(InteractionLog.chat_session_id == chat_session.id)
    elif working_station is not None:
        interactions_query = interactions_query.filter(
            InteractionLog.user_id == current_user.id,
            InteractionLog.working_station_id == working_station.id,
        )
    else:
        interactions_query = interactions_query.filter(
            InteractionLog.user_id == current_user.id,
            InteractionLog.working_station_id.is_(None),
            InteractionLog.machine_id == machine.id,
        )
    interactions = interactions_query.all()
    return OperatorChatSessionResponse(
        chat_session_id=chat_session.id if chat_session else None,
        working_station_id=resolved_working_station_id,
        machine_id=machine.id if machine else None,
        messages=_build_chat_messages(interactions),
    )


@router.post("/clear-session-history", response_model=OperatorChatSessionResponse)
async def clear_session_history(
    request: InteractionTargetRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    working_station, machine, _chat_session = _resolve_operator_session_target(
        db,
        current_user.id,
        working_station_id=request.working_station_id,
        machine_id=request.machine_id,
    )

    if working_station is None:
        raise HTTPException(status_code=400, detail="La chat operatore richiede una postazione attiva")

    new_chat_session = _create_operator_chat_session(db, current_user.id, working_station.id, refresh_token_id=None)
    db.commit()

    return OperatorChatSessionResponse(
        chat_session_id=new_chat_session.id,
        working_station_id=working_station.id,
        machine_id=machine.id if machine else None,
        messages=[],
    )


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
                joinedload(InteractionLog.working_station),
                joinedload(InteractionLog.category),
                joinedload(InteractionLog.knowledge_item),
                joinedload(InteractionLog.resolved_by_user),
            )
            .filter(InteractionLog.id == interaction_id)
            .first()
        )
        if interaction is None:
            raise HTTPException(status_code=404, detail="Interazione non trovata")
        if not user_has_permission(current_user, "backoffice.access") and interaction.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Non puoi aggiornare questa interazione")
        if interaction.feedback_status == "resolved":
            raise HTTPException(status_code=409, detail="Interazione gia chiusa")

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


@router.post("/{interaction_id}/resolve", response_model=InteractionResolutionResponse)
async def resolve_interaction(
    interaction_id: int,
    request: InteractionResolutionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        interaction = (
            db.query(InteractionLog)
            .options(
                joinedload(InteractionLog.user),
                joinedload(InteractionLog.machine),
                joinedload(InteractionLog.working_station),
                joinedload(InteractionLog.category),
                joinedload(InteractionLog.knowledge_item),
                joinedload(InteractionLog.resolved_by_user),
            )
            .filter(InteractionLog.id == interaction_id)
            .first()
        )
        if interaction is None:
            raise HTTPException(status_code=404, detail="Interazione non trovata")
        if interaction.feedback_status == "resolved":
            raise HTTPException(status_code=409, detail="Interazione gia chiusa")
        if interaction.feedback_status != "unresolved":
            raise HTTPException(status_code=409, detail="Interazione non risolvibile")
        if interaction.action_type not in {"question", "maintenance", "emergency"}:
            raise HTTPException(status_code=400, detail="Tipo interazione non risolvibile")

        technician = _resolve_technician_user(request, current_user, db)
        now = datetime.now(timezone.utc)
        resolution_note = request.resolution_note.strip() if request.resolution_note else None

        interaction.feedback_status = "resolved"
        interaction.feedback_timestamp = now
        interaction.resolved_by_user_id = technician.id
        interaction.resolution_note = resolution_note
        interaction.resolution_timestamp = now
        db.commit()
        db.refresh(interaction)
        interaction = (
            db.query(InteractionLog)
            .options(
                joinedload(InteractionLog.user),
                joinedload(InteractionLog.machine),
                joinedload(InteractionLog.working_station),
                joinedload(InteractionLog.category),
                joinedload(InteractionLog.knowledge_item),
                joinedload(InteractionLog.resolved_by_user),
            )
            .filter(InteractionLog.id == interaction.id)
            .first()
        )

        await session_event_bus.publish(
            ADMIN_MACHINE_EVENTS_CHANNEL,
            "interaction_feedback_updated",
            _build_interaction_event_payload(interaction),
        )

        return InteractionResolutionResponse(
            interaction_id=interaction.id,
            feedback_status=interaction.feedback_status,
            feedback_timestamp=interaction.feedback_timestamp,
            resolved_by_user_id=technician.id,
            resolved_by_user_name=technician.nome,
            resolution_note=interaction.resolution_note,
            resolution_timestamp=interaction.resolution_timestamp,
        )
    except HTTPException:
        raise
    except OperationalError as exc:
        db.rollback()
        logger.error("Database error resolving interaction: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc
    except Exception as exc:
        db.rollback()
        logger.error("Unexpected interaction resolution error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Errore confermando la risoluzione") from exc


@router.get("/health")
async def health_check():
    return {"status": "ok"}
