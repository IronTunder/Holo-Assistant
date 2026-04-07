import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse


SettingValueType = Literal["string", "integer", "number", "boolean", "csv", "url", "enum"]


@dataclass(frozen=True)
class SettingDefinition:
    key: str
    group: str
    label: str
    description: str
    value_type: SettingValueType = "string"
    default: str = ""
    required: bool = False
    min_value: float | None = None
    max_value: float | None = None
    options: tuple[str, ...] = ()
    sensitive: bool = False


class SettingsValidationError(ValueError):
    def __init__(self, errors: dict[str, str]) -> None:
        super().__init__("Impostazioni non valide")
        self.errors = errors


PROJECT_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ENV_PATH = PROJECT_ROOT / "backend" / ".env"

SETTINGS: tuple[SettingDefinition, ...] = (
    SettingDefinition("DATABASE_HOST", "Database", "Host database", "Hostname o IP del database PostgreSQL.", "string", "localhost", True),
    SettingDefinition("DATABASE_PORT", "Database", "Porta database", "Porta TCP del database PostgreSQL.", "integer", "5432", True, 1, 65535),
    SettingDefinition("DATABASE_USER", "Database", "Utente database", "Utente usato dal backend per collegarsi a PostgreSQL.", "string", "postgres", True),
    SettingDefinition("DATABASE_PASSWORD", "Database", "Password database", "Password usata dal backend per collegarsi a PostgreSQL. Non viene mai mostrata in chiaro.", "string", "", True, sensitive=True),
    SettingDefinition("DATABASE_NAME", "Database", "Nome database", "Nome del database applicativo.", "string", "ditto_db", True),
    SettingDefinition("OLLAMA_BASE_URL", "AI / Ollama", "URL Ollama", "Endpoint del runtime Ollama usato dal backend.", "url", "http://127.0.0.1:11434", True),
    SettingDefinition("OLLAMA_MODEL", "AI / Ollama", "Modello Ollama", "Nome del modello scaricato nel runtime Ollama.", "string", "qwen3.5:9b", True),
    SettingDefinition("OLLAMA_RUNTIME", "AI / Ollama", "Runtime Ollama", "Strategia runtime usata dagli script di avvio.", "enum", "auto", False, options=("auto", "native", "docker")),
    SettingDefinition("OLLAMA_ACCELERATOR", "AI / Ollama", "Acceleratore Ollama", "Accelerazione preferita dagli script di avvio.", "enum", "auto", False, options=("auto", "cpu", "nvidia", "amd")),
    SettingDefinition("OLLAMA_NATIVE_VULKAN", "AI / Ollama", "Vulkan nativo", "Abilita Vulkan quando il runtime nativo lo supporta.", "boolean", "true"),
    SettingDefinition("OLLAMA_TIMEOUT_SECONDS", "AI / Ollama", "Timeout richieste", "Secondi massimi per le chiamate al modello.", "number", "120", True, 1, 600),
    SettingDefinition("OLLAMA_HEALTH_TIMEOUT_SECONDS", "AI / Ollama", "Timeout health", "Secondi massimi per il controllo di disponibilita Ollama.", "number", "5", True, 1, 60),
    SettingDefinition("OLLAMA_KEEP_ALIVE", "AI / Ollama", "Keep alive modello", "Durata di permanenza del modello in memoria.", "string", "30m", True),
    SettingDefinition("OLLAMA_NUM_PREDICT_CLASSIFY", "AI / Ollama", "Token classificazione", "Limite token per classificare le categorie.", "integer", "4", True, 1, 256),
    SettingDefinition("OLLAMA_NUM_PREDICT_SELECT", "AI / Ollama", "Token selezione", "Limite token per scegliere una risposta.", "integer", "2", True, 1, 256),
    SettingDefinition("OLLAMA_NUM_PREDICT_RERANK", "AI / Ollama", "Token rerank", "Limite token per reranking e verifiche knowledge.", "integer", "12", True, 1, 512),
    SettingDefinition("OLLAMA_TOP_K", "AI / Ollama", "Top K", "Parametro top_k passato a Ollama.", "integer", "20", True, 1, 200),
    SettingDefinition("OLLAMA_TOP_P", "AI / Ollama", "Top P", "Parametro top_p passato a Ollama.", "number", "0.8", True, 0, 1),
    SettingDefinition("OLLAMA_TEMPERATURE_CLASSIFY", "AI / Ollama", "Temperatura classificazione", "Temperatura per classificazione categorie.", "number", "0.0", True, 0, 2),
    SettingDefinition("OLLAMA_TEMPERATURE_SELECT", "AI / Ollama", "Temperatura selezione", "Temperatura per selezione e reranking.", "number", "0.0", True, 0, 2),
    SettingDefinition("OLLAMA_NUM_CTX", "AI / Ollama", "Contesto modello", "Dimensione del contesto passato a Ollama.", "integer", "2048", True, 128, 131072),
    SettingDefinition("OLLAMA_NUM_THREAD", "AI / Ollama", "Thread modello", "Numero thread Ollama, 0 lascia scegliere al runtime.", "integer", "4", True, 0, 256),
    SettingDefinition("TTS_ENABLED", "TTS", "TTS abilitato", "Abilita la sintesi vocale Piper.", "boolean", "true"),
    SettingDefinition("PIPER_USE_CUDA", "TTS", "CUDA Piper", "Usa CUDA per Piper quando disponibile.", "boolean", "false"),
    SettingDefinition("PIPER_DEFAULT_VOICE", "TTS", "Voce default", "Chiave della voce Piper predefinita.", "string", "it_IT-paola-medium", True),
    SettingDefinition("PIPER_DEFAULT_LANGUAGE", "TTS", "Lingua default", "Lingua predefinita per la risoluzione delle voci.", "string", "it-IT", True),
    SettingDefinition("PIPER_PREFERRED_QUALITIES", "TTS", "Qualita preferite", "Ordine qualita Piper separate da virgola.", "csv", "medium,low,x_low,high", True),
    SettingDefinition("DITTO_CACHE_ENABLED", "Cache", "Cache abilitata", "Abilita le cache in memoria del backend.", "boolean", "true"),
    SettingDefinition("DITTO_CACHE_TOTAL_MAX_BYTES", "Cache", "Limite totale cache", "Budget massimo in byte per le cache.", "integer", "134217728", True, 1048576),
    SettingDefinition("DITTO_RETRIEVAL_CACHE_TTL_SECONDS", "Cache", "TTL retrieval", "Durata in secondi della cache retrieval.", "integer", "600", True, 0),
    SettingDefinition("DITTO_RETRIEVAL_CACHE_MAX_ENTRIES", "Cache", "Voci retrieval", "Numero massimo di risultati retrieval in cache.", "integer", "512", True, 0),
    SettingDefinition("DITTO_TTS_CACHE_TTL_SECONDS", "Cache", "TTL TTS", "Durata in secondi della cache audio TTS.", "integer", "1800", True, 0),
    SettingDefinition("DITTO_TTS_CACHE_MAX_BYTES", "Cache", "Limite cache TTS", "Budget massimo in byte per la cache TTS.", "integer", "67108864", True, 1048576),
    SettingDefinition("DITTO_TTS_CACHE_MAX_TEXT_CHARS", "Cache", "Testo cacheabile TTS", "Lunghezza massima testo per caching TTS.", "integer", "500", True, 1, 2000),
    SettingDefinition("DITTO_TTS_CACHE_MAX_AUDIO_BYTES", "Cache", "Audio cacheabile TTS", "Dimensione massima audio TTS cacheabile.", "integer", "2097152", True, 1024),
    SettingDefinition("DITTO_ADMIN_METADATA_CACHE_TTL_SECONDS", "Cache", "TTL metadata admin", "Durata in secondi della cache metadata admin.", "integer", "10", True, 0),
    SettingDefinition("ACCESS_TOKEN_EXPIRE_MINUTES", "Sessioni / CORS", "Token operatori", "Durata in minuti degli access token operatore.", "integer", "480", True, 1, 1440),
    SettingDefinition("ADMIN_TOKEN_EXPIRE_MINUTES", "Sessioni / CORS", "Token admin", "Durata in minuti degli access token admin.", "integer", "120", True, 1, 1440),
    SettingDefinition("OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES", "Sessioni / CORS", "Refresh operatori", "Durata in minuti dei refresh token operatore.", "integer", "480", True, 1, 10080),
    SettingDefinition("ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES", "Sessioni / CORS", "Refresh admin", "Durata in minuti dei refresh token admin.", "integer", "120", True, 1, 10080),
    SettingDefinition("SSE_TOKEN_EXPIRE_MINUTES", "Sessioni / CORS", "Token SSE", "Durata in minuti dei token SSE temporanei.", "integer", "5", True, 1, 60),
    SettingDefinition("REFRESH_TOKEN_COOKIE_SECURE", "Sessioni / CORS", "Cookie secure", "Richiede HTTPS per il refresh cookie.", "boolean", "false"),
    SettingDefinition("REFRESH_TOKEN_COOKIE_SAMESITE", "Sessioni / CORS", "Cookie SameSite", "Policy SameSite del refresh cookie.", "enum", "lax", True, options=("lax", "strict", "none")),
    SettingDefinition("REFRESH_TOKEN_COOKIE_NAME", "Sessioni / CORS", "Nome cookie refresh", "Nome del cookie HTTP-only del refresh token.", "string", "ditto_refresh_token", True),
    SettingDefinition("ALLOWED_ORIGINS", "Sessioni / CORS", "Origini CORS", "Origini HTTP/HTTPS abilitate, separate da virgola.", "csv", "https://localhost:5173", False),
)

