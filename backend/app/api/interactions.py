from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.database import get_db
from app.models.interaction_log import InteractionLog
from app.models.category import Category
from app.models.preset_response import PresetResponse
from app.schemas.interaction import AskQuestionRequest, AskQuestionResponse
from app.services.ollama_service import classify_question, select_best_response, is_ollama_available
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/interactions", tags=["interactions"])


@router.post("/ask", response_model=AskQuestionResponse)
async def ask_question(
    request: AskQuestionRequest,
    db: Session = Depends(get_db),
):
    """
    Processa una domanda da parte dell'operatore.
    
    1. Classifica la domanda in una categoria usando Ollama
    2. Seleziona la migliore risposta preset per quella categoria
    3. Salva l'interazione nel database
    4. Ritorna la risposta al frontend
    """
    
    # Verifica che Ollama sia disponibile
    ollama_available = await is_ollama_available()
    if not ollama_available:
        logger.error("Ollama is not available")
        raise HTTPException(status_code=503, detail="AI service not available")
    
    # Recupera tutte le categorie disponibili
    categories_db = db.query(Category).all()
    if not categories_db:
        logger.warning("No categories found in database")
        raise HTTPException(status_code=400, detail="No categories available")
    
    category_names = [cat.name for cat in categories_db]
    
    # Classifica la domanda usando Ollama
    classified_category = await classify_question(request.question, category_names)
    
    # Trova la categoria nel database
    category = db.query(Category).filter(
        Category.name.ilike(classified_category)
    ).first()
    
    if not category:
        # Fallback alla prima categoria se non trovata
        category = categories_db[0]
    
    # Recupera le risposte preset per questa categoria
    preset_responses = db.query(PresetResponse).filter(
        PresetResponse.category_id == category.id
    ).all()
    
    if not preset_responses:
        logger.warning(f"No preset responses for category {category.name}")
        raise HTTPException(
            status_code=400, 
            detail=f"No responses available for category {category.name}"
        )
    
    # Converti le risposte in formato per Ollama
    preset_responses_formatted = [
        {
            "id": r.id,
            "text": r.text,
            "keywords": r.keywords,
        }
        for r in preset_responses
    ]
    
    # Seleziona la migliore risposta usando Ollama
    selected_response = await select_best_response(
        request.question,
        preset_responses_formatted
    )
    
    # Salva l'interazione nel database
    interaction = InteractionLog(
        user_id=request.user_id,
        machine_id=request.machine_id,
        category_id=category.id,
        domanda=request.question,
        risposta=selected_response["text"],
    )
    
    db.add(interaction)
    db.commit()
    db.refresh(interaction)
    
    logger.info(
        f"Question processed - User: {request.user_id}, Category: {category.name}, "
        f"Response ID: {selected_response.get('id')}"
    )
    
    return AskQuestionResponse(
        response=selected_response["text"],
        category_id=category.id,
        category_name=category.name,
    )


@router.get("/health")
async def health_check():
    """Verifica che il servizio e Ollama siano disponibili."""
    ollama_available = await is_ollama_available()
    
    return {
        "status": "ok" if ollama_available else "degraded",
        "ollama_available": ollama_available,
    }
