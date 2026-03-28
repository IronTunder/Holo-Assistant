# Progetto Ditto

Sistema di gestione macchinari industriali con:
- interfaccia operatore;
- dashboard amministrativa;
- backend FastAPI;
- database PostgreSQL;
- supporto AI con Ollama per classificazione/selezione risposte preset.

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

Lo script:
- avvia Docker con PostgreSQL, Adminer e Ollama;
- prepara il modello `mistral:7b-instruct-v0.3-q4_K_M`;
- crea `backend/.env` e `frontend/my-app/.env`;
- installa dipendenze backend/frontend;
- inizializza e popola il database.

### Avvio successivo

Windows:
```bat
start.bat
```

Linux:
```bash
./start.sh
```

Lo script:
- riavvia Docker;
- aspetta PostgreSQL;
- legge `OLLAMA_MODEL` da `backend/.env`;
- prova il warmup del modello AI;
- avvia backend e frontend in finestre separate;
- aggiorna `ditto_info.txt`.

## URL principali

- Frontend locale: `http://localhost:5173`
- Frontend rete: `http://{server-ip}:5173`
- Backend API: `http://{server-ip}:8000`
- Swagger: `http://{server-ip}:8000/docs`
- Adminer: `http://localhost:8080`
- Ollama tags: `http://{server-ip}:11434/api/tags`

## Login

### Operatore

Flussi supportati:
- `POST /auth/badge-login`
- `POST /auth/credentials-login`

L’operatore accede associandosi a una macchina.

### Admin

Endpoint:
```http
POST /auth/admin-login
```

Credenziali di default generate dal setup:
```ini
ADMIN_USERNAME=admin
ADMIN_PASSWORD=tuapasswordsicura
```

## Sessioni e token

Variabili attuali:
```ini
ACCESS_TOKEN_EXPIRE_MINUTES=480
ADMIN_TOKEN_EXPIRE_MINUTES=120
OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES=480
ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES=120
```

Nota importante:
- se scade solo l’`access_token`, la sessione può essere recuperata se il `refresh_token` è ancora valido;
- per testare davvero la scadenza completa bisogna ridurre anche `OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES` o `ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES`.

## AI con Ollama

Configurazione attuale:
```ini
OLLAMA_BASE_URL=http://{server-ip}:11434
OLLAMA_MODEL=mistral:7b-instruct-v0.3-q4_K_M
OLLAMA_TIMEOUT_SECONDS=120
OLLAMA_HEALTH_TIMEOUT_SECONDS=5
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_PREDICT_CLASSIFY=4
OLLAMA_NUM_PREDICT_SELECT=2
OLLAMA_TOP_K=20
OLLAMA_TOP_P=0.8
OLLAMA_TEMPERATURE_CLASSIFY=0.0
OLLAMA_TEMPERATURE_SELECT=0.0
OLLAMA_NUM_CTX=2048
OLLAMA_NUM_THREAD=4
```

Comportamento attuale:
- il backend prova direttamente la generazione con Ollama;
- se Ollama fallisce o il modello non è pronto, entra in fallback controllato;
- la selezione di fallback usa euristiche keyword-based, non il “primo risultato” fisso;
- `start.bat` e `start.sh` provano a fare warmup del modello con `ollama run`.

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

OLLAMA_BASE_URL=http://{server-ip}:11434
OLLAMA_MODEL=mistral:7b-instruct-v0.3-q4_K_M
OLLAMA_TIMEOUT_SECONDS=120
OLLAMA_HEALTH_TIMEOUT_SECONDS=5
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_PREDICT_CLASSIFY=4
OLLAMA_NUM_PREDICT_SELECT=2
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

Il frontend usa solo `VITE_API_URL`.

## Struttura progetto

    Progetto-Ditto/
    |- backend/
    |- docs/
    |- docker/
    |- frontend/my-app/
    |- scripts/
    |  |- unix/
    |  \- windows/
    |- setup.bat      (wrapper)
    |- setup.sh       (wrapper)
    |- start.bat      (wrapper)
    \- start.sh       (wrapper)

Dettagli principali:
- `backend/app/` contiene il runtime FastAPI.
- `backend/scripts/` contiene script operativi e di bootstrap database.
- `frontend/my-app/src/features/` contiene le feature `admin` e `operator`.
- `frontend/my-app/src/shared/` contiene UI, auth e client condivisi.
- I file `setup/start` in root restano disponibili ma delegano agli script reali dentro `scripts/`.

## Troubleshooting rapido

### Ollama risponde a `/api/tags` ma fallisce su `/api/generate`

Controlla:
- che `OLLAMA_MODEL` esista davvero nel container:
  ```bash
  docker exec ditto_ollama ollama list
  ```
- che il modello configurato coincida con quello scaricato;
- che il cold start non stia andando in timeout.

Per scaricare manualmente il modello corretto:
```bash
docker exec ditto_ollama ollama pull mistral:7b-instruct-v0.3-q4_K_M
```

### Prima richiesta AI molto lenta

È normale al primo load del modello. Gli script di start provano già un warmup. Se serve più margine:
- aumenta `OLLAMA_TIMEOUT_SECONDS`;
- verifica che il warmup non fallisca;
- controlla i log di Ollama per timeout di load.

### Errore database

Verifica:
- container Postgres attivo;
- `DATABASE_HOST` corretto;
- `docker exec ditto_postgres pg_isready -U postgres`.

## Documentazione

- Guida operativa: [docs/STARTUP_GUIDE.md](/e:/Scuola/Progetto-Ditto/docs/STARTUP_GUIDE.md)
- Backend entrypoint: [backend/app/main.py](/e:/Scuola/Progetto-Ditto/backend/app/main.py)
- Auth: [backend/app/api/auth/auth.py](/e:/Scuola/Progetto-Ditto/backend/app/api/auth/auth.py)
- Interactions AI: [backend/app/api/interactions.py](/e:/Scuola/Progetto-Ditto/backend/app/api/interactions.py)

## Stato attuale

- ultimo aggiornamento: Marzo 2026
- source of truth per setup/avvio: `setup.bat` e `start.bat`
