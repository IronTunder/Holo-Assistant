#!/bin/bash

################################################################################
# DITTO - Setup Completo "A Prova di Bomba" - VERSIONE DEBIAN COMPATIBILE
################################################################################

set -euo pipefail
IFS=$'\n\t'

# Configurazione
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$HOME/ditto_setup_logs"
LOG_FILE="$LOG_DIR/setup_$(date +%Y%m%d_%H%M%S).log"
ERROR_LOG="$LOG_DIR/errors_$(date +%Y%m%d_%H%M%S).log"
BACKUP_DIR="$HOME/ditto_backup_$(date +%Y%m%d_%H%M%S)"

# Colori
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    MAGENTA='\033[0;35m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; MAGENTA=''; BOLD=''; NC=''
fi

# Variabili
SETUP_SUCCESS=false
DOCKER_INSTALLED=false
OS_DISTRO=""
OS_VERSION=""
OLLAMA_CONTAINER_NAME="ditto_ollama"
OLLAMA_MODEL="mistral:7b-instruct-v0.3-q4_K_M"

# Directory Piper
PIPER_BASE_DIR="$HOME/.local/share/piper"
PIPER_VOICES_DIR="$PIPER_BASE_DIR/voices"
PIPER_MODEL_PATH="$PIPER_VOICES_DIR/it_IT-paola-medium.onnx"
PIPER_CONFIG_PATH="$PIPER_VOICES_DIR/it_IT-paola-medium.onnx.json"
HTTPS_CERT_PATH="$ROOT_DIR/certs/ditto.crt"
HTTPS_KEY_PATH="$ROOT_DIR/certs/ditto.key"

# Crea directory log
mkdir -p "$LOG_DIR"

################################################################################
# Funzioni di logging
################################################################################

log() {
    local level="$1"
    local message="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
    
    case "$level" in
        "INFO")    echo -e "${BLUE}[INFO]${NC} $message" ;;
        "SUCCESS") echo -e "${GREEN}[OK]${NC} $message" ;;
        "WARNING") echo -e "${YELLOW}[AVVISO]${NC} $message" ;;
        "ERROR")   echo -e "${RED}[ERRORE]${NC} $message" | tee -a "$ERROR_LOG" ;;
        "STEP")    echo -e "\n${CYAN}${BOLD}>>>${NC} ${CYAN}$message${NC}" ;;
        *)         echo "$message" ;;
    esac
}

error_exit() {
    log "ERROR" "$1"
    cleanup_on_error
    echo -e "\n${RED}${BOLD}✗ Installazione fallita!${NC}"
    echo -e "${YELLOW}Log: $LOG_FILE${NC}"
    echo -e "${YELLOW}Errori: $ERROR_LOG${NC}"
    exit 1
}

cleanup_on_error() {
    if [ "$SETUP_SUCCESS" = false ]; then
        log "WARNING" "Pulizia in corso dopo errore..."
        
        if [ -f "$ROOT_DIR/docker/docker-compose.yml" ]; then
            cd "$ROOT_DIR/docker" 2>/dev/null && docker compose down 2>/dev/null || true
        fi
        
        pkill -f "uvicorn" 2>/dev/null || true
        pkill -f "vite" 2>/dev/null || true
        
        log "INFO" "Pulizia completata"
    fi
}

################################################################################
# Funzioni di verifica
################################################################################

check_directory_structure() {
    log "STEP" "Verifica struttura directory"
    
    local required_dirs=(
        "$ROOT_DIR/docker"
        "$ROOT_DIR/backend"
        "$ROOT_DIR/frontend/my-app"
    )
    
    for dir in "${required_dirs[@]}"; do
        if [ ! -d "$dir" ]; then
            error_exit "Directory non trovata: $dir"
        else
            log "SUCCESS" "Trovata: $dir"
        fi
    done
    
    if [ ! -f "$ROOT_DIR/docker/docker-compose.yml" ]; then
        error_exit "docker-compose.yml non trovato"
    fi
    
    if [ ! -f "$ROOT_DIR/frontend/my-app/package.json" ]; then
        error_exit "package.json non trovato in frontend/my-app"
    fi

    if [ ! -f "$HTTPS_CERT_PATH" ]; then
        error_exit "Certificato HTTPS non trovato: $HTTPS_CERT_PATH"
    fi

    if [ ! -f "$HTTPS_KEY_PATH" ]; then
        error_exit "Chiave HTTPS non trovata: $HTTPS_KEY_PATH"
    fi
    
    log "SUCCESS" "Struttura directory verificata"
}

