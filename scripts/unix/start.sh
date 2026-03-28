#!/bin/bash

set -euo pipefail

echo "========================================"
echo "   DITTO - Avvio servizi"
echo "========================================"
echo ""

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_PORT=8000
FRONTEND_PORT=5173
OLLAMA_MODEL="mistral:7b-instruct-v0.3-q4_K_M"

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

IP="$(get_local_ip)"
echo "[INFO] IP del server: $IP"
echo ""

echo "[1/3] Avvio PostgreSQL e Ollama con Docker..."
cd "$ROOT_DIR/docker"
if [ ! -f docker-compose.yml ]; then
    echo "[ERRORE] File docker-compose.yml non trovato in $(pwd)"
    exit 1
fi

docker compose down 2>/dev/null || true
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
fi

echo "Preparazione modello AI: $OLLAMA_MODEL"
if docker exec ditto_ollama ollama list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$OLLAMA_MODEL"; then
    echo "[INFO] Warmup modello AI in corso..."
    if docker exec ditto_ollama ollama run "$OLLAMA_MODEL" "Rispondi solo OK" >/dev/null 2>&1; then
        echo "[OK] Modello AI pronto"
    else
        echo "[AVVISO] Warmup Ollama non completato. Il primo prompt potrebbe essere piu' lento."
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

run_in_terminal "DITTO Backend" "cd '$ROOT_DIR/backend' && source venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port $BACKEND_PORT --no-use-colors"
echo "[OK] Backend avviato su http://$IP:$BACKEND_PORT"
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
VITE_API_URL=http://$IP:$BACKEND_PORT
EOF

if [ ! -d node_modules ]; then
    echo "Installazione dipendenze Node.js..."
    npm install
else
    echo "Dipendenze Node.js gia' installate"
fi

run_in_terminal "DITTO Frontend" "cd '$ROOT_DIR/frontend/my-app' && npm run dev -- --host 0.0.0.0"
echo "[OK] Frontend avviato su http://$IP:$FRONTEND_PORT"
echo ""

cd "$ROOT_DIR"
cat > "$ROOT_DIR/ditto_info.txt" <<EOF
=== DITTO - Informazioni di sistema ===
Data avvio: $(date '+%Y-%m-%d %H:%M:%S')
IP Server: $IP

URL:
- Frontend locale: http://localhost:$FRONTEND_PORT
- Frontend rete: http://$IP:$FRONTEND_PORT
- Backend: http://$IP:$BACKEND_PORT
- API Docs: http://$IP:$BACKEND_PORT/docs

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
echo "Frontend locale: http://localhost:$FRONTEND_PORT"
echo "Frontend rete:   http://$IP:$FRONTEND_PORT"
echo "Backend API:     http://$IP:$BACKEND_PORT"
echo "API Docs:        http://$IP:$BACKEND_PORT/docs"
echo "Adminer DB:      http://localhost:8080"
echo ""
echo "Per fermare il sistema, chiudi le finestre del terminale"
echo "oppure esegui: cd docker && docker compose down"
echo ""
