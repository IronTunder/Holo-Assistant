from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

FeedbackStatus = Literal["resolved", "unresolved", "not_applicable"]
InteractionActionType = Literal["question", "maintenance", "emergency"]
QuickActionType = Literal["maintenance", "emergency"]
InteractionPriority = Literal["normal", "critical"]


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


class QuickActionRequest(InteractionTargetRequest):
    user_id: int
    action_type: QuickActionType


class ClarificationOption(BaseModel):
    knowledge_item_id: int
    label: str
    category_name: Optional[str] = None


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
