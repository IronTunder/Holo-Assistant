# Frontend Ditto

Ultimo aggiornamento: 7 aprile 2026

Frontend React/Vite del progetto Ditto. L'applicazione espone due macro-aree:
- esperienza operatore su `/`;
- area amministrativa su `/admin-login` e `/admin`.

## Stack

- React
- React Router
- Vite
- Tailwind CSS
- Radix UI
- Motion
- TalkingHead per avatar 3D
- vosk-browser per wake-word e STT locale nel browser

## Comandi

Installa le dipendenze:
```bash
npm install
```

Avvia il frontend in sviluppo:
```bash
npm run dev -- --host 0.0.0.0
```

Crea la build:
```bash
npm run build
```

## Configurazione ambiente

Il frontend legge:

```ini
VITE_API_URL=http://{server-ip}:8000
VITE_VOSK_MODEL_URL=/models/vosk-model-small-it-0.22.tar.gz
```

Comportamento attuale di `src/shared/api/config.ts`:
- in sviluppo usa `VITE_API_URL` se presente;
- mantiene porta e path configurati;
- riallinea l'hostname a `window.location.hostname` per mantenere coerenti host e cookie auth quando il frontend viene aperto da altri dispositivi o dopo i reload;
- in produzione usa `VITE_API_URL` oppure fallback relativo a `${window.location.origin}/api`.

`VITE_VOSK_MODEL_URL` configura il modello Vosk per la wake-word. Se la variabile manca, `OperatorInterface.tsx` usa il fallback `/models/vosk-model-small-it-0.22.tar.gz`.

## Struttura principale

- `src/app` contiene root, router, route protection e bootstrap applicativo.
- `src/features/operator` contiene interfaccia operatore, badge reader, login credenziali, avatar e logica della console.
- `src/features/admin` contiene login admin, dashboard e strumenti CRUD.
- `src/shared` contiene API client, auth context e componenti UI condivisi.

Routing attuale:
- `/` interfaccia operatore
- `/admin-login` login amministratore
- `/admin` dashboard protetta

## Flusso operatore

L'interfaccia operatore e pensata per schermi orizzontali e uso rapido in postazione.

Passi principali:
- caricamento macchine disponibili tramite `GET /machines/available`;
- selezione della macchina dal pannello di accesso;
- login via `POST /auth/badge-login` oppure `POST /auth/credentials-login`;
- apertura della console operatore con avatar, stato sessione e box domanda;
- ascolto wake-word locale nel browser con frase `Ehi Ditto`;
- invio domande a `POST /api/interactions/ask`;
- eventuale riproduzione TTS tramite `POST /tts/synthesize`.

Comportamenti utente rilevanti:
- layout a due colonne con avatar a sinistra e console a destra;
- risposta digitata progressivamente nella console senza far scorrere la pagina intera;
- opzioni di chiarimento quando la knowledge base richiede disambiguazione;
- follow-up finale per chiedere se il problema e stato risolto;
- azioni rapide sempre visibili nella parte bassa della console.

## Sessione operatore e protezione macchina

Una sessione operatore e sempre legata a una macchina.

Protezione attuale:
- richiesta token SSE via `POST /auth/sse-token`;
- ascolto eventi via `GET /auth/session-events`;
- fallback automatico su `GET /auth/session-status` quando SSE non e disponibile.

Eventi o motivi di invalidazione gestiti lato frontend:
- `machine_released`
- `machine_reassigned`
- `machine_not_found`

Quando la sessione diventa invalida il frontend:
- chiude la connessione attiva;
- esegue logout;
- mostra una notifica temporanea di disconnessione macchina.

## AI, chiarimenti e TTS

La UI operatore gestisce tre esiti principali della risposta:
- `answer`
- `clarification`
- `fallback`

Metadati rilevanti ricevuti dal backend:
- `reason_code`
- `confidence`
- `clarification_options`
- riferimenti opzionali a categoria e knowledge item

Per la voce:
- il frontend prova a sintetizzare il testo;
- se l'avatar puo gestire il parlato, usa playback sincronizzato;
- altrimenti usa audio fallback.

## File utili

- `src/shared/api/config.ts` centralizza endpoint e base URL.
- `src/features/operator/OperatorInterface.tsx` contiene il flusso principale operatore.
- `src/features/operator/voice/useVoskWakeWord.ts` gestisce wake-word e trascrizione locale.
- `src/features/operator/BadgeReader.tsx` gestisce selezione macchina e accesso.
- `src/features/operator/CredentialsLogin.tsx` gestisce il modal di login credenziali.

## Note operative

- Il frontend assume che backend e auth siano raggiungibili all'host risolto da `VITE_API_URL`.
- In ambiente locale gli script di root e `scripts/windows/start.bat` aggiornano automaticamente `.env`; lo `start` puo lasciare solo `VITE_API_URL`, perche il modello Vosk ha un fallback applicativo.
- Se il backend cambia host o porta, verifica prima `frontend/my-app/.env` e poi `src/shared/api/config.ts`.
- Il modello Vosk locale si prepara con `scripts/windows/prepare_vosk_model.ps1` oppure `bash scripts/unix/prepare_vosk_model.sh`.

## Nota hosting

Il frontend viene avviato dagli script correnti tramite `vite dev`. Per un host sempre acceso o condiviso in produzione interna, la strada consigliata e:

- generare una build con `npm run build`
- servire gli asset statici da un web server o reverse proxy
- lasciare `VITE_API_URL` puntare al backend pubblicato sulla rete interna
