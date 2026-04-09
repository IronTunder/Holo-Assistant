#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "$SCRIPT_DIR/common.sh"

ditto_on_error() {
    local exit_code="$1"
    local line_no="$2"
    local command_text="$3"
    ditto_error "Start interrotto alla riga $line_no."
    ditto_info "Comando fallito: $command_text"
    exit "$exit_code"
}
trap 'ditto_on_error $? ${LINENO} "$BASH_COMMAND"' ERR

ditto_parse_check_only "$@"
if ((${#DITTO_SCRIPT_ARGS[@]} > 0)); then
    ditto_error "Argomenti non supportati: ${DITTO_SCRIPT_ARGS[*]}"
    exit 1
fi

ROOT_DIR="$(ditto_root)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend/my-app"
DOCKER_DIR="$ROOT_DIR/docker"
BACKEND_ENV_PATH="$BACKEND_DIR/.env"
FRONTEND_ENV_PATH="$FRONTEND_DIR/.env"
VOSK_ARCHIVE="$FRONTEND_DIR/public/models/$DITTO_VOSK_MODEL_ARCHIVE_NAME"
PIPER_VOICE_MODEL="$BACKEND_DIR/app/services/voice_models/$DITTO_PIPER_DEFAULT_VOICE_MODEL_FILENAME"
PIPER_VOICE_CONFIG="$BACKEND_DIR/app/services/voice_models/$DITTO_PIPER_DEFAULT_VOICE_CONFIG_FILENAME"

printf '========================================\n'
printf '   DITTO - Start Unix\n'
printf '========================================\n\n'

if [[ "$DITTO_CHECK_ONLY" == "1" ]]; then
    ditto_info "Modalita CheckOnly: nessun container, download, installazione o server verra avviato."
fi

[[ -f "$DOCKER_DIR/docker-compose.yml" ]] || { ditto_error "File docker-compose.yml non trovato in $DOCKER_DIR"; exit 1; }
[[ -d "$BACKEND_DIR" ]] || { ditto_error "Directory backend non trovata: $BACKEND_DIR"; exit 1; }
[[ -d "$FRONTEND_DIR" ]] || { ditto_error "Directory frontend non trovata: $FRONTEND_DIR"; exit 1; }

IP="$(ditto_get_local_ip)"
ditto_info "IP del server: $IP"

ditto_step "[1/3] Verifica prerequisiti e avvio servizi Docker..."
ditto_ensure_docker "$DITTO_CHECK_ONLY"
ditto_get_python_command "$DITTO_CHECK_ONLY"
ditto_ok "Python disponibile: ${DITTO_PYTHON_CMD[*]}"
ditto_require_command node Node.js "$DITTO_CHECK_ONLY"
ditto_require_command npm npm "$DITTO_CHECK_ONLY"
ditto_ensure_https_certificate "$ROOT_DIR" "$IP" "$DITTO_CHECK_ONLY"

ditto_load_ollama_config "$BACKEND_ENV_PATH"
ditto_resolve_ollama_runtime

if [[ "$DITTO_CHECK_ONLY" == "1" ]]; then
    ditto_info "CheckOnly: runtime Ollama previsto: native"
    ditto_info "CheckOnly: venv presente: $( [[ -d "$BACKEND_DIR/venv" ]] && printf true || printf false )"
    ditto_info "CheckOnly: node_modules presente: $( [[ -d "$FRONTEND_DIR/node_modules" ]] && printf true || printf false )"
    ditto_info "CheckOnly completato: start.sh e configurazione base sono leggibili."
    exit 0
fi

if [[ ! -f "$BACKEND_ENV_PATH" ]]; then
    ditto_warn "backend/.env non trovato: creo configurazione minima come setup."
    ditto_new_backend_env "$BACKEND_ENV_PATH" "$IP"
fi

DATABASE_PASSWORD="$(ditto_read_env_value "$BACKEND_ENV_PATH" "DATABASE_PASSWORD" || true)"
if [[ -n "${DATABASE_PASSWORD:-}" ]]; then
    export DATABASE_PASSWORD
else
    ditto_export_env_value "$BACKEND_ENV_PATH" "DATABASE_PASSWORD"
fi

(cd "$DOCKER_DIR" && export DATABASE_PASSWORD="$DATABASE_PASSWORD" && ditto_docker_compose -f docker-compose.yml stop ollama >/dev/null 2>&1) || true
(
    cd "$DOCKER_DIR" &&
    export DATABASE_PASSWORD="$DATABASE_PASSWORD" &&
    ditto_run_quiet_checked "Avvio PostgreSQL/Adminer fallito." \
        ditto_docker_compose -f docker-compose.yml up -d postgres adminer
)
sleep 8
ditto_wait_postgres 20 || true

ditto_set_env_values "$BACKEND_ENV_PATH" \
    "DATABASE_HOST=127.0.0.1" \
    "ALLOWED_ORIGINS=https://localhost:$DITTO_DEFAULT_FRONTEND_PORT,https://$IP:$DITTO_DEFAULT_FRONTEND_PORT" \
    "REFRESH_TOKEN_COOKIE_SECURE=true" \
    "REFRESH_TOKEN_COOKIE_SAMESITE=lax"
ditto_ok "Impostazioni HTTPS backend aggiornate."

ditto_ensure_ollama_model 0
ditto_ollama_warmup 0

ditto_step "[2/3] Riparazione minima e avvio backend..."
if [[ ! -x "$BACKEND_DIR/venv/bin/python" ]]; then
    ditto_warn "Ambiente virtuale backend mancante: provo a ricrearlo."
    ditto_ensure_backend_dependencies "$BACKEND_DIR" 0
else
    ditto_ok "Ambiente virtuale backend presente."
fi

VENV_PYTHON="$BACKEND_DIR/venv/bin/python"
if [[ -f "$BACKEND_DIR/scripts/seed_categories.py" ]]; then
    ditto_info "Riallineamento knowledge base tecnica..."
    if (cd "$BACKEND_DIR" && "$VENV_PYTHON" scripts/seed_categories.py); then
        ditto_ok "Knowledge base riallineata."
    else
        ditto_warn "Riallineamento knowledge base non completato."
    fi
fi

if [[ ! -f "$PIPER_VOICE_MODEL" || ! -f "$PIPER_VOICE_CONFIG" ]]; then
    ditto_info "Preparo voce Piper predefinita..."
    if bash "$ROOT_DIR/scripts/unix/prepare_piper_model.sh"; then
        ditto_ok "Modello Piper pronto."
    else
        ditto_warn "Impossibile preparare il modello Piper automaticamente."
    fi
else
    ditto_ok "Modello Piper gia presente."
fi

printf -v BACKEND_COMMAND 'cd %q && venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port %q --ssl-certfile %q --ssl-keyfile %q --no-use-colors' \
    "$BACKEND_DIR" "$DITTO_DEFAULT_BACKEND_PORT" "$DITTO_CERT_FILE" "$DITTO_KEY_FILE"
ditto_start_terminal "DITTO Backend" "$BACKEND_COMMAND"
ditto_ok "Backend avviato su https://$IP:$DITTO_DEFAULT_BACKEND_PORT"

sleep 5

ditto_step "[3/3] Riparazione minima e avvio frontend..."
if [[ ! -f "$VOSK_ARCHIVE" ]]; then
    ditto_info "Modello Vosk mancante: provo a prepararlo."
    if bash "$ROOT_DIR/scripts/unix/prepare_vosk_model.sh"; then
        ditto_ok "Modello Vosk pronto."
    else
        ditto_warn "Impossibile preparare il modello Vosk automaticamente."
    fi
else
    ditto_ok "Modello Vosk gia presente."
fi

cat > "$FRONTEND_ENV_PATH" <<EOF
VITE_API_URL=https://$IP:$DITTO_DEFAULT_BACKEND_PORT
VITE_VOSK_MODEL_URL=$DITTO_VOSK_MODEL_PUBLIC_URL
EOF
ditto_ok "frontend/my-app/.env aggiornato."

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    ditto_warn "node_modules mancante: provo a reinstallare le dipendenze frontend."
    ditto_ensure_frontend_dependencies "$FRONTEND_DIR" 0
else
    ditto_ok "Dipendenze Node.js gia installate."
fi

printf -v FRONTEND_COMMAND 'cd %q && npm run dev -- --host 0.0.0.0' "$FRONTEND_DIR"
ditto_start_terminal "DITTO Frontend" "$FRONTEND_COMMAND"
ditto_ok "Frontend avviato su https://$IP:$DITTO_DEFAULT_FRONTEND_PORT"

printf '\n========================================\n'
printf '   [OK] SERVIZI AVVIATI\n'
printf '========================================\n\n'
printf 'Apri il frontend da qui:\n'
printf '   - Locale: https://localhost:%s\n' "$DITTO_DEFAULT_FRONTEND_PORT"
printf '   - Rete:   https://%s:%s\n\n' "$IP" "$DITTO_DEFAULT_FRONTEND_PORT"
printf 'Link tecnici:\n'
printf '   - Backend API: https://%s:%s\n' "$IP" "$DITTO_DEFAULT_BACKEND_PORT"
printf '   - API Docs:    https://%s:%s/docs\n' "$IP" "$DITTO_DEFAULT_BACKEND_PORT"
printf '   - Adminer DB:  http://localhost:8080\n\n'
printf '[INFO] In sviluppo le chiamate API passano dal frontend tramite proxy Vite.\n'
printf '[INFO] Su browser desktop o mobile di solito basta accettare il certificato del frontend.\n'
printf '[INFO] Se apri il backend direttamente e il browser lo blocca, accetta anche: https://%s:%s/health\n\n' "$IP" "$DITTO_DEFAULT_BACKEND_PORT"
printf 'Per fermare il sistema, chiudi le finestre del terminale oppure esegui: cd docker && %s down\n' "${DITTO_DOCKER_COMPOSE_CMD[*]}"
