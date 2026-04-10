#!/bin/bash
cd "$(dirname "$0")/../../backend"
venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --ssl-certfile ../certs/holo-assistant.crt --ssl-keyfile ../certs/holo-assistant.key
