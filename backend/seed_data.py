from app.database import SessionLocal
from app.models.user import User, LivelloEsperienza, Turno
from app.models.machine import Machine
from app.models.role import Role

db = SessionLocal()

# Inserisci ruoli
roles = [
    Role(nome="admin", permessi="tutto"),
    Role(nome="operatore", permessi="base"),
]

for role in roles:
    existing = db.query(Role).filter(Role.nome == role.nome).first()
    if not existing:
        db.add(role)

# Inserisci operatori
users = [
    User(
        nome="Mario Rossi",
        badge_id="NFT-001",
        livello_esperienza=LivelloEsperienza.MANUTENTORE,
        reparto="Tecnico",
        turno=Turno.MATTINA
    ),
    User(
        nome="Luigi Verdi",
        badge_id="NFT-002",
        livello_esperienza=LivelloEsperienza.SENIOR,
        reparto="Stampaggio",
        turno=Turno.MATTINA
    ),
    User(
        nome="Giovanni Bianchi",
        badge_id="NFT-003",
        livello_esperienza=LivelloEsperienza.APPRENDISTA,
        reparto="Officina",
        turno=Turno.POMERIGGIO
    ),
]

for user in users:
    existing = db.query(User).filter(User.badge_id == user.badge_id).first()
    if not existing:
        db.add(user)

# Inserisci macchinari
machines = [
    Machine(
        nome="Pressa A7",
        reparto="Stampaggio",
        descrizione="Pressa idraulica 200 ton",
        id_postazione="POST-001"
    ),
    Machine(
        nome="Tornio T300",
        reparto="Officina",
        descrizione="Tornio CNC",
        id_postazione="POST-002"
    ),
    Machine(
        nome="Fresatrice F5",
        reparto="Officina",
        descrizione="Fresatrice a controllo numerico",
        id_postazione="POST-003"
    ),
    Machine(
        nome="Compressore C2",
        reparto="Manutenzione",
        descrizione="Compressore aria 500L",
        id_postazione="POST-004"
    ),
]

for machine in machines:
    existing = db.query(Machine).filter(Machine.id_postazione == machine.id_postazione).first()
    if not existing:
        db.add(machine)

db.commit()
db.close()

print("Dati di test inseriti con successo!")