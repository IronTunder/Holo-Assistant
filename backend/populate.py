from passlib.context import CryptContext

from app.database import SessionLocal
from app.models.department import Department
from app.models.machine import Machine
from app.models.user import LivelloEsperienza, Turno, User

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
db = SessionLocal()

password = "password123"
password_hash = pwd_context.hash(password)


def get_or_create_department(name: str) -> Department:
    department = db.query(Department).filter(Department.name == name).first()
    if department is None:
        department = Department(
            name=name,
            code=name.lower().replace(" ", "-"),
            is_active=True,
        )
        db.add(department)
        db.flush()
    return department


machines = [
    Machine(
        nome="Pressa A7",
        department_id=get_or_create_department("Stampaggio").id,
        reparto_legacy="Stampaggio",
        descrizione="Pressa idraulica 200 ton",
        id_postazione="POST-001",
        in_uso=False,
    ),
    Machine(
        nome="Tornio CNC X200",
        department_id=get_or_create_department("Lavorazioni").id,
        reparto_legacy="Lavorazioni",
        descrizione="Tornio a controllo numerico",
        id_postazione="POST-002",
        in_uso=False,
    ),
    Machine(
        nome="Fresa F5",
        department_id=get_or_create_department("Lavorazioni").id,
        reparto_legacy="Lavorazioni",
        descrizione="Fresatrice 5 assi",
        id_postazione="POST-003",
        in_uso=False,
    ),
    Machine(
        nome="Linea Assemblaggio 1",
        department_id=get_or_create_department("Assemblaggio").id,
        reparto_legacy="Assemblaggio",
        descrizione="Linea automatizzata assemblaggio",
        id_postazione="POST-004",
        in_uso=False,
    ),
]

for machine in machines:
    if not db.query(Machine).filter(Machine.id_postazione == machine.id_postazione).first():
        db.add(machine)
        print(f"Aggiunto: {machine.nome}")

db.commit()

users = [
    User(
        nome="Mario Rossi",
        badge_id="NFT-001",
        password_hash=password_hash,
        livello_esperienza=LivelloEsperienza.MANUTENTORE,
        department_id=get_or_create_department("Tecnico").id,
        reparto_legacy="Tecnico",
        turno=Turno.MATTINA,
    ),
    User(
        nome="Luigi Verdi",
        badge_id="NFT-002",
        password_hash=password_hash,
        livello_esperienza=LivelloEsperienza.SENIOR,
        department_id=get_or_create_department("Stampaggio").id,
        reparto_legacy="Stampaggio",
        turno=Turno.MATTINA,
    ),
    User(
        nome="Anna Bianchi",
        badge_id="NFT-003",
        password_hash=password_hash,
        livello_esperienza=LivelloEsperienza.OPERAIO,
        department_id=get_or_create_department("Assemblaggio").id,
        reparto_legacy="Assemblaggio",
        turno=Turno.POMERIGGIO,
    ),
    User(
        nome="Marco Neri",
        badge_id="NFT-004",
        password_hash=password_hash,
        livello_esperienza=LivelloEsperienza.APPRENDISTA,
        department_id=get_or_create_department("Stampaggio").id,
        reparto_legacy="Stampaggio",
        turno=Turno.NOTTE,
    ),
]

for user in users:
    if not db.query(User).filter(User.badge_id == user.badge_id).first():
        db.add(user)
        print(f"Aggiunto: {user.nome}")

db.commit()

print("\n" + "=" * 50)
print("DATABASE POPOLATO")
print("=" * 50)
print(f"Macchinari: {db.query(Machine).count()}")
print(f"Utenti: {db.query(User).count()}")
print(f"\nPassword per tutti: {password}")
print("\nUtenti:")
for user in db.query(User).all():
    print(f" - {user.nome} (Badge: {user.badge_id})")
print("\nMacchinari:")
for machine in db.query(Machine).all():
    print(f" - {machine.nome} ({machine.id_postazione}) - {'Libero' if not machine.in_uso else 'In uso'}")

db.close()
