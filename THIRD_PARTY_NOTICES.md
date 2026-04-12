# Note Su Licenza E Copyright Di Terze Parti

Ultimo aggiornamento: 12 aprile 2026

## Licenza del progetto

Salvo diversa indicazione, il codice sorgente originale di questo repository e distribuito sotto licenza [MIT](./LICENSE).

Copyright (c) 2026 Contributors to Progetto Holo-Assistant.

## Materiali e componenti terzi rilevanti

Questo repository include o utilizza componenti di terze parti che restano soggetti ai rispettivi termini di licenza.

### Frontend scaffold e componenti UI

- Parti del frontend derivano da uno scaffold Figma Make.
- Alcuni componenti UI sono derivati da [shadcn/ui](https://ui.shadcn.com/), distribuito sotto licenza MIT.
- Riferimento locale: `frontend/my-app/ATTRIBUTIONS.md`.

### Dipendenze frontend installate tramite npm

- `@met4citizen/talkinghead`: licenza MIT.
- `vosk-browser`: licenza Apache-2.0.

Le informazioni sopra riflettono il lockfile versionato in `frontend/my-app/package-lock.json`.

### Modelli vocali Piper inclusi nel repository

- La directory `backend/app/services/voice_models` contiene materiale upstream Piper e modelli vocali associati.
- Il file `backend/app/services/voice_models/README.md` dichiara `license: mit`.
- I singoli modelli possono includere file `MODEL_CARD` o metadati aggiuntivi da conservare insieme agli asset.

### Modelli Vosk

- I modelli Vosk usati dal frontend non sono pensati per essere committati di default.
- La cartella `frontend/my-app/public/models` contiene solo istruzioni operative; gli archivi modello, se aggiunti localmente, restano soggetti ai termini del progetto upstream da cui sono stati scaricati.

## Regole pratiche per il progetto

- Non rimuovere avvisi di copyright o file di licenza dai materiali terzi redistribuiti.
- Se vengono aggiunti nuovi asset binari, font, immagini, modelli ML o script copiati da terzi, aggiornare questo file e l'eventuale file di attribuzioni locale.
- Prima di una redistribuzione esterna del progetto, verificare in particolare gli asset non generati internamente come modelli vocali, avatar 3D, immagini e dataset.