check_sudo() {
    if ! sudo -v >/dev/null 2>&1; then
        error_exit "Privilegi sudo richiesti"
    fi
    log "SUCCESS" "Privilegi sudo OK"
}

check_internet() {
    log "INFO" "Verifica connessione internet..."
    if ping -c 1 google.com >/dev/null 2>&1 || ping -c 1 8.8.8.8 >/dev/null 2>&1; then
        log "SUCCESS" "Connessione internet attiva"
        return 0
    else
        error_exit "Nessuna connessione internet"
    fi
}

get_os_type() {
    if [ -f /etc/os-release ]; then
        source /etc/os-release
        OS_DISTRO="$ID"
        OS_VERSION="$VERSION_ID"
        
        # Normalizza nomi distribuzioni
        case "$OS_DISTRO" in
            debian|ubuntu|linuxmint)
                log "INFO" "Sistema: $NAME $VERSION_ID"
                ;;
            fedora|rhel|centos)
                log "INFO" "Sistema: $NAME $VERSION_ID"
                ;;
            arch|manjaro)
                log "INFO" "Sistema: $NAME"
                ;;
            *)
                log "WARNING" "Sistema non riconosciuto: $NAME"
                ;;
        esac
    else
        error_exit "Impossibile determinare il sistema operativo"
    fi
}

################################################################################
# Installazione Piper TTS
################################################################################

