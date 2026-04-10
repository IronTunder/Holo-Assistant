#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "$SCRIPT_DIR/common.sh"

holo_assistant_on_error() {
    local exit_code="$1"
    local line_no="$2"
    local command_text="$3"
    holo_assistant_error "Start interrotto alla riga $line_no."
    holo_assistant_info "Comando fallito: $command_text"
    exit "$exit_code"
}
trap 'holo_assistant_on_error $? ${LINENO} "$BASH_COMMAND"' ERR

holo_assistant_parse_check_only "$@"
if ((${#HOLO_ASSISTANT_SCRIPT_ARGS[@]} > 0)); then
    holo_assistant_error "Argomenti non supportati: ${HOLO_ASSISTANT_SCRIPT_ARGS[*]}"
    exit 1
fi

ROOT_DIR="$(holo_assistant_root)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend/my-app"
DOCKER_DIR="$ROOT_DIR/docker"
BACKEND_ENV_PATH="$BACKEND_DIR/.env"
FRONTEND_ENV_PATH="$FRONTEND_DIR/.env"
VOSK_ARCHIVE="$FRONTEND_DIR/public/models/$HOLO_ASSISTANT_VOSK_MODEL_ARCHIVE_NAME"
PIPER_VOICE_MODEL="$BACKEND_DIR/app/services/voice_models/$HOLO_ASSISTANT_PIPER_DEFAULT_VOICE_MODEL_FILENAME"
PIPER_VOICE_CONFIG="$BACKEND_DIR/app/services/voice_models/$HOLO_ASSISTANT_PIPER_DEFAULT_VOICE_CONFIG_FILENAME"

printf '========================================\n'
printf '   HOLO-ASSISTANT - Start Unix\n'
printf '========================================\n\n'

if [[ "$HOLO_ASSISTANT_CHECK_ONLY" == "1" ]]; then
    holo_assistant_info "Modalita CheckOnly: nessun container, download, installazione o server verra avviato."
fi

[[ -f "$DOCKER_DIR/docker-compose.yml" ]] || { holo_assistant_error "File docker-compose.yml non trovato in $DOCKER_DIR"; exit 1; }
[[ -d "$BACKEND_DIR" ]] || { holo_assistant_error "Directory backend non trovata: $BACKEND_DIR"; exit 1; }
[[ -d "$FRONTEND_DIR" ]] || { holo_assistant_error "Directory frontend non trovata: $FRONTEND_DIR"; exit 1; }

IP="$(holo_assistant_get_local_ip)"
holo_assistant_info "IP del server: $IP"

holo_assistant_step "[1/3] Verifica prerequisiti e avvio servizi Docker..."
holo_assistant_ensure_docker "$HOLO_ASSISTANT_CHECK_ONLY"
holo_assistant_get_python_command "$HOLO_ASSISTANT_CHECK_ONLY"
holo_assistant_ok "Python disponibile: ${HOLO_ASSISTANT_PYTHON_CMD[*]}"
holo_assistant_require_command node Node.js "$HOLO_ASSISTANT_CHECK_ONLY"
holo_assistant_require_command npm npm "$HOLO_ASSISTANT_CHECK_ONLY"
holo_assistant_ensure_https_certificate "$ROOT_DIR" "$IP" "$HOLO_ASSISTANT_CHECK_ONLY"

holo_assistant_load_ollama_config "$BACKEND_ENV_PATH"
holo_assistant_resolve_ollama_runtime

if [[ "$HOLO_ASSISTANT_CHECK_ONLY" == "1" ]]; then
    holo_assistant_info "CheckOnly: runtime Ollama previsto: native"
    holo_assistant_info "CheckOnly: venv presente: $( [[ -d "$BACKEND_DIR/venv" ]] && printf true || printf false )"
    holo_assistant_info "CheckOnly: node_modules presente: $( [[ -d "$FRONTEND_DIR/node_modules" ]] && printf true || printf false )"
    holo_assistant_info "CheckOnly completato: start.sh e configurazione base sono leggibili."
    exit 0
fi

if [[ ! -f "$BACKEND_ENV_PATH" ]]; then
    holo_assistant_warn "backend/.env non trovato: creo configurazione minima come setup."
    holo_assistant_new_backend_env "$BACKEND_ENV_PATH" "$IP"
fi

DATABASE_PASSWORD="$(holo_assistant_read_env_value "$BACKEND_ENV_PATH" "DATABASE_PASSWORD" || true)"
if [[ -n "${DATABASE_PASSWORD:-}" ]]; then
    export DATABASE_PASSWORD
else
    holo_assistant_export_env_value "$BACKEND_ENV_PATH" "DATABASE_PASSWORD"
fi

(cd "$DOCKER_DIR" && export DATABASE_PASSWORD="$DATABASE_PASSWORD" && holo_assistant_docker_compose -f docker-compose.yml stop ollama >/dev/null 2>&1) || true
(
    cd "$DOCKER_DIR" &&
    export DATABASE_PASSWORD="$DATABASE_PASSWORD" &&
    holo_assistant_run_quiet_checked "Avvio PostgreSQL/Adminer fallito." \
        holo_assistant_docker_compose -f docker-compose.yml up -d postgres adminer
)
sleep 4
holo_assistant_wait_postgres_healthy 40 || true
holo_assistant_wait_postgres 20 || true

holo_assistant_set_env_values "$BACKEND_ENV_PATH" \
    "DATABASE_HOST=127.0.0.1" \
    "ALLOWED_ORIGINS=https://localhost:$HOLO_ASSISTANT_DEFAULT_FRONTEND_PORT,https://$IP:$HOLO_ASSISTANT_DEFAULT_FRONTEND_PORT" \
    "REFRESH_TOKEN_COOKIE_SECURE=true" \
    "REFRESH_TOKEN_COOKIE_SAMESITE=lax"
holo_assistant_ok "Impostazioni HTTPS backend aggiornate."

holo_assistant_ensure_ollama_model 0
holo_assistant_ollama_warmup 0

holo_assistant_step "[2/3] Riparazione minima e avvio backend..."
if [[ ! -x "$BACKEND_DIR/venv/bin/python" ]]; then
    holo_assistant_warn "Ambiente virtuale backend mancante: provo a ricrearlo."
    holo_assistant_ensure_backend_dependencies "$BACKEND_DIR" 0
else
    holo_assistant_ok "Ambiente virtuale backend presente."
fi

VENV_PYTHON="$BACKEND_DIR/venv/bin/python"
if [[ -f "$BACKEND_DIR/scripts/seed_categories.py" ]]; then
    holo_assistant_info "Riallineamento knowledge base tecnica..."
    if (cd "$BACKEND_DIR" && "$VENV_PYTHON" scripts/seed_categories.py); then
        holo_assistant_ok "Knowledge base riallineata."
    else
        holo_assistant_warn "Riallineamento knowledge base non completato."
    fi
fi

if [[ ! -f "$PIPER_VOICE_MODEL" || ! -f "$PIPER_VOICE_CONFIG" ]]; then
    holo_assistant_info "Preparo voce Piper predefinita..."
    if bash "$ROOT_DIR/scripts/unix/prepare_piper_model.sh"; then
        holo_assistant_ok "Modello Piper pronto."
    else
        holo_assistant_warn "Impossibile preparare il modello Piper automaticamente."
    fi
else
    holo_assistant_ok "Modello Piper gia presente."
fi

printf -v BACKEND_COMMAND 'cd %q && venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port %q --ssl-certfile %q --ssl-keyfile %q --no-use-colors' \
    "$BACKEND_DIR" "$HOLO_ASSISTANT_DEFAULT_BACKEND_PORT" "$HOLO_ASSISTANT_CERT_FILE" "$HOLO_ASSISTANT_KEY_FILE"
holo_assistant_start_terminal "Holo-Assistant Backend" "$BACKEND_COMMAND"
holo_assistant_ok "Backend avviato su https://$IP:$HOLO_ASSISTANT_DEFAULT_BACKEND_PORT"

sleep 5

holo_assistant_step "[3/3] Riparazione minima e avvio frontend..."
if [[ ! -f "$VOSK_ARCHIVE" ]]; then
    holo_assistant_info "Modello Vosk mancante: provo a prepararlo."
    if bash "$ROOT_DIR/scripts/unix/prepare_vosk_model.sh"; then
        holo_assistant_ok "Modello Vosk pronto."
    else
        holo_assistant_warn "Impossibile preparare il modello Vosk automaticamente."
    fi
else
    holo_assistant_ok "Modello Vosk gia presente."
fi

cat > "$FRONTEND_ENV_PATH" <<EOF
VITE_API_URL=https://$IP:$HOLO_ASSISTANT_DEFAULT_BACKEND_PORT
VITE_VOSK_MODEL_URL=$HOLO_ASSISTANT_VOSK_MODEL_PUBLIC_URL
EOF
holo_assistant_ok "frontend/my-app/.env aggiornato."

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    holo_assistant_warn "node_modules mancante: provo a reinstallare le dipendenze frontend."
    holo_assistant_ensure_frontend_dependencies "$FRONTEND_DIR" 0
else
    holo_assistant_ok "Dipendenze Node.js gia installate."
fi

printf -v FRONTEND_COMMAND 'cd %q && npm run dev -- --host 0.0.0.0' "$FRONTEND_DIR"
holo_assistant_start_terminal "Holo-Assistant Frontend" "$FRONTEND_COMMAND"
holo_assistant_ok "Frontend avviato su https://$IP:$HOLO_ASSISTANT_DEFAULT_FRONTEND_PORT"

printf '\n========================================\n'
printf '   [OK] SERVIZI AVVIATI\n'
printf '========================================\n\n'
printf 'Apri il frontend da qui:\n'
printf '   - Locale: https://localhost:%s\n' "$HOLO_ASSISTANT_DEFAULT_FRONTEND_PORT"
printf '   - Rete:   https://%s:%s\n\n' "$IP" "$HOLO_ASSISTANT_DEFAULT_FRONTEND_PORT"
printf 'Link tecnici:\n'
printf '   - Backend API: https://%s:%s\n' "$IP" "$HOLO_ASSISTANT_DEFAULT_BACKEND_PORT"
printf '   - API Docs:    https://%s:%s/docs\n' "$IP" "$HOLO_ASSISTANT_DEFAULT_BACKEND_PORT"
printf '   - Adminer DB:  http://localhost:8080\n\n'
printf '[INFO] In sviluppo le chiamate API passano dal frontend tramite proxy Vite.\n'
printf '[INFO] Su browser desktop o mobile di solito basta accettare il certificato del frontend.\n'
printf '[INFO] Se apri il backend direttamente e il browser lo blocca, accetta anche: https://%s:%s/health\n\n' "$IP" "$HOLO_ASSISTANT_DEFAULT_BACKEND_PORT"
printf 'Per fermare il sistema, chiudi le finestre del terminale oppure esegui: cd docker && %s down\n' "${HOLO_ASSISTANT_DOCKER_COMPOSE_CMD[*]}"
