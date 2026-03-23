from backend.app.api.auth import auth
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from backend.app.api.machines import machines

# Crea le tabelle nel database
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Ditto API - Assistente Olografico",
    description="API per il sistema di assistenza vocale industriale",
    version="1.0.0"
)

# Configura CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Frontend Next.js
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Includi router
app.include_router(auth.router)
app.include_router(machines.router)

@app.get("/health")
def health_check():
    """Endpoint per verificare che il servizio sia attivo"""
    return {"status": "ok", "message": "Ditto API is running"}