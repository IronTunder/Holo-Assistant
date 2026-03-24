from app.database import engine, Base
from app.models.user import User
from app.models.machine import Machine
from app.models.interaction_log import InteractionLog
from app.models.role import Role

print("Creazione tabelle...")
Base.metadata.create_all(bind=engine)
print("✅ Tabelle create con successo")