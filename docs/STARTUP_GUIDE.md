# STARTUP_GUIDE

Guida pratica per avviare Holo-Assistant con il flusso attuale degli script.

Ultimo aggiornamento: 14 aprile 2026

## Script supportati

### Windows

- setup iniziale: `setup.bat`
- avvio successivo: `start.bat`

Questi comandi restano i punti di ingresso pubblici. Su Windows i `.bat` chiamano script PowerShell (`scripts/windows/setup.ps1` e `scripts/windows/start.ps1`) che gestiscono prerequisiti, retry e riparazioni automatiche.

### Linux

- setup iniziale: `./setup.sh`
- avvio successivo: `./start.sh`

Gli script Windows e Unix sono allineati nelle funzionalita principali: `setup` esegue il bootstrap completo, `start` fa avvio quotidiano con riparazione minima, e su Unix sono disponibili anche `./setup.sh --check-only` e `./start.sh --check-only`.

Controllo repository supportato:
- Windows: `check.bat`
- Unix: `./check.sh`

## Prerequisiti

- Docker con Compose
- Python 3 e supporto `venv`
- Node.js con `npm`

Su Windows, `setup.bat` e `start.bat` provano a installare automaticamente prerequisiti mancanti con `winget`: Python, Node.js LTS, mkcert e Ollama. Per Docker, se un runtime Windows gia funzionante non e' disponibile, il flusso Windows chiede i permessi amministrativi all'inizio quando deve installare WSL oppure quando WSL e presente ma non accessibile nella sessione corrente, poi riusa la prima distro WSL esistente oppure crea `holo_assistant_wsl`, mette in pausa il setup dopo la creazione dell'utente Linux e installa Docker Engine dal repository ufficiale Docker dentro la distro scelta. Su Unix, `setup.sh` e `start.sh` provano a installarli automaticamente con il package manager della distro (`apt`, `dnf`, `yum`, `pacman`, `zypper`) e usano `sudo` quando serve. Su Ubuntu/Debian, Docker viene installato con il repository ufficiale Docker, inclusa la rimozione dei pacchetti in conflitto e l'installazione di `docker-ce`. Se l'installazione automatica non riesce, lo script si ferma con un messaggio guidato.

Servizi Docker previsti da `docker/docker-compose.yml`:
- `holo_assistant_postgres`
- `holo_assistant_adminer`

## Cosa fa `setup`

`setup.bat` e `./setup.sh` eseguono il bootstrap completo dell'ambiente con la stessa sequenza logica, adattata alla piattaforma.

Passi principali:
- controllano Docker, Python, Node.js/npm, certificati HTTPS e Ollama nativo quando serve;
- su Windows provano a installare automaticamente i prerequisiti mancanti con `winget`;
- su Windows, se `docker` non e' pronto, chiedono i permessi amministrativi se devono installare WSL oppure se la distro WSL non e accessibile in quella sessione e poi preparano Docker via WSL usando la prima distro esistente oppure `holo_assistant_wsl`;
- eseguono `docker compose down`;
- eseguono `docker compose up -d postgres adminer`;
- aspettano che PostgreSQL sia pronto con `pg_isready`;
- preparano il modello `qwen3.5:9b` in Ollama;
- generano `certs/holo-assistant.crt` e `certs/holo-assistant.key` con `mkcert` se mancano quando `mkcert` e disponibile;
- generano `backend/.env`;
- generano `frontend/my-app/.env`;
- preparano `frontend/my-app/public/models/vosk-model-small-it-0.22.tar.gz` se manca;
- creano il virtual environment backend se manca;
- installano le dipendenze Python da `backend/requirements.txt`;
- eseguono `backend/scripts/init_db.py`;
- eseguono `backend/scripts/populate.py`;
- eseguono `backend/scripts/seed_categories.py`;
- preparano la voce Piper predefinita se manca;
- installano le dipendenze frontend se `node_modules` non e presente;
- avviano backend e frontend.

## Cosa fa `start`

`start.bat` e `./start.sh` servono per l'avvio quotidiano senza reinstallare tutto, con riparazione minima dei componenti mancanti.

