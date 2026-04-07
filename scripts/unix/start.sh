#!/bin/bash

set -euo pipefail

echo "========================================"
echo "   DITTO - Avvio servizi"
echo "========================================"
echo ""

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_PORT=8000
FRONTEND_PORT=5173
CERT_FILE="$ROOT_DIR/certs/ditto.crt"
KEY_FILE="$ROOT_DIR/certs/ditto.key"
OLLAMA_MODEL="mistral:7b-instruct-v0.3-q4_K_M"
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OLLAMA_KEEP_ALIVE="30m"
OLLAMA_TOP_K="20"
OLLAMA_TOP_P="0.8"
OLLAMA_NUM_CTX="2048"
OLLAMA_NUM_THREAD="4"

get_local_ip() {
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -z "$ip" ]; then
        ip="$(ip route get 1 2>/dev/null | awk '{print $NF; exit}')"
    fi
    if [ -z "$ip" ]; then
        ip="localhost"
    fi
    echo "$ip"
}

run_in_terminal() {
    local title="$1"
    local command="$2"

    if command -v gnome-terminal >/dev/null 2>&1; then
        gnome-terminal --title="$title" -- bash -lc "$command; exec bash" &
    elif command -v konsole >/dev/null 2>&1; then
        konsole --new-tab --title "$title" -e bash -lc "$command; exec bash" &
    elif command -v xterm >/dev/null 2>&1; then
        xterm -title "$title" -e bash -lc "$command; exec bash" &
    else
        bash -lc "$command" &
    fi
}

upsert_env_value() {
    local env_path="$1"
    local key="$2"
    local value="$3"
    local temp_path="${env_path}.tmp"

    if [ -f "$env_path" ] && grep -q "^${key}=" "$env_path"; then
        awk -v key="$key" -v value="$value" 'BEGIN { replacement = key "=" value } $0 ~ "^" key "=" { print replacement; next } { print }' "$env_path" > "$temp_path"
    else
        if [ -f "$env_path" ]; then
            cp "$env_path" "$temp_path"
        else
            : > "$temp_path"
        fi
        printf '%s=%s\n' "$key" "$value" >> "$temp_path"
    fi

    mv "$temp_path" "$env_path"
}

IP="$(get_local_ip)"
echo "[INFO] IP del server: $IP"
if [ ! -f "$CERT_FILE" ]; then
    echo "[ERRORE] Certificato HTTPS non trovato: $CERT_FILE"
    exit 1
fi
if [ ! -f "$KEY_FILE" ]; then
    echo "[ERRORE] Chiave HTTPS non trovata: $KEY_FILE"
    exit 1
fi
echo "[INFO] HTTPS attivo con certificato: $CERT_FILE"
echo ""

echo "[1/3] Avvio PostgreSQL e Ollama con Docker..."
cd "$ROOT_DIR/docker"
if [ ! -f docker-compose.yml ]; then
    echo "[ERRORE] File docker-compose.yml non trovato in $(pwd)"
    exit 1
fi

if [ -f "$ROOT_DIR/backend/.env" ]; then
    DATABASE_PASSWORD="$(grep '^DATABASE_PASSWORD=' "$ROOT_DIR/backend/.env" | cut -d'=' -f2- || true)"
    export DATABASE_PASSWORD
fi

if docker compose up -d; then
    echo "[OK] Docker avviato correttamente"
else
    echo "[AVVISO] Impossibile avviare Docker con docker compose."
    echo "[AVVISO] Continuo comunque: assicurati che PostgreSQL e Ollama siano gia' in esecuzione."
fi
echo ""

echo "Attendendo l'avvio di PostgreSQL e Ollama..."
sleep 8

echo "Verifica connessione a PostgreSQL..."
MAX_ATTEMPTS=20
ATTEMPT=1
while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    if docker exec ditto_postgres pg_isready -U postgres >/dev/null 2>&1; then
        echo "[OK] PostgreSQL e' pronto"
        break
    fi

    if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
        echo "[AVVISO] PostgreSQL potrebbe non essere pronto"
        break
    fi

    ATTEMPT=$((ATTEMPT + 1))
    sleep 2
