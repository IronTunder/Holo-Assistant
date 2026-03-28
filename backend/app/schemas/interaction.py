from typing import Literal, Optional

from pydantic import BaseModel, Field


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


class AskQuestionRequest(BaseModel):
    machine_id: int
    user_id: int
    question: str
    selected_knowledge_item_id: Optional[int] = None


class ClarificationOption(BaseModel):
    knowledge_item_id: int
    label: str
    category_name: Optional[str] = None


class AskQuestionResponse(BaseModel):
    response: str
    mode: Literal["answer", "clarification", "fallback"] = "answer"
    reason_code: Literal["matched", "clarification", "no_match", "out_of_scope"] = "matched"
    confidence: float = 0.0
    clarification_options: list[ClarificationOption] = Field(default_factory=list)
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    knowledge_item_id: Optional[int] = None
    knowledge_item_title: Optional[str] = None
