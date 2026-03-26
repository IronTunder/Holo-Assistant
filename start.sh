#!/bin/bash

################################################################################
# Progetto Ditto - Script Avvio Servizi
################################################################################
# Avvia il backend e frontend quando il database è già inizializzato
################################################################################

set -euo pipefail

# Colori per output
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; BOLD=''; NC=''
fi

# Variabili
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-mistral}"
OLLAMA_CONTAINER_NAME="${OLLAMA_CONTAINER_NAME:-ditto_ollama}"
IP=""

# Funzioni di logging
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_ok() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[AVVISO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERRORE]${NC} $1"
}

log_step() {
    echo ""
    echo -e "${CYAN}${BOLD}[FASE $1]${NC} $2"
}

# Verifica se una porta è disponibile
is_port_available() {
    local port="$1"
    
    # Usa netcat se disponibile
    if command -v nc >/dev/null 2>&1; then
        ! nc -z localhost "$port" 2>/dev/null
    else
        # Alternativa con Python
        python3 -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(('0.0.0.0', $port))
    print('available')
except OSError:
    print('in_use')
finally:
    s.close()
" 2>/dev/null | grep -q "available"
    fi
}

# Ottieni IP locale
get_local_ip() {
    local ip
    
    # Prova diversi metodi per ottenere l'IP
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    
    if [ -z "$ip" ] || [ "$ip" = "127.0.0.1" ]; then
        ip=$(ip route get 1 2>/dev/null | awk '{print $NF;exit}' 2>/dev/null)
    fi
    
    if [ -z "$ip" ]; then
        ip=$(ifconfig 2>/dev/null | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -n1)
    fi
    
    [ -z "$ip" ] && ip="localhost"
    echo "$ip"
}

ensure_ollama_model() {
    log_info "Verifico Ollama e modello $OLLAMA_MODEL..."
    local max_attempts=45
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if docker exec "$OLLAMA_CONTAINER_NAME" ollama list >/dev/null 2>&1; then
            log_ok "Ollama è pronto"
            break
        fi

        if [ $attempt -eq $max_attempts ]; then
            log_warning "Ollama non è diventato disponibile in tempo"
            return 1
        fi

        printf "."
        sleep 2
        ((attempt++))
    done
    echo ""

    if docker exec "$OLLAMA_CONTAINER_NAME" ollama list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$OLLAMA_MODEL"; then
        log_ok "Modello $OLLAMA_MODEL già presente"
    else
        log_info "Scarico modello $OLLAMA_MODEL..."
        if docker exec "$OLLAMA_CONTAINER_NAME" ollama pull "$OLLAMA_MODEL"; then
            log_ok "Modello $OLLAMA_MODEL scaricato"
        else
            log_warning "Download del modello $OLLAMA_MODEL fallito"
            return 1
        fi
    fi

    return 0
}

# Header
echo ""
echo "========================================"
echo "  Progetto Ditto - Avvio Servizi"
echo "========================================"
echo ""
log_info "Cartella base: $BASE_DIR"

# Ottieni IP
IP=$(get_local_ip)
log_info "IP locale: $IP"

################################################################################
# 1. AVVIO DOCKER (PostgreSQL)
################################################################################

log_step "1" "Verifica Docker e PostgreSQL..."
echo ""

# Verifica se Docker è installato
if ! command -v docker >/dev/null 2>&1; then
    log_warning "Docker non trovato. Continuo senza container..."
    log_info "Assicurati che PostgreSQL sia in esecuzione sulla macchina!"
    sleep 2