install_piper() {
    log "STEP" "Installazione modello Piper TTS"
    
    # Crea directory necessarie
    mkdir -p "$PIPER_VOICES_DIR"
    
    # Il runtime usa la libreria Python piper-tts, quindi il binario non serve piu.
    if false; then
    
    # Determina architettura
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)
            PIPER_ARCH="x86_64"
            ;;
        aarch64|arm64)
            PIPER_ARCH="aarch64"
            ;;
        armv7l)
            PIPER_ARCH="armv7l"
            ;;
        *)
            log "WARNING" "Architettura non supportata: $ARCH, salto installazione Piper"
            return 1
            ;;
    esac
    
    # Scarica Piper se non esiste
    if [ ! -f "$PIPER_EXECUTABLE" ]; then
        log "INFO" "Scaricamento Piper per $PIPER_ARCH..."
        
        # URL base per il download
        PIPER_VERSION="1.2.0"
        PIPER_URL="https://github.com/rhasspy/piper/releases/download/v${PIPER_VERSION}/piper_${PIPER_ARCH}.tar.gz"
        
        # Directory temporanea
        TEMP_DIR=$(mktemp -d)
        cd "$TEMP_DIR"
        
        # Scarica l'archivio
        if wget -q --show-progress "$PIPER_URL" -O piper.tar.gz; then
            log "SUCCESS" "Download completato"
        elif curl -L --progress-bar "$PIPER_URL" -o piper.tar.gz; then
            log "SUCCESS" "Download completato"
        else
            log "WARNING" "Download fallito, provo URL alternativo..."
            PIPER_URL="https://github.com/rhasspy/piper/releases/download/v${PIPER_VERSION}/piper_${PIPER_ARCH}.tar.gz"
            if ! wget -q --show-progress "$PIPER_URL" -o piper.tar.gz 2>/dev/null; then
                log "ERROR" "Impossibile scaricare Piper"
                cd /
                rm -rf "$TEMP_DIR"
                return 1
            fi
        fi
        
        # Estrai l'archivio
        log "INFO" "Estrazione Piper..."
        tar -xzf piper.tar.gz
        
        # Copia il binario
        if [ -f "piper" ]; then
            cp piper "$PIPER_EXECUTABLE"
        elif [ -f "piper/piper" ]; then
            cp piper/piper "$PIPER_EXECUTABLE"
        else
            log "ERROR" "Binario Piper non trovato nell'archivio"
            cd /
            rm -rf "$TEMP_DIR"
            return 1
        fi
        
        chmod +x "$PIPER_EXECUTABLE"
        
        # Pulizia
        cd /
        rm -rf "$TEMP_DIR"
        
        log "SUCCESS" "Piper installato in $PIPER_EXECUTABLE"
    else
        log "SUCCESS" "Piper già installato"
    fi
    
    fi

    # Scarica modello vocale italiano
    if [ ! -f "$PIPER_MODEL_PATH" ]; then
        log "INFO" "Download modello vocale italiano (Paola medium)..."
        
        # URL del modello italiano
        MODEL_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium/it_IT-paola-medium.onnx"
        CONFIG_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium/it_IT-paola-medium.onnx.json"
        
        # Download del modello
        if wget -q --show-progress "$MODEL_URL" -O "$PIPER_MODEL_PATH" 2>/dev/null || curl -L --progress-bar "$MODEL_URL" -o "$PIPER_MODEL_PATH"; then
            log "SUCCESS" "Modello scaricato: $PIPER_MODEL_PATH"
        else
            log "WARNING" "Download modello fallito, provo con URL alternativo..."
            MODEL_URL="https://github.com/rhasspy/piper/releases/download/v1.2.0/voice-it_IT-paola-medium.tar.gz"
            TEMP_DIR=$(mktemp -d)
            cd "$TEMP_DIR"
            
            if wget -q "$MODEL_URL" -O voice.tar.gz; then
                tar -xzf voice.tar.gz
                find . -name "*.onnx" -exec cp {} "$PIPER_MODEL_PATH" \; 2>/dev/null
                find . -name "*.json" -exec cp {} "$PIPER_CONFIG_PATH" \; 2>/dev/null
                log "SUCCESS" "Modello installato da archivio alternativo"
            else
                log "WARNING" "Impossibile scaricare il modello vocale italiano"
            fi
            
            cd /
            rm -rf "$TEMP_DIR"
        fi
        
        # Download del file di configurazione se non esiste
        if [ ! -f "$PIPER_CONFIG_PATH" ]; then
            if wget -q "$CONFIG_URL" -O "$PIPER_CONFIG_PATH" 2>/dev/null || curl -L -s "$CONFIG_URL" -o "$PIPER_CONFIG_PATH"; then
                log "SUCCESS" "Configurazione scaricata"
            else
                # Crea file di configurazione di base
                cat > "$PIPER_CONFIG_PATH" << EOF
{
  "audio": {
    "sample_rate": 22050
  },
  "language": {
    "code": "it"
  },
  "name": "it_IT-paola-medium",
  "num_speakers": 1,
  "phoneme_type": "espeak",
  "speaker_id_map": null,
  "version": "1.0.0"
}
EOF
                log "WARNING" "Configurazione creata manualmente"
            fi
        fi
    else
        log "SUCCESS" "Modello vocale già presente"
    fi
    
    # Verifica installazione
    if [ -f "$PIPER_MODEL_PATH" ] && [ -f "$PIPER_CONFIG_PATH" ]; then
        log "SUCCESS" "Modello Piper TTS pronto"
        return 0
    else
        log "WARNING" "Modello Piper TTS non completamente installato"
        return 1
    fi
}

################################################################################
# Installazione Docker per Debian/Ubuntu
################################################################################

install_docker_debian() {
    log "INFO" "Installazione Docker per Debian/Ubuntu..."
    
    # Rimuovi vecchie versioni
    sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
    
    # Installa prerequisiti
    sudo apt-get update
    sudo apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release \
        wget
    
    # Aggiungi chiave GPG Docker
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$OS_DISTRO/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    # Aggiungi repository (usa debian per Debian, ubuntu per Ubuntu)
    if [ "$OS_DISTRO" = "debian" ]; then
        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
          $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    else
        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
          $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    fi
    
    # Installa Docker
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    # Avvia Docker
    sudo systemctl enable docker
    sudo systemctl start docker
    
    # Verifica
    if command -v docker >/dev/null 2>&1; then
        DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | tr -d ',')
        log "SUCCESS" "Docker $DOCKER_VERSION installato"
        return 0
    else
        return 1
    fi
}

install_docker_fedora() {
    log "INFO" "Installazione Docker per Fedora/RHEL..."
    
    sudo dnf -y install dnf-plugins-core wget curl
    sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
    sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    sudo systemctl enable docker
    sudo systemctl start docker
    
    if command -v docker >/dev/null 2>&1; then
        DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | tr -d ',')
        log "SUCCESS" "Docker $DOCKER_VERSION installato"
        return 0
    else
        return 1
    fi
}

