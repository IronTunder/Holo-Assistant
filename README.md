# Progetto Ditto

Ultimo aggiornamento documentazione: 7 aprile 2026

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

Il percorso Windows e attualmente la source of truth operativa: i wrapper in root (`setup.bat` e `start.bat`) chiamano `scripts/windows/setup.bat` e `scripts/windows/start.bat`.

I wrapper Unix (`setup.sh` e `start.sh`) sono disponibili, ma il loro flusso non e ancora perfettamente allineato a quello Windows: usano Ollama in Docker come percorso principale, hanno default legacy per il modello AI se `backend/.env` non e presente e non preparano automaticamente il modello Vosk nel normale `start`.

### Primo setup

Windows:
```bat
setup.bat
```

Linux:
```bash
./setup.sh
```

Nel flusso Windows documentato come source of truth, lo script di setup:
- esegue `docker compose down` e poi `docker compose up -d`;
- aspetta PostgreSQL;
- prepara il modello `qwen3.5:9b` in Ollama;
- crea `backend/.env` e `frontend/my-app/.env`;
- installa dipendenze backend e frontend;
- esegue `backend/scripts/init_db.py`, `backend/scripts/populate.py` e `backend/scripts/seed_categories.py`;
- su Windows prepara anche il modello wake-word Vosk se manca;
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

Nel flusso Windows documentato come source of truth, lo script di start:
- riallinea Docker con `docker compose up -d` senza forzare il reset dei container;
- aspetta PostgreSQL;
- legge `OLLAMA_MODEL` e i parametri principali da `backend/.env`;
- controlla la presenza del modello con `ollama list`;
- prova il warmup del modello via `POST /api/generate`;
- aggiorna `frontend/my-app/.env` con `VITE_API_URL`;
- su Windows riallinea la knowledge base eseguendo `backend/scripts/seed_categories.py`;
- avvia backend e frontend.

## Prerequisiti software

- Docker Desktop o Docker Engine con Compose
- Python 3 con `venv`
- Node.js e `npm`

Versioni consigliate per evitare incompatibilita:
- Python 3.10 o superiore
- Node.js 20 LTS o superiore
- Docker Compose v2

Dipendenze backend notevoli presenti in `backend/requirements.txt`:
- `fastapi`
- `uvicorn[standard]`
- `sqlalchemy`
- `psycopg2-binary`
- `python-jose[cryptography]`
- `piper-tts`
- `rapidfuzz`

## Requisiti di sistema per hostare Ditto

I numeri sotto sono un dimensionamento operativo consigliato per ospitare l'intero stack locale: frontend, backend FastAPI, PostgreSQL, Adminer e Ollama.

### Host minimo per demo interna o test funzionale

- OS: Windows 10/11, oppure Linux x86_64 recente
- CPU: 4 core
- GPU: Consigliata per tempi di risposta migliori
- RAM: 16 GB
- Storage libero: 30 GB SSD
- Rete: LAN stabile con porte `5173`, `8000`, `8080`, `5432`, `11434` raggiungibili dove serve

Questa configurazione e adatta soprattutto a test, sviluppo o piccole demo. Con il modello di default il tempo di risposta AI puo aumentare sensibilmente se si usa solo CPU.

### Host consigliato per utilizzo interno stabile

- CPU: 8 core moderni
- RAM: 32 GB
- Storage libero: 60-80 GB SSD

Configurazioni GPU consigliate:
- NVIDIA con almeno 8 GB di VRAM se si vuole usare Ollama in Docker con override NVIDIA
- AMD con almeno 8 GB di VRAM su Windows: meglio Ollama nativo
- AMD con almeno 8 GB di VRAM su Linux/WSL: possibile usare l'override ROCm dedicato

### Note pratiche di hosting

- Il flusso attuale del repository e ottimizzato per self-hosting in rete locale, non per deployment cloud completamente automatizzato.
- Gli script di root avviano backend e frontend in modalita sviluppo (`uvicorn --reload` e `vite dev`).
- Per un host sempre acceso conviene sostituire il frontend Vite dev server con una build statica servita da web server e il backend con un process manager o servizio dedicato.
- PostgreSQL e Ollama restano gia pronti per un uso self-hosted tramite Docker Compose.

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
- wake-word locale con Vosk in browser: di' `Ehi Ditto`, poi pronuncia la domanda tecnica;
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
OLLAMA_MODEL=qwen3.5:9b
OLLAMA_RUNTIME=auto
OLLAMA_ACCELERATOR=auto
OLLAMA_NATIVE_VULKAN=1
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

### STT e wake-word Vosk

Il riconoscimento vocale operatore usa `vosk-browser` nel frontend: l'audio resta nel browser e non viene inviato al backend. Il browser chiedera il permesso microfono al primo avvio della sessione operatore.

Modello predefinito:
```ini
VITE_VOSK_MODEL_URL=/models/vosk-model-small-it-0.22.tar.gz
```

Il modello non e versionato nel repository. Preparalo localmente con:
```powershell
scripts\windows\prepare_vosk_model.ps1
```

oppure su Linux/macOS:
```bash
bash scripts/unix/prepare_vosk_model.sh
```

Gli script scaricano `vosk-model-small-it-0.22` dal catalogo Vosk ufficiale e creano l'archivio `frontend/my-app/public/models/vosk-model-small-it-0.22.tar.gz` con root `model/`, formato richiesto da `vosk-browser`.

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
OLLAMA_MODEL=qwen3.5:9b
OLLAMA_RUNTIME=auto
OLLAMA_ACCELERATOR=auto
OLLAMA_NATIVE_VULKAN=1
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
VITE_VOSK_MODEL_URL=/models/vosk-model-small-it-0.22.tar.gz
```

`VITE_VOSK_MODEL_URL` e opzionale: se manca, il frontend usa comunque il fallback `/models/vosk-model-small-it-0.22.tar.gz`.

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
- `OLLAMA_MODEL` in `backend/.env` esista davvero nel runtime Ollama usato, nativo o container;
- non ci sia mismatch tra nome configurato e modello scaricato;
- il cold start non stia superando il timeout.
- se sei su Windows con GPU AMD, verifica di stare usando Ollama nativo e non il container CPU-only.

Download manuale:
```bash
docker exec ditto_ollama ollama pull qwen3.5:9b
```

Se stai usando Ollama nativo:
```bash
ollama pull qwen3.5:9b
ollama list
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

- ultimo aggiornamento documentazione: 7 aprile 2026
- source of truth operativa: `scripts/windows/setup.bat` e `scripts/windows/start.bat`
