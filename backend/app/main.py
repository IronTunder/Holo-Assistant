from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth.auth import router as auth_router
# from app.api.machines import router as machines_router
# from app.api.checklist import router as checklist_router

app = FastAPI(title="Ditto API", version="1.0.0")

# Configura CORS per permettere al frontend di comunicare
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Includi i router
app.include_router(auth_router, prefix="/auth", tags=["auth"])
# app.include_router(machines_router, prefix="/machines", tags=["machines"])
# app.include_router(checklist_router, prefix="/checklist", tags=["checklist"])

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "Ditto API is running"}