done
echo ""

if [ -f "$ROOT_DIR/backend/.env" ]; then
    env_model="$(grep '^OLLAMA_MODEL=' "$ROOT_DIR/backend/.env" | cut -d'=' -f2- || true)"
    if [ -n "$env_model" ]; then
        OLLAMA_MODEL="$env_model"
    fi
    env_base_url="$(grep '^OLLAMA_BASE_URL=' "$ROOT_DIR/backend/.env" | cut -d'=' -f2- || true)"
    if [ -n "$env_base_url" ]; then
        OLLAMA_BASE_URL="$env_base_url"
    fi
    env_keep_alive="$(grep '^OLLAMA_KEEP_ALIVE=' "$ROOT_DIR/backend/.env" | cut -d'=' -f2- || true)"
    if [ -n "$env_keep_alive" ]; then
        OLLAMA_KEEP_ALIVE="$env_keep_alive"
    fi
    env_top_k="$(grep '^OLLAMA_TOP_K=' "$ROOT_DIR/backend/.env" | cut -d'=' -f2- || true)"
    if [ -n "$env_top_k" ]; then
        OLLAMA_TOP_K="$env_top_k"
    fi
    env_top_p="$(grep '^OLLAMA_TOP_P=' "$ROOT_DIR/backend/.env" | cut -d'=' -f2- || true)"
    if [ -n "$env_top_p" ]; then
        OLLAMA_TOP_P="$env_top_p"
    fi
    env_num_ctx="$(grep '^OLLAMA_NUM_CTX=' "$ROOT_DIR/backend/.env" | cut -d'=' -f2- || true)"
    if [ -n "$env_num_ctx" ]; then
        OLLAMA_NUM_CTX="$env_num_ctx"
    fi
    env_num_thread="$(grep '^OLLAMA_NUM_THREAD=' "$ROOT_DIR/backend/.env" | cut -d'=' -f2- || true)"
    if [ -n "$env_num_thread" ]; then
        OLLAMA_NUM_THREAD="$env_num_thread"
    fi
fi

upsert_env_value "$ROOT_DIR/backend/.env" "ALLOWED_ORIGINS" "https://localhost:$FRONTEND_PORT,https://$IP:$FRONTEND_PORT"
upsert_env_value "$ROOT_DIR/backend/.env" "DATABASE_HOST" "127.0.0.1"
upsert_env_value "$ROOT_DIR/backend/.env" "REFRESH_TOKEN_COOKIE_SECURE" "true"
upsert_env_value "$ROOT_DIR/backend/.env" "REFRESH_TOKEN_COOKIE_SAMESITE" "lax"
echo "[OK] Impostazioni HTTPS backend aggiornate"

echo "Preparazione modello AI: $OLLAMA_MODEL"
if docker exec ditto_ollama ollama list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$OLLAMA_MODEL"; then
    echo "[INFO] Attendo che Ollama risponda su $OLLAMA_BASE_URL..."
    ollama_ready=false
    for attempt in $(seq 1 30); do
        if curl -fsS "$OLLAMA_BASE_URL/api/tags" >/dev/null 2>&1; then
            ollama_ready=true
            break
        fi
        sleep 2
    done

    if [ "$ollama_ready" = false ]; then
        echo "[AVVISO] Ollama non risponde ancora all'endpoint /api/tags"
    else
        echo "[INFO] Warmup modello AI in corso..."
        if curl -fsS "$OLLAMA_BASE_URL/api/generate" \
            -H "Content-Type: application/json" \
            -d "{\"model\":\"$OLLAMA_MODEL\",\"prompt\":\"Rispondi solo OK\",\"stream\":false,\"keep_alive\":\"$OLLAMA_KEEP_ALIVE\",\"options\":{\"temperature\":0,\"top_k\":$OLLAMA_TOP_K,\"top_p\":$OLLAMA_TOP_P,\"num_predict\":12,\"num_ctx\":$OLLAMA_NUM_CTX,\"num_thread\":$OLLAMA_NUM_THREAD}}" >/dev/null 2>&1; then
            echo "[OK] Modello AI pronto"
        else
            echo "[AVVISO] Warmup Ollama non completato. Il primo prompt potrebbe essere piu' lento."
        fi
    fi
