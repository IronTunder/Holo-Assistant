import re
import unicodedata
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy.orm import Session, joinedload

from app.models.machine import Machine
from app.models.material import Material, WorkingStationMaterial
from app.models.operational_ticket import OperationalTicket
from app.models.operator_chat_session import OperatorChatSession
from app.models.operator_conversation_state import OperatorConversationState
from app.models.user import User
from app.models.working_station import WorkingStation

WorkflowType = Literal["material_shortage"]
AgentResponseMode = Literal["agent_question", "confirmation_required", "action_completed", "action_blocked"]

SHORTAGE_PATTERNS = (
    "ho finito",
    "sono finiti",
    "sono finite",
    "abbiamo finito",
    "sono terminati",
    "sono terminate",
    "e finito",
    "e finita",
    "non ho piu",
    "mancano",
    "mi mancano",
    "sono senza",
)
POSITIVE_CONFIRMATIONS = {"si", "sì", "confermo", "ok", "va bene", "procedi", "manda la segnalazione"}
NEGATIVE_CONFIRMATIONS = {"no", "annulla", "annulla segnalazione", "ferma", "lascia stare"}


def _normalize_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_only = "".join(char for char in normalized if not unicodedata.combining(char))
    collapsed = re.sub(r"[^a-zA-Z0-9]+", " ", ascii_only.lower()).strip()
    return re.sub(r"\s+", " ", collapsed)


def _tokenize(value: str | None) -> set[str]:
    return {token for token in _normalize_text(value).split(" ") if token}


