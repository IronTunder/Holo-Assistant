# STARTUP_GUIDE

Guida pratica per avviare Ditto con il flusso attuale degli script.

## Script supportati

### Windows

- setup iniziale: `setup.bat`
- avvio successivo: `start.bat`

### Linux

- setup iniziale: `./setup.sh`
- avvio successivo: `./start.sh`

Gli script Windows sono la source of truth e quelli Linux sono allineati allo stesso flusso.

## Cosa fa `setup`

`setup.bat` / `setup.sh`:
- avviano Docker con PostgreSQL, Adminer e Ollama;
- aspettano che PostgreSQL sia pronto;
- scaricano il modello `mistral:7b-instruct-v0.3-q4_K_M` se manca;
- generano `backend/.env` e `frontend/my-app/.env`;
- installano dipendenze Python e Node.js;
- eseguono `init_db.py`, `populate.py` e `seed_categories.py` se presenti;
- avviano backend e frontend.

## Cosa fa `start`

`start.bat` / `start.sh`:
- fanno `docker compose down` e `docker compose up -d`;
- aspettano PostgreSQL con `pg_isready`;
- leggono `OLLAMA_MODEL` da `backend/.env`;
- verificano che il modello sia presente con `ollama list`;
- fanno warmup del modello con:
  ```bash
  ollama run "<model>" "Rispondi solo OK"
  ```
- aggiornano `frontend/my-app/.env` con `VITE_API_URL`;
- avviano backend e frontend;
- scrivono `ditto_info.txt`.

## Configurazione attuale

### Backend

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

### Frontend

```ini
VITE_API_URL=http://{server-ip}:8000
```

Il frontend usa solo `VITE_API_URL`.

## URL utili

- Frontend locale: `http://localhost:5173`
- Frontend rete: `http://{server-ip}:5173`
- Backend API: `http://{server-ip}:8000`
- Swagger: `http://{server-ip}:8000/docs`
- Admin login: `http://localhost:5173/admin-login`
- Adminer: `http://localhost:8080`
- Ollama tags: `http://{server-ip}:11434/api/tags`

## Flusso consigliato

### Prima installazione

Windows:
```bat
setup.bat
```

Linux:
```bash
./setup.sh
```

### Avvio quotidiano

Windows:
```bat
start.bat
```

Linux:
```bash
./start.sh
```

## Troubleshooting

### `GET /api/tags` va ma `POST /api/generate` fallisce

Cause tipiche:
- `OLLAMA_MODEL` non presente nel container;
- timeout sul cold start del modello;
- mismatch tra `backend/.env` e il modello realmente scaricato.

Controlli:
```bash
docker exec ditto_ollama ollama list
docker compose logs -f ollama
```

Download manuale:
```bash
docker exec ditto_ollama ollama pull mistral:7b-instruct-v0.3-q4_K_M
```

### Prima richiesta AI molto lenta o interrotta

Sintomi tipici nei log:
- `load_tensors: loading model tensors`
- `client connection closed before server finished loading`
- `499`
- timeout lato backend

Significa che il modello sta facendo cold start e il backend chiude la richiesta troppo presto. La configurazione attuale usa già:
- `OLLAMA_TIMEOUT_SECONDS=120`
- `OLLAMA_KEEP_ALIVE=30m`
- warmup del modello in start

Se serve ancora più margine:
- aumenta `OLLAMA_TIMEOUT_SECONDS`;
- verifica che il warmup non fallisca;
- controlla che non ci sia mismatch del modello.

### Ollama non usa il modello configurato

Verifica che `backend/.env` e il container siano coerenti:
```bash
grep '^OLLAMA_MODEL=' backend/.env
docker exec ditto_ollama ollama list
```

Se i nomi non coincidono, il backend andrà in fallback controllato invece che usare l’AI vera.

### PostgreSQL non pronto

Controlli:
```bash
docker exec ditto_postgres pg_isready -U postgres
docker compose logs -f postgres
```

### Frontend non parte

Controlli:
```bash
cd frontend/my-app
npm install
npm run dev -- --host 0.0.0.0
```

### Backend non parte

Controlli:
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Note su auth e sessioni

- operatori: login via `badge-login` o `credentials-login`;
- admin: login via `admin-login`;
- l’`access_token` da solo non rappresenta l’intera sessione;
- per testare una vera scadenza bisogna ridurre anche i refresh token;
- i refresh token sono uno per utente e vengono ripuliti nei flussi auth.

## Verifica finale

Dopo `setup` o `start` controlla:
- `backend/.env` creato correttamente;
- `frontend/my-app/.env` aggiornato con `VITE_API_URL`;
- `ditto_info.txt` presente;
- `docker compose ps` con `ditto_postgres`, `ditto_ollama`, `ditto_adminer`;
- backend su `8000`;
- frontend su `5173`.
