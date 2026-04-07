import asyncio
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
from app.core.database import apply_compatible_migrations
from app.services.ollama_service import warmup_model

# Setup logging
logger = logging.getLogger(__name__)

app = FastAPI(title="Ditto API", version="1.0.0")


async def _warmup_ollama_background():
    await asyncio.sleep(0.1)
    await warmup_model()


@app.on_event("startup")
async def startup_event():
    apply_compatible_migrations()
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

# Rileva il prefisso di rete e crea il pattern CORS
network_prefix = get_local_network_prefix()
if network_prefix:
    logger.info(f"[CORS] Detected local network prefix: {network_prefix}, allowing origins matching: http://{network_prefix}.*:5173")
    cors_regex = rf"http://{network_prefix}\..*:5173"
else:
    logger.warning("[CORS] Could not detect local network, using fallback pattern")
    cors_regex = r"http://192\.168\..*\..*:5173"

# Configura CORS dinamico
configured_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
base_origins = ["http://localhost:3000", "http://localhost:5173"]
allowed_origins = list(dict.fromkeys(base_origins + configured_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,  # Base + backend/.env ALLOWED_ORIGINS
    allow_origin_regex=cors_regex,  # Regex dinamico per la rete locale
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info(f"[CORS] Initialized with regex: {cors_regex}")

# Includi i router
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(machines_router, prefix="/machines", tags=["machines"])
app.include_router(admin_router, tags=["admin"])
app.include_router(interactions_router, tags=["interactions"])
app.include_router(tts_router, prefix="/tts", tags=["tts"])

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "Ditto API is running"}
