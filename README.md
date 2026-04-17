# Holo-Assistant

Ultimo aggiornamento documentazione: 18 aprile 2026

Holo-Assistant e un sistema di supporto per postazioni e macchinari industriali composto da:
- frontend React/Vite per operatori e amministratori;
- fallback CSS legacy generato in build per browser senza supporto ai CSS layers;
- backend FastAPI;
- database PostgreSQL;
- catalogo materiali centralizzato con stock, soglie e movimenti di magazzino;
- servizi AI locali con retrieval deterministico, chiarimenti guidati e fallback controllati;
- sintesi vocale TTS e avatar operatore;
- pagina pubblica su cookie, tecnologie utilizzate e privacy disponibile su `/cookie-policy`.

## Licenza e copyright

- Il codice originale del repository e distribuito sotto licenza [MIT](./LICENSE).
- Le attribuzioni e le note relative a componenti e asset di terze parti sono raccolte in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
- Alcuni materiali inclusi o integrati dal progetto, come componenti UI derivati, dipendenze frontend e modelli vocali, mantengono le rispettive licenze upstream.

## Architettura in breve

- `frontend/my-app` contiene l'applicazione web.
- `frontend/my-app/src/features/operator` gestisce login operatore, console assistente, avatar e sessione postazione.
- `frontend/my-app/src/features/admin` contiene dashboard e strumenti di amministrazione.
- `frontend/my-app/src/features/legal` contiene la pagina informativa cookie, tecnologie utilizzate e privacy.
- `frontend/my-app/src/shared` raccoglie API client, auth e componenti UI condivisi.
- `backend/app` contiene API, modelli, servizi AI e logica applicativa.
- `backend/scripts` contiene bootstrap database e utility operative.
- `docker` contiene i servizi locali PostgreSQL e Adminer.
- `scripts/windows` e `scripts/unix` contengono gli script reali di setup e avvio; i file in root sono wrapper.

## Runtime Ollama e GPU

- Su Windows, il runtime AI supportato e solo `Ollama` nativo.
- Su Windows, Docker serve al progetto solo per PostgreSQL e Adminer.
- Se `docker` non e pronto lato Windows, gli script Windows chiedono i permessi amministrativi all'inizio se devono installare WSL oppure se la distro WSL esistente non e accessibile nella sessione corrente, poi riusano la prima distro WSL esistente oppure creano `holo_assistant_wsl` e installano Docker Engine dentro quella distro, senza richiedere Docker Desktop come prerequisito del progetto.
- I file `docker/docker-compose.nvidia.yml` e `docker/docker-compose.amd.yml` restano come override legacy e non fanno parte del flusso Windows corrente.

## Quick Start

I wrapper pubblici restano `setup.bat`/`start.bat` su Windows e `./setup.sh`/`./start.sh` su Unix. I flussi sono ora allineati nelle funzionalita principali: bootstrap completo con `setup`, avvio quotidiano riparativo con `start`, supporto `--check-only` su Unix e gestione coerente di Docker, HTTPS, Ollama, Vosk, backend e frontend.

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
- controlla Docker, Python, Node.js/npm, certificati HTTPS e Ollama nativo;
- su Windows, se manca un prerequisito prova a installarlo con `winget` e aggiorna il `PATH` della sessione;
- su Windows, se `docker` non e' pronto, chiede i permessi amministrativi se deve installare WSL oppure se la distro WSL non e accessibile in quella sessione e poi prepara Docker via WSL usando la prima distro esistente oppure `holo_assistant_wsl`;
- esegue `docker compose down` e poi `docker compose up -d` per `postgres` e `adminer`;
- aspetta PostgreSQL;
- prepara il modello `qwen3.5:9b` in Ollama;
- genera `certs/holo-assistant.crt` e `certs/holo-assistant.key` con `mkcert` se mancano quando `mkcert` e disponibile;
- crea `backend/.env` e `frontend/my-app/.env`;
- configura backend e frontend per HTTPS in LAN;
- installa dipendenze backend e frontend;
- esegue `backend/scripts/init_db.py`, `backend/scripts/populate.py` e `backend/scripts/seed_categories.py`;
- prepara la voce Piper predefinita se manca;
- prepara il modello wake-word Vosk se manca;
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

Controllo non distruttivo Unix:
```bash
./setup.sh --check-only
./start.sh --check-only
```

Verifica rapida repository:
```bat
check.bat
```

oppure su Unix:
```bash
./check.sh
```

