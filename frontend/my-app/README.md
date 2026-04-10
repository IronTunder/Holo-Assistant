# Frontend Holo-Assistant

Ultimo aggiornamento: 8 aprile 2026

Frontend React/Vite del progetto Holo-Assistant. L'applicazione espone due macro-aree:
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

In sviluppo Vite usa HTTPS se trova `../../certs/holo-assistant.crt` e `../../certs/holo-assistant.key`, cioe i certificati generati dagli script di root. Se questi file mancano, il dev server torna al comportamento standard di Vite.

Crea la build:
```bash
npm run build
```

La build frontend ora esegue due passi:
- `npm run build:legacy-css` genera `public/legacy.css` con Tailwind CLI e `lightningcss`;
- `vite build` produce gli asset finali.

`index.html` collega sempre `legacy.css` all'avvio, poi lo disabilita subito nei browser che supportano i CSS layers. In questo modo i browser moderni usano gli stili principali, mentre quelli piu vecchi hanno un fallback dedicato.

## Configurazione ambiente

Il frontend legge:

```ini
VITE_API_URL=https://{server-ip}:8000
VITE_VOSK_MODEL_URL=/models/vosk-model-small-it-0.22.tar.gz
```

Comportamento attuale di `src/shared/api/config.ts`:
- in sviluppo usa sempre la stessa origin del frontend e lascia a Vite il proxy delle route API;
- `VITE_API_URL` resta il target del proxy dev verso il backend;
- in produzione usa `VITE_API_URL` oppure fallback relativo a `${window.location.origin}/api`.

`VITE_VOSK_MODEL_URL` configura il modello Vosk per la wake-word. Se la variabile manca, `OperatorInterface.tsx` usa il fallback `/models/vosk-model-small-it-0.22.tar.gz`.

Con gli script attuali `VITE_API_URL` viene scritto come `https://{server-ip}:8000`; in sviluppo il browser continua comunque a chiamare `https://{frontend-host}:5173/...`, mentre Vite inoltra al backend in proxy. Questo evita blocchi dovuti al certificato HTTPS del backend sui client LAN. Il backend resta comunque allineato a `ALLOWED_ORIGINS=https://localhost:5173,https://{server-ip}:5173`, `REFRESH_TOKEN_COOKIE_SECURE=true` e `REFRESH_TOKEN_COOKIE_SAMESITE=lax`.

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
- ascolto wake-word locale nel browser con frase `Holo`;
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

## Auth e sessioni

Comportamento attuale:
- l'access token vive nello stato React ed e usato per le chiamate protette;
- il refresh token resta nel cookie HTTP-only del backend;
- `restoreSession()` prova a recuperare la sessione usando `POST /auth/refresh` e poi riallinea i dati utente con `GET /auth/me`;
- `logout()` prova anche a liberare la macchina corrente e, se serve, ritenta dopo un refresh dell'access token.

## File utili

- `src/shared/api/config.ts` centralizza endpoint e base URL.
- `src/features/operator/OperatorInterface.tsx` contiene il flusso principale operatore.
- `src/features/operator/voice/useVoskWakeWord.ts` gestisce wake-word e trascrizione locale.
- `src/features/operator/BadgeReader.tsx` gestisce selezione macchina e accesso.
- `src/features/operator/CredentialsLogin.tsx` gestisce il modal di login credenziali.

## Note operative

- Il frontend assume che backend e auth siano raggiungibili all'host risolto da `VITE_API_URL`.
- In ambiente locale gli script di root e `scripts/windows/start.bat` aggiornano automaticamente `.env`; lo `start` puo lasciare solo `VITE_API_URL`, perche il modello Vosk ha un fallback applicativo.
- Se il problema nasce dal backend HTTPS non trusted sul client, in sviluppo ora le chiamate API passano dal proxy Vite e in genere basta accettare il certificato del frontend.
- Se il backend cambia host o porta, verifica prima `frontend/my-app/.env` e poi `src/shared/api/config.ts`.
- Il modello Vosk locale si prepara con `scripts/windows/prepare_vosk_model.ps1` oppure `bash scripts/unix/prepare_vosk_model.sh`.

## Nota hosting

Il frontend viene avviato dagli script correnti tramite `vite dev`. Per un host sempre acceso o condiviso in produzione interna, la strada consigliata e:

- generare una build con `npm run build`
- servire gli asset statici da un web server o reverse proxy
- lasciare `VITE_API_URL` puntare al backend pubblicato sulla rete interna
