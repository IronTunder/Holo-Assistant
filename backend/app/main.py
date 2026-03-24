# backend/app/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import ipaddress

from app.api.auth.auth import router as auth_router
from app.api.machines import router as machines_router

app = FastAPI(title="Ditto API", version="1.0.0")

# Funzione per verificare se un'origine è nella rete locale
def is_local_network(origin: str) -> bool:
    """Verifica se l'origine è nella rete 192.168.1.0/24"""
    if not origin:
        return False
    
    # Estrai l'IP dall'URL (es. http://192.168.1.100:5173)
    try:
        # Rimuovi protocollo e porta
        host = origin.split("://")[1].split(":")[0]
        ip = ipaddress.ip_address(host)
        # Verifica se è nella rete 192.168.1.0/24
        return ip in ipaddress.ip_network("192.168.1.0/24")
    except:
        return False

# Configura CORS dinamico
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],  # Base
    allow_origin_regex=r"http://192\.168\.1\..*:5173",  # Regex per la rete locale
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Includi i router
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(machines_router, prefix="/machines", tags=["machines"])

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "Ditto API is running"}