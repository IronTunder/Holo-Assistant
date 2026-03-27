import logging
import os
from typing import List

import httpx

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
MODEL = os.getenv("OLLAMA_MODEL", "mistral:7b-instruct-v0.3-q4_K_M")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "20"))
OLLAMA_HEALTH_TIMEOUT = float(os.getenv("OLLAMA_HEALTH_TIMEOUT_SECONDS", "3"))
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "10m")
OLLAMA_NUM_PREDICT_CLASSIFY = int(os.getenv("OLLAMA_NUM_PREDICT_CLASSIFY", "4"))
OLLAMA_NUM_PREDICT_SELECT = int(os.getenv("OLLAMA_NUM_PREDICT_SELECT", "2"))
OLLAMA_TOP_K = int(os.getenv("OLLAMA_TOP_K", "20"))
OLLAMA_TOP_P = float(os.getenv("OLLAMA_TOP_P", "0.8"))
OLLAMA_TEMPERATURE_CLASSIFY = float(os.getenv("OLLAMA_TEMPERATURE_CLASSIFY", "0.0"))
OLLAMA_TEMPERATURE_SELECT = float(os.getenv("OLLAMA_TEMPERATURE_SELECT", "0.0"))
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "1024"))
OLLAMA_NUM_THREAD = int(os.getenv("OLLAMA_NUM_THREAD", "0"))


class OllamaServiceError(Exception):
    """Errore applicativo per chiamate Ollama non valide o non disponibili."""


class OllamaUnavailableError(OllamaServiceError):
    """Ollama non raggiungibile o non pronto."""


class OllamaConfigurationError(OllamaServiceError):
    """Endpoint o configurazione Ollama non validi."""


def _build_options(temperature: float, num_predict: int) -> dict:
    options = {
        "temperature": temperature,
        "top_k": OLLAMA_TOP_K,
        "top_p": OLLAMA_TOP_P,
        "num_predict": num_predict,
        "num_ctx": OLLAMA_NUM_CTX,
    }

    if OLLAMA_NUM_THREAD > 0:
        options["num_thread"] = OLLAMA_NUM_THREAD

    return options


_async_client = httpx.AsyncClient(
    base_url=OLLAMA_BASE_URL,
    timeout=httpx.Timeout(OLLAMA_TIMEOUT),
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
)


async def _generate(prompt: str, temperature: float, num_predict: int) -> str:
    try:
        response = await _async_client.post(
            "/api/generate",
            json={
                "model": MODEL,
                "prompt": prompt,
                "stream": False,
                "keep_alive": OLLAMA_KEEP_ALIVE,
                "options": _build_options(temperature, num_predict),
            },
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        if status_code == 404:
            raise OllamaConfigurationError(
                f"Ollama endpoint non valido o non disponibile su {OLLAMA_BASE_URL}/api/generate"
            ) from exc
        raise OllamaServiceError(
            f"Ollama ha risposto con status {status_code}"
        ) from exc
    except httpx.HTTPError as exc:
        raise OllamaUnavailableError(
            f"Ollama non raggiungibile su {OLLAMA_BASE_URL}"
        ) from exc

    payload = response.json()
    generated_response = payload.get("response", "").strip()
    if not generated_response:
        raise OllamaServiceError("Ollama ha restituito una risposta vuota")
    return generated_response


async def classify_question(question: str, categories: List[str]) -> str:
    """
    Classifica la domanda in una delle categorie disponibili.
    """
    categories_str = ", ".join(categories)
    prompt = (
        f"Categorie valide: {categories_str}\n"
        f"Domanda: {question}\n"
        "Rispondi con una sola categoria esatta."
    )

    try:
        classification = await _generate(
            prompt,
            temperature=OLLAMA_TEMPERATURE_CLASSIFY,
            num_predict=OLLAMA_NUM_PREDICT_CLASSIFY,
        )
    except OllamaServiceError as exc:
        logger.error(f"Error classifying question with Ollama: {exc}", exc_info=True)
        logger.error(f"Attempted to connect to: {OLLAMA_BASE_URL}")
        raise

    normalized = classification.lower().strip()

    for category in categories:
        if normalized == category.lower():
            return category

    for category in categories:
        if category.lower() in normalized:
            return category

    raise OllamaServiceError(
        f"Ollama ha classificato una categoria non valida: {classification}"
    )


async def select_best_response(question: str, preset_responses: List[dict]) -> dict:
    """
    Seleziona la migliore risposta preset basata sulla domanda.
    """
    if not preset_responses:
        return {"id": None, "text": "Mi dispiace, non ho risposte per questa categoria."}

    if len(preset_responses) == 1:
        return preset_responses[0]

    responses_text = "\n".join(
        f"{index + 1}. {response['text'][:90].replace(chr(10), ' ')}"
        for index, response in enumerate(preset_responses)
    )

    prompt = (
        f"Domanda: {question}\n"
        f"Risposte:\n{responses_text}\n"
        f"Rispondi solo con un numero da 1 a {len(preset_responses)}."
    )

    try:
        selection = await _generate(
            prompt,
            temperature=OLLAMA_TEMPERATURE_SELECT,
            num_predict=OLLAMA_NUM_PREDICT_SELECT,
        )

        for char in selection:
            if char.isdigit():
                idx = int(char) - 1
                if 0 <= idx < len(preset_responses):
                    return preset_responses[idx]

        raise OllamaServiceError(
            f"Ollama ha selezionato una risposta non valida: {selection}"
        )
    except OllamaServiceError as exc:
        logger.error(f"Error selecting response with Ollama: {exc}", exc_info=True)
        logger.error(f"Attempted to connect to: {OLLAMA_BASE_URL}")
        raise


async def is_ollama_available() -> bool:
    """Verifica se Ollama è disponibile e pronto."""
    try:
        response = await _async_client.get("/api/tags", timeout=OLLAMA_HEALTH_TIMEOUT)
        return response.status_code == 200
    except Exception as exc:
        logger.warning(f"Ollama not available at {OLLAMA_BASE_URL}: {exc}")
        return False
