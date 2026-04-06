# Progetto Ditto

Ditto e un sistema di supporto per postazioni e macchinari industriali composto da:
- frontend React/Vite per operatori e amministratori;
- backend FastAPI;
- database PostgreSQL;
- servizi AI locali con retrieval deterministico, chiarimenti guidati e fallback controllati;
- sintesi vocale TTS e avatar operatore.

## Architettura in breve

- `frontend/my-app` contiene l'applicazione web.
- `frontend/my-app/src/features/operator` gestisce login operatore, console assistente, avatar e sessione macchina.
- `frontend/my-app/src/features/admin` contiene dashboard e strumenti di amministrazione.
- `frontend/my-app/src/shared` raccoglie API client, auth e componenti UI condivisi.
- `backend/app` contiene API, modelli, servizi AI e logica applicativa.
- `backend/scripts` contiene bootstrap database e utility operative.
- `docker` contiene i servizi locali PostgreSQL, Adminer e Ollama.
- `scripts/windows` e `scripts/unix` contengono gli script reali di setup e avvio; i file in root sono wrapper.

## Runtime Ollama e GPU

- Su Windows, gli script preferiscono automaticamente `Ollama` nativo se presente nel `PATH`.
- Questa scelta e voluta: su Windows e il percorso piu affidabile per usare la GPU sia con NVIDIA sia con AMD.
- In modalita Docker, il progetto mantiene PostgreSQL/Adminer e puo usare override Compose dedicati per accelerazione GPU.
- `docker/docker-compose.nvidia.yml` abilita la riserva GPU NVIDIA nel container Ollama.
- `docker/docker-compose.amd.yml` prepara il container `ollama/ollama:rocm` per host Linux/WSL con device ROCm (`/dev/kfd`, `/dev/dri`).
- Su Windows con GPU AMD, Docker Desktop non offre un percorso ROCm trasparente come su Linux; per questo e consigliato il runtime nativo.

## Quick Start

### Primo setup

Windows:
```bat
setup.bat
```

Linux:
```bash
./setup.sh
```

Lo script di setup:
- esegue `docker-compose down` e poi `docker-compose up -d`;
- aspetta PostgreSQL;
- prepara il modello `mistral:7b-instruct-v0.3-q4_K_M` in Ollama;
- crea `backend/.env` e `frontend/my-app/.env`;
- installa dipendenze backend e frontend;
- esegue `backend/scripts/init_db.py`, `backend/scripts/populate.py` e `backend/scripts/seed_categories.py`;
- avvia backend e frontend.

### Avvio successivo

Windows:
```bat
start.bat
```

Linux:
```bash
./start.sh
```

Lo script di start:
- riallinea Docker con `docker-compose up -d` senza forzare il reset dei container;
- aspetta PostgreSQL;
- legge `OLLAMA_MODEL` e i parametri principali da `backend/.env`;
- controlla la presenza del modello con `ollama list`;
- prova il warmup del modello via `POST /api/generate`;
- aggiorna `frontend/my-app/.env` con `VITE_API_URL`;
- avvia backend e frontend.

## Prerequisiti

- Docker Desktop o Docker Engine con Compose
- Python 3 con `venv`
- Node.js e `npm`

Dipendenze backend notevoli presenti in `backend/requirements.txt`:
- `fastapi`
- `uvicorn[standard]`
- `sqlalchemy`
- `psycopg2-binary`
- `python-jose[cryptography]`
- `piper-tts`
- `rapidfuzz`

## URL utili

- Frontend locale: `http://localhost:5173`
- Frontend rete: `http://{server-ip}:5173`
- Backend API: `http://{server-ip}:8000`
- Swagger: `http://{server-ip}:8000/docs`
- Admin login: `http://localhost:5173/admin-login`
- Adminer: `http://localhost:8080`
- Ollama tags: `http://{server-ip}:11434/api/tags`

## Flussi applicativi

### Esperienza operatore

Il frontend operatore e ottimizzato per l'uso su postazioni in orizzontale:
- selezione macchina tra quelle disponibili;
- login con badge o credenziali;
- area avatar con stati `idle`, `listening`, `thinking`, `speaking`;
- console laterale per domanda, risposta, chiarimenti e follow-up;
- azioni rapide visibili senza scroll dell'intera pagina.

Endpoint principali usati dal frontend operatore:
- `POST /auth/badge-login`
- `POST /auth/credentials-login`
- `GET /machines/available`
- `POST /api/interactions/ask`
- `POST /tts/synthesize`

### Sessione operatore in tempo reale

La sessione macchina viene monitorata in tempo reale:
- il frontend richiede un token via `POST /auth/sse-token`;
- apre il canale `GET /auth/session-events`;
- riceve eventi `session_status` e heartbeat;
- se SSE non e disponibile, usa fallback su `GET /auth/session-status`.

I motivi di logout remoto gestiti lato frontend sono:
- `machine_released`
- `machine_reassigned`
- `machine_not_found`

### Dashboard admin

L'area admin gestisce autenticazione dedicata, macchine, utenti, metadati e knowledge base tecnica. Il frontend usa routing lazy e protegge `/admin` tramite sessione autenticata.

## AI, retrieval e TTS

### Motore AI

