from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.database import get_db
from app.models.interaction_log import InteractionLog
from app.models.category import Category
from app.models.preset_response import PresetResponse
from app.models.machine import Machine
from app.schemas.interaction import AskQuestionRequest, AskQuestionResponse
from app.services.ollama_service import classify_question, select_best_response, is_ollama_available
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/interactions", tags=["interactions"])

# Risposta di fallback generica
FALLBACK_RESPONSE = {
    "response": "Mi dispiace, non sono riuscito a trovare una risposta appropriata alla tua domanda. Ti consiglio di contattare direttamente l'assistenza per ricevere aiuto.",
    "category_id": None,
    "category_name": "Fallback",
}


@router.post("/ask", response_model=AskQuestionResponse)
async def ask_question(
    request: AskQuestionRequest,
    db: Session = Depends(get_db),
):
    """
    Processa una domanda da parte dell'operatore.
    
    1. Verifica il macchinario e le sue categorie disponibili
    2. Classifica la domanda in una categoria usando Ollama
    3. Seleziona la migliore risposta preset per quella categoria e macchinario
    4. Salva l'interazione nel database
    5. Ritorna la risposta al frontend
    6. Se fallisce, ritorna una risposta di fallback
    """
    
    try:
        # Verifica che Ollama sia disponibile
        ollama_available = await is_ollama_available()
        if not ollama_available:
            logger.error("Ollama is not available")
            raise HTTPException(status_code=503, detail="AI service not available")
        
        # Verifica che il macchinario esista
        machine = db.query(Machine).filter(Machine.id == request.machine_id).first()
        if not machine:
            logger.warning(f"Machine {request.machine_id} not found")
            raise HTTPException(status_code=404, detail="Machine not found")
        
        # Recupera le categorie disponibili PER QUESTO MACCHINARIO
        categories_for_machine = machine.categories
        if not categories_for_machine:
            logger.warning(f"No categories assigned to machine {machine.nome}")
            # Fallback: usa tutte le categorie se il macchinario non ha categorie assegnate
            categories_for_machine = db.query(Category).all()
        
        if not categories_for_machine:
            logger.warning("No categories found in database")
            return FALLBACK_RESPONSE
        
        category_names = [cat.name for cat in categories_for_machine]
        
        # Classifica la domanda usando Ollama
        classified_category = await classify_question(request.question, category_names)
        
        # Trova la categoria nel database tra quelle disponibili
        category = next(
            (cat for cat in categories_for_machine if cat.name.lower() == classified_category.lower()),
            None
        )
        
        if not category:
            logger.warning(f"Classified category {classified_category} not found, using first available")
            category = categories_for_machine[0]
        
        # Recupera le risposte per questa categoria e macchinario
        # Priorità: risposte specifiche del macchinario > risposte globali
        preset_responses = db.query(PresetResponse).filter(
            and_(
                PresetResponse.category_id == category.id,
                # Includi risposte specifiche di questo macchinario O risposte globali (machine_id = NULL)
                (
                    (PresetResponse.machine_id == request.machine_id) |
                    (PresetResponse.machine_id == None)
                )
            )
        ).all()
        
        if not preset_responses:
            logger.warning(f"No preset responses for category {category.name} and machine {machine.nome}")
            # Fallback: prova con risposte globali di qualsiasi categoria
            preset_responses = db.query(PresetResponse).filter(
                PresetResponse.machine_id == None
            ).all()
        
        if not preset_responses:
            logger.warning("No fallback responses available")
            return FALLBACK_RESPONSE
        
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
            f"Question processed - User: {request.user_id}, Machine: {machine.nome}, "
            f"Category: {category.name}, Response ID: {selected_response.get('id')}"
        )
        
        return AskQuestionResponse(
            response=selected_response["text"],
            category_id=category.id,
            category_name=category.name,
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing question: {e}", exc_info=True)
        # In caso di errore inaspettato, ritorna fallback
        return FALLBACK_RESPONSE


@router.get("/health")
async def health_check():
    """Verifica che il servizio e Ollama siano disponibili."""
    ollama_available = await is_ollama_available()
    
    return {
        "status": "ok" if ollama_available else "degraded",
        "ollama_available": ollama_available,
    }