Passi principali:
- controllano prerequisiti e provano a riparare il minimo indispensabile;
- su Windows, se `docker` non e' pronto, chiedono i permessi amministrativi se devono installare WSL oppure se la distro WSL non e accessibile in quella sessione e poi preparano Docker via WSL usando la prima distro esistente oppure `holo_assistant_wsl`;
- eseguono `docker compose up -d postgres adminer`;
- aspettano che PostgreSQL sia pronto;
- verificano la presenza del certificato HTTPS locale e lo generano se manca quando `mkcert` e disponibile;
- leggono `OLLAMA_MODEL`, `OLLAMA_BASE_URL` e gli altri parametri AI da `backend/.env` se presente;
- verificano la presenza del modello con il runtime Ollama configurato e provano a scaricarlo se manca;
- provano il warmup del modello via `POST /api/generate` dopo il check su `GET /api/tags`;
- aggiornano `backend/.env` con `ALLOWED_ORIGINS` HTTPS e cookie refresh secure;
- aggiornano `frontend/my-app/.env` con `VITE_API_URL=https://{server-ip}:8000` e `VITE_VOSK_MODEL_URL`;
- in sviluppo, il frontend inoltra le route API al backend tramite proxy Vite, cosi browser desktop e mobile restano sulla stessa origin del frontend;
- ricreano il virtualenv backend o reinstallano le dipendenze frontend se mancano;
- preparano la voce Piper predefinita se manca;
- preparano il modello Vosk se l'archivio locale manca;
- riallineano la knowledge base tecnica assegnata alle postazioni con `backend/scripts/seed_categories.py` in best-effort;
- avviano backend FastAPI in HTTPS in una finestra dedicata;
- avviano frontend Vite in HTTPS in una finestra dedicata quando il certificato e presente.

## Configurazione attuale

### Backend

```ini
DATABASE_HOST=<ip-raggiungibile-dal-backend>
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=<genera-un-valore-casuale-lungo>
DATABASE_NAME=holo_assistant_db

SECRET_KEY=<genera-almeno-32-caratteri-casuali>
ALGORITHM=HS256

ADMIN_USERNAME=admin
ADMIN_PASSWORD=<genera-una-password-sicura>

ACCESS_TOKEN_EXPIRE_MINUTES=480
ADMIN_TOKEN_EXPIRE_MINUTES=120
OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES=480
ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES=120

ALLOWED_ORIGINS=https://localhost:5173,https://{server-ip}:5173
REFRESH_TOKEN_COOKIE_SECURE=true
REFRESH_TOKEN_COOKIE_SAMESITE=lax

OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:9b
OLLAMA_RUNTIME=native
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

Su Windows il valore canonico di `DATABASE_HOST` e' `127.0.0.1`:

- Docker in WSL: la guida Microsoft sul networking WSL indica `localhost` come percorso normale da Windows verso un servizio in WSL; per questo `setup.bat` e `start.bat` provano prima `127.0.0.1`/`localhost` e usano l'IP corrente della distro WSL solo come fallback.
- Docker nativo lato Windows: gli script mantengono `DATABASE_HOST=127.0.0.1`.

L'IP della distro WSL puo' cambiare dopo `wsl --shutdown`, reboot o restart del networking, quindi gli script lo rigenerano a ogni setup/start.

### Frontend

```ini
VITE_API_URL=https://{server-ip}:8000
VITE_VOSK_MODEL_URL=/models/vosk-model-small-it-0.22.tar.gz
```

Il frontend usa `VITE_API_URL` come target backend del proxy dev Vite. In sviluppo il browser chiama la stessa origin del frontend e Vite inoltra al backend; `VITE_VOSK_MODEL_URL` e opzionale e, se manca, viene usato il fallback `/models/vosk-model-small-it-0.22.tar.gz`.

Per la build statica:
- `npm run build` genera prima `public/legacy.css` con `npm run build:legacy-css`;
- il file viene creato da `frontend/my-app/scripts/build-legacy-css.mjs` usando Tailwind CLI e `lightningcss`;
- `frontend/my-app/index.html` carica il foglio legacy solo come fallback per browser che non supportano i CSS layers.

## URL utili

- Frontend locale: `https://localhost:5173`
- Frontend rete: `https://{server-ip}:5173`
- Backend API: `https://{server-ip}:8000`
- Swagger: `https://{server-ip}:8000/docs`
- Admin login: `https://localhost:5173/admin-login`
- Informativa cookie/privacy: `https://localhost:5173/cookie-policy`
- Adminer: `http://localhost:8080`
- Ollama tags: `http://{server-ip}:11434/api/tags`

## HTTPS in LAN

