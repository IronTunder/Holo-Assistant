#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend/my-app"
BACKEND_PYTHON="$BACKEND_DIR/venv/bin/python"

printf '========================================\n'
printf '   HOLO-ASSISTANT - Check Unix\n'
printf '========================================\n\n'

if [[ ! -x "$BACKEND_PYTHON" ]]; then
    printf '[ERRORE] Virtualenv backend non trovato: %s\n' "$BACKEND_PYTHON" >&2
    exit 1
fi

printf '[1/2] Eseguo pytest backend...\n'
(
    cd "$BACKEND_DIR"
    "$BACKEND_PYTHON" -m pytest
)

printf '\n[2/2] Eseguo smoke build frontend...\n'
(
    cd "$FRONTEND_DIR"
    npm run smoke:build
)

printf '\n[OK] Controlli completati.\n'
