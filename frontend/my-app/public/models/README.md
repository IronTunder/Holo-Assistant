# Modelli Vosk

Questa cartella serve asset STT statici al frontend.

Il file atteso di default e:

```text
vosk-model-small-it-0.22.tar.gz
```

Non committare archivi o cartelle modello: sono asset locali pesanti. Per prepararli usa:

```powershell
scripts\windows\prepare_vosk_model.ps1
```

oppure:

```bash
bash scripts/unix/prepare_vosk_model.sh
```

Per usare un URL diverso imposta `VITE_VOSK_MODEL_URL` in `frontend/my-app/.env`.