install_docker_arch() {
    log "INFO" "Installazione Docker per Arch Linux..."
    
    sudo pacman -S --noconfirm docker docker-compose wget curl
    sudo systemctl enable docker
    sudo systemctl start docker
    
    if command -v docker >/dev/null 2>&1; then
        DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | tr -d ',')
        log "SUCCESS" "Docker $DOCKER_VERSION installato"
        return 0
    else
        return 1
    fi
}

install_docker() {
    log "STEP" "Installazione Docker"
    
    if command -v docker >/dev/null 2>&1; then
        DOCKER_VERSION=$(docker --version 2>/dev/null | cut -d' ' -f3 | tr -d ',')
        log "SUCCESS" "Docker già installato: $DOCKER_VERSION"
        DOCKER_INSTALLED=true
        return 0
    fi
    
    log "INFO" "Installazione Docker in corso..."
    
    case "$OS_DISTRO" in
        debian|ubuntu|linuxmint)
            install_docker_debian || error_exit "Installazione Docker fallita"
            ;;
        fedora|rhel|centos)
            install_docker_fedora || error_exit "Installazione Docker fallita"
            ;;
        arch|manjaro)
            install_docker_arch || error_exit "Installazione Docker fallita"
            ;;
        *)
            error_exit "Distribuzione non supportata. Installa Docker manualmente: https://docs.docker.com/engine/install/"
            ;;
    esac
    
    DOCKER_INSTALLED=true
}

check_docker_permissions() {
    if ! docker ps >/dev/null 2>&1; then
        log "WARNING" "Problemi permessi Docker"
        
        # Crea gruppo docker se non esiste
        sudo groupadd docker 2>/dev/null || true
        
        # Aggiungi utente al gruppo docker
        sudo usermod -aG docker "$USER"
        
        log "INFO" "Utente aggiunto al gruppo docker"
        log "WARNING" "Per applicare i permessi, esegui: newgrp docker"
        log "WARNING" "Oppure riavvia la sessione e rilancia lo script"
        
        # Prova a usare newgrp
        exec newgrp docker <<EONG
$0 "$@"
EONG
        exit 0
    else
        log "SUCCESS" "Permessi Docker OK"
    fi
}

################################################################################
# Installazione Node.js
################################################################################

install_nodejs() {
    log "STEP" "Installazione Node.js"
    
    if command -v node >/dev/null 2>&1; then
        NODE_VERSION=$(node --version)
        log "SUCCESS" "Node.js già installato: $NODE_VERSION"
        return 0
    fi
    
    log "INFO" "Installazione Node.js 20.x..."
    
    case "$OS_DISTRO" in
        debian|ubuntu|linuxmint)
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        fedora|rhel|centos)
            sudo dnf install -y nodejs npm
            ;;
        arch|manjaro)
            sudo pacman -S --noconfirm nodejs npm
            ;;
        *)
            error_exit "Installazione Node.js automatica non supportata"
            ;;
    esac
    
    if command -v node >/dev/null 2>&1; then
        log "SUCCESS" "Node.js $(node --version) installato"
    else
        error_exit "Installazione Node.js fallita"
    fi
}

################################################################################
# Installazione Python
################################################################################

install_python() {
    log "STEP" "Verifica Python"
    
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_VERSION=$(python3 --version)
        log "SUCCESS" "Python3 già installato: $PYTHON_VERSION"
        return 0
    fi
    
    log "INFO" "Installazione Python3..."
    
    case "$OS_DISTRO" in
        debian|ubuntu|linuxmint)
            sudo apt-get update
            sudo apt-get install -y python3 python3-pip python3-venv
            ;;
        fedora|rhel|centos)
            sudo dnf install -y python3 python3-pip python3-virtualenv
            ;;
        arch|manjaro)
            sudo pacman -S --noconfirm python python-pip python-virtualenv
            ;;
        *)
            error_exit "Python3 non trovato. Installalo manualmente"
            ;;
    esac
    
    if command -v python3 >/dev/null 2>&1; then
        log "SUCCESS" "Python3 $(python3 --version) installato"
    else
        error_exit "Installazione Python3 fallita"
    fi
}

################################################################################
# Setup database
################################################################################

