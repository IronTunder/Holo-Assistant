from app.database import SessionLocal
from app.models.machine import Machine
from app.models.user import User, LivelloEsperienza, Turno
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
db = SessionLocal()

# Password per tutti
password = "password123"
password_hash = pwd_context.hash(password)

# Crea macchinari
machines = [
    Machine(nome="Pressa A7", reparto="Stampaggio", descrizione="Pressa idraulica 200 ton", id_postazione="POST-001", in_uso=False),
    Machine(nome="Tornio CNC X200", reparto="Lavorazioni", descrizione="Tornio a controllo numerico", id_postazione="POST-002", in_uso=False),
    Machine(nome="Fresa F5", reparto="Lavorazioni", descrizione="Fresatrice 5 assi", id_postazione="POST-003", in_uso=False),
    Machine(nome="Linea Assemblaggio 1", reparto="Assemblaggio", descrizione="Linea automatizzata assemblaggio", id_postazione="POST-004", in_uso=False)
]

for m in machines:
    if not db.query(Machine).filter(Machine.id_postazione == m.id_postazione).first():
        db.add(m)
        print(f"✅ Aggiunto: {m.nome}")

db.commit()

# Crea utenti
users = [
    User(nome="Mario Rossi", badge_id="NFT-001", password_hash=password_hash, livello_esperienza=LivelloEsperienza.MANUTENTORE, reparto="Tecnico", turno=Turno.MATTINA),
    User(nome="Luigi Verdi", badge_id="NFT-002", password_hash=password_hash, livello_esperienza=LivelloEsperienza.SENIOR, reparto="Stampaggio", turno=Turno.MATTINA),
    User(nome="Anna Bianchi", badge_id="NFT-003", password_hash=password_hash, livello_esperienza=LivelloEsperienza.OPERAIO, reparto="Assemblaggio", turno=Turno.POMERIGGIO),
    User(nome="Marco Neri", badge_id="NFT-004", password_hash=password_hash, livello_esperienza=LivelloEsperienza.APPRENDISTA, reparto="Stampaggio", turno=Turno.NOTTE)
]

for u in users:
    if not db.query(User).filter(User.badge_id == u.badge_id).first():
        db.add(u)
        print(f"✅ Aggiunto: {u.nome}")

db.commit()

# Mostra riepilogo
print("\n" + "="*50)
print("📊 DATABASE POPOLATO")
print("="*50)
print(f"Macchinari: {db.query(Machine).count()}")
print(f"Utenti: {db.query(User).count()}")
print("\n🔑 Password per tutti: password123")
print("\n👥 Utenti:")
for u in db.query(User).all():
    print(f"   - {u.nome} (Badge: {u.badge_id})")
print("\n🏭 Macchinari:")
for m in db.query(Machine).all():
    print(f"   - {m.nome} ({m.id_postazione}) - {'🟢 Libero' if not m.in_uso else '🔴 In uso'}")

db.close()