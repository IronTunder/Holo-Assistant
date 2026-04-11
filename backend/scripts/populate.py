import os
import sys
from pathlib import Path

from passlib.context import CryptContext

if os.getenv("HOLO_ASSISTANT_ALLOW_DEMO_SEED", "false").lower() != "true":
    raise SystemExit("Demo seed disabilitato. Imposta HOLO_ASSISTANT_ALLOW_DEMO_SEED=true per popolare dati dimostrativi.")

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.database import SessionLocal
from app.models.department import Department
from app.models.machine import Machine
from app.models.role import ADMIN_ROLE_CODE, MAINTENANCE_TECH_ROLE_CODE, OPERATOR_ROLE_CODE, Role
from app.models.user import LivelloEsperienza, Ruolo, Turno, User
from app.models.working_station import WorkingStation

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
db = SessionLocal()

password = "password123"
password_hash = pwd_context.hash(password)


DEPARTMENTS = [
    {
        "name": "Stampaggio Lamiera",
        "code": "stampaggio-lamiera",
        "description": "Reparto presse per componenti in acciaio zincato destinati ai telai di assemblaggio.",
    },
    {
        "name": "Lavorazioni CNC",
        "code": "lavorazioni-cnc",
        "description": "Centri di tornitura e fresatura per particolari meccanici a disegno.",
    },
    {
        "name": "Assemblaggio Finale",
        "code": "assemblaggio-finale",
        "description": "Linea di montaggio e collaudo dei moduli finiti prima della spedizione.",
    },
    {
        "name": "Manutenzione",
        "code": "manutenzione",
        "description": "Supporto tecnico di stabilimento per guasti, cambi formato e interventi preventivi.",
    },
]


MACHINE_SEEDS = [
    {
        "nome": "Pressa idraulica Schuler 250T",
        "department": "Stampaggio Lamiera",
        "descrizione": "Pressa per stampaggio staffe e supporti in lamiera per la linea Ditto S4.",
        "id_postazione": "STP-01",
        "startup_checklist": [
            "Verificare chiusura e integrita delle protezioni laterali e frontali",
            "Controllare pressione circuito idraulico e livello olio da pannello HMI",
            "Testare il fungo di emergenza con macchina ferma e registrare esito",
            "Rimuovere sfridi, attrezzature e pallet vuoti dall area di carico",
        ],
    },
    {
        "nome": "Tornio CNC Doosan Puma 2600SY",
        "department": "Lavorazioni CNC",
        "descrizione": "Tornio multitasking per alberi e bussole di precisione con contromandrino.",
        "id_postazione": "CNC-02",
        "startup_checklist": [
            "Controllare serraggio del pezzo e stato delle ganasce del mandrino",
            "Verificare livello refrigerante e assenza di perdite nella vasca",
            "Confermare che il programma CNC e l offset utensile caricati coincidano con l ordine",
            "Chiudere le porte interbloccate prima del ciclo prova a vuoto",
        ],
    },
    {
        "nome": "Centro di lavoro DMG Mori CMX 70U",
        "department": "Lavorazioni CNC",
        "descrizione": "Centro di fresatura a 5 assi per piastre e supporti lavorati su più facce.",
        "id_postazione": "CNC-03",
        "startup_checklist": [
            "Verificare bloccaggio pezzo su tavola e presenza staffaggi previsti dal setup",
            "Controllare usura utensili critici e corretto serraggio dei portautensili",
            "Eseguire homing assi e confermare zero pezzo del programma pianificato",
            "Pulire il banco da trucioli, chiavi e strumenti lasciati dal turno precedente",
        ],
    },
    {
        "nome": "Linea assemblaggio moduli DT-4",
        "department": "Assemblaggio Finale",
        "descrizione": "Linea semiautomatica per montaggio, avvitatura controllata e collaudo funzionale.",
        "id_postazione": "ASM-01",
        "startup_checklist": [
            "Controllare che barriere ottiche e reset sicurezza siano operativi",
            "Verificare disponibilita componenti del lotto e corretto orientamento nei feeder",
            "Confermare accessibilita del pulsante arresto linea e stato torri luminose",
            "Liberare il percorso pallet e la zona pick and place da ingombri o materiali sfusi",
        ],
    },
]