Lo script di start:
- controlla prerequisiti e prova la riparazione minima dei componenti mancanti;
- su Windows, se `docker` non e' pronto, chiede i permessi amministrativi se deve installare WSL oppure se la distro WSL non e accessibile in quella sessione e poi prepara Docker via WSL usando la prima distro esistente oppure `holo_assistant_wsl`;
- riallinea Docker con `docker compose up -d` senza forzare il reset dei container, lasciando attivi solo `postgres` e `adminer`;
- aspetta PostgreSQL;
- verifica o genera il certificato HTTPS locale;
- legge `OLLAMA_MODEL` e i parametri principali da `backend/.env`;
- controlla la presenza del modello con `ollama list` e, se manca, prova a scaricarlo;
- prova il warmup del modello via `POST /api/generate`;
- aggiorna `backend/.env` con origini CORS HTTPS e cookie refresh secure;
- aggiorna `frontend/my-app/.env` con `VITE_API_URL=https://{server-ip}:8000` e `VITE_VOSK_MODEL_URL`;
- in sviluppo, il frontend usa Vite come proxy verso il backend, cosi i browser LAN parlano alla stessa origin del frontend invece di aprire una seconda connessione diretta al backend;
- ricrea il virtualenv backend o reinstalla le dipendenze frontend se mancano;
- prepara la voce Piper predefinita se manca;
- prepara il modello Vosk se l'archivio locale manca;
- riallinea la knowledge base assegnata alle postazioni eseguendo `backend/scripts/seed_categories.py` in modalita best-effort;
- avvia backend e frontend.

## Prerequisiti software

- Docker con Compose
- Python 3 con `venv`
- Node.js e `npm`

Su Windows, `setup.bat` e `start.bat` provano a installare automaticamente Python, Node.js, mkcert e Ollama quando possibile. Per Docker, se un runtime Windows non e gia disponibile, il flusso Windows chiede i permessi amministrativi all'inizio quando deve installare WSL oppure quando WSL e presente ma non accessibile nella sessione corrente, poi riusa la prima distro WSL esistente oppure crea `holo_assistant_wsl`, mette in pausa il setup dopo la creazione dell'utente Linux e installa Docker Engine dal repository ufficiale Docker dentro la distro scelta. Su Unix, `setup.sh` e `start.sh` provano a installare i prerequisiti automaticamente con il package manager della distro (`apt`, `dnf`, `yum`, `pacman`, `zypper`) e usano `sudo` quando serve. Se l'installazione automatica non riesce, lo script si ferma con un messaggio guidato.

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

## Requisiti di sistema per hostare Holo-Assistant

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
- NVIDIA con almeno 8 GB di VRAM o AMD con almeno 8 GB di VRAM per usare bene Ollama nativo
- su Windows il percorso supportato resta Ollama nativo
- su Linux/WSL gli override Docker legacy per Ollama restano opzionali e fuori dal flusso Windows

### Note pratiche di hosting

- Il flusso attuale del repository e ottimizzato per self-hosting in rete locale, non per deployment cloud completamente automatizzato.
- Gli script di root avviano backend e frontend in modalita sviluppo (`uvicorn --reload` e `vite dev`).
- Per un host sempre acceso conviene sostituire il frontend Vite dev server con una build statica servita da web server e il backend con un process manager o servizio dedicato.
- PostgreSQL resta pronto tramite Docker Compose; Ollama su Windows gira nativamente.

## URL utili

- Frontend locale: `https://localhost:5173`
- Frontend rete: `https://{server-ip}:5173`
- Backend API: `https://{server-ip}:8000`
- Swagger: `https://{server-ip}:8000/docs`
- Admin login: `https://localhost:5173/admin-login`
- Informativa cookie/privacy: `https://localhost:5173/cookie-policy`
- Adminer: `http://localhost:8080`
- Ollama tags: `http://{server-ip}:11434/api/tags`

## Stop completo su Windows

Per fermare backend e frontend, chiudi le finestre terminale aperte dagli script oppure premi `Ctrl+C`. Per fermare anche i container del progetto, esegui:
```bat
cd docker
docker compose down
```

Se stai usando Docker dentro WSL e vuoi spegnere anche il backend Linux, esegui:
```bat
wsl --shutdown
```

Nota: `wsl --shutdown` spegne tutte le distro WSL attive.

## HTTPS in rete locale

Backend e frontend vengono avviati in HTTPS usando `certs/holo-assistant.crt` e `certs/holo-assistant.key`. Il certificato deve includere l'IP statico con cui i dispositivi aprono Holo-Assistant, ad esempio `{server-ip}`, `127.0.0.1`, `localhost` e `holo-assistant.lan`.

Su Windows, `setup.bat` e `start.bat` provano a generare automaticamente questi file se mancano. Se `mkcert` non e installato, lo script prova a installarlo con `winget install -e --id FiloSottile.mkcert --accept-package-agreements --accept-source-agreements`, aggiorna il `PATH` della sessione e poi genera il certificato. Se `winget` non e disponibile o `mkcert` non entra nel `PATH`, lo script mostra un errore guidato e chiede di riaprire il terminale o installare il prerequisito manualmente.