def _split_aliases(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    raw_parts = re.split(r"[,;\n]+", value)
    return tuple(part.strip() for part in raw_parts if part.strip())


def _build_shortage_suggestion(material: Material) -> str:
    aliases = [alias for alias in _split_aliases(material.aliases) if alias]
    suggestion_source = min(aliases, key=lambda alias: (len(_tokenize(alias)), len(alias))) if aliases else material.name
    normalized = _normalize_text(suggestion_source)
    if not normalized:
        normalized = _normalize_text(material.name) or "materiale"
    return f"Ho finito il {normalized}"


@dataclass
class AgentCandidate:
    material_id: int
    label: str
    description: str | None = None


@dataclass
class AgentConfirmation:
    prompt: str
    action: str
    material_id: int | None = None
    material_name: str | None = None


@dataclass
class AgentExecutedActionResult:
    action: str
    status: Literal["completed", "blocked", "cancelled"]
    ticket_id: int | None = None
    summary: str | None = None


@dataclass
class AgentWorkflowResult:
    handled: bool
    response: str | None = None
    response_mode: AgentResponseMode | None = None
    workflow_type: WorkflowType | None = None
    conversation_state_id: int | None = None
    pending_slots: list[str] = field(default_factory=list)
    candidate_options: list[AgentCandidate] = field(default_factory=list)
    confirmation_payload: AgentConfirmation | None = None
    executed_action: AgentExecutedActionResult | None = None
    ticket_id: int | None = None
    action_type: str = "question"
    priority: str = "normal"
    feedback_status: str | None = None
    reason_code: str = "no_match"


class AgentTools:
    def get_operator_context(
        self,
        db: Session,
        *,
        user_id: int,
        working_station: WorkingStation | None,
        machine: Machine | None,
        chat_session: OperatorChatSession | None,
    ) -> dict:
        return {
            "user_id": user_id,
            "working_station_id": working_station.id if working_station else None,
            "working_station_name": working_station.name if working_station else None,
            "machine_id": machine.id if machine else None,
            "machine_name": machine.nome if machine else None,
            "chat_session_id": chat_session.id if chat_session else None,
        }

    def list_station_materials(
        self,
        db: Session,
        *,
        working_station_id: int,
        machine_id: int | None = None,
    ) -> list[WorkingStationMaterial]:
        query = (
            db.query(WorkingStationMaterial)
            .options(joinedload(WorkingStationMaterial.material))
            .filter(
                WorkingStationMaterial.working_station_id == working_station_id,
                WorkingStationMaterial.is_active.is_(True),
            )
        )
        if machine_id is not None:
            query = query.filter(
                (WorkingStationMaterial.machine_id.is_(None)) | (WorkingStationMaterial.machine_id == machine_id)
            )
        return query.order_by(WorkingStationMaterial.display_order.asc(), WorkingStationMaterial.id.asc()).all()

    def get_material_details(self, assignment: WorkingStationMaterial) -> dict:
        material = assignment.material
        aliases = _split_aliases(material.aliases)
        return {
            "material_id": material.id,
            "name": material.name,
            "category": material.category,
            "description": material.description,
            "characteristics": material.characteristics,
            "aliases": aliases,
            "usage_context": assignment.usage_context,
            "notes": assignment.notes,
        }

    def search_material_candidates(
        self,
        assignments: list[WorkingStationMaterial],
        *,
        user_message: str,
    ) -> tuple[str | None, list[WorkingStationMaterial]]:
        normalized_message = _normalize_text(user_message)
        message_tokens = _tokenize(user_message)
        best_family: str | None = None
        scored_matches: list[tuple[int, WorkingStationMaterial]] = []

        for assignment in assignments:
            material = assignment.material
            aliases = _split_aliases(material.aliases)
            family_candidates = {
                token
                for source in (material.category, material.name, *aliases)
                for token in _tokenize(source)
                if len(token) >= 3
            }
            characteristics_tokens = _tokenize(material.characteristics)
            score = 0
            if any(pattern in normalized_message for pattern in SHORTAGE_PATTERNS):
                score += 1
            overlap = message_tokens & family_candidates
            score += len(overlap) * 4
            score += len(message_tokens & characteristics_tokens) * 2
            if material.category and _normalize_text(material.category) in normalized_message:
                score += 3
            if _normalize_text(material.name) in normalized_message:
                score += 5
            if score > 0:
                best_family = material.category or next(iter(overlap), best_family)
                scored_matches.append((score, assignment))

        if scored_matches:
            scored_matches.sort(key=lambda item: (-item[0], item[1].display_order, item[1].id))
            top_score = scored_matches[0][0]
            return best_family, [assignment for score, assignment in scored_matches if score >= max(top_score - 2, 1)]

        return None, assignments

    def message_supports_assignment(
        self,
        assignment: WorkingStationMaterial,
        *,
        user_message: str,
    ) -> bool:
        normalized_message = _normalize_text(user_message)
        message_tokens = _tokenize(user_message)
        material = assignment.material
        aliases = _split_aliases(material.aliases)
        candidate_sources = (
            material.category,
            material.name,
            material.characteristics,
            material.description,
            assignment.usage_context,
            assignment.notes,
            *aliases,
        )
        for source in candidate_sources:
            normalized_source = _normalize_text(source)
            if not normalized_source:
                continue
            source_tokens = _tokenize(source)
            if source_tokens and (message_tokens & source_tokens):
                return True
            if normalized_source in normalized_message:
                return True
        return False

    def list_open_tickets_for_context(
        self,
        db: Session,
        *,
        workflow_type: WorkflowType,
        working_station_id: int | None,
        material_id: int | None,
    ) -> list[OperationalTicket]:
        query = db.query(OperationalTicket).filter(
            OperationalTicket.workflow_type == workflow_type,
            OperationalTicket.status == "open",
        )
        if working_station_id is not None:
            query = query.filter(OperationalTicket.working_station_id == working_station_id)
        if material_id is not None:
            query = query.filter(OperationalTicket.material_id == material_id)
        return query.order_by(OperationalTicket.created_at.desc(), OperationalTicket.id.desc()).all()

    def create_operational_ticket(
        self,
        db: Session,
        *,
        workflow_type: WorkflowType,
        priority: str,
        summary: str,
        details: str,
        user_id: int,
        working_station_id: int | None,
        machine_id: int | None,
        material_id: int | None,
        conversation_state_id: int | None,
    ) -> OperationalTicket:
        ticket = OperationalTicket(
            workflow_type=workflow_type,
            status="open",
            priority=priority,
            summary=summary,
            details=details,
            user_id=user_id,
            working_station_id=working_station_id,
            machine_id=machine_id,
            material_id=material_id,
            conversation_state_id=conversation_state_id,
        )
        db.add(ticket)
        db.flush()
        return ticket


class AgentOrchestratorService:
    def __init__(self) -> None:
        self.tools = AgentTools()

    def resolve(
        self,
        db: Session,
        *,
        current_user: User,
        working_station: WorkingStation | None,
        machine: Machine | None,
        chat_session: OperatorChatSession | None,
        question: str,
        conversation_state_id: int | None = None,
        selected_material_id: int | None = None,
        confirmation_decision: Literal["confirm", "cancel"] | None = None,
    ) -> AgentWorkflowResult:
        active_state = self._load_active_state(
            db,
            current_user_id=current_user.id,
            working_station_id=working_station.id if working_station else None,
            chat_session_id=chat_session.id if chat_session else None,
            conversation_state_id=conversation_state_id,
        )
        if active_state is not None:
            return self._continue_existing_workflow(
                db,
                current_user=current_user,
                working_station=working_station,
                machine=machine,
                chat_session=chat_session,
                question=question,
                active_state=active_state,
                selected_material_id=selected_material_id,
                confirmation_decision=confirmation_decision,
            )

        if not self._is_material_shortage_request(question):
            return AgentWorkflowResult(handled=False)

        if working_station is None:
            return AgentWorkflowResult(
                handled=True,
                response="Per questa richiesta operativa ho bisogno di una postazione attiva associata all'operatore.",
                response_mode="action_blocked",
                workflow_type="material_shortage",
                pending_slots=["working_station_id"],
                action_type="material_shortage",
                priority="normal",
                reason_code="no_match",
            )

        assignments = self.tools.list_station_materials(
            db,
            working_station_id=working_station.id,
            machine_id=machine.id if machine else None,
        )
        if not assignments:
            return AgentWorkflowResult(
                handled=True,
                response="Non trovo materiali configurati per questa postazione. Non posso aprire una segnalazione affidabile.",
                response_mode="action_blocked",
                workflow_type="material_shortage",
                pending_slots=["materials"],
                action_type="material_shortage",
                priority="normal",
                reason_code="no_match",
            )

        material_family, candidates = self.tools.search_material_candidates(assignments, user_message=question)
        if not candidates:
            return AgentWorkflowResult(
                handled=True,
                response="Ho capito che manca un materiale, ma non riesco a identificarlo con sicurezza. Dimmi quale materiale ti serve.",
                response_mode="agent_question",
                workflow_type="material_shortage",
                pending_slots=["material_family"],
                action_type="material_shortage",
                priority="normal",
                reason_code="clarification",
            )

        state = self._create_or_update_state(
            db,
            current_user=current_user,
            working_station=working_station,
            machine=machine,
            chat_session=chat_session,
            workflow_type="material_shortage",
            state_status="awaiting_material_selection" if len(candidates) > 1 else "awaiting_confirmation",
            pending_action="create_material_shortage_ticket",
            state_payload={
                "material_family": material_family,
                "candidate_material_ids": [candidate.material_id for candidate in candidates],
                "material_id": candidates[0].material_id if len(candidates) == 1 else None,
                "requires_confirmation": True,
            },
            last_user_message=question,
        )

        if len(candidates) == 1:
            if not self.tools.message_supports_assignment(candidates[0], user_message=question):
                material = candidates[0].material
                suggestion = _build_shortage_suggestion(material)
                response = f"Ho capito che manca un materiale, ma non riesco a collegarlo con sicurezza. Magari volevi dire \"{suggestion}\"?"
                state.state_status = "awaiting_material_selection"
                state.state_payload = {
                    **dict(state.state_payload or {}),
                    "material_id": None,
                    "candidate_material_ids": [candidates[0].material_id],
                    "suggested_message": suggestion,
                }
                state.last_assistant_message = response
                db.flush()
                return AgentWorkflowResult(
                    handled=True,
                    response=response,
                    response_mode="agent_question",
                    workflow_type="material_shortage",
                    conversation_state_id=state.id,
                    pending_slots=["material_id"],
                    candidate_options=[self._build_candidate_option(candidates[0])],
                    action_type="material_shortage",
                    priority="normal",
                    reason_code="clarification",
                )
            return self._build_confirmation_result(working_station, candidates[0], state.id)

        return AgentWorkflowResult(
            handled=True,
            response="Va bene, di quale materiale hai bisogno?",
            response_mode="agent_question",
            workflow_type="material_shortage",
            conversation_state_id=state.id,
            pending_slots=["material_id"],
            candidate_options=[self._build_candidate_option(candidate) for candidate in candidates],
            action_type="material_shortage",
            priority="normal",
            reason_code="clarification",
        )

    def _load_active_state(
        self,
        db: Session,
        *,
        current_user_id: int,
        working_station_id: int | None,
        chat_session_id: int | None,
        conversation_state_id: int | None,
    ) -> OperatorConversationState | None:
        query = db.query(OperatorConversationState).filter(
            OperatorConversationState.user_id == current_user_id,
            OperatorConversationState.is_active.is_(True),
        )
        if conversation_state_id is not None:
            return query.filter(OperatorConversationState.id == conversation_state_id).first()
        if chat_session_id is not None:
            query = query.filter(
                (OperatorConversationState.chat_session_id == chat_session_id)
                | (OperatorConversationState.chat_session_id.is_(None))
            )
        if working_station_id is not None:
            query = query.filter(
                (OperatorConversationState.working_station_id == working_station_id)
                | (OperatorConversationState.working_station_id.is_(None))
            )
        return query.order_by(OperatorConversationState.updated_at.desc(), OperatorConversationState.id.desc()).first()

    def _continue_existing_workflow(
        self,
        db: Session,
        *,
        current_user: User,
        working_station: WorkingStation | None,
        machine: Machine | None,
        chat_session: OperatorChatSession | None,
        question: str,
        active_state: OperatorConversationState,
        selected_material_id: int | None,
        confirmation_decision: Literal["confirm", "cancel"] | None,
    ) -> AgentWorkflowResult:
        if active_state.workflow_type != "material_shortage":
            active_state.is_active = False
            db.flush()
            return AgentWorkflowResult(handled=False)

        if active_state.state_status == "awaiting_material_selection":
            return self._handle_material_selection(
                db,
                current_user=current_user,
                working_station=working_station,
                machine=machine,
                chat_session=chat_session,
                question=question,
                active_state=active_state,
                selected_material_id=selected_material_id,
            )

        if active_state.state_status == "awaiting_confirmation":
            return self._handle_confirmation(
                db,
                current_user=current_user,
                working_station=working_station,
                machine=machine,
                question=question,
                active_state=active_state,
                confirmation_decision=confirmation_decision,
            )

        active_state.is_active = False
        db.flush()
        return AgentWorkflowResult(handled=False)

    def _handle_material_selection(
        self,
        db: Session,
        *,
        current_user: User,
        working_station: WorkingStation | None,
        machine: Machine | None,
        chat_session: OperatorChatSession | None,
        question: str,
        active_state: OperatorConversationState,
        selected_material_id: int | None,
    ) -> AgentWorkflowResult:
        payload = dict(active_state.state_payload or {})
        candidate_ids = [int(material_id) for material_id in payload.get("candidate_material_ids") or []]
        assignments = self.tools.list_station_materials(
            db,
            working_station_id=working_station.id if working_station else 0,
            machine_id=machine.id if machine else None,
        )
        assignments = [assignment for assignment in assignments if assignment.material_id in candidate_ids]
        if not assignments:
            active_state.is_active = False
            db.flush()
            return AgentWorkflowResult(
                handled=True,
                response="Lo stato della conversazione non e piu valido. Ripeti la richiesta di materiale.",
                response_mode="action_blocked",
                workflow_type="material_shortage",
                action_type="material_shortage",
                priority="normal",
            )

        chosen_assignment = None
        if selected_material_id is not None:
            chosen_assignment = next((assignment for assignment in assignments if assignment.material_id == selected_material_id), None)

        if chosen_assignment is None:
            normalized_question = _normalize_text(question)
            for assignment in assignments:
                material = assignment.material
                material_signals = [
                    material.name,
                    material.category,
                    material.characteristics,
                    material.description,
                    *list(_split_aliases(material.aliases)),
                ]
                if any(_normalize_text(signal) and _normalize_text(signal) in normalized_question for signal in material_signals):
                    chosen_assignment = assignment
                    break

        if chosen_assignment is None:
            active_state.last_user_message = question
            active_state.last_assistant_message = "Dimmi quale materiale ti serve scegliendo una delle opzioni disponibili."
            db.flush()
            return AgentWorkflowResult(
                handled=True,
                response="Dimmi quale materiale ti serve scegliendo una delle opzioni disponibili.",
                response_mode="agent_question",
                workflow_type="material_shortage",
                conversation_state_id=active_state.id,
                pending_slots=["material_id"],
                candidate_options=[self._build_candidate_option(candidate) for candidate in assignments],
                action_type="material_shortage",
                priority="normal",
                reason_code="clarification",
            )

        payload["material_id"] = chosen_assignment.material_id
        active_state.state_status = "awaiting_confirmation"
        active_state.state_payload = payload
        active_state.last_user_message = question
        db.flush()
        return self._build_confirmation_result(working_station, chosen_assignment, active_state.id)

    def _handle_confirmation(
        self,
        db: Session,
        *,
        current_user: User,
        working_station: WorkingStation | None,
        machine: Machine | None,
        question: str,
        active_state: OperatorConversationState,
        confirmation_decision: Literal["confirm", "cancel"] | None,
    ) -> AgentWorkflowResult:
        payload = dict(active_state.state_payload or {})
        material_id = payload.get("material_id")
        if material_id is None:
            active_state.is_active = False
            db.flush()
            return AgentWorkflowResult(handled=False)

        normalized_question = _normalize_text(question)
        if confirmation_decision is None:
            if normalized_question in {_normalize_text(value) for value in POSITIVE_CONFIRMATIONS}:
                confirmation_decision = "confirm"
            elif normalized_question in {_normalize_text(value) for value in NEGATIVE_CONFIRMATIONS}:
                confirmation_decision = "cancel"

        if confirmation_decision == "cancel":
            active_state.is_active = False
            active_state.state_status = "cancelled"
            active_state.last_user_message = question
            active_state.last_assistant_message = "Segnalazione annullata. Se ti serve posso aiutarti con un'altra richiesta."
            db.flush()
            return AgentWorkflowResult(
                handled=True,
                response="Segnalazione annullata. Se ti serve posso aiutarti con un'altra richiesta.",
                response_mode="action_blocked",
                workflow_type="material_shortage",
                conversation_state_id=active_state.id,
                executed_action=AgentExecutedActionResult(
                    action="create_material_shortage_ticket",
                    status="cancelled",
                    summary="Segnalazione materiale annullata dall'operatore.",
                ),
                action_type="material_shortage",
                priority="normal",
            )

        if confirmation_decision != "confirm":
            material = db.query(Material).filter(Material.id == material_id, Material.is_active.is_(True)).first()
            return AgentWorkflowResult(
                handled=True,
                response="Confermi che devo inviare la segnalazione?",
                response_mode="confirmation_required",
                workflow_type="material_shortage",
                conversation_state_id=active_state.id,
                pending_slots=["confirmation"],
                confirmation_payload=AgentConfirmation(
                    prompt="Confermi che devo inviare la segnalazione?",
                    action="create_material_shortage_ticket",
                    material_id=material.id if material else None,
                    material_name=material.name if material else None,
                ),
                action_type="material_shortage",
                priority="normal",
            )

        material = db.query(Material).filter(Material.id == material_id, Material.is_active.is_(True)).first()
        existing_tickets = self.tools.list_open_tickets_for_context(
            db,
            workflow_type="material_shortage",
            working_station_id=working_station.id if working_station else None,
            material_id=material_id,
        )
        if existing_tickets:
            active_state.is_active = False
            active_state.state_status = "completed"
            active_state.last_user_message = question
            active_state.last_assistant_message = "Esiste gia una segnalazione aperta per questo materiale in questa postazione."
            db.flush()
            return AgentWorkflowResult(
                handled=True,
                response="Esiste gia una segnalazione aperta per questo materiale in questa postazione.",
                response_mode="action_blocked",
                workflow_type="material_shortage",
                conversation_state_id=active_state.id,
                ticket_id=existing_tickets[0].id,
                executed_action=AgentExecutedActionResult(
                    action="create_material_shortage_ticket",
                    status="blocked",
                    ticket_id=existing_tickets[0].id,
                    summary=existing_tickets[0].summary,
                ),
                action_type="material_shortage",
                priority="normal",
            )

        station_label = working_station.name if working_station else "postazione"
        material_name = material.name if material else "materiale"
        summary = f"{material_name} terminati alla {station_label}"
        details_parts = [
            f"Operatore: {current_user.nome}",
            f"Postazione: {working_station.name if working_station else 'N/D'}",
        ]
        if machine is not None:
            details_parts.append(f"Macchinario: {machine.nome}")
        if material is not None and material.characteristics:
            details_parts.append(f"Caratteristiche: {material.characteristics}")
        ticket = self.tools.create_operational_ticket(
            db,
            workflow_type="material_shortage",
            priority="normal",
            summary=summary,
            details=" | ".join(details_parts),
            user_id=current_user.id,
            working_station_id=working_station.id if working_station else None,
            machine_id=machine.id if machine else None,
            material_id=material.id if material else None,
            conversation_state_id=active_state.id,
        )
        active_state.is_active = False
        active_state.state_status = "completed"
        active_state.last_user_message = question
        active_state.last_assistant_message = (
            f"Segnalazione inviata: {material_name} terminati alla {station_label}. Ticket #{ticket.id}."
        )
        db.flush()
        return AgentWorkflowResult(
            handled=True,
            response=f"Segnalazione inviata: {material_name} terminati alla {station_label}. Ticket #{ticket.id}.",
            response_mode="action_completed",
            workflow_type="material_shortage",
            conversation_state_id=active_state.id,
            ticket_id=ticket.id,
            executed_action=AgentExecutedActionResult(
                action="create_material_shortage_ticket",
                status="completed",
                ticket_id=ticket.id,
                summary=summary,
            ),
            action_type="material_shortage",
            priority="normal",
            feedback_status="unresolved",
        )

    def _build_candidate_option(self, assignment: WorkingStationMaterial) -> AgentCandidate:
        material = assignment.material
        details = material.characteristics or material.description or assignment.notes or assignment.usage_context
        label = material.name
        if material.characteristics:
            label = f"{material.name} ({material.characteristics})"
        return AgentCandidate(
            material_id=material.id,
            label=label,
            description=details,
        )

    def _build_confirmation_result(
        self,
        working_station: WorkingStation | None,
        assignment: WorkingStationMaterial,
        conversation_state_id: int,
    ) -> AgentWorkflowResult:
        material = assignment.material
        station_name = working_station.name if working_station else "questa postazione"
        prompt = f"Confermo segnalazione per {material.name} alla {station_name}?"
        return AgentWorkflowResult(
            handled=True,
            response=prompt,
            response_mode="confirmation_required",
            workflow_type="material_shortage",
            conversation_state_id=conversation_state_id,
            pending_slots=["confirmation"],
            confirmation_payload=AgentConfirmation(
                prompt=prompt,
                action="create_material_shortage_ticket",
                material_id=material.id,
                material_name=material.name,
            ),
            action_type="material_shortage",
            priority="normal",
            reason_code="matched",
        )

    def _create_or_update_state(
        self,
        db: Session,
        *,
        current_user: User,
        working_station: WorkingStation | None,
        machine: Machine | None,
        chat_session: OperatorChatSession | None,
        workflow_type: WorkflowType,
        state_status: str,
        pending_action: str,
        state_payload: dict,
        last_user_message: str | None,
    ) -> OperatorConversationState:
        state = OperatorConversationState(
            user_id=current_user.id,
            working_station_id=working_station.id if working_station else None,
            machine_id=machine.id if machine else None,
            chat_session_id=chat_session.id if chat_session else None,
            workflow_type=workflow_type,
            state_status=state_status,
            pending_action=pending_action,
            state_payload=state_payload,
            last_user_message=last_user_message,
            is_active=True,
        )
        db.add(state)
        db.flush()
        return state

    def _is_material_shortage_request(self, question: str) -> bool:
        normalized = _normalize_text(question)
        if not normalized:
            return False
        return any(pattern in normalized for pattern in SHORTAGE_PATTERNS)


agent_orchestrator_service = AgentOrchestratorService()
