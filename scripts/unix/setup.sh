#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "$SCRIPT_DIR/common.sh"

ditto_on_error() {
    local exit_code="$1"
    local line_no="$2"
    local command_text="$3"
    ditto_error "Setup interrotto alla riga $line_no."
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
printf '   DITTO - Setup Unix\n'
printf '========================================\n\n'

if [[ "$DITTO_CHECK_ONLY" == "1" ]]; then
    ditto_info "Modalita CheckOnly: nessun container, download, installazione o server verra avviato."
fi

[[ -f "$DOCKER_DIR/docker-compose.yml" ]] || { ditto_error "File docker-compose.yml non trovato in $DOCKER_DIR"; exit 1; }
[[ -d "$BACKEND_DIR" ]] || { ditto_error "Directory backend non trovata: $BACKEND_DIR"; exit 1; }
[[ -d "$FRONTEND_DIR" ]] || { ditto_error "Directory frontend non trovata: $FRONTEND_DIR"; exit 1; }

IP="$(ditto_get_local_ip)"
ditto_info "IP del server: $IP"

ditto_step "[1/5] Verifica prerequisiti e HTTPS..."
ditto_ensure_docker "$DITTO_CHECK_ONLY"
ditto_get_python_command "$DITTO_CHECK_ONLY"
ditto_ok "Python disponibile: ${DITTO_PYTHON_CMD[*]}"
ditto_ensure_frontend_dependencies "$FRONTEND_DIR" "$DITTO_CHECK_ONLY"
ditto_ensure_https_certificate "$ROOT_DIR" "$IP" "$DITTO_CHECK_ONLY"

ditto_load_ollama_config "$BACKEND_ENV_PATH"
ditto_resolve_ollama_runtime

if [[ "$DITTO_CHECK_ONLY" == "1" ]]; then
    ditto_info "CheckOnly: runtime Ollama previsto: native"
    ditto_info "CheckOnly completato: setup.sh e configurazione base sono leggibili."
    exit 0
fi

ditto_new_backend_env "$BACKEND_ENV_PATH" "$IP"
ditto_export_env_value "$BACKEND_ENV_PATH" "DATABASE_PASSWORD"

ditto_step "[2/5] Avvio PostgreSQL e Ollama..."
(cd "$DOCKER_DIR" && export DATABASE_PASSWORD="$DATABASE_PASSWORD" && ditto_docker_compose -f docker-compose.yml down >/dev/null 2>&1) || true
(cd "$DOCKER_DIR" && export DATABASE_PASSWORD="$DATABASE_PASSWORD" && ditto_docker_compose -f docker-compose.yml stop ollama >/dev/null 2>&1) || true
(
    cd "$DOCKER_DIR" &&
    export DATABASE_PASSWORD="$DATABASE_PASSWORD" &&
    ditto_run_quiet_checked "Avvio PostgreSQL/Adminer fallito." \
        ditto_docker_compose -f docker-compose.yml up -d postgres adminer
)
sleep 8
ditto_wait_postgres 30 || true
ditto_ensure_ollama_model 0

ditto_step "[3/5] Configurazione backend e database..."
ditto_ok "backend/.env creato."
ADMIN_PASSWORD="$(ditto_read_env_value "$BACKEND_ENV_PATH" "ADMIN_PASSWORD" || true)"
if [[ -n "${ADMIN_PASSWORD:-}" ]]; then
    ditto_info "Credenziali admin iniziali: admin / $ADMIN_PASSWORD"
fi

ditto_ensure_backend_dependencies "$BACKEND_DIR" 0
VENV_PYTHON="$BACKEND_DIR/venv/bin/python"

if [[ -f "$BACKEND_DIR/scripts/init_db.py" ]]; then
    ditto_info "Creo tabelle database..."
    (cd "$BACKEND_DIR" && "$VENV_PYTHON" scripts/init_db.py)
else
    ditto_warn "scripts/init_db.py non trovato."
fi

if [[ -f "$BACKEND_DIR/scripts/populate.py" ]]; then
    ditto_info "Popolo database con dati dimostrativi per verifica setup..."
    (
        cd "$BACKEND_DIR"
        DITTO_ALLOW_DEMO_SEED=true "$VENV_PYTHON" scripts/populate.py
    )
else
    ditto_warn "scripts/populate.py non trovato."
fi

if [[ -f "$BACKEND_DIR/scripts/seed_categories.py" ]]; then
    ditto_info "Seed categorie e risposte per AI..."
    (cd "$BACKEND_DIR" && "$VENV_PYTHON" scripts/seed_categories.py)
else
    ditto_warn "scripts/seed_categories.py non trovato."
fi

if [[ ! -f "$PIPER_VOICE_MODEL" || ! -f "$PIPER_VOICE_CONFIG" ]]; then
    ditto_info "Preparo voce Piper predefinita..."
    bash "$ROOT_DIR/scripts/unix/prepare_piper_model.sh"
else
    ditto_ok "Modello Piper gia presente."
fi

ditto_step "[4/5] Configurazione frontend..."
if [[ ! -f "$VOSK_ARCHIVE" ]]; then
    ditto_info "Preparo modello wake-word Vosk..."
    bash "$ROOT_DIR/scripts/unix/prepare_vosk_model.sh"
else
    ditto_ok "Modello Vosk gia presente."
fi

cat > "$FRONTEND_ENV_PATH" <<EOF
VITE_API_URL=https://$IP:$DITTO_DEFAULT_BACKEND_PORT
VITE_VOSK_MODEL_URL=$DITTO_VOSK_MODEL_PUBLIC_URL
EOF
ditto_ok "frontend/my-app/.env creato."
ditto_ensure_frontend_dependencies "$FRONTEND_DIR" 0

ditto_step "[5/5] Avvio backend e frontend..."
printf -v BACKEND_COMMAND 'cd %q && venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port %q --ssl-certfile %q --ssl-keyfile %q --no-use-colors' \
    "$BACKEND_DIR" "$DITTO_DEFAULT_BACKEND_PORT" "$DITTO_CERT_FILE" "$DITTO_KEY_FILE"
ditto_start_terminal "DITTO Backend" "$BACKEND_COMMAND"
ditto_ok "Backend avviato su https://$IP:$DITTO_DEFAULT_BACKEND_PORT"

sleep 5
printf -v FRONTEND_COMMAND 'cd %q && npm run dev -- --host 0.0.0.0' "$FRONTEND_DIR"
ditto_start_terminal "DITTO Frontend" "$FRONTEND_COMMAND"
ditto_ok "Frontend avviato su https://$IP:$DITTO_DEFAULT_FRONTEND_PORT"

printf '\n========================================\n'
printf '   [OK] SISTEMA AVVIATO CON SUCCESSO!\n'
printf '========================================\n\n'
printf 'Apri il frontend da qui:\n'
printf '   - Locale: https://localhost:%s\n' "$DITTO_DEFAULT_FRONTEND_PORT"
printf '   - Rete:   https://%s:%s\n\n' "$IP" "$DITTO_DEFAULT_FRONTEND_PORT"
printf 'Link tecnici:\n'
printf '   - Backend API: https://%s:%s\n' "$IP" "$DITTO_DEFAULT_BACKEND_PORT"
printf '   - API Docs:    https://%s:%s/docs\n' "$IP" "$DITTO_DEFAULT_BACKEND_PORT"
printf '   - Adminer DB:  http://localhost:8080\n\n'
printf 'Credenziali di test:\n'
printf '   - Username: Mario Rossi / Luigi Verdi / Anna Bianchi / Marco Neri\n'
printf '   - Password: password123\n\n'
printf '[INFO] In sviluppo le chiamate API passano dal frontend tramite proxy Vite.\n'
printf '[INFO] Su browser desktop o mobile di solito basta accettare il certificato del frontend.\n'
printf '[INFO] Se apri il backend direttamente e il browser lo blocca, accetta anche: https://%s:%s/health\n\n' "$IP" "$DITTO_DEFAULT_BACKEND_PORT"
printf 'Per fermare il sistema, chiudi le finestre del terminale o premi Ctrl+C.\n'
printf '========================================\n'
