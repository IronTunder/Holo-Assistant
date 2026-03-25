"""
Script per popolare il database con categorie e risposte preset di base.
Esegui dopo le migrazioni del database.
"""

import sys
import os

# Aggiungi il percorso del backend al PYTHONPATH
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.category import Category
from app.models.preset_response import PresetResponse
from app.models.machine import Machine
from app.database import Base
import logging
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Connessione al database (usa variabili d'ambiente se disponibili)
db_host = os.getenv("DATABASE_HOST", "localhost")
db_port = os.getenv("DATABASE_PORT", "5432")
db_user = os.getenv("DATABASE_USER", "postgres")
db_password = os.getenv("DATABASE_PASSWORD", "postgres")
db_name = os.getenv("DATABASE_NAME", "ditto_db")

DATABASE_URL = f"postgresql+psycopg2://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Categorie e risposte di base
CATEGORIES_DATA = {
    "Manutenzione": {
        "description": "Domande relative alla manutenzione e riparazione della macchina",
        "responses": [
            {"text": "Per la manutenzione ordinaria:\n1. Spegnere la macchina\n2. Controllare il livello dell'olio\n3. Verificare lo stato delle cinghie\n4. Pulire i filtri\n5. Ungere i punti di articolazione", "keywords": "manutenzione ordinaria, olio, filtri, cinghie"},
            {"text": "Manutenzione periodica consigliata: sostituzione olio ogni 500 ore, cambio filtri ogni 250 ore, verifica cuscinetti ogni 100 ore", "keywords": "manutenzione periodica, ore, intervalli"},
            {"text": "Se la macchina produce rumori anomali: verificare l'usura dei cuscinetti, controllare i bulloni di fissaggio, lubrificare gli assi", "keywords": "rumori, cuscinetti, bulloni"},
            {"text": "Per sostituire le cinghie di trasmissione:\n1. Allentare il motore\n2. Rimuovere la cinghia vecchia\n3. Montare quella nuova\n4. Tensionare correttamente", "keywords": "cinghie, trasmissione, sostituzione"},
        ]
    },
    "Sicurezza": {
        "description": "Domande relative alla sicurezza e alle precauzioni nell'uso della macchina",
        "responses": [
            {"text": "Dispositivi di protezione individuale obbligatori:\n• Mascherina FFP2\n• Occhiali di protezione\n• Guanti in nitrile\n• Scarpe antinfortunistiche\n• Casco", "keywords": "DPI, mascherina, occhiali, guanti, scarpe, casco"},
            {"text": "Prima di avviare la macchina verificare:\n• Assenza di ostruzioni\n• Bloccaggi delle protezioni\n• Integrità dei cavi\n• Corretto posizionamento del materiale", "keywords": "verifica pre-avvio, sicurezza, protezioni"},
            {"text": "In caso di emergenza: schiacciare il pulsante di arresto di emergenza, allontanarsi dalla macchina, avvertire un supervisor", "keywords": "emergenza, arresto, pulsante, procedure"},
            {"text": "Non toccare mai parti in movimento della macchina. Utilizzare sempre le protezioni. In caso di incastro, fermare immediatamente la macchina", "keywords": "parti mobili, incastro, pericolo, protezioni"},
        ]
    },
    "Operazioni": {
        "description": "Domande sulle operazioni e il funzionamento della macchina",
        "responses": [
            {"text": "Sequenza di avvio:\n1. Verificare le protezioni\n2. Inserire il materiale\n3. Selezionare il programma\n4. Impostare parametri velocità/potenza\n5. Premere START", "keywords": "avvio, sequenza, programma, parametri"},
            {"text": "Parametri di funzionamento: velocità (default 50%), potenza (default 75%), tempo ciclo variabile in base al materiale", "keywords": "velocità, potenza, parametri, ciclo"},
            {"text": "Se la macchina non si avvia:\n1. Verificare l'alimentazione\n2. Controllare gli interruttori di sicurezza\n3. Spegnere e riaccendere", "keywords": "avvio fallito, alimentazione, interruttori"},
            {"text": "Per regolare la velocità di lavoro: utilizzare il potenziometro sul pannello di controllo, non superare il 90% per materiali delicati", "keywords": "velocità, potenziometro, regolazione, materiali delicati"},
        ]
    },
    "Diagnostica": {
        "description": "Domande per diagnosticare problemi e anomalie della macchina",
        "responses": [
            {"text": "Spie di allarme comuni:\n• Luce rossa = errore critico\n• Luce gialla = avvertimento\n• Luce verde = funzionamento normale", "keywords": "spie, allarme, luce, errore, avvertimento"},
            {"text": "Se la macchina si ferma durante il ciclo:\n1. Verificare il sensore di carico\n2. Controllare il materiale intasato\n3. Verificare l'alimentazione", "keywords": "stop ciclo, sensore, intasamento, carico"},
            {"text": "Scarso rendimento:\n1. Controllare usura degli utensili\n2. Verificare la qualità del materiale\n3. Calibrare i sensori", "keywords": "rendimento, usura, utensili, sensori, calibrazione"},
            {"text": "Messaggi di errore:\n• E01 = sovraccarico\n• E02 = sensore bloccato\n• E03 = problema elettrico (contattare l'assistenza)", "keywords": "errore, codice, E01, E02, E03, assistenza"},
        ]
    },
    "Pulizia": {
        "description": "Domande sulla pulizia e la manutenzione ordinaria della macchina",
        "responses": [
            {"text": "Pulizia giornaliera: rimuovere residui di materiale, pulire la superficie di lavoro, verificare l'assenza di usura", "keywords": "pulizia giornaliera, residui, superficie"},
            {"text": "Pulizia settimanale:\n1. Smontare i coperchi di accesso\n2. Soffiare i filtri\n3. Pulire i sensori con aria compressa", "keywords": "pulizia settimanale, filtri, sensori, aria compressa"},
            {"text": "Pulizia sicura dei componenti:\n• Non usare acqua su componenti elettrici\n• Utilizzare aria compressa\n• Usare panni asciutti\n• Evitare eccessi che raccolgono polvere", "keywords": "pulizia, acqua, elettrico, aria compressa, panni"},
            {"text": "Lubrificazione settimanale dei punti di articolazione con grasso neutro. Evitare eccessi che raccolgono polvere", "keywords": "lubrificazione, grasso, articolazioni, settimanale"},
        ]
    },
}


def seed_database():
    """Popola il database con categorie e risposte preset, associate ai macchinari."""
    
    db = SessionLocal()
    
    try:
        # Verifica se ci sono già categorie
        existing_categories = db.query(Category).count()
        if existing_categories > 0:
            logger.info(f"Database già contiene {existing_categories} categorie. Saltando il seeding.")
            return
        
        logger.info("Inizio seeding del database con categorie e risposte...")
        
        # Recupera tutti i macchinari
        machines = db.query(Machine).all()
        if not machines:
            logger.warning("Nessun macchinario trovato nel database. Crea prima i macchinari.")
            return
        
        logger.info(f"Trovati {len(machines)} macchinari. Associando categorie...")
        
        for category_name, category_data in CATEGORIES_DATA.items():
            # Crea la categoria
            category = Category(
                name=category_name,
                description=category_data["description"]
            )
            db.add(category)
            db.flush()  # Flush per ottenere l'ID
            
            # Associa questa categoria a TUTTI i macchinari
            for machine in machines:
                machine.categories.append(category)
            
            logger.info(f"Creata categoria: {category_name} (associata a {len(machines)} macchinari)")
            
            # Aggiungi le risposte per questa categoria
            # Le risposte sono GLOBALI (machine_id = NULL) ma accessibili solo dai macchinari che hanno questa categoria
            for response_data in category_data["responses"]:
                preset_response = PresetResponse(
                    category_id=category.id,
                    text=response_data["text"],
                    keywords=response_data["keywords"],
                    machine_id=None  # Globale a questa categoria
                )
                db.add(preset_response)
            
            db.flush()
        
        # Commit finale
        db.commit()
        logger.info("✓ Seeding completato con successo!")
        logger.info(f"Categorie create: {len(CATEGORIES_DATA)}")
        total_responses = sum(len(cat['responses']) for cat in CATEGORIES_DATA.values())
        logger.info(f"Risposte create: {total_responses}")
        logger.info(f"Macchinari: {len(machines)}")
        logger.info(f"Associazioni Machine-Category: {len(machines) * len(CATEGORIES_DATA)}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"✗ Errore durante il seeding: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