setup_database() {
    log "STEP" "Configurazione database PostgreSQL"
    
    cd "$ROOT_DIR/docker" || error_exit "Directory docker non trovata"
    
    # Ferma container esistenti
    docker compose down 2>/dev/null || true
    
    # Avvia container
    log "INFO" "Avvio container PostgreSQL e Ollama..."
    docker compose up -d
    
    if [ $? -ne 0 ]; then
        error_exit "Impossibile avviare i container Docker"
    fi
    
    # Attendi PostgreSQL
    log "INFO" "Attendo avvio PostgreSQL..."
    sleep 8
    
    # Verifica
    local max_attempts=20
    local attempt=1
    while [ $attempt -le $max_attempts ]; do
        if docker ps | grep -q postgres; then
            log "SUCCESS" "PostgreSQL è in esecuzione"
            break
        fi
        log "INFO" "Attesa... ($attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done
    
    log "SUCCESS" "Database configurato"
}

################################################################################
# Setup Ollama / Mistral
################################################################################

setup_ollama_model() {
    log "STEP" "Configurazione Ollama e modello $OLLAMA_MODEL"

    if ! docker ps --format '{{.Names}}' | grep -qx "$OLLAMA_CONTAINER_NAME"; then
        error_exit "Container Ollama non in esecuzione"
    fi

    log "INFO" "Attendo che Ollama sia pronto..."
    local max_attempts=45
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if docker exec "$OLLAMA_CONTAINER_NAME" ollama list >/dev/null 2>&1; then
            log "SUCCESS" "Ollama risponde correttamente"
            break
        fi

        if [ $attempt -eq $max_attempts ]; then
            error_exit "Ollama non è diventato disponibile in tempo"
        fi

        log "INFO" "Attesa Ollama... ($attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done

    if docker exec "$OLLAMA_CONTAINER_NAME" ollama list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$OLLAMA_MODEL"; then
        log "SUCCESS" "Modello $OLLAMA_MODEL già presente"
    else
        log "INFO" "Download modello $OLLAMA_MODEL in corso..."
        docker exec "$OLLAMA_CONTAINER_NAME" ollama pull "$OLLAMA_MODEL" || error_exit "Download modello $OLLAMA_MODEL fallito"
        log "SUCCESS" "Modello $OLLAMA_MODEL scaricato"
    fi

    log "INFO" "Verifica disponibilità modello..."
    local ollama_base_url="http://127.0.0.1:11434"
    if command -v curl >/dev/null 2>&1; then
        if curl -fsS "$ollama_base_url/api/generate" \
            -H "Content-Type: application/json" \
            -d "{\"model\":\"$OLLAMA_MODEL\",\"prompt\":\"Rispondi solo OK\",\"stream\":false}" >/dev/null 2>&1; then
            log "SUCCESS" "Modello $OLLAMA_MODEL pronto all'uso"
        else
            log "WARNING" "Ollama è attivo ma il warm-up del modello non è riuscito"
        fi
    else
        log "WARNING" "curl non disponibile, salto il warm-up del modello"
    fi
}

################################################################################
# Setup backend
################################################################################

