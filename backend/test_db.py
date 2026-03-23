from app.database import engine
from sqlalchemy import text

try:
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1"))
        print("✅ Connessione al database riuscita!")
        print(f"Risultato: {result.fetchone()}")
except Exception as e:
    print(f"❌ Errore di connessione: {e}")