WORKING_STATION_SEEDS = [
    {
        "name": "Pressa Schuler STP-01",
        "department": "Stampaggio Lamiera",
        "description": "Postazione presse dedicata a stampaggio staffe e supporti per linea Ditto S4.",
        "station_code": "STP-01",
        "machine_station_code": "STP-01",
        "startup_checklist": [
            "Verificare chiusura e integrita delle protezioni laterali e frontali",
            "Controllare pressione circuito idraulico e livello olio da pannello HMI",
            "Testare il fungo di emergenza con macchina ferma e registrare esito",
            "Rimuovere sfridi, attrezzature e pallet vuoti dall area di carico",
        ],
    },
    {
        "name": "Tornio CNC Doosan CNC-02",
        "department": "Lavorazioni CNC",
        "description": "Postazione tornitura multitasking per alberi e bussole di precisione.",
        "station_code": "CNC-02",
        "machine_station_code": "CNC-02",
        "startup_checklist": [
            "Controllare serraggio del pezzo e stato delle ganasce del mandrino",
            "Verificare livello refrigerante e assenza di perdite nella vasca",
            "Confermare che il programma CNC e l offset utensile caricati coincidano con l ordine",
            "Chiudere le porte interbloccate prima del ciclo prova a vuoto",
        ],
    },
    {
        "name": "Centro di lavoro DMG Mori CNC-03",
        "department": "Lavorazioni CNC",
        "description": "Postazione fresatura 5 assi per lavorazioni complesse e setup multi-faccia.",
        "station_code": "CNC-03",
        "machine_station_code": "CNC-03",
        "startup_checklist": [
            "Verificare bloccaggio pezzo su tavola e presenza staffaggi previsti dal setup",
            "Controllare usura utensili critici e corretto serraggio dei portautensili",
            "Eseguire homing assi e confermare zero pezzo del programma pianificato",
            "Pulire il banco da trucioli, chiavi e strumenti lasciati dal turno precedente",
        ],
    },
    {
        "name": "Linea assemblaggio DT-4",
        "department": "Assemblaggio Finale",
        "description": "Postazione linea semiautomatica per montaggio, avvitatura e collaudo.",
        "station_code": "ASM-01",
        "machine_station_code": "ASM-01",
        "startup_checklist": [
            "Controllare che barriere ottiche e reset sicurezza siano operativi",
            "Verificare disponibilita componenti del lotto e corretto orientamento nei feeder",
            "Confermare accessibilita del pulsante arresto linea e stato torri luminose",
            "Liberare il percorso pallet e la zona pick and place da ingombri o materiali sfusi",
        ],
    },
    {
        "name": "Reception stabilimento",
        "department": "Assemblaggio Finale",
        "description": "Postazione informativa in hall per assistenza operativa senza macchinario associato.",
        "station_code": "HALL-01",
        "machine_station_code": None,
        "startup_checklist": [
            "Verificare accessibilita della postazione e stato del terminale operatore",
            "Controllare che i contatti di emergenza reparto siano visibili e aggiornati",
            "Accertarsi che il percorso di accesso sia libero da ostacoli",
            "Confermare disponibilita delle istruzioni generali di sicurezza per i visitatori",
        ],
    },
]


USER_SEEDS = [
    {
        "nome": "elisa.conti",
        "badge_id": "ADM-1001",
        "ruolo": Ruolo.ADMIN,
        "role_code": ADMIN_ROLE_CODE,
        "livello_esperienza": LivelloEsperienza.SENIOR,
        "department": "Manutenzione",
        "turno": Turno.MATTINA,
    },
    {
        "nome": "davide.rinaldi",
        "badge_id": "MNT-2048",
        "ruolo": Ruolo.OPERAIO,
        "role_code": MAINTENANCE_TECH_ROLE_CODE,
        "livello_esperienza": LivelloEsperienza.MANUTENTORE,
        "department": "Manutenzione",
        "turno": Turno.MATTINA,
    },
    {
        "nome": "luca.ferri",
        "badge_id": "STP-3184",
        "ruolo": Ruolo.OPERAIO,
        "role_code": OPERATOR_ROLE_CODE,
        "livello_esperienza": LivelloEsperienza.SENIOR,
        "department": "Stampaggio Lamiera",
        "turno": Turno.MATTINA,
    },
    {
        "nome": "sara.galli",
        "badge_id": "ASM-4421",
        "ruolo": Ruolo.OPERAIO,
        "role_code": OPERATOR_ROLE_CODE,
        "livello_esperienza": LivelloEsperienza.OPERAIO,
        "department": "Assemblaggio Finale",
        "turno": Turno.POMERIGGIO,
    },
    {
        "nome": "matteo.villa",
        "badge_id": "CNC-5277",
        "ruolo": Ruolo.OPERAIO,
        "role_code": OPERATOR_ROLE_CODE,
        "livello_esperienza": LivelloEsperienza.APPRENDISTA,
        "department": "Lavorazioni CNC",
        "turno": Turno.NOTTE,
    },
]