Configurazione attuale:
```ini
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=mistral:7b-instruct-v0.3-q4_K_M
OLLAMA_RUNTIME=auto
OLLAMA_ACCELERATOR=auto
OLLAMA_TIMEOUT_SECONDS=120
OLLAMA_HEALTH_TIMEOUT_SECONDS=5
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_PREDICT_CLASSIFY=4
OLLAMA_NUM_PREDICT_SELECT=2
OLLAMA_NUM_PREDICT_RERANK=12
OLLAMA_TOP_K=20
OLLAMA_TOP_P=0.8
OLLAMA_TEMPERATURE_CLASSIFY=0.0
OLLAMA_TEMPERATURE_SELECT=0.0
OLLAMA_NUM_CTX=2048
OLLAMA_NUM_THREAD=4
```

Comportamento attuale:
- il backend privilegia retrieval deterministico e selezione controllata dei contenuti;
- Ollama viene usato per classificazione, selezione o casi ambigui, non come unica fonte;
- se il modello non e disponibile, il backend usa fallback espliciti;
- le risposte possono produrre chiarimenti guidati o messaggi di out-of-scope;
- il frontend puo sintetizzare la risposta via TTS e riprodurla attraverso avatar o audio fallback.

### TTS

Configurazione minima:
```ini
TTS_ENABLED=true
```

Il frontend chiama `POST /tts/synthesize` e prova a far parlare l'avatar; se la riproduzione avatar non e disponibile, usa playback audio diretto.

## Variabili ambiente

### `backend/.env`

```ini
DATABASE_HOST={server-ip}
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=ditto_db

SECRET_KEY=your-super-secret-key-change-this-in-production
ALGORITHM=HS256

ADMIN_USERNAME=admin
ADMIN_PASSWORD=tuapasswordsicura

ACCESS_TOKEN_EXPIRE_MINUTES=480
ADMIN_TOKEN_EXPIRE_MINUTES=120
OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES=480
ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES=120

ALLOWED_ORIGINS=http://localhost:5173,http://{server-ip}:5173

OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=mistral:7b-instruct-v0.3-q4_K_M
OLLAMA_TIMEOUT_SECONDS=120
OLLAMA_HEALTH_TIMEOUT_SECONDS=5
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_PREDICT_CLASSIFY=4
OLLAMA_NUM_PREDICT_SELECT=2
OLLAMA_NUM_PREDICT_RERANK=12
OLLAMA_TOP_K=20
OLLAMA_TOP_P=0.8
OLLAMA_TEMPERATURE_CLASSIFY=0.0
OLLAMA_TEMPERATURE_SELECT=0.0
OLLAMA_NUM_CTX=2048
OLLAMA_NUM_THREAD=4

TTS_ENABLED=true
```

### `frontend/my-app/.env`

```ini
VITE_API_URL=http://{server-ip}:8000
```

In sviluppo il frontend conserva porta e path di `VITE_API_URL`, ma riallinea l'hostname a quello della pagina corrente per mantenere coerenti host e cookie auth durante i reload.

## Sessioni e token

Valori attuali:
```ini
ACCESS_TOKEN_EXPIRE_MINUTES=480
ADMIN_TOKEN_EXPIRE_MINUTES=120
OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES=480
ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES=120
```

Note pratiche:
- se scade solo l'access token, il frontend prova il refresh della sessione;
- per simulare una vera scadenza completa bisogna ridurre anche i refresh token;
- il monitoraggio sessione operatore puo forzare il logout se la macchina cambia stato lato admin.

## Troubleshooting rapido

### Ollama risponde a `/api/tags` ma il warmup o le richieste AI falliscono

Controlla:
```bash
docker exec ditto_ollama ollama list
docker compose logs -f ollama
```

Verifica che:
- `OLLAMA_MODEL` in `backend/.env` esista davvero nel container;
- non ci sia mismatch tra nome configurato e modello scaricato;
- il cold start non stia superando il timeout.
- se sei su Windows con GPU AMD, verifica di stare usando Ollama nativo e non il container CPU-only.

Download manuale:
```bash
docker exec ditto_ollama ollama pull mistral:7b-instruct-v0.3-q4_K_M
```

### Prima richiesta AI lenta

Il primo caricamento del modello puo essere sensibilmente piu lento. Gli script di start provano gia un warmup reale via `/api/generate`. Se serve piu margine:
- aumenta `OLLAMA_TIMEOUT_SECONDS`;
- controlla i log di Ollama;
- verifica che il warmup non stia fallendo.

### Problemi di sessione operatore

Se l'operatore viene disconnesso:
- verifica se la macchina e stata liberata o riassegnata lato admin;
- controlla gli endpoint auth di sessione e il token SSE;
- verifica che il browser possa mantenere aperta la connessione `session-events`.

### Errore database

Controlla:
```bash
docker exec ditto_postgres pg_isready -U postgres
docker compose logs -f postgres
```

Verifica anche che `DATABASE_HOST` punti all'host corretto.

## Documentazione correlata

- Guida operativa: [docs/STARTUP_GUIDE.md](docs/STARTUP_GUIDE.md)
- README frontend: [frontend/my-app/README.md](frontend/my-app/README.md)
- Backend entrypoint: [backend/app/main.py](backend/app/main.py)
- Config API frontend: [frontend/my-app/src/shared/api/config.ts](frontend/my-app/src/shared/api/config.ts)

## Stato attuale

- ultimo aggiornamento documentazione: 28 marzo 2026
- source of truth operativa: `scripts/windows/setup.bat` e `scripts/windows/start.bat`