else
    log_ok "Docker trovato: $(docker --version)"
    log_info "Avvio PostgreSQL tramite docker-compose..."
    
    cd "$BASE_DIR/docker" || {
        log_error "Directory docker non trovata!"
        exit 1
    }
    
    # Ferma eventuali container esistenti
    log_info "Fermo container esistenti..."
    if docker compose version >/dev/null 2>&1; then
        docker compose down 2>/dev/null || true
        docker compose up -d
    else
        docker-compose down 2>/dev/null || true
        docker-compose up -d
    fi
    
    if [ $? -ne 0 ]; then
        log_warning "Impossibile avviare docker-compose."
        log_info "Assicurati che Docker Desktop sia in esecuzione."
        sleep 2
    else
        log_ok "Container avviati"
        
        # Attendi che PostgreSQL sia pronto
        log_info "Attendo che PostgreSQL sia pronto..."
        max_attempts=30
        attempt=1
        
        while [ $attempt -le $max_attempts ]; do
            if docker ps 2>/dev/null | grep -q postgres; then
                if docker exec ditto_postgres pg_isready -U postgres >/dev/null 2>&1; then
                    log_ok "PostgreSQL è pronto"
                    break
                fi
            fi
            
            if [ $attempt -eq $max_attempts ]; then
                log_warning "PostgreSQL potrebbe non essere pronto"
            fi
            
            printf "."
            sleep 2
            ((attempt++))
        done
        echo ""

        ensure_ollama_model || log_warning "Ollama disponibile senza garanzia che il modello $OLLAMA_MODEL sia pronto"
    fi
fi

################################################################################
# 2. AVVIO BACKEND
################################################################################

log_step "2" "Avvio Backend FastAPI..."
echo ""

cd "$BASE_DIR/backend" || {
    log_error "Directory backend non trovata!"
    exit 1
}

# Verifica se Python è installato
if ! command -v python3 >/dev/null 2>&1; then
    log_error "Python3 non trovato. Installa Python prima di procedere."
    exit 1
fi

log_ok "Python3 trovato: $(python3 --version)"

# Verifica se venv esiste
if [ ! -d "venv" ]; then
    log_warning "Ambiente virtuale non trovato. Creazione in corso..."
    python3 -m venv venv
fi

# Attiva ambiente virtuale
source venv/bin/activate

# Installa dipendenze se necessario
if [ -f "requirements.txt" ]; then
    log_info "Verifica dipendenze Python..."
    pip install -q -r requirements.txt 2>/dev/null || {
        log_warning "Problemi con l'installazione delle dipendenze"
    }
fi

# Avvia il server in una nuova finestra solo se la porta è libera
if is_port_available "$BACKEND_PORT"; then
    log_ok "Avvio server backend su http://$IP:$BACKEND_PORT"

    # Crea script temporaneo per avviare il backend
    BACKEND_SCRIPT="$BASE_DIR/start_backend_$$.sh"
    cat > "$BACKEND_SCRIPT" << EOF
#!/bin/bash
cd "$BASE_DIR/backend"
source venv/bin/activate
echo "Backend Ditto in esecuzione su http://0.0.0.0:$BACKEND_PORT"
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port $BACKEND_PORT --no-use-colors
echo ""
echo "Backend terminato. Premi INVIO per chiudere..."
read
EOF
    chmod +x "$BACKEND_SCRIPT"

    # Avvia in una nuova finestra di terminale
    if command -v gnome-terminal >/dev/null 2>&1; then
        gnome-terminal --title="Ditto Backend Server" -- bash -c "$BACKEND_SCRIPT; rm -f $BACKEND_SCRIPT; exec bash" &
    elif command -v konsole >/dev/null 2>&1; then
        konsole --new-tab --title "Ditto Backend Server" -e bash -c "$BACKEND_SCRIPT; rm -f $BACKEND_SCRIPT; exec bash" &
    elif command -v xterm >/dev/null 2>&1; then
        xterm -title "Ditto Backend Server" -e bash -c "$BACKEND_SCRIPT; rm -f $BACKEND_SCRIPT; exec bash" &
    elif command -v terminator >/dev/null 2>&1; then
        terminator --title="Ditto Backend Server" -e "$BACKEND_SCRIPT" &
    else
        log_warning "Nessun terminale grafico trovato. Avvio in background..."
        "$BACKEND_SCRIPT" &
    fi
else
    log_warning "Porta $BACKEND_PORT già in uso: backend non avviato per evitare istanze duplicate."
    log_info "Se Ditto è già attivo, puoi usare http://$IP:$BACKEND_PORT"
    log_info "Se vuoi usare un'altra porta: BACKEND_PORT=8001 ./start.sh"