Su Unix, gli script provano anche a installare automaticamente `mkcert` con il package manager della distro. Se `mkcert` viene installato o e gia disponibile, generano `certs/holo-assistant.crt` e `certs/holo-assistant.key` quando mancano. Se l'installazione automatica non riesce, lo script si ferma con un messaggio guidato e puoi generare i file manualmente con un comando equivalente a quello indicato sotto.

`*.crt` e `*.key` sono ignorati da Git: in `certs/` resta versionabile solo il placeholder `.gitkeep`, mentre i certificati reali sono locali alla macchina.

Senza installare una CA attendibile sui dispositivi, browser desktop e mobile possono mostrare un avviso di certificato non attendibile: la connessione e comunque cifrata, ma va accettata manualmente. Nel flusso di sviluppo attuale le API passano dal proxy HTTPS di Vite, quindi di norma basta accettare il certificato del frontend. Se continui a chiamare il backend direttamente oppure usi strumenti esterni al browser, apri anche `https://{server-ip}:8000/health` sul dispositivo e accetta il certificato del backend.

Se l'IP statico cambia, rigenera il certificato includendo il nuovo IP, ad esempio con `mkcert -cert-file certs/holo-assistant.crt -key-file certs/holo-assistant.key {server-ip} localhost 127.0.0.1 holo-assistant.lan`, poi riavvia backend e frontend.

## Flussi applicativi

### Esperienza operatore

Il frontend operatore e ottimizzato per l'uso su postazioni in orizzontale:
- selezione postazione tra quelle disponibili;
- login con badge o credenziali;
- area avatar con stati `idle`, `listening`, `thinking`, `speaking`;
- wake-word locale con Vosk in browser: di' `ehi holo`, poi pronuncia la domanda tecnica;
- dopo la wake-word puoi anche richiamare azioni rapide vocali come `emergenza`, `chiama emergenza`, `manutenzione` o `chiama tecnico`, che aprono la stessa conferma visiva dei pulsanti rapidi;
- console laterale per domanda, risposta, chiarimenti e follow-up;
- nei follow-up vocali di conferma o chiarimento l'ascolto contestuale resta attivo, cosi normalmente non serve ripetere `ehi holo`;
- i flussi materiale poco chiari non autoconfermano piu in modo aggressivo e possono proporre chiarimenti guidati come `Magari volevi dire "Ho finito il refrigerante"?`;
- azioni rapide visibili senza scroll dell'intera pagina;
- icona impostazioni nella barra operatore, disponibile sia prima del login sia durante la sessione, per gestire ologramma, wakeword e grafica legacy forzata.
- su mobile il layout aggiorna dinamicamente l'altezza viewport con `visualViewport`, cosi la UI si riallinea correttamente dopo login, chiusura tastiera o cambi di safe-area.

Endpoint principali usati dal frontend operatore:
- `POST /auth/badge-login`
- `POST /auth/credentials-login`
- `GET /working-stations/available`
- `POST /api/interactions/ask`
- `POST /tts/synthesize`

### Sessione operatore in tempo reale

La sessione postazione viene monitorata in tempo reale:
- il frontend richiede un token via `POST /auth/sse-token`;
- apre il canale `GET /auth/session-events`;
- riceve eventi `session_status` e heartbeat;
- se SSE non e disponibile, usa fallback su `GET /auth/session-status`.

I motivi di logout remoto gestiti lato frontend sono:
- `working_station_released`
- `working_station_reassigned`
- `working_station_not_found`

### Dashboard admin

L'area admin gestisce autenticazione dedicata, macchine, utenti, postazioni, materiali, ticket operativi, metadati e knowledge base tecnica assegnata alle postazioni. Il frontend usa routing lazy e protegge `/admin` tramite sessione autenticata.

Organizzazione attuale:
- `Panoramica` per KPI e accessi rapidi;
- `Operazioni` per log compattati e ticket/segnalazioni;
- `Risorse` per utenti, macchinari, postazioni e materiali;
- `Configurazione` per knowledge base, reparti, ruoli e impostazioni.

Aggiornamenti UI rilevanti:
- la sezione impostazioni e stata separata in `Impostazioni normali` e `Impostazioni avanzate`;
- ogni voce che richiede riavvio mostra l'indicatore direttamente sulla card dell'impostazione;
- il form macchinari associa la postazione tramite dropdown delle postazioni libere, evitando inserimenti manuali incoerenti;
- la sezione postazioni e stata riallineata visivamente agli altri pannelli admin;
- i log admin ora compattano i workflow multi-step, rendendo piu leggibili chiarimenti, conferme e follow-up;
- e disponibile un modulo `Materiali` con catalogo centrale, stock, soglie minime, stato sintetico, movimenti di carico/scarico/rettifica e assegnazioni alle postazioni;
- il dettaglio postazione mostra anche un riepilogo dei materiali assegnati con relativo stato stock centrale;
- la knowledge base tecnica viene assegnata alle postazioni; il macchinario associato resta un contesto operativo aggiuntivo, non il contenitore della knowledge.