SETTINGS_BY_KEY = {definition.key: definition for definition in SETTINGS}
EXCLUDED_PREFIXES = ("VITE_",)
EXCLUDED_KEYS = {"SECRET_KEY", "ALGORITHM", "ADMIN_USERNAME", "ADMIN_PASSWORD", "PIPER_VOICE_MODELS_DIR", "PIPER_VOICES_MANIFEST"}
ENV_KEY_PATTERN = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=")
COOKIE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+$")


def _read_env_values(env_path: Path = BACKEND_ENV_PATH) -> dict[str, str]:
    if not env_path.exists():
        return {}

    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        match = ENV_KEY_PATTERN.match(line)
        if not match:
            continue
        key = match.group(1)
        raw_value = line.split("=", 1)[1].strip()
        values[key] = _unquote(raw_value)
    return values


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _validate_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _validate_origin_list(value: str) -> bool:
    if not value:
        return True
    return all(_validate_url(item.strip()) for item in value.split(",") if item.strip())


def _normalize_value(definition: SettingDefinition, raw_value: object) -> str:
    value = str(raw_value).strip()
    if "\n" in value or "\r" in value or "\x00" in value:
        raise ValueError("Il valore non puo contenere nuove righe")
    if definition.required and not value:
        raise ValueError("Valore obbligatorio")

    if definition.value_type == "boolean":
        normalized = value.lower()
        if normalized not in {"true", "false", "1", "0", "yes", "no", "on", "off"}:
            raise ValueError("Usa true oppure false")
        return "true" if normalized in {"true", "1", "yes", "on"} else "false"

    if definition.value_type == "integer":
        try:
            numeric_value = int(value)
        except ValueError as exc:
            raise ValueError("Inserisci un numero intero") from exc
        _validate_number_bounds(definition, numeric_value)
        return str(numeric_value)

    if definition.value_type == "number":
        try:
            numeric_value = float(value)
        except ValueError as exc:
            raise ValueError("Inserisci un numero") from exc
        _validate_number_bounds(definition, numeric_value)
        return f"{numeric_value:g}"

    if definition.value_type == "enum":
        normalized = value.lower()
        if normalized not in definition.options:
            raise ValueError(f"Valore ammesso: {', '.join(definition.options)}")
        return normalized

    if definition.value_type == "url":
        if not _validate_url(value):
            raise ValueError("Inserisci un URL http/https valido")
        return value.rstrip("/")

    if definition.value_type == "csv":
        items = [item.strip() for item in value.split(",") if item.strip()]
        normalized = ",".join(items)
        if definition.key == "ALLOWED_ORIGINS" and not _validate_origin_list(normalized):
            raise ValueError("Le origini devono essere URL http/https separati da virgola")
        if definition.required and not normalized:
            raise ValueError("Inserisci almeno un valore")
        return normalized

    if definition.key == "REFRESH_TOKEN_COOKIE_NAME" and not COOKIE_NAME_PATTERN.match(value):
        raise ValueError("Usa solo lettere, numeri, punto, trattino o underscore")
    return value