else
    echo "[AVVISO] Modello $OLLAMA_MODEL non trovato nel container Ollama"
    echo "[AVVISO] Esegui setup.sh oppure: docker exec ditto_ollama ollama pull $OLLAMA_MODEL"
fi
echo ""

echo "[2/3] Avvio backend FastAPI..."
cd "$ROOT_DIR/backend"
if [ ! -d venv ]; then
    echo "[ERRORE] Ambiente virtuale non trovato in $(pwd)/venv"
    echo "[INFO] Esegui prima setup.sh"
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "[ERRORE] Python3 non trovato. Installa Python prima di procedere."
    exit 1
fi

run_in_terminal "DITTO Backend" "cd '$ROOT_DIR/backend' && source venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port $BACKEND_PORT --ssl-certfile ../certs/ditto.crt --ssl-keyfile ../certs/ditto.key --no-use-colors"
echo "[OK] Backend avviato su https://$IP:$BACKEND_PORT"
echo ""

echo "Attendendo l'avvio del backend..."
sleep 5

echo "[3/3] Avvio frontend..."
cd "$ROOT_DIR/frontend/my-app"

if ! command -v node >/dev/null 2>&1; then
    echo "[ERRORE] Node.js non trovato. Installa Node.js prima di procedere."
    exit 1
fi

cat > .env <<EOF
VITE_API_URL=https://$IP:$BACKEND_PORT
EOF

if [ ! -d node_modules ]; then
    echo "Installazione dipendenze Node.js..."
    npm install
else
    echo "Dipendenze Node.js gia' installate"
fi

run_in_terminal "DITTO Frontend" "cd '$ROOT_DIR/frontend/my-app' && npm run dev -- --host 0.0.0.0"
echo "[OK] Frontend avviato su https://$IP:$FRONTEND_PORT"
echo ""

cd "$ROOT_DIR"
cat > "$ROOT_DIR/ditto_info.txt" <<EOF
=== DITTO - Informazioni di sistema ===
Data avvio: $(date '+%Y-%m-%d %H:%M:%S')
IP Server: $IP

URL:
- Frontend locale: https://localhost:$FRONTEND_PORT
- Frontend rete: https://$IP:$FRONTEND_PORT
- Backend: https://$IP:$BACKEND_PORT
- API Docs: https://$IP:$BACKEND_PORT/docs

Comandi utili:
- Ferma container: cd docker && docker compose down
- Log container: docker compose logs -f
EOF

echo "[OK] Informazioni salvate in: $ROOT_DIR/ditto_info.txt"
echo ""
echo "========================================"
echo "   [OK] SERVIZI AVVIATI"
echo "========================================"
echo ""
echo "Frontend locale: https://localhost:$FRONTEND_PORT"
echo "Frontend rete:   https://$IP:$FRONTEND_PORT"
echo "Backend API:     https://$IP:$BACKEND_PORT"
echo "API Docs:        https://$IP:$BACKEND_PORT/docs"
echo "Adminer DB:      http://localhost:8080"
echo ""
echo "[INFO] Su dispositivi mobile potrebbe comparire un avviso certificato."
echo "[INFO] Se le API non rispondono, apri e accetta anche: https://$IP:$BACKEND_PORT/health"
echo ""
echo "Per fermare il sistema, chiudi le finestre del terminale"
echo "oppure esegui: cd docker && docker compose down"
echo ""