Gli script avviano backend e frontend in HTTPS usando `certs/holo-assistant.crt` e `certs/holo-assistant.key`. Il certificato deve contenere l'IP statico del server usato dai dispositivi, ad esempio `{server-ip}`, `127.0.0.1`, `localhost` e `holo-assistant.lan`.

Su Windows, `setup.bat` e `start.bat` generano automaticamente `certs/holo-assistant.crt` e `certs/holo-assistant.key` se mancano. Se `mkcert` non e installato, lo script prova a installarlo con `winget install -e --id FiloSottile.mkcert --accept-package-agreements --accept-source-agreements`, aggiorna il `PATH` della sessione e poi genera il certificato. Se `winget` non e disponibile o `mkcert` non entra nel `PATH`, lo script mostra un errore guidato e chiede di riaprire il terminale o installare il prerequisito manualmente.

Su Unix, `setup.sh` e `start.sh` provano anche a installare `mkcert` automaticamente. Se `mkcert` viene installato o e gia disponibile, possono generare `certs/holo-assistant.crt` e `certs/holo-assistant.key` quando mancano. Se l'installazione automatica non riesce, si fermano con un messaggio guidato. I file `*.crt` e `*.key` sono ignorati da Git, quindi il certificato locale non viene versionato.

Su mobile e desktop puo comparire un avviso di certificato non attendibile se la CA locale non e installata nel dispositivo. In questo setup l'obiettivo e cifrare il traffico interno: accetta l'avviso per il frontend. Nel flusso dev attuale le API passano dal proxy Vite, quindi in genere non serve piu accettare separatamente il certificato del backend dal browser. Se invece richiami il backend direttamente o usi strumenti esterni al frontend, apri anche `https://{server-ip}:8000/health` e accetta il certificato del backend.

Se l'IP statico cambia, rigenera il certificato prima dello start, ad esempio con `mkcert -cert-file certs/holo-assistant.crt -key-file certs/holo-assistant.key {server-ip} localhost 127.0.0.1 holo-assistant.lan`.

## Requisiti host consigliati

Per ospitare l'intero stack sulla stessa macchina:

- minimo per test o demo interna: 4 core CPU, 16 GB RAM, 30 GB SSD liberi
- consigliato per uso interno stabile: 8 core CPU, 32 GB RAM, 60-80 GB SSD liberi
- GPU opzionale ma utile per ridurre la latenza del modello `qwen3.5:9b`
- porte da considerare: `5173`, `8000`, `8080`, `5432`, `11434`

Note operative:
- su Windows il runtime AI supportato e solo Ollama nativo
- se `ollama` manca, lo script Windows prova a installarlo con `irm https://ollama.com/install.ps1 | iex`
- su Windows Docker serve al progetto solo per `holo_assistant_postgres` e `holo_assistant_adminer`
- gli override `docker/docker-compose.nvidia.yml` e `docker/docker-compose.amd.yml` non fanno parte del flusso Windows corrente
- gli script attuali avviano frontend e backend in modalita sviluppo, quindi per un host permanente conviene prevedere un servizio dedicato per FastAPI e una build statica del frontend

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

Controllo non distruttivo Windows:
```powershell
scripts\windows\setup.ps1 -CheckOnly
scripts\windows\start.ps1 -CheckOnly
```

Linux:
```bash
./start.sh
```

Controllo non distruttivo Linux:
```bash
./setup.sh --check-only
./start.sh --check-only
```

### Stop completo su Windows

Per fermare backend e frontend, chiudi le finestre terminale aperte dagli script oppure premi `Ctrl+C` in ciascuna finestra.

Per fermare anche i servizi Docker del progetto:
```bat
cd docker
docker compose down
```

Se stai usando Docker dentro WSL, dopo aver fermato i container puoi spegnere anche il backend WSL con:
```bat
wsl --shutdown
```

Nota: `wsl --shutdown` spegne tutte le distro WSL attive. Usalo quando non ti servono altre sessioni WSL aperte.

## Sessioni operatore in tempo reale

Il frontend operatore protegge la sessione postazione con due livelli:
- canale SSE via `POST /auth/sse-token` e `GET /auth/session-events`;
- fallback polling via `GET /auth/session-status`.

Se la sessione non e piu valida, il frontend forza il logout e mostra un messaggio locale.

Motivi principali gestiti dal frontend:
- `working_station_released`
- `working_station_reassigned`
- `working_station_not_found`

Questo copre i casi in cui un amministratore libera la postazione, la assegna a un altro operatore oppure la postazione non e piu disponibile.

## Note UI aggiornate