## AI, retrieval e TTS

### Motore AI

Configurazione attuale:
```ini
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

Voce Piper predefinita:
```ini
PIPER_DEFAULT_VOICE=it_IT-paola-medium
```

Il modello non e versionato nel repository. Preparalo localmente con:
```bash
bash scripts/unix/prepare_piper_model.sh
```

Lo script scarica il modello e il file di configurazione della voce `it_IT-paola-medium` nella cartella `backend/app/services/voice_models/`, percorso letto dal backend TTS.

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

- Docker in WSL: secondo la guida Microsoft per il networking WSL, da Windows verso un servizio esposto in WSL si usa normalmente `localhost`; gli script provano quindi prima `127.0.0.1`/`localhost` e tengono l'IP della distro WSL solo come fallback diagnostico.
- Docker nativo lato Windows: `DATABASE_HOST=127.0.0.1`.

Nota: l'IP della distro WSL puo' cambiare dopo `wsl --shutdown`, riavvii o restart del networking. Per questo `setup.bat` e `start.bat` lo ricalcolano a ogni esecuzione.

### `frontend/my-app/.env`

```ini
VITE_API_URL=https://{server-ip}:8000
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
- il refresh token resta nel cookie HTTP-only configurato dal backend e non viene piu mantenuto in `localStorage`;
- se scade solo l'access token, il frontend prova il refresh della sessione;
- il logout prova prima a liberare la sessione autenticata corrente e revoca il refresh token associato;
- quando una chat session operatore viene chiusa, i relativi record restano nei log admin ma vengono sganciati dalla `chat_session_id`, quindi non riappaiono nella cronologia live della sessione chiusa;
- per simulare una vera scadenza completa bisogna ridurre anche i refresh token;
- il monitoraggio sessione operatore puo forzare il logout se la postazione cambia stato lato admin.

## Compatibilita frontend e build CSS

Per la build frontend attuale:
- `npm run build` esegue prima `npm run build:legacy-css` e poi `vite build`;
- `cd frontend/my-app && npm run smoke:build` esegue lo smoke check frontend oggi disponibile;
- `frontend/my-app/scripts/build-legacy-css.mjs` genera `frontend/my-app/public/legacy.css`;
- `index.html` carica `legacy.css` come fallback iniziale e lo disabilita subito nei browser che supportano i CSS layers, salvo preferenza operatore che forza la grafica legacy;
- questo mantiene compatibile l'interfaccia anche su browser enterprise o postazioni aggiornate lentamente.

Al momento il repository non include ancora test frontend dedicati: la baseline automatizzabile lato web e la smoke build.

## Troubleshooting rapido

### Ollama risponde a `/api/tags` ma il warmup o le richieste AI falliscono

Controlla:
```bash
ollama list
ollama ps
```

Verifica che:
- `OLLAMA_MODEL` in `backend/.env` esista davvero nel runtime Ollama nativo;
- non ci sia mismatch tra nome configurato e modello scaricato;
- il cold start non stia superando il timeout.
- su Windows verifica che `ollama serve` sia attivo e che il modello sia presente.

Download manuale:
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
- verifica se la postazione e stata liberata o riassegnata lato admin;
- controlla gli endpoint auth di sessione e il token SSE;
- verifica che il browser possa mantenere aperta la connessione `session-events`.

### Errore database

Controlla:
```bash
docker exec holo_assistant_postgres pg_isready -U postgres
docker compose logs -f postgres
```

Verifica anche che `DATABASE_HOST` punti all'host corretto.

## Documentazione correlata

- Guida operativa: [docs/STARTUP_GUIDE.md](docs/STARTUP_GUIDE.md)
- README frontend: [frontend/my-app/README.md](frontend/my-app/README.md)
- Backend entrypoint: [backend/app/main.py](backend/app/main.py)
- Config API frontend: [frontend/my-app/src/shared/api/config.ts](frontend/my-app/src/shared/api/config.ts)
- Informativa cookie/privacy frontend: [frontend/my-app/src/features/legal/CookiePolicyPage.tsx](frontend/my-app/src/features/legal/CookiePolicyPage.tsx)

## Stato attuale

- ultimo aggiornamento documentazione: 18 aprile 2026
- script pubblici supportati: `setup.bat`, `start.bat`, `check.bat`, `./setup.sh`, `./start.sh`, `./check.sh`
- controlli non distruttivi Unix: `./setup.sh --check-only`, `./start.sh --check-only`





