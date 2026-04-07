"""
Script per popolare il database con categorie globali e knowledge item di base.
Esegui dopo le migrazioni del database.
"""

import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import models  # noqa: F401
from app.database import Base, apply_compatible_migrations, engine
from app.models.category import Category
from app.models.knowledge_item import KnowledgeItem, MachineKnowledgeItem
from app.models.machine import Machine
from app.database import SessionLocal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

CATEGORIES_DATA = {
    "Manutenzione": {
        "description": "Domande relative alla manutenzione e riparazione della macchina",
        "responses": [
            {"text": "Per la manutenzione ordinaria:\n1. Spegnere la macchina\n2. Controllare il livello dell'olio\n3. Verificare lo stato delle cinghie\n4. Pulire i filtri\n5. Ungere i punti di articolazione", "keywords": "manutenzione ordinaria, olio, filtri, cinghie", "examples": "Come faccio la manutenzione ordinaria?\nQuali controlli devo fare prima del turno?\nDevo controllare olio e filtri"},
            {"text": "Manutenzione periodica consigliata: sostituzione olio ogni 500 ore, cambio filtri ogni 250 ore, verifica cuscinetti ogni 100 ore", "keywords": "manutenzione periodica, ore, intervalli", "examples": "Ogni quante ore cambio l'olio?\nQuali sono gli intervalli di manutenzione?\nQuando va fatto il cambio filtri?"},
            {"text": "Se la macchina produce rumori anomali: verificare l'usura dei cuscinetti, controllare i bulloni di fissaggio, lubrificare gli assi", "keywords": "rumori, cuscinetti, bulloni", "examples": "La macchina fa un rumore strano\nSento vibrazioni e rumori anomali\nCosa controllo se sento un battito metallico?"},
            {"text": "Per sostituire le cinghie di trasmissione:\n1. Allentare il motore\n2. Rimuovere la cinghia vecchia\n3. Montare quella nuova\n4. Tensionare correttamente", "keywords": "cinghie, trasmissione, sostituzione", "examples": "Come cambio la cinghia?\nLa cinghia e usurata\nDevo sostituire la trasmissione"},
        ],
    },
    "Sicurezza": {
        "description": "Domande relative alla sicurezza e alle precauzioni nell'uso della macchina",
        "responses": [
            {"text": "Dispositivi di protezione individuale obbligatori:\n- Mascherina FFP2\n- Occhiali di protezione\n- Guanti in nitrile\n- Scarpe antinfortunistiche\n- Casco", "keywords": "DPI, mascherina, occhiali, guanti, scarpe, casco", "examples": "Quali DPI devo indossare?\nChe protezioni servono per lavorare?\nPosso usare la macchina senza guanti?"},
            {"text": "Prima di avviare la macchina verificare:\n- Assenza di ostruzioni\n- Bloccaggi delle protezioni\n- Integrita dei cavi\n- Corretto posizionamento del materiale", "keywords": "verifica pre-avvio, sicurezza, protezioni", "examples": "Cosa controllo prima di avviare la macchina?\nChecklist sicurezza prima dello start\nQuali protezioni devo verificare?"},
            {"text": "In caso di emergenza: schiacciare il pulsante di arresto di emergenza, allontanarsi dalla macchina, avvertire un supervisor", "keywords": "emergenza, arresto, pulsante, procedure", "examples": "Come fermo subito la macchina?\nDove trovo l'arresto di emergenza?\nCosa faccio in caso di emergenza?"},
            {"text": "Non toccare mai parti in movimento della macchina. Utilizzare sempre le protezioni. In caso di incastro, fermare immediatamente la macchina", "keywords": "parti mobili, incastro, pericolo, protezioni", "examples": "Cosa faccio se c'e un incastro?\nPosso toccare parti in movimento?\nCome mi comporto con un blocco del pezzo?"},
        ],
    },
    "Operazioni": {
        "description": "Domande sulle operazioni e il funzionamento della macchina",
        "responses": [
            {"text": "Sequenza di avvio:\n1. Verificare le protezioni\n2. Inserire il materiale\n3. Selezionare il programma\n4. Impostare parametri velocita/potenza\n5. Premere START", "keywords": "avvio, sequenza, programma, parametri", "examples": "Come avvio la macchina?\nQual e la sequenza di start?\nCosa faccio prima di premere start?"},
            {"text": "Parametri di funzionamento: velocita (default 50%), potenza (default 75%), tempo ciclo variabile in base al materiale", "keywords": "velocita, potenza, parametri, ciclo", "examples": "Quali parametri devo impostare?\nChe velocita uso?\nQual e la potenza standard?"},
            {"text": "Se la macchina non si avvia:\n1. Verificare l'alimentazione\n2. Controllare gli interruttori di sicurezza\n3. Spegnere e riaccendere", "keywords": "avvio fallito, alimentazione, interruttori", "examples": "La macchina non parte\nNon riesco ad avviare il macchinario\nCosa controllo se non si accende?"},
            {"text": "Per regolare la velocita di lavoro: utilizzare il potenziometro sul pannello di controllo, non superare il 90% per materiali delicati", "keywords": "velocita, potenziometro, regolazione, materiali delicati", "examples": "Come regolo la velocita?\nDove imposto la velocita di lavoro?\nPosso aumentare il potenziometro?"},
        ],
    },
}


def seed_database():
    Base.metadata.create_all(bind=engine)
    apply_compatible_migrations()

    db = SessionLocal()
    try:
        existing_categories = db.query(Category).count()
        existing_knowledge_items = db.query(KnowledgeItem).count()
        if existing_categories > 0 or existing_knowledge_items > 0:
            logger.info(
                "Database gia popolato con %s categorie e %s knowledge items. Saltando il seeding.",
                existing_categories,
                existing_knowledge_items,
            )
            return

        machines = db.query(Machine).all()
        if not machines:
            logger.warning("Nessun macchinario trovato nel database. Crea prima i macchinari.")
            return

        total_items = 0
        for category_name, category_data in CATEGORIES_DATA.items():
            category = Category(name=category_name, description=category_data["description"])
            db.add(category)
            db.flush()

            for sort_order, response_data in enumerate(category_data["responses"], start=1):
                first_keyword = next(
                    (token.strip() for token in response_data["keywords"].split(",") if token.strip()),
                    None,
                )
                knowledge_item = KnowledgeItem(
                    category_id=category.id,
                    question_title=first_keyword or f"{category_name} {sort_order}",
                    answer_text=response_data["text"],
                    keywords=response_data["keywords"],
                    example_questions=response_data.get("examples"),
                    is_active=True,
                    sort_order=sort_order,
                )
                db.add(knowledge_item)
                db.flush()
                total_items += 1

                for machine in machines:
                    db.add(
                        MachineKnowledgeItem(
                            machine_id=machine.id,
                            knowledge_item_id=knowledge_item.id,
                            is_enabled=True,
                        )
                    )

        db.commit()
        logger.info("Seeding completato con successo")
        logger.info("Categorie create: %s", len(CATEGORIES_DATA))
        logger.info("Knowledge item creati: %s", total_items)
    except Exception:
        db.rollback()
        logger.exception("Errore durante il seeding")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
