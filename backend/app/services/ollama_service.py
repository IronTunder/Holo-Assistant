import httpx
import json
import logging
import os
from typing import List

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "localhost:11434")
MODEL = "mistral"


async def classify_question(question: str, categories: List[str]) -> str:
    """
    Classifica la domanda in una delle categorie disponibili.
    
    Args:
        question: La domanda dell'operatore
        categories: Lista di nomi categorie disponibili
        
    Returns:
        Nome della categoria più appropriata
    """
    categories_str = ", ".join(categories)
    prompt = f"""Date le seguenti categorie: {categories_str}

Classifica questa domanda in una sola categoria:
"{question}"

Rispondi SOLO con il nome della categoria, senza spiegazioni."""
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "temperature": 0.3,
                },
                timeout=30.0,
            )
            response.raise_for_status()
            
            result = response.json()
            classification = result.get("response", "").strip()
            
            # Pulisci la risposta
            classification = classification.lower().strip()
            
            # Verifica che sia una categoria valida
            for cat in categories:
                if cat.lower() in classification:
                    return cat
            
            # Se non corrisponde esattamente, ritorna il primo matching
            return classification if classification in [c.lower() for c in categories] else categories[0]
    except Exception as e:
        logger.error(f"Error classifying question with Ollama: {e}", exc_info=True)
        logger.error(f"Attempted to connect to: {OLLAMA_BASE_URL}")
        return categories[0] if categories else "Generale"


async def select_best_response(
    question: str, 
    preset_responses: List[dict]
) -> dict:
    """
    Seleziona la migliore risposta preset basata sulla domanda.
    
    Args:
        question: La domanda dell'operatore
        preset_responses: Lista di risposte preset {id, text, keywords}
        
    Returns:
        Risposta preset selezionata
    """
    if not preset_responses:
        return {"id": None, "text": "Mi dispiace, non ho risposte per questa categoria."}
    
    # Se c'è solo una risposta, ritornala direttamente
    if len(preset_responses) == 1:
        return preset_responses[0]
    
    # Crea un prompt per Ollama per selezionare la migliore risposta
    responses_text = "\n".join(
        [f"{i+1}. {r['text']}" for i, r in enumerate(preset_responses)]
    )
    
    prompt = f"""Domanda: "{question}"

Disponibili le seguenti risposte:
{responses_text}

Quale è la risposta più appropriata per rispondere a questa domanda?
Rispondi SOLO con il numero (1, 2, 3, ecc) della risposta migliore, senza spiegazioni."""
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "temperature": 0.2,
                },
                timeout=30.0,
            )
            response.raise_for_status()
            
            result = response.json()
            selection = result.get("response", "").strip()
            
            # Estrai il numero
            for char in selection:
                if char.isdigit():
                    idx = int(char) - 1
                    if 0 <= idx < len(preset_responses):
                        return preset_responses[idx]
            
            # Fallback alla prima se non riesce a parsare
            return preset_responses[0]
    except Exception as e:
        logger.error(f"Error selecting response with Ollama: {e}", exc_info=True)
        logger.error(f"Attempted to connect to: {OLLAMA_BASE_URL}")
        return preset_responses[0]


async def is_ollama_available() -> bool:
    """Verifica se Ollama è disponibile e pronto."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5.0)
            return response.status_code == 200
    except Exception as e:
        logger.warning(f"Ollama not available at {OLLAMA_BASE_URL}: {e}")
        return False