def _validate_number_bounds(definition: SettingDefinition, value: float) -> None:
    if definition.min_value is not None and value < definition.min_value:
        raise ValueError(f"Valore minimo: {definition.min_value:g}")
    if definition.max_value is not None and value > definition.max_value:
        raise ValueError(f"Valore massimo: {definition.max_value:g}")


def validate_settings_update(settings: dict[str, object]) -> dict[str, str]:
    errors: dict[str, str] = {}
    normalized_settings: dict[str, str] = {}

    for key, raw_value in settings.items():
        if key not in SETTINGS_BY_KEY:
            errors[key] = "Impostazione non modificabile"
            continue
        try:
            normalized_settings[key] = _normalize_value(SETTINGS_BY_KEY[key], raw_value)
        except ValueError as exc:
            errors[key] = str(exc)

    if errors:
        raise SettingsValidationError(errors)
    return normalized_settings


def _serialize_definition(definition: SettingDefinition, values: dict[str, str]) -> dict:
    value = values.get(definition.key, os.getenv(definition.key, definition.default))
    has_value = bool(value)
    if definition.sensitive:
        value = ""
    return {
        "key": definition.key,
        "label": definition.label,
        "description": definition.description,
        "value": value,
        "has_value": has_value,
        "value_type": definition.value_type,
        "required": definition.required,
        "requires_restart": True,
        "sensitive": definition.sensitive,
        "min_value": definition.min_value,
        "max_value": definition.max_value,
        "options": list(definition.options),
    }


