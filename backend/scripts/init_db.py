import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app import models  # noqa: F401
from app.api.auth.auth import get_password_hash
from app.database import Base, SessionLocal, apply_compatible_migrations, engine
from app.models.department import Department
from app.models.user import LivelloEsperienza, Ruolo, Turno, User

load_dotenv()

print("Eliminazione tabelle vecchie...")
with engine.begin() as connection:
    connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
    connection.execute(text("CREATE SCHEMA public"))
    connection.execute(text("GRANT ALL ON SCHEMA public TO postgres"))
    connection.execute(text("GRANT ALL ON SCHEMA public TO public"))
print("Creazione tabelle...")
Base.metadata.create_all(bind=engine)
apply_compatible_migrations()
print("Tabelle create con successo")

admin_username = os.getenv("ADMIN_USERNAME")
admin_password = os.getenv("ADMIN_PASSWORD")

if admin_username and admin_password:
    print("\nCreazione utente admin...")
    db = SessionLocal()
    try:
        existing_admin = db.query(User).filter(User.nome == admin_username).first()
        if existing_admin:
            print(f"Utente admin '{admin_username}' gia esiste")
        else:
            admin_department = db.query(Department).filter(Department.name == "AMMINISTRAZIONE").first()
            if admin_department is None:
                admin_department = Department(
                    name="AMMINISTRAZIONE",
                    code="amministrazione",
                    is_active=True,
                )
                db.add(admin_department)
                db.flush()

            admin_user = User(
                nome=admin_username,
                badge_id=f"admin_{admin_username}",
                password_hash=get_password_hash(admin_password),
                ruolo=Ruolo.ADMIN,
                livello_esperienza=LivelloEsperienza.SENIOR,
                department_id=admin_department.id,
                reparto_legacy=admin_department.name,
                turno=Turno.MATTINA,
            )
            db.add(admin_user)
            db.commit()
            print(f"Utente admin '{admin_username}' creato con successo")
    finally:
        db.close()
else:
    print("Variabili ADMIN_USERNAME e ADMIN_PASSWORD non configurate in .env")