- la barra operatore espone azioni rapide di emergenza e manutenzione prima di info e impostazioni;
- il pannello impostazioni operatore permette di disattivare ologramma, wakeword e forzare la grafica legacy;
- dopo la wake-word l'operatore puo anche pronunciare comandi rapidi come `emergenza`, `chiama emergenza`, `manutenzione` o `chiama tecnico`; il frontend apre comunque la conferma visiva prima dell'invio;
- su mobile la UI operatore aggiorna l'altezza utile con `visualViewport`, cosi il layout si riallinea quando cambia la tastiera o quando il login avviene nella stessa view;
- la dashboard admin mostra le impostazioni separate tra `normali` e `avanzate`;
- il form macchinari usa un dropdown delle postazioni libere per associare la postazione in modo coerente;
- la knowledge base tecnica viene assegnata alle postazioni; il macchinario associato resta solo contesto operativo;
- l'informativa cookie, tecnologie utilizzate e privacy e disponibile pubblicamente su `/cookie-policy`.

## Troubleshooting

### `GET /api/tags` funziona ma warmup o richieste AI falliscono

Cause tipiche:
- modello non presente nel runtime Ollama nativo;
- timeout durante il cold start;
- mismatch tra `OLLAMA_MODEL` configurato e modello realmente scaricato.

Controlli:
```bash
ollama list
ollama ps
```

Download manuale:
```bash
ollama pull qwen3.5:9b
ollama list
```

### Prima richiesta AI molto lenta

Sintomo normale al primo caricamento del modello. La configurazione attuale usa gia:
- `OLLAMA_TIMEOUT_SECONDS=120`
- `OLLAMA_KEEP_ALIVE=30m`
- warmup automatico durante `start`

Se serve ancora piu margine:
- aumenta `OLLAMA_TIMEOUT_SECONDS`;
- verifica che il warmup non fallisca;
- controlla i log di Ollama.

### L'operatore viene disconnesso inaspettatamente

Controlla:
- se la postazione e stata liberata o riassegnata lato admin;
- se il token SSE e stato emesso correttamente;
- se il browser riceve heartbeat o eventi `session_status`;
- se il fallback `session-status` risponde correttamente quando SSE cade.

### PostgreSQL non pronto

Controlli:
```bash
docker exec holo_assistant_postgres pg_isready -U postgres
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

Controlli Windows:
```bat
cd backend
venv\Scripts\activate.bat
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --ssl-certfile ..\certs\holo-assistant.crt --ssl-keyfile ..\certs\holo-assistant.key --no-use-colors
```

Controlli Unix:
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --ssl-certfile ../certs/holo-assistant.crt --ssl-keyfile ../certs/holo-assistant.key
```

## Note su auth e sessioni

- operatori: login via badge o credenziali, sempre associati a una postazione;
- admin: login dedicato via `POST /auth/admin-login`;
- l'access token da solo non rappresenta l'intera sessione;
- il refresh token attivo viene mantenuto nel cookie HTTP-only del backend;
- il frontend non persiste piu il refresh token in `localStorage`;
- il logout revoca il refresh token della sessione corrente e libera la postazione associata quando presente;
- la chiusura di una chat session operatore non elimina piu i record dalla lista log admin: i log restano persistenti e vengono solo scollegati dalla sessione chiusa;
- per testare una scadenza completa bisogna ridurre anche i refresh token;
- il frontend prova il refresh prima di considerare scaduta la sessione.

## Verifica finale

Dopo `setup` o `start` controlla:
- `backend/.env` creato correttamente;
- `backend/.env` aggiornato con `ALLOWED_ORIGINS` HTTPS, `REFRESH_TOKEN_COOKIE_SECURE=true` e `REFRESH_TOKEN_COOKIE_SAMESITE=lax`;
- `frontend/my-app/.env` aggiornato con `VITE_API_URL=https://{server-ip}:8000`;
- `certs/holo-assistant.crt` e `certs/holo-assistant.key` presenti localmente;
- modello wake-word presente in `frontend/my-app/public/models` oppure URL alternativo configurato con `VITE_VOSK_MODEL_URL`;
- `docker compose ps` con `holo_assistant_postgres` e `holo_assistant_adminer`;
- backend raggiungibile su `https://{server-ip}:8000`;
- frontend raggiungibile su `https://{server-ip}:5173`;
- accesso admin disponibile su `/admin-login`;
- selezione postazione e login operatore funzionanti dal frontend.