fi

# Attendi un momento per lo startup
sleep 3

################################################################################
# 3. AVVIO FRONTEND
################################################################################

log_step "3" "Avvio Frontend (React + Vite)..."
echo ""

cd "$BASE_DIR/frontend/my-app" || {
    log_error "Directory frontend non trovata!"
    exit 1
}

# Verifica se Node.js è installato
if ! command -v node >/dev/null 2>&1; then
    log_error "Node.js non trovato. Installa Node.js prima di procedere."
    exit 1
fi

log_ok "Node.js trovato: $(node --version)"
log_ok "npm trovato: $(npm --version)"

# Installa dipendenze se necessario
if [ ! -d "node_modules" ]; then
    log_warning "node_modules non trovato. Installazione in corso (potrebbe richiedere tempo)..."
    npm install
    log_ok "Dipendenze installate"
fi

# Verifica .env
if [ ! -f ".env" ]; then
    log_info "Creazione file .env con VITE_API_URL=http://$IP:$BACKEND_PORT"
    echo "VITE_API_URL=http://$IP:$BACKEND_PORT" > .env
fi

# Avvia il server di sviluppo in una nuova finestra solo se la porta è libera
if is_port_available "$FRONTEND_PORT"; then
    log_ok "Avvio dev server frontend su http://localhost:$FRONTEND_PORT"

    # Crea script temporaneo per avviare il frontend
    FRONTEND_SCRIPT="$BASE_DIR/start_frontend_$$.sh"
    cat > "$FRONTEND_SCRIPT" << EOF
#!/bin/bash
cd "$BASE_DIR/frontend/my-app"
echo "Frontend Ditto in esecuzione su http://0.0.0.0:$FRONTEND_PORT"
npm run dev -- --host 0.0.0.0
echo ""
echo "Frontend terminato. Premi INVIO per chiudere..."
read
EOF
    chmod +x "$FRONTEND_SCRIPT"

    # Avvia in una nuova finestra di terminale
    if command -v gnome-terminal >/dev/null 2>&1; then
        gnome-terminal --title="Ditto Frontend Dev Server" -- bash -c "$FRONTEND_SCRIPT; rm -f $FRONTEND_SCRIPT; exec bash" &
    elif command -v konsole >/dev/null 2>&1; then
        konsole --new-tab --title "Ditto Frontend Dev Server" -e bash -c "$FRONTEND_SCRIPT; rm -f $FRONTEND_SCRIPT; exec bash" &
    elif command -v xterm >/dev/null 2>&1; then
        xterm -title "Ditto Frontend Dev Server" -e bash -c "$FRONTEND_SCRIPT; rm -f $FRONTEND_SCRIPT; exec bash" &
    elif command -v terminator >/dev/null 2>&1; then
        terminator --title="Ditto Frontend Dev Server" -e "$FRONTEND_SCRIPT" &
    else
        log_warning "Nessun terminale grafico trovato. Avvio in background..."
        "$FRONTEND_SCRIPT" &
    fi
else
    log_warning "Porta $FRONTEND_PORT già in uso: frontend non avviato per evitare istanze duplicate."
    log_info "Se il frontend è già attivo, puoi usare http://localhost:$FRONTEND_PORT"
fi

sleep 3

################################################################################
# 4. RIEPILOGO
################################################################################

echo ""
echo "========================================"
echo "  Servizi Avviati Con Successo!"
echo "========================================"
echo ""
echo "Docker:   postgres:5432 (in docker-compose)"
echo "Backend:  http://$IP:$BACKEND_PORT"
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo ""
echo "Documentazione API: http://$IP:$BACKEND_PORT/docs"
echo "Health Check:       http://$IP:$BACKEND_PORT/health"
echo ""
echo "[INFO] I servizi sono in esecuzione in finestre separate."
echo "[INFO] Per fermare i servizi:"
echo "       - Chiudi le finestre del terminale"
echo "       - Oppure esegui: cd $BASE_DIR/docker && docker compose down"
echo ""

read -p "Premi INVIO per continuare..."
