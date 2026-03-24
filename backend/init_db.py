from app.database import engine, Base, SessionLocal
from app.models.user import User, RefreshToken, Ruolo, LivelloEsperienza, Turno
from app.models.machine import Machine
from app.models.interaction_log import InteractionLog
from app.models.role import Role
from app.api.auth.auth import get_password_hash
import os
from dotenv import load_dotenv

load_dotenv()

print("Eliminazione tabelle vecchie...")
Base.metadata.drop_all(bind=engine)
print("Creazione tabelle...")
Base.metadata.create_all(bind=engine)
print("✅ Tabelle create con successo")

# Seed admin user from environment variables
admin_username = os.getenv("ADMIN_USERNAME")
admin_password = os.getenv("ADMIN_PASSWORD")

if admin_username and admin_password:
    print("\n🔐 Creazione utente admin...")
    db = SessionLocal()
    
    # Check if admin already exists
    existing_admin = db.query(User).filter(User.nome == admin_username).first()
    if existing_admin:
        print(f"✅ Utente admin '{admin_username}' già esiste")
    else:
        # Create admin user
        admin_user = User(
            nome=admin_username,
            badge_id=f"admin_{admin_username}",  # Unique badge_id for admin
            password_hash=get_password_hash(admin_password),
            ruolo=Ruolo.ADMIN,
            livello_esperienza=LivelloEsperienza.SENIOR,  # Admin gets SENIOR level
            reparto="AMMINISTRAZIONE",
            turno=Turno.MATTINA
        )
        db.add(admin_user)
        db.commit()
        print(f"✅ Utente admin '{admin_username}' creato con successo")
    
    db.close()
else:
    print("⚠️  Variabili ADMIN_USERNAME e ADMIN_PASSWORD non configurate in .env")