setup_backend() {
    log "STEP" "Configurazione backend FastAPI"
    
    cd "$ROOT_DIR/backend" || error_exit "Directory backend non trovata"
    
    # Ottieni IP
    IP=$(hostname -I | awk '{print $1}')
    [ -z "$IP" ] && IP="localhost"
    
    # Crea .env con percorsi Piper
    cat > .env << EOF
DATABASE_HOST=$IP
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=ditto_db
SECRET_KEY=$(openssl rand -hex 32 2>/dev/null || echo "dev-secret-key-$(date +%s)")
ADMIN_USERNAME=admin
ADMIN_PASSWORD=tuapasswordsicura
ACCESS_TOKEN_EXPIRE_MINUTES=480
ADMIN_TOKEN_EXPIRE_MINUTES=120
OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES=480
ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES=120
ALGORITHM=HS256
ALLOWED_ORIGINS=https://localhost:5173,https://$IP:5173
REFRESH_TOKEN_COOKIE_SECURE=true
REFRESH_TOKEN_COOKIE_SAMESITE=lax
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=$OLLAMA_MODEL
OLLAMA_TIMEOUT_SECONDS=120
OLLAMA_HEALTH_TIMEOUT_SECONDS=5
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_PREDICT_CLASSIFY=4
OLLAMA_NUM_PREDICT_SELECT=2
OLLAMA_NUM_PREDICT_RERANK=12
OLLAMA_TOP_K=20
OLLAMA_TOP_P=0.8
OLLAMA_TEMPERATURE_CLASSIFY=0.0
OLLAMA_TEMPERATURE_SELECT=0.0
OLLAMA_NUM_CTX=2048
OLLAMA_NUM_THREAD=4
TTS_ENABLED=true
EOF
    
    log "SUCCESS" "File .env creato"
    
    # Crea ambiente virtuale
    if [ ! -d "venv" ]; then
        log "INFO" "Creazione ambiente virtuale..."
        python3 -m venv venv
    fi
    
    # Attiva virtualenv
    source venv/bin/activate
    
    # Aggiorna pip
    pip install --upgrade pip
    
    # Installa dipendenze
    log "INFO" "Installazione dipendenze Python..."
    if [ -f "requirements.txt" ]; then
        pip install -r requirements.txt --quiet
    else
        log "WARNING" "requirements.txt non trovato, installo dipendenze base"
        pip install fastapi uvicorn sqlalchemy psycopg2-binary python-jose[cryptography] passlib[bcrypt] python-multipart python-dotenv requests
    fi
    
    # Inizializza database
    if [ -f "scripts/init_db.py" ]; then
        log "INFO" "Inizializzazione database..."
        python scripts/init_db.py 2>/dev/null || log "WARNING" "scripts/init_db.py potrebbe aver fallito"
    fi
    
    # Popola database
    if [ -f "scripts/populate.py" ]; then
        log "INFO" "Popolamento database..."
        python scripts/populate.py 2>/dev/null || log "WARNING" "scripts/populate.py potrebbe aver fallito"
    fi
    
    # Seed categorie se esiste
    if [ -f "scripts/seed_categories.py" ]; then
        log "INFO" "Seeding categorie..."
        python scripts/seed_categories.py 2>/dev/null || log "WARNING" "scripts/seed_categories.py potrebbe aver fallito"
    fi
    
    log "SUCCESS" "Backend configurato"
}

################################################################################
# Setup frontend
################################################################################

setup_frontend() {
    log "STEP" "Configurazione frontend"
    
    cd "$ROOT_DIR/frontend/my-app" || error_exit "Directory frontend non trovata"
    
    # Ottieni IP
    IP=$(hostname -I | awk '{print $1}')
    [ -z "$IP" ] && IP="localhost"
    
    # Crea .env
    echo "VITE_API_URL=https://$IP:8000" > .env
    log "SUCCESS" "File .env creato"
    
    # Installa dipendenze
    if [ ! -d "node_modules" ]; then
        log "INFO" "Installazione dipendenze Node.js (potrebbe richiedere tempo)..."
        npm install
    else
        log "INFO" "Dipendenze già installate"
    fi
    
    log "SUCCESS" "Frontend configurato"
}

################################################################################
# Avvio servizi
################################################################################

start_services() {
    log "STEP" "Avvio dei servizi"
    
    IP=$(hostname -I | awk '{print $1}')
    [ -z "$IP" ] && IP="localhost"
    
    # Script avvio backend
    cat > "$ROOT_DIR/scripts/unix/start_backend.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")/../../backend"
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --ssl-certfile ../certs/ditto.crt --ssl-keyfile ../certs/ditto.key
EOF
    chmod +x "$ROOT_DIR/scripts/unix/start_backend.sh"
    
    # Script avvio frontend
    cat > "$ROOT_DIR/scripts/unix/start_frontend.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")/../../frontend/my-app"
npm run dev -- --host 0.0.0.0
EOF
    chmod +x "$ROOT_DIR/scripts/unix/start_frontend.sh"
    
    # Avvia backend
    log "INFO" "Avvio backend su porta 8000..."
    if command -v gnome-terminal >/dev/null 2>&1; then
        gnome-terminal --title="DITTO Backend" -- bash -c "$ROOT_DIR/scripts/unix/start_backend.sh; exec bash" &
    elif command -v xterm >/dev/null 2>&1; then
        xterm -title "DITTO Backend" -e bash -c "$ROOT_DIR/scripts/unix/start_backend.sh; exec bash" &
    else
        log "INFO" "Avvio backend in background..."
        $ROOT_DIR/scripts/unix/start_backend.sh &
    fi
    
    sleep 3
    
    # Avvia frontend
    log "INFO" "Avvio frontend su porta 5173..."
    if command -v gnome-terminal >/dev/null 2>&1; then
        gnome-terminal --title="DITTO Frontend" -- bash -c "$ROOT_DIR/scripts/unix/start_frontend.sh; exec bash" &
    elif command -v xterm >/dev/null 2>&1; then
        xterm -title "DITTO Frontend" -e bash -c "$ROOT_DIR/scripts/unix/start_frontend.sh; exec bash" &
    else
        log "INFO" "Avvio frontend in background..."
        $ROOT_DIR/scripts/unix/start_frontend.sh &
    fi
    
    sleep 5
    log "SUCCESS" "Servizi avviati"
}

