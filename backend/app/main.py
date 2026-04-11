import asyncio
from sqlalchemy.exc import OperationalError
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import ipaddress
import socket
import logging
import os

from app.api.auth.auth import router as auth_router
from app.api.machines import router as machines_router
from app.api.admin import router as admin_router
from app.api.interactions import router as interactions_router
from app.api.tts import router as tts_router
from app.api.working_stations import router as working_stations_router
from app.core.database import apply_compatible_migrations
from app.services.ollama_service import warmup_model

# Setup logging
logger = logging.getLogger(__name__)

app = FastAPI(title="Holo-Assistant API", version="1.0.0")


async def _warmup_ollama_background():
    await asyncio.sleep(0.1)
    await warmup_model()


async def _apply_migrations_with_retry(max_attempts: int = 12, delay_seconds: float = 3.0):
    for attempt in range(1, max_attempts + 1):
        try:
            apply_compatible_migrations()
            return
        except OperationalError as exc:
            if attempt == max_attempts:
                raise
            logger.warning(
                "[startup] Database non ancora pronto (tentativo %s/%s): %s",
                attempt,
                max_attempts,
                exc,
            )
            await asyncio.sleep(delay_seconds)


@app.on_event("startup")
async def startup_event():
    await _apply_migrations_with_retry()
    asyncio.create_task(_warmup_ollama_background())

# Funzione per rilevare il prefisso di rete locale dinamicamente
def get_local_network_prefix() -> str:
    try:
        # Ottieni il hostname locale
        hostname = socket.gethostname()
        # Ottieni tutti gli indirizzi IP associati al hostname
        ip_addresses = socket.gethostbyname_ex(hostname)[2]
        
        # Filtra e ordina gli indirizzi IPv4 non-loopback
        valid_ips = []
        for ip in ip_addresses:
            if ip != "127.0.0.1" and ":" not in ip:  # Esclude IPv6 e loopback
                # Classifica gli IP per priorità
                if ip.startswith("192.168."):  # Priorità massima - reti locali comuni
                    valid_ips.insert(0, ip)  # Inserisci all'inizio
                elif ip.startswith("10."):     # Priorità alta - reti private aziendali
                    valid_ips.insert(0, ip)  # Inserisci all'inizio
                else:
                    valid_ips.append(ip)      # Altri IP alla fine
        
        # Usa il primo IP valido (prioritizzato)
        if valid_ips:
            ip = valid_ips[0]
            # Estrai il prefisso di rete (tutto tranne l'ultimo ottetto)
            network_prefix = ".".join(ip.split(".")[:3])
            # Scappa i punti per il regex
            escaped_prefix = network_prefix.replace(".", r"\.")
            logger.info(f"[CORS] Detected local network IP: {ip}, using regex prefix: {escaped_prefix}")
            return escaped_prefix
    except Exception as e:
        logger.warning(f"[CORS] Failed to detect local network IP: {e}")
    
    return None

# Funzione per verificare se un'origine è nella rete locale
def is_local_network(origin: str) -> bool:
    """Verifica se l'origine è nella rete locale rilevata automaticamente"""
    if not origin:
        return False
    
    try:
        # Estrai l'IP dall'URL (es. http://192.168.1.100:5173)
        host = origin.split("://")[1].split(":")[0]
        ip = ipaddress.ip_address(host)
        # Verifica se è nella rete privata
        return ip.is_private
    except:
        return False

# Configura CORS solo da origini esplicite
configured_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
if not configured_origins and os.getenv("HOLO_ASSISTANT_ALLOW_INSECURE_DEFAULTS", "false").lower() != "true":
    raise RuntimeError("ALLOWED_ORIGINS must be configured with explicit trusted origins.")

allowed_origins = list(dict.fromkeys(configured_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Browser-Language"],
)

logger.info("[CORS] Initialized with explicit origins: %s", allowed_origins)

# Includi i router
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(machines_router, prefix="/machines", tags=["machines"])
app.include_router(working_stations_router)
app.include_router(admin_router, tags=["admin"])
app.include_router(interactions_router, tags=["interactions"])
app.include_router(tts_router, prefix="/tts", tags=["tts"])

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "Holo-Assistant API is running"}
