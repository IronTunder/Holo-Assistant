from pydantic import BaseModel
from typing import Optional


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


class AskQuestionResponse(BaseModel):
    response: str
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    knowledge_item_id: Optional[int] = None
    knowledge_item_title: Optional[str] = None
