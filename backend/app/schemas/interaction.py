from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

FeedbackStatus = Literal["resolved", "unresolved", "not_applicable"]
InteractionActionType = Literal["question", "maintenance", "emergency", "material_shortage"]
QuickActionType = Literal["maintenance", "emergency"]
InteractionPriority = Literal["normal", "critical"]
AgentResponseMode = Literal["knowledge_answer", "agent_question", "confirmation_required", "action_completed", "action_blocked"]
WorkflowType = Literal["material_shortage"]


class CategoryBase(BaseModel):
    name: str
    description: Optional[str] = None


class CategoryResponse(CategoryBase):
    id: int

    class Config:
        from_attributes = True


class PresetResponseBase(BaseModel):
    text: str
    keywords: Optional[str] = None


class PresetResponseCreate(PresetResponseBase):
    category_id: int


class PresetResponseResponse(PresetResponseBase):
    id: int
    category_id: int

    class Config:
        from_attributes = True


class InteractionTargetRequest(BaseModel):
    working_station_id: Optional[int] = None
    machine_id: Optional[int] = None

    @model_validator(mode="after")
    def validate_target(self):
        if self.working_station_id is None and self.machine_id is None:
            raise ValueError("working_station_id o machine_id obbligatorio")
        return self


class AskQuestionRequest(InteractionTargetRequest):
    user_id: Optional[int] = None
    question: str
    selected_knowledge_item_id: Optional[int] = None
    conversation_state_id: Optional[int] = None
    selected_material_id: Optional[int] = None
    confirmation_decision: Optional[Literal["confirm", "cancel"]] = None


class QuickActionRequest(InteractionTargetRequest):
    user_id: int
    action_type: QuickActionType


class ClarificationOption(BaseModel):
    knowledge_item_id: int
    label: str
    category_name: Optional[str] = None


class AgentCandidateOption(BaseModel):
    material_id: int
    label: str
    description: Optional[str] = None


class AgentConfirmationPayload(BaseModel):
    prompt: str
    action: str
    material_id: Optional[int] = None
    material_name: Optional[str] = None


class AgentExecutedAction(BaseModel):
    action: str
    status: Literal["completed", "blocked", "cancelled"]
    ticket_id: Optional[int] = None
    summary: Optional[str] = None


class AskQuestionResponse(BaseModel):
    interaction_id: Optional[int] = None
    response: str
    mode: Literal["answer", "clarification", "fallback"] = "answer"
    reason_code: Literal["matched", "clarification", "no_match", "out_of_scope"] = "matched"
    confidence: float = 0.0
    clarification_options: list[ClarificationOption] = Field(default_factory=list)
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    knowledge_item_id: Optional[int] = None
    knowledge_item_title: Optional[str] = None
    response_mode: Optional[AgentResponseMode] = None
    conversation_state_id: Optional[int] = None
    workflow_type: Optional[WorkflowType] = None
    pending_slots: list[str] = Field(default_factory=list)
    candidate_options: list[AgentCandidateOption] = Field(default_factory=list)
    confirmation_payload: Optional[AgentConfirmationPayload] = None
    executed_action: Optional[AgentExecutedAction] = None
    ticket_id: Optional[int] = None


class InteractionFeedbackRequest(BaseModel):
    feedback_status: FeedbackStatus


class InteractionFeedbackResponse(BaseModel):
    interaction_id: int
    feedback_status: FeedbackStatus
    feedback_timestamp: datetime


class InteractionResolutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resolution_note: Optional[str] = None
    technician_username: Optional[str] = None
    technician_password: Optional[str] = None


class InteractionResolutionResponse(BaseModel):
    interaction_id: int
    feedback_status: FeedbackStatus
    feedback_timestamp: datetime
    resolved_by_user_id: int
    resolved_by_user_name: str
    resolution_note: Optional[str] = None
    resolution_timestamp: datetime


class QuickActionResponse(BaseModel):
    interaction_id: int
    action_type: QuickActionType
    priority: InteractionPriority
    feedback_status: FeedbackStatus
    message: str
    timestamp: datetime


class PendingQuickActionResponse(BaseModel):
    interaction_id: int
    action_type: QuickActionType
    priority: InteractionPriority
    feedback_status: FeedbackStatus
    message: str
    timestamp: datetime
    resolved_by_user_id: Optional[int] = None
    resolved_by_user_name: Optional[str] = None
    resolution_timestamp: Optional[datetime] = None


class OperatorChatMessage(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    timestamp: datetime
    interaction_id: Optional[int] = None
    action_type: Optional[InteractionActionType] = None
    feedback_status: Optional[FeedbackStatus] = None


class OperatorChatSessionResponse(BaseModel):
    chat_session_id: Optional[int] = None
    working_station_id: Optional[int] = None
    machine_id: Optional[int] = None
    messages: list[OperatorChatMessage] = Field(default_factory=list)


class OperationalTicketResponse(BaseModel):
    id: int
    workflow_type: WorkflowType
    status: str
    priority: InteractionPriority
    summary: str
    details: Optional[str] = None
    user_id: int
    user_name: Optional[str] = None
    working_station_id: Optional[int] = None
    working_station_name: Optional[str] = None
    machine_id: Optional[int] = None
    machine_name: Optional[str] = None
    material_id: Optional[int] = None
    material_name: Optional[str] = None
    interaction_log_id: Optional[int] = None
    conversation_state_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    closed_at: Optional[datetime] = None