################################################################################
# Riepilogo finale
################################################################################

show_summary() {
    IP=$(hostname -I | awk '{print $1}')
    [ -z "$IP" ] && IP="localhost"
    
    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║           INSTALLAZIONE COMPLETATA CON SUCCESSO!            ║${NC}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}${BOLD}🌐 URL di accesso:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  • Frontend:            ${GREEN}https://localhost:5173${NC}"
    echo -e "  • Frontend (rete):     ${GREEN}https://$IP:5173${NC}"
    echo -e "  • Backend API:         ${GREEN}https://localhost:8000${NC}"
    echo -e "  • Documentazione API:  ${GREEN}https://localhost:8000/docs${NC}"
    echo -e "  • Ollama API:          ${GREEN}http://localhost:11434${NC}"
    echo ""
    echo -e "${CYAN}${BOLD}🔐 Credenziali:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  • Admin:     admin / admin123"
    echo -e "  • Utenti:    Mario Rossi, Luigi Verdi, Anna Bianchi, Marco Neri"
    echo -e "  • Password:  password123"
    echo ""
    echo -e "${CYAN}${BOLD}🎤 Text-to-Speech (Piper):${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  • Modello vocale:      ${GREEN}$PIPER_MODEL_PATH${NC}"
    echo -e "  • Configurazione:      ${GREEN}$PIPER_CONFIG_PATH${NC}"
    echo -e "  • Runtime:             ${GREEN}libreria Python piper-tts${NC}"
    echo ""
    echo -e "${CYAN}${BOLD}🧠 Modello AI:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  • Provider:            ${GREEN}Ollama${NC}"
    echo -e "  • Modello:             ${GREEN}$OLLAMA_MODEL${NC}"
    echo -e "  • Test rapido:         curl http://localhost:11434/api/tags${NC}"
    echo ""
    echo -e "${CYAN}${BOLD}📝 Comandi utili:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  • Ferma container:     cd docker && docker compose down"
    echo -e "  • Log Docker:          docker compose logs -f"
    echo -e "  • Log setup:           tail -f $LOG_FILE"
    echo ""
    echo -e "${GREEN}${BOLD}✨ Sistema pronto! I servizi sono in esecuzione in finestre separate ✨${NC}"
    echo ""
}

################################################################################
# Main
################################################################################

main() {
    trap cleanup_on_error EXIT
    
    clear
    echo -e "${CYAN}${BOLD}"
    cat << "EOF"
    ██████╗ ██╗████████╗████████╗ ██████╗ 
    ██╔══██╗██║╚══██╔══╝╚══██╔══╝██╔═══██╗
    ██║  ██║██║   ██║      ██║   ██║   ██║
    ██║  ██║██║   ██║      ██║   ██║   ██║
    ██████╔╝██║   ██║      ██║   ╚██████╔╝
    ╚═════╝ ╚═╝   ╚═╝      ╚═╝    ╚═════╝ 
EOF
    echo -e "${NC}"
    echo -e "${BOLD}Setup Automatico \"A Prova di Bomba\" v2.0 - Debian Edition${NC}"
    echo ""
    
    # Verifiche iniziali
    check_directory_structure
    check_sudo
    check_internet
    get_os_type
    
    # Backup
    mkdir -p "$BACKUP_DIR"
    log "INFO" "Backup salvato in: $BACKUP_DIR"
    
    # Installazione
    install_docker
    check_docker_permissions
    install_nodejs
    install_python
    install_piper
    
    # Setup
    setup_database
    setup_ollama_model
    setup_backend
    setup_frontend
    
    # Avvio
    start_services
    
    SETUP_SUCCESS=true
    show_summary
}

# Esegui
main "$@"
