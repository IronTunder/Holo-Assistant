# Third Party Notices

Ultimo aggiornamento: 12 aprile 2026

Questo file raccoglie le note legali e di attribuzione di terze parti rilevanti per Holo-Assistant.

## Frontend e UI

- Parte del frontend deriva da uno scaffold Figma Make.
- Alcuni componenti UI derivano da `shadcn/ui`, distribuito con licenza MIT.
- Il pacchetto `@met4citizen/talkinghead` usato per l'avatar 3D e distribuito con licenza MIT.
- Il pacchetto `vosk-browser` usato per wake-word e STT locale nel browser e distribuito con licenza Apache-2.0.

## Backend e servizi locali

- Holo-Assistant usa PostgreSQL tramite immagine Docker ufficiale `postgres`.
- Adminer viene eseguito tramite immagine Docker ufficiale `adminer`.
- Il runtime AI locale previsto dal progetto e Ollama, soggetto ai termini del progetto upstream.

## Modelli e asset

- I modelli Vosk e Piper restano soggetti alle rispettive licenze upstream e non sono pensati per essere versionati di default nel repository.
- Se vengono aggiunti manualmente modelli o archivi locali, restano sotto i termini dei progetti di origine.

## Riferimenti interni

- Note frontend piu specifiche: `frontend/my-app/ATTRIBUTIONS.md`
- Licenza del repository: `LICENSE`