def get_or_create_department(seed: dict) -> Department:
    department = db.query(Department).filter(Department.name == seed["name"]).first()
    if department is None:
        department = Department(name=seed["name"])
        db.add(department)
        db.flush()

    department.code = seed["code"]
    department.description = seed["description"]
    department.is_active = True
    return department


def get_role_id(role_code: str) -> int | None:
    role = db.query(Role).filter(Role.code == role_code).first()
    return role.id if role is not None else None


departments_by_name = {seed["name"]: get_or_create_department(seed) for seed in DEPARTMENTS}

working_stations_by_code: dict[str, WorkingStation] = {}

for station_seed in WORKING_STATION_SEEDS:
    department = departments_by_name[station_seed["department"]]
    existing_station = db.query(WorkingStation).filter(WorkingStation.station_code == station_seed["station_code"]).first()

    if existing_station is None:
        existing_station = WorkingStation(station_code=station_seed["station_code"], name=station_seed["name"])
        db.add(existing_station)

    existing_station.name = station_seed["name"]
    existing_station.department_id = department.id
    existing_station.description = station_seed["description"]
    existing_station.startup_checklist = station_seed["startup_checklist"]
    existing_station.in_uso = False
    existing_station.operatore_attuale_id = None
    working_stations_by_code[station_seed["station_code"]] = existing_station

    print(f"Allineata postazione demo: {existing_station.name}")

db.flush()

for machine_seed in MACHINE_SEEDS:
    department = departments_by_name[machine_seed["department"]]
    existing_machine = db.query(Machine).filter(Machine.id_postazione == machine_seed["id_postazione"]).first()

    if existing_machine is None:
        existing_machine = Machine(id_postazione=machine_seed["id_postazione"])
        db.add(existing_machine)

    existing_machine.nome = machine_seed["nome"]
    existing_machine.department_id = department.id
    existing_machine.reparto_legacy = department.name
    existing_machine.descrizione = machine_seed["descrizione"]
    existing_machine.startup_checklist = machine_seed["startup_checklist"]
    existing_machine.working_station_id = working_stations_by_code[machine_seed["id_postazione"]].id
    if existing_machine.in_uso is None:
        existing_machine.in_uso = False

    print(f"Allineata macchina demo: {existing_machine.nome}")

db.commit()

for user_seed in USER_SEEDS:
    department = departments_by_name[user_seed["department"]]
    existing_user = db.query(User).filter(User.badge_id == user_seed["badge_id"]).first()

    if existing_user is None:
        existing_user = User(badge_id=user_seed["badge_id"])
        db.add(existing_user)

    existing_user.nome = user_seed["nome"]
    existing_user.password_hash = password_hash
    existing_user.ruolo = user_seed["ruolo"]
    existing_user.role_id = get_role_id(user_seed["role_code"])
    existing_user.livello_esperienza = user_seed["livello_esperienza"]
    existing_user.department_id = department.id
    existing_user.reparto_legacy = department.name
    existing_user.turno = user_seed["turno"]

    print(f"Allineato utente demo: {existing_user.nome}")

db.commit()

print("\n" + "=" * 50)
print("DATABASE POPOLATO")
print("=" * 50)
print(f"Postazioni: {db.query(WorkingStation).count()}")
print(f"Macchinari: {db.query(Machine).count()}")
print(f"Utenti: {db.query(User).count()}")
print("\nPassword demo impostata per gli utenti seed.")
print("\nUtenti:")
for user in db.query(User).order_by(User.nome).all():
    print(f" - {user.nome} (Badge: {user.badge_id}, Reparto: {user.reparto}, Turno: {user.turno.value})")
print("\nMacchinari:")
for machine in db.query(Machine).order_by(Machine.id_postazione).all():
    print(f" - {machine.nome} ({machine.id_postazione}) - {machine.reparto}")

print("\nPostazioni:")
for working_station in db.query(WorkingStation).order_by(WorkingStation.station_code).all():
    assigned_machine_name = (
        working_station.assigned_machine.nome if working_station.assigned_machine is not None else "Nessun macchinario"
    )
    print(f" - {working_station.name} ({working_station.station_code}) - {assigned_machine_name}")

db.close()