def get_settings_payload(env_path: Path = BACKEND_ENV_PATH, *, pending_restart: bool = False) -> dict:
    values = _read_env_values(env_path)
    groups: list[dict] = []
    for group_name in dict.fromkeys(definition.group for definition in SETTINGS):
        group_settings = [
            _serialize_definition(definition, values)
            for definition in SETTINGS
            if definition.group == group_name
        ]
        groups.append({"name": group_name, "settings": group_settings})

    return {
        "groups": groups,
        "pending_restart": pending_restart,
        "requires_restart": True,
    }


def update_env_file(settings: dict[str, object], env_path: Path = BACKEND_ENV_PATH) -> dict:
    normalized_settings = validate_settings_update(settings)
    _write_env_values(normalized_settings, env_path)
    return get_settings_payload(env_path, pending_restart=True)


def _write_env_values(values: dict[str, str], env_path: Path) -> None:
    env_path.parent.mkdir(parents=True, exist_ok=True)
    lines = env_path.read_text(encoding="utf-8").splitlines(keepends=True) if env_path.exists() else []
    key_indexes: dict[str, int] = {}

    for index, line in enumerate(lines):
        match = ENV_KEY_PATTERN.match(line)
        if match:
            key_indexes[match.group(1)] = index

    for key, value in values.items():
        line = f"{key}={value}\n"
        if key in key_indexes:
            lines[key_indexes[key]] = line
        else:
            if lines and lines[-1] and not lines[-1].endswith(("\n", "\r")):
                lines[-1] = f"{lines[-1]}\n"
            if not any(line.strip() == "# Admin settings" for line in lines):
                if lines and lines[-1].strip():
                    lines.append("\n")
                lines.append("# Admin settings\n")
            lines.append(line)

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=env_path.parent, delete=False) as temp_file:
        temp_file.writelines(lines)
        temp_path = Path(temp_file.name)

    temp_path.replace(env_path)
