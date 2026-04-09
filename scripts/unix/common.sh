#!/usr/bin/env bash

set -euo pipefail

DITTO_DEFAULT_BACKEND_PORT=8000
DITTO_DEFAULT_FRONTEND_PORT=5173
DITTO_DEFAULT_OLLAMA_MODEL="qwen3.5:9b"
DITTO_DEFAULT_OLLAMA_BASE_URL="http://127.0.0.1:11434"
DITTO_VOSK_MODEL_PUBLIC_URL="/models/vosk-model-small-it-0.22.tar.gz"
DITTO_VOSK_MODEL_ARCHIVE_NAME="vosk-model-small-it-0.22.tar.gz"
DITTO_PIPER_DEFAULT_VOICE_KEY="it_IT-paola-medium"
DITTO_PIPER_DEFAULT_VOICE_MODEL_FILENAME="${DITTO_PIPER_DEFAULT_VOICE_KEY}.onnx"
DITTO_PIPER_DEFAULT_VOICE_CONFIG_FILENAME="${DITTO_PIPER_DEFAULT_VOICE_MODEL_FILENAME}.json"
DITTO_UNIX_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DITTO_ROOT_DIR="$(cd "$DITTO_UNIX_SCRIPT_DIR/../.." && pwd)"

if [[ -t 1 ]]; then
    DITTO_RED=$'\033[0;31m'
    DITTO_GREEN=$'\033[0;32m'
    DITTO_YELLOW=$'\033[1;33m'
    DITTO_BLUE=$'\033[0;34m'
    DITTO_CYAN=$'\033[0;36m'
    DITTO_BOLD=$'\033[1m'
    DITTO_NC=$'\033[0m'
else
    DITTO_RED=''
    DITTO_GREEN=''
    DITTO_YELLOW=''
    DITTO_BLUE=''
    DITTO_CYAN=''
    DITTO_BOLD=''
    DITTO_NC=''
fi

DITTO_OLLAMA_USE_NATIVE=0
declare -ag DITTO_OLLAMA_COMPOSE_ARGS=("-f" "docker-compose.yml")

DITTO_OLLAMA_MODEL="$DITTO_DEFAULT_OLLAMA_MODEL"
DITTO_OLLAMA_BASE_URL="$DITTO_DEFAULT_OLLAMA_BASE_URL"
DITTO_OLLAMA_RUNTIME="auto"
DITTO_OLLAMA_ACCELERATOR="auto"
DITTO_OLLAMA_NATIVE_VULKAN="1"
DITTO_OLLAMA_KEEP_ALIVE="30m"
DITTO_OLLAMA_TOP_K="20"
DITTO_OLLAMA_TOP_P="0.8"
DITTO_OLLAMA_NUM_CTX="2048"
DITTO_OLLAMA_NUM_THREAD="4"
DITTO_OS_ID=""
DITTO_OS_NAME=""
DITTO_PACKAGE_MANAGER=""
DITTO_PACKAGE_INDEX_UPDATED=0
declare -ag DITTO_DOCKER_CMD=("docker")
declare -ag DITTO_DOCKER_COMPOSE_CMD=("docker" "compose")
DITTO_DOCKER_USE_SUDO=0
DITTO_DOCKER_COMPOSE_MODE="compose"

ditto_info() {
    printf '%b[INFO]%b %s\n' "$DITTO_BLUE" "$DITTO_NC" "$1"
}

ditto_ok() {
    printf '%b[OK]%b %s\n' "$DITTO_GREEN" "$DITTO_NC" "$1"
}

ditto_warn() {
    printf '%b[AVVISO]%b %s\n' "$DITTO_YELLOW" "$DITTO_NC" "$1"
}

ditto_error() {
    printf '%b[ERRORE]%b %s\n' "$DITTO_RED" "$DITTO_NC" "$1" >&2
}

ditto_step() {
    printf '\n%b%s%b\n' "$DITTO_CYAN$DITTO_BOLD" "$1" "$DITTO_NC"
}

ditto_install_notice() {
    printf '\n%b%s%b\n' "$DITTO_CYAN$DITTO_BOLD" "$1" "$DITTO_NC"
}

ditto_root() {
    printf '%s\n' "$DITTO_ROOT_DIR"
}

ditto_command_exists() {
    command -v "$1" >/dev/null 2>&1
}

ditto_try_add_common_paths() {
    local candidate

    for candidate in /usr/local/bin /usr/bin /bin /snap/bin; do
        if [[ ":$PATH:" != *":$candidate:"* && -d "$candidate" ]]; then
            PATH="$candidate:$PATH"
        fi
    done
    export PATH
}

ditto_detect_system() {
    if [[ -n "$DITTO_OS_ID" ]]; then
        return
    fi

    if [[ -f /etc/os-release ]]; then
        # shellcheck disable=SC1091
        source /etc/os-release
        DITTO_OS_ID="${ID:-linux}"
        DITTO_OS_NAME="${PRETTY_NAME:-${NAME:-Linux}}"
    else
        DITTO_OS_ID="linux"
        DITTO_OS_NAME="Linux"
    fi

    if ditto_command_exists apt-get; then
        DITTO_PACKAGE_MANAGER="apt"
    elif ditto_command_exists dnf; then
        DITTO_PACKAGE_MANAGER="dnf"
    elif ditto_command_exists yum; then
        DITTO_PACKAGE_MANAGER="yum"
    elif ditto_command_exists pacman; then
        DITTO_PACKAGE_MANAGER="pacman"
    elif ditto_command_exists zypper; then
        DITTO_PACKAGE_MANAGER="zypper"
    else
        DITTO_PACKAGE_MANAGER="unknown"
    fi
}

ditto_install_hint() {
    local command_name="$1"

    ditto_detect_system
    case "$command_name:$DITTO_PACKAGE_MANAGER" in
        docker:apt)
            printf 'sudo apt remove docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc\n'
            printf 'sudo apt-get update && sudo apt-get install -y ca-certificates curl\n'
            printf 'sudo install -m 0755 -d /etc/apt/keyrings\n'
            printf 'sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc\n'
            printf 'sudo chmod a+r /etc/apt/keyrings/docker.asc\n'
            printf 'sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF\n'
            printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")\nComponents: stable\nArchitectures: $(dpkg --print-architecture)\nSigned-By: /etc/apt/keyrings/docker.asc\nEOF\n'
            printf 'sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin\n'
            ;;
        docker:dnf)
            printf 'sudo dnf install -y docker docker-compose-plugin\n'
            ;;
        docker:yum)
            printf 'sudo yum install -y docker docker-compose-plugin\n'
            ;;
        docker:pacman)
            printf 'sudo pacman -S --needed docker docker-compose\n'
            ;;
        docker:zypper)
            printf 'sudo zypper install -y docker docker-compose\n'
            ;;
        node:apt|npm:apt)
            printf 'sudo apt-get update && sudo apt-get install -y nodejs npm\n'
            ;;
        node:dnf|npm:dnf)
            printf 'sudo dnf install -y nodejs npm\n'
            ;;
        node:yum|npm:yum)
            printf 'sudo yum install -y nodejs npm\n'
            ;;
        node:pacman|npm:pacman)
            printf 'sudo pacman -S --needed nodejs npm\n'
            ;;
        node:zypper|npm:zypper)
            printf 'sudo zypper install -y nodejs npm\n'
            ;;
        python3:apt|python:apt)
            printf 'sudo apt update && sudo apt upgrade -y\n'
            printf 'sudo apt install python3 python3-pip python3-venv python3-dev -y\n'
            ;;
        python3:dnf|python:dnf)
            printf 'sudo dnf install -y python3 python3-pip\n'
            ;;
        python3:yum|python:yum)
            printf 'sudo yum install -y python3 python3-pip\n'
            ;;
        python3:pacman|python:pacman)
            printf 'sudo pacman -S --needed python python-pip\n'
            ;;
        python3:zypper|python:zypper)
            printf 'sudo zypper install -y python3 python3-pip\n'
            ;;
        mkcert:apt)
            printf 'sudo apt-get update && sudo apt-get install -y mkcert libnss3-tools\n'
            ;;
        mkcert:dnf)
            printf 'sudo dnf install -y mkcert nss-tools\n'
            ;;
        mkcert:yum)
            printf 'sudo yum install -y mkcert nss-tools\n'
            ;;
        mkcert:pacman)
            printf 'sudo pacman -S --needed mkcert nss\n'
            ;;
        mkcert:zypper)
            printf 'sudo zypper install -y mkcert mozilla-nss-tools\n'
            ;;
        ollama:*)
            printf 'curl -fsSL https://ollama.com/install.sh | sh\n'
            ;;
        *)
            printf ''
            ;;
    esac
}

ditto_print_install_hint() {
    local command_name="$1"
    local display_name="$2"
    local hint

    ditto_detect_system
    hint="$(ditto_install_hint "$command_name")"
    if [[ -n "$hint" ]]; then
        ditto_info "Installazione consigliata per $display_name su $DITTO_OS_NAME:"
        printf '       %s\n' "$hint"
    fi
}

ditto_package_names_for_command() {
    local command_name="$1"

    ditto_detect_system
    case "$command_name:$DITTO_PACKAGE_MANAGER" in
        docker:dnf|docker:yum)
            printf 'docker docker-compose-plugin\n'
            ;;
        docker:pacman|docker:zypper)
            printf 'docker docker-compose\n'
            ;;
        node:apt|npm:apt)
            printf 'nodejs npm\n'
            ;;
        node:dnf|npm:dnf|node:yum|npm:yum|node:zypper|npm:zypper)
            printf 'nodejs npm\n'
            ;;
        node:pacman|npm:pacman)
            printf 'nodejs npm\n'
            ;;
        python3:apt|python:apt)
            printf 'python3 python3-venv python3-pip\n'
            ;;
        python3:dnf|python:dnf|python3:yum|python:yum)
            printf 'python3 python3-pip\n'
            ;;
        python3:pacman|python:pacman)
            printf 'python python-pip\n'
            ;;
        python3:zypper|python:zypper)
            printf 'python3 python3-pip\n'
            ;;
        mkcert:apt)
            printf 'mkcert libnss3-tools\n'
            ;;
        mkcert:dnf|mkcert:yum)
            printf 'mkcert nss-tools\n'
            ;;
        mkcert:pacman)
            printf 'mkcert nss\n'
            ;;
        mkcert:zypper)
            printf 'mkcert mozilla-nss-tools\n'
            ;;
        *)
            printf ''
            ;;
    esac
}

ditto_run_with_sudo() {
    if [[ "$(id -u)" == "0" ]]; then
        "$@"
    else
        sudo "$@"
    fi
}

ditto_run_quiet() {
    "$@" >/dev/null 2>&1
}

ditto_run_with_sudo_quiet() {
    if [[ "$(id -u)" == "0" ]]; then
        "$@" >/dev/null 2>&1
    else
        sudo "$@" >/dev/null 2>&1
    fi
}

ditto_run_quiet_checked() {
    local failure_message="$1"
    shift

    local log_file
    log_file="$(mktemp)"
    if "$@" >"$log_file" 2>&1; then
        rm -f "$log_file"
        return 0
    fi

    ditto_error "$failure_message"
    if [[ -s "$log_file" ]]; then
        tail -n 20 "$log_file" >&2
    fi
    rm -f "$log_file"
    return 1
}

ditto_configure_docker_commands() {
    local use_sudo="${1:-0}"
    local compose_binary="${2:-compose}"

    DITTO_DOCKER_USE_SUDO="$use_sudo"
    DITTO_DOCKER_COMPOSE_MODE="$compose_binary"

    if [[ "$use_sudo" == "1" ]]; then
        DITTO_DOCKER_CMD=("sudo" "docker")
        if [[ "$compose_binary" == "docker-compose" ]]; then
            DITTO_DOCKER_COMPOSE_CMD=("sudo" "docker-compose")
        else
            DITTO_DOCKER_COMPOSE_CMD=("sudo" "docker" "compose")
        fi
        return
    fi

    DITTO_DOCKER_CMD=("docker")
    if [[ "$compose_binary" == "docker-compose" ]]; then
        DITTO_DOCKER_COMPOSE_CMD=("docker-compose")
    else
        DITTO_DOCKER_COMPOSE_CMD=("docker" "compose")
    fi
}

ditto_update_package_index_once() {
    ditto_detect_system
    if [[ "$DITTO_PACKAGE_INDEX_UPDATED" == "1" ]]; then
        return 0
    fi

    case "$DITTO_PACKAGE_MANAGER" in
        apt)
            ditto_run_with_sudo_quiet apt-get -qq update
            ;;
    esac

    DITTO_PACKAGE_INDEX_UPDATED=1
}

ditto_install_docker_official_apt() {
    local packages_to_remove codename arch

    ditto_install_notice "Installazione Docker ufficiale in corso..."
    packages_to_remove="$(dpkg --get-selections docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc 2>/dev/null | cut -f1 | xargs || true)"
    if [[ -n "${packages_to_remove:-}" ]]; then
        ditto_run_with_sudo_quiet apt -qq remove -y $packages_to_remove
    fi

    ditto_update_package_index_once || return 1
    ditto_run_with_sudo_quiet apt-get -qq install -y ca-certificates curl || return 1
    ditto_run_with_sudo_quiet install -m 0755 -d /etc/apt/keyrings || return 1
    ditto_run_with_sudo_quiet curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc || return 1
    ditto_run_with_sudo_quiet chmod a+r /etc/apt/keyrings/docker.asc || return 1

    # shellcheck disable=SC1091
    source /etc/os-release
    codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
    arch="$(dpkg --print-architecture)"
    if [[ -z "$codename" || -z "$arch" ]]; then
        return 1
    fi

    printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$codename" "$arch" | ditto_run_with_sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null || return 1

    DITTO_PACKAGE_INDEX_UPDATED=0
    ditto_update_package_index_once || return 1
    ditto_run_with_sudo_quiet apt-get -qq install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || return 1
}

ditto_try_install_command() {
    local command_name="$1"
    local display_name="$2"
    local packages

    ditto_detect_system
    if [[ "$command_name" == "docker" && "$DITTO_PACKAGE_MANAGER" == "apt" ]]; then
        ditto_install_docker_official_apt || return 1
        ditto_try_add_common_paths
        if ditto_command_exists docker; then
            ditto_ok "$display_name installato automaticamente."
            return 0
        fi
        return 1
    fi

    packages="$(ditto_package_names_for_command "$command_name")"
    if [[ -z "$packages" ]]; then
        return 1
    fi

    ditto_install_notice "Installazione $display_name in corso..."
    case "$DITTO_PACKAGE_MANAGER" in
        apt)
            ditto_update_package_index_once || return 1
            ditto_run_with_sudo_quiet apt-get -qq install -y $packages || return 1
            ;;
        dnf)
            ditto_run_with_sudo_quiet dnf -q install -y $packages || return 1
            ;;
        yum)
            ditto_run_with_sudo_quiet yum -q install -y $packages || return 1
            ;;
        pacman)
            ditto_run_with_sudo_quiet pacman -S --needed --noconfirm $packages || return 1
            ;;
        zypper)
            ditto_run_with_sudo_quiet zypper --quiet install -y $packages || return 1
            ;;
        *)
            return 1
            ;;
    esac

    ditto_try_add_common_paths
    if ditto_command_exists "$command_name"; then
        ditto_ok "$display_name installato automaticamente."
        return 0
    fi

    return 1
}

ditto_try_install_ollama() {
    local display_name="$1"

    if ! ditto_command_exists curl; then
        return 1
    fi

    ditto_install_notice "Installazione $display_name in corso..."
    if ! bash -c "$(curl -fsSL https://ollama.com/install.sh)" >/dev/null 2>&1; then
        return 1
    fi

    ditto_try_add_common_paths
    if ditto_command_exists ollama; then
        ditto_ok "$display_name installato automaticamente."
        return 0
    fi

    return 1
}

ditto_require_command() {
    local command_name="$1"
    local display_name="$2"
    local check_only="${3:-0}"

    ditto_try_add_common_paths
    if ditto_command_exists "$command_name"; then
        ditto_ok "$display_name disponibile."
        return 0
    fi

    if [[ "$check_only" != "1" ]]; then
        if [[ "$command_name" == "ollama" ]]; then
            if ditto_try_install_ollama "$display_name"; then
                return 0
            fi
        else
            if ditto_try_install_command "$command_name" "$display_name"; then
                return 0
            fi
        fi
    fi

    ditto_error "$display_name non trovato nel PATH."
    if [[ "$check_only" != "1" ]]; then
        ditto_warn "Installazione automatica non riuscita oppure non supportata."
    fi
    ditto_print_install_hint "$command_name" "$display_name"
    return 1
}

ditto_read_env_value() {
    local env_path="$1"
    local key="$2"

    if [[ ! -f "$env_path" ]]; then
        return 1
    fi

    awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, "", $0); print $0; exit }' "$env_path"
}

ditto_set_env_values() {
    local env_path="$1"
    shift

    local tmp_path="${env_path}.tmp"
    local line key value

    touch "$env_path"
    cp "$env_path" "$tmp_path"

    while (($#)); do
        line="$1"
        shift
        key="${line%%=*}"
        value="${line#*=}"

        if grep -q "^${key}=" "$tmp_path"; then
            awk -v key="$key" -v value="$value" '
                BEGIN { replacement = key "=" value }
                $0 ~ "^" key "=" { print replacement; next }
                { print }
            ' "$tmp_path" > "${tmp_path}.next"
            mv "${tmp_path}.next" "$tmp_path"
        else
            printf '%s=%s\n' "$key" "$value" >> "$tmp_path"
        fi
    done

    mv "$tmp_path" "$env_path"
}

ditto_export_env_value() {
    local env_path="$1"
    local key="$2"
    local value

    value="$(ditto_read_env_value "$env_path" "$key" || true)"
    if [[ -z "${value:-}" ]]; then
        ditto_error "Variabile $key mancante in $env_path"
        return 1
    fi

    export "$key=$value"
}

ditto_generate_secret() {
    if ditto_command_exists openssl; then
        openssl rand -hex 32
        return
    fi

    local value
    set +o pipefail
    value="$(tr -dc 'a-f0-9' < /dev/urandom | head -c 64)"
    set -o pipefail
    printf '%s\n' "$value"
}

ditto_generate_admin_password() {
    local value
    set +o pipefail
    value="$(tr -dc 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&?' < /dev/urandom | head -c 20)"
    set -o pipefail
    printf '%s\n' "$value"
}

ditto_get_local_ip() {
    local ip route_ip

    if ditto_command_exists ip; then
        route_ip="$(ip route get 1 2>/dev/null | awk '/src/ { for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }')"
        if [[ -n "${route_ip:-}" ]]; then
            printf '%s\n' "$route_ip"
            return
        fi
    fi

    if ditto_command_exists hostname; then
        ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
        if [[ -n "${ip:-}" ]]; then
            printf '%s\n' "$ip"
            return
        fi
    fi

    printf 'localhost\n'
}

ditto_invoke_checked() {
    local failure_message="$1"
    shift

    if ! "$@"; then
        ditto_error "$failure_message"
        return 1
    fi
}

ditto_parse_check_only() {
    DITTO_CHECK_ONLY=0
    declare -ga DITTO_SCRIPT_ARGS=()

    while (($#)); do
        case "$1" in
            --check-only)
                DITTO_CHECK_ONLY=1
                ;;
            *)
                DITTO_SCRIPT_ARGS+=("$1")
                ;;
        esac
        shift
    done
}

ditto_ensure_mkcert_trust() {
    local install_log

    install_log="$(mktemp)"
    if mkcert -install >"$install_log" 2>&1; then
        rm -f "$install_log"
        return 0
    fi

    ditto_detect_system
    if [[ "$DITTO_PACKAGE_MANAGER" == "apt" ]]; then
        ditto_install_notice "Configurazione trust HTTPS locale in corso..."
        ditto_update_package_index_once || true
        ditto_run_with_sudo_quiet apt install -y libnss3-tools || true
        if mkcert -install >"$install_log" 2>&1; then
            rm -f "$install_log"
            return 0
        fi
    fi

    ditto_error "Installazione della CA locale mkcert fallita."
    if [[ -s "$install_log" ]]; then
        tail -n 20 "$install_log" >&2
    fi
    rm -f "$install_log"
    return 1
}

ditto_trust_system_certificate() {
    local cert_file="$1"
    local ca_store_dir="/usr/local/share/ca-certificates"
    local system_cert_name="ditto-local.crt"
    local caroot=""
    local root_ca=""

    if ! ditto_command_exists update-ca-certificates; then
        return 0
    fi

    ditto_install_notice "Aggiornamento certificati trusted di sistema in corso..."
    ditto_run_with_sudo_quiet install -m 0755 -d "$ca_store_dir" || return 1
    ditto_run_with_sudo_quiet cp "$cert_file" "$ca_store_dir/$system_cert_name" || return 1

    caroot="$(mkcert -CAROOT 2>/dev/null || true)"
    root_ca="${caroot%/}/rootCA.pem"
    if [[ -n "${caroot:-}" && -f "$root_ca" ]]; then
        ditto_run_with_sudo_quiet cp "$root_ca" "$ca_store_dir/ditto-mkcert-root-ca.crt" || return 1
    fi

    ditto_run_with_sudo_quiet update-ca-certificates || return 1
    return 0
}

ditto_ensure_https_certificate() {
    local root_dir="$1"
    local ip="$2"
    local check_only="${3:-0}"
    local cert_file="$root_dir/certs/ditto.crt"
    local key_file="$root_dir/certs/ditto.key"

    if [[ "$check_only" != "1" ]]; then
        ditto_ensure_mkcert_trust || return 1
    fi

    if [[ -f "$cert_file" && -f "$key_file" ]]; then
        if [[ "$check_only" != "1" ]]; then
            ditto_trust_system_certificate "$cert_file" || return 1
        fi
        ditto_ok "HTTPS attivo con certificato: $cert_file"
        DITTO_CERT_FILE="$cert_file"
        DITTO_KEY_FILE="$key_file"
        return 0
    fi

    if ! ditto_require_command mkcert "mkcert" "$check_only"; then
        ditto_error "Certificato HTTPS mancante e mkcert non e disponibile. Installa mkcert oppure genera manualmente certs/ditto.crt e certs/ditto.key."
        return 1
    fi

    if [[ "$check_only" == "1" ]]; then
        ditto_info "CheckOnly: certificato HTTPS mancante, ma non genero file."
        DITTO_CERT_FILE="$cert_file"
        DITTO_KEY_FILE="$key_file"
        return 0
    fi

    mkdir -p "$root_dir/certs"
    mkcert -cert-file "$cert_file" -key-file "$key_file" "$ip" localhost 127.0.0.1 ditto.lan >/dev/null

    if [[ ! -f "$cert_file" || ! -f "$key_file" ]]; then
        ditto_error "Certificato HTTPS non creato correttamente."
        return 1
    fi

    ditto_trust_system_certificate "$cert_file" || return 1

    ditto_ok "Certificato HTTPS generato."
    DITTO_CERT_FILE="$cert_file"
    DITTO_KEY_FILE="$key_file"
}

ditto_ensure_docker() {
    local check_only="${1:-0}"
    local docker_info_output=""

    ditto_require_command docker Docker "$check_only" || return 1
    if docker compose version >/dev/null 2>&1; then
        ditto_configure_docker_commands 0 compose
    elif ditto_command_exists docker-compose; then
        ditto_configure_docker_commands 0 docker-compose
    else
        ditto_error "Docker Compose non disponibile."
        ditto_print_install_hint "docker" "Docker"
        return 1
    fi
    ditto_ok "Docker Compose disponibile: ${DITTO_DOCKER_COMPOSE_CMD[*]}"

    if [[ "$check_only" == "1" ]]; then
        ditto_info "CheckOnly: non invoco Docker Compose e non controllo il daemon."
        return 0
    fi

    if ditto_docker info >/dev/null 2>&1; then
        ditto_ok "Docker daemon gia pronto."
        return 0
    fi

    docker_info_output="$(ditto_docker info 2>&1 || true)"

    if grep -qi "permission denied" <<<"$docker_info_output"; then
        if getent group docker >/dev/null 2>&1; then
            ditto_run_with_sudo usermod -aG docker "${USER:-$LOGNAME}" >/dev/null 2>&1 || true
        fi

        if [[ "${DITTO_DOCKER_COMPOSE_CMD[*]}" == "docker-compose" ]]; then
            ditto_configure_docker_commands 1 docker-compose
        else
            ditto_configure_docker_commands 1 compose
        fi

        if ditto_docker info >/dev/null 2>&1; then
            ditto_ok "Docker disponibile automaticamente tramite sudo."
            return 0
        fi

        docker_info_output="$(ditto_docker info 2>&1 || true)"
    fi

    if ditto_command_exists systemctl; then
        if systemctl is-active --quiet docker 2>/dev/null; then
            ditto_error "Docker risponde in modo anomalo anche se il servizio risulta attivo."
            ditto_info "Dettaglio docker info: ${docker_info_output:-nessun output}"
            return 1
        fi

        ditto_warn "Docker e installato ma il servizio non sembra attivo."
        if ditto_run_with_sudo systemctl start docker >/dev/null 2>&1 && ditto_docker info >/dev/null 2>&1; then
            ditto_ok "Docker daemon avviato."
            return 0
        fi

        ditto_info "Avvia Docker con:"
        printf '       sudo systemctl start docker\n'
        printf '       sudo systemctl enable docker\n'
        return 1
    fi

    if ditto_command_exists service; then
        ditto_warn "Docker e installato ma il servizio non sembra attivo."
        ditto_info "Avvia Docker con:"
        printf '       sudo service docker start\n'
        return 1
    fi

    ditto_error "Docker non risponde. Avvia il daemon Docker e rilancia lo script."
    if [[ -n "$docker_info_output" ]]; then
        ditto_info "Dettaglio docker info: $docker_info_output"
    fi
    return 1
}

ditto_docker_compose() {
    if [[ "$DITTO_DOCKER_USE_SUDO" == "1" ]]; then
        if [[ "$DITTO_DOCKER_COMPOSE_MODE" == "docker-compose" ]]; then
            sudo --preserve-env=DATABASE_PASSWORD docker-compose "$@"
        else
            sudo --preserve-env=DATABASE_PASSWORD docker compose "$@"
        fi
        return
    fi

    "${DITTO_DOCKER_COMPOSE_CMD[@]}" "$@"
}

ditto_docker() {
    "${DITTO_DOCKER_CMD[@]}" "$@"
}

ditto_install_python_apt() {
    ditto_install_notice "Installazione Python 3 in corso..."
    ditto_run_with_sudo_quiet apt update || return 1
    ditto_run_with_sudo_quiet apt upgrade -y || return 1
    ditto_run_with_sudo_quiet apt install python3 python3-pip python3-venv python3-dev -y || return 1

    ditto_try_add_common_paths
    ditto_command_exists python3 || return 1
    ditto_command_exists pip3 || return 1
    return 0
}

ditto_get_python_command() {
    local check_only="${1:-0}"

    if ditto_command_exists python3; then
        if [[ "$check_only" != "1" ]]; then
            ditto_detect_system
            if [[ "$DITTO_PACKAGE_MANAGER" == "apt" ]] && ! ditto_command_exists pip3; then
                ditto_install_python_apt || return 1
            fi
        fi
        DITTO_PYTHON_CMD=(python3)
        return 0
    fi

    if [[ "$check_only" != "1" ]]; then
        ditto_detect_system
        if [[ "$DITTO_PACKAGE_MANAGER" == "apt" ]]; then
            ditto_install_python_apt || return 1
            if ditto_command_exists python3; then
                DITTO_PYTHON_CMD=(python3)
                return 0
            fi
        fi
    fi

    if ditto_require_command python3 "Python 3" "$check_only"; then
        if ditto_command_exists python3; then
            DITTO_PYTHON_CMD=(python3)
            return 0
        fi
    fi

    ditto_error "Python 3 non trovato. Installa Python 3.10+ e rilancia."
    ditto_print_install_hint "python3" "Python 3"
    return 1
}

ditto_get_python_version() {
    "${DITTO_PYTHON_CMD[@]}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
}

ditto_try_fix_python_venv() {
    local error_output="$1"
    local python_version=""
    local versioned_package=""

    if ! grep -qi "ensurepip is not available" <<<"$error_output"; then
        return 1
    fi

    ditto_detect_system
    if [[ "$DITTO_PACKAGE_MANAGER" != "apt" ]]; then
        return 1
    fi

    python_version="$(ditto_get_python_version 2>/dev/null || true)"
    ditto_install_notice "Installazione supporto venv Python in corso..."
    ditto_update_package_index_once || return 1

    if [[ -n "$python_version" ]]; then
        versioned_package="python${python_version}-venv"
        if ditto_run_with_sudo_quiet apt install -y "$versioned_package"; then
            return 0
        fi
    fi

    ditto_run_with_sudo_quiet apt install -y python3-venv || return 1
    return 0
}

ditto_create_backend_venv() {
    local backend_dir="$1"
    local venv_log="$2"

    if (cd "$backend_dir" && "${DITTO_PYTHON_CMD[@]}" -m venv venv) >"$venv_log" 2>&1; then
        return 0
    fi

    if ditto_try_fix_python_venv "$(cat "$venv_log")"; then
        (cd "$backend_dir" && "${DITTO_PYTHON_CMD[@]}" -m venv venv) >"$venv_log" 2>&1
        return $?
    fi

    return 1
}

ditto_ensure_venv_pip() {
    local backend_dir="$1"
    local venv_dir="$2"
    local venv_python="$3"
    local venv_log
    local backup_dir

    if "$venv_python" -m pip --version >/dev/null 2>&1; then
        return 0
    fi

    ditto_install_notice "Riparazione pip ambiente virtuale in corso..."
    "$venv_python" -m ensurepip --upgrade >/dev/null 2>&1 || true
    if "$venv_python" -m pip --version >/dev/null 2>&1; then
        return 0
    fi

    backup_dir="${venv_dir}.broken.$(date +%Y%m%d_%H%M%S)"
    mv "$venv_dir" "$backup_dir"
    venv_log="$(mktemp)"
    if ! ditto_create_backend_venv "$backend_dir" "$venv_log"; then
        ditto_error "Riparazione ambiente virtuale backend fallita."
        cat "$venv_log" >&2
        rm -f "$venv_log"
        return 1
    fi
    rm -f "$venv_log"

    if ! "$venv_python" -m pip --version >/dev/null 2>&1; then
        ditto_error "pip non disponibile neppure dopo la ricreazione del virtualenv."
        return 1
    fi
}

ditto_ensure_frontend_dependencies() {
    local frontend_dir="$1"
    local check_only="${2:-0}"

    ditto_require_command node Node.js "$check_only" || return 1
    ditto_require_command npm npm "$check_only" || return 1

    if [[ "$check_only" == "1" ]]; then
        ditto_info "CheckOnly: verifico solo se node_modules esiste: $( [[ -d "$frontend_dir/node_modules" ]] && printf true || printf false )"
        return 0
    fi

    if [[ ! -d "$frontend_dir/node_modules" ]]; then
        (cd "$frontend_dir" && npm install --silent --no-fund --no-audit >/dev/null 2>&1)
    else
        ditto_ok "Dipendenze Node.js gia installate."
    fi
}

ditto_ensure_backend_dependencies() {
    local backend_dir="$1"
    local check_only="${2:-0}"
    local venv_dir="$backend_dir/venv"
    local venv_python="$venv_dir/bin/python"
    local venv_log=""

    if [[ "$check_only" == "1" ]]; then
        ditto_info "CheckOnly: verifico solo se venv esiste: $( [[ -d "$venv_dir" ]] && printf true || printf false )"
        return 0
    fi

    ditto_get_python_command "$check_only" || return 1
    ditto_ok "Python disponibile: ${DITTO_PYTHON_CMD[*]}"

    if [[ ! -d "$venv_dir" ]]; then
        ditto_info "Creo ambiente virtuale backend..."
        venv_log="$(mktemp)"
        if ! ditto_create_backend_venv "$backend_dir" "$venv_log"; then
            ditto_error "Creazione ambiente virtuale backend fallita."
            cat "$venv_log" >&2
            rm -f "$venv_log"
            return 1
        fi
        rm -f "$venv_log"
    fi

    if [[ ! -x "$venv_python" ]]; then
        ditto_error "Python del virtualenv non trovato: $venv_python"
        return 1
    fi

    ditto_ensure_venv_pip "$backend_dir" "$venv_dir" "$venv_python" || return 1

    "$venv_python" -m pip install --upgrade pip --quiet --disable-pip-version-check || ditto_warn "Aggiornamento pip non completato; continuo con la versione installata."

    if [[ -f "$backend_dir/requirements.txt" ]]; then
        (cd "$backend_dir" && "$venv_python" -m pip install -r requirements.txt --quiet)
    else
        ditto_warn "requirements.txt non trovato, installo dipendenze base."
        (cd "$backend_dir" && "$venv_python" -m pip install fastapi uvicorn sqlalchemy psycopg2-binary "python-jose[cryptography]" "passlib[bcrypt]" python-multipart python-dotenv requests --quiet)
    fi
}

ditto_load_ollama_config() {
    local backend_env_path="$1"

    DITTO_OLLAMA_MODEL="$(ditto_read_env_value "$backend_env_path" "OLLAMA_MODEL" || true)"
    DITTO_OLLAMA_BASE_URL="$(ditto_read_env_value "$backend_env_path" "OLLAMA_BASE_URL" || true)"
    DITTO_OLLAMA_RUNTIME="$(ditto_read_env_value "$backend_env_path" "OLLAMA_RUNTIME" || true)"
    DITTO_OLLAMA_ACCELERATOR="$(ditto_read_env_value "$backend_env_path" "OLLAMA_ACCELERATOR" || true)"
    DITTO_OLLAMA_NATIVE_VULKAN="$(ditto_read_env_value "$backend_env_path" "OLLAMA_NATIVE_VULKAN" || true)"
    DITTO_OLLAMA_KEEP_ALIVE="$(ditto_read_env_value "$backend_env_path" "OLLAMA_KEEP_ALIVE" || true)"
    DITTO_OLLAMA_TOP_K="$(ditto_read_env_value "$backend_env_path" "OLLAMA_TOP_K" || true)"
    DITTO_OLLAMA_TOP_P="$(ditto_read_env_value "$backend_env_path" "OLLAMA_TOP_P" || true)"
    DITTO_OLLAMA_NUM_CTX="$(ditto_read_env_value "$backend_env_path" "OLLAMA_NUM_CTX" || true)"
    DITTO_OLLAMA_NUM_THREAD="$(ditto_read_env_value "$backend_env_path" "OLLAMA_NUM_THREAD" || true)"

    DITTO_OLLAMA_MODEL="${DITTO_OLLAMA_MODEL:-$DITTO_DEFAULT_OLLAMA_MODEL}"
    DITTO_OLLAMA_BASE_URL="${DITTO_OLLAMA_BASE_URL:-$DITTO_DEFAULT_OLLAMA_BASE_URL}"
    DITTO_OLLAMA_RUNTIME="native"
    DITTO_OLLAMA_ACCELERATOR="${DITTO_OLLAMA_ACCELERATOR:-auto}"
    DITTO_OLLAMA_NATIVE_VULKAN="${DITTO_OLLAMA_NATIVE_VULKAN:-1}"
    DITTO_OLLAMA_KEEP_ALIVE="${DITTO_OLLAMA_KEEP_ALIVE:-30m}"
    DITTO_OLLAMA_TOP_K="${DITTO_OLLAMA_TOP_K:-20}"
    DITTO_OLLAMA_TOP_P="${DITTO_OLLAMA_TOP_P:-0.8}"
    DITTO_OLLAMA_NUM_CTX="${DITTO_OLLAMA_NUM_CTX:-2048}"
    DITTO_OLLAMA_NUM_THREAD="${DITTO_OLLAMA_NUM_THREAD:-4}"
}

ditto_resolve_ollama_runtime() {
    DITTO_OLLAMA_USE_NATIVE=1
    DITTO_OLLAMA_RUNTIME="native"
    ditto_require_command ollama "Ollama nativo" 0 || return 1
}

ditto_new_backend_env() {
    local env_path="$1"
    local ip="$2"
    local frontend_port="${3:-$DITTO_DEFAULT_FRONTEND_PORT}"
    local database_password secret_key admin_password existing_database_password

    database_password="$(ditto_generate_secret)"
    secret_key="$(ditto_generate_secret)"
    admin_password="$(ditto_generate_admin_password)"

    if [[ -f "$env_path" ]]; then
        existing_database_password="$(ditto_read_env_value "$env_path" "DATABASE_PASSWORD" || true)"
        if [[ -n "${existing_database_password:-}" ]]; then
            database_password="$existing_database_password"
        fi
    fi

    cat > "$env_path" <<EOF
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=$database_password
DATABASE_NAME=ditto_db
SECRET_KEY=$secret_key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$admin_password
ACCESS_TOKEN_EXPIRE_MINUTES=480
ADMIN_TOKEN_EXPIRE_MINUTES=120
OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES=480
ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES=120
ALGORITHM=HS256
ALLOWED_ORIGINS=https://localhost:$frontend_port,https://$ip:$frontend_port
REFRESH_TOKEN_COOKIE_SECURE=true
REFRESH_TOKEN_COOKIE_SAMESITE=lax
OLLAMA_BASE_URL=$DITTO_OLLAMA_BASE_URL
OLLAMA_MODEL=$DITTO_OLLAMA_MODEL
OLLAMA_RUNTIME=native
OLLAMA_ACCELERATOR=$DITTO_OLLAMA_ACCELERATOR
OLLAMA_NATIVE_VULKAN=$DITTO_OLLAMA_NATIVE_VULKAN
OLLAMA_TIMEOUT_SECONDS=120
OLLAMA_HEALTH_TIMEOUT_SECONDS=5
OLLAMA_KEEP_ALIVE=$DITTO_OLLAMA_KEEP_ALIVE
OLLAMA_NUM_PREDICT_CLASSIFY=4
OLLAMA_NUM_PREDICT_SELECT=2
OLLAMA_NUM_PREDICT_RERANK=12
OLLAMA_TOP_K=$DITTO_OLLAMA_TOP_K
OLLAMA_TOP_P=$DITTO_OLLAMA_TOP_P
OLLAMA_TEMPERATURE_CLASSIFY=0.0
OLLAMA_TEMPERATURE_SELECT=0.0
OLLAMA_NUM_CTX=$DITTO_OLLAMA_NUM_CTX
OLLAMA_NUM_THREAD=$DITTO_OLLAMA_NUM_THREAD
TTS_ENABLED=true
EOF
}

ditto_wait_postgres() {
    local attempts="${1:-30}"
    local attempt

    for ((attempt = 1; attempt <= attempts; attempt++)); do
        if ditto_docker exec ditto_postgres pg_isready -U postgres >/dev/null 2>&1; then
            ditto_ok "PostgreSQL e pronto."
            return 0
        fi
        sleep 2
    done

    ditto_warn "PostgreSQL potrebbe non essere ancora pronto."
    return 1
}

ditto_test_http() {
    local url="$1"
    local timeout="${2:-3}"
    curl -fsS --max-time "$timeout" "$url" >/dev/null 2>&1
}

ditto_ensure_native_ollama() {
    local check_only="${1:-0}"
    local attempt

    ditto_require_command ollama "Ollama nativo" "$check_only" || return 1

    if [[ "$check_only" == "1" ]]; then
        ditto_info "CheckOnly: non avvio Ollama nativo."
        return 0
    fi

    if ditto_test_http "$DITTO_OLLAMA_BASE_URL/api/tags" 5; then
        ditto_ok "Ollama nativo raggiungibile."
        return 0
    fi

    ditto_install_notice "Avvio Ollama nativo in corso..."
    if ditto_command_exists systemctl; then
        ditto_run_with_sudo systemctl enable ollama >/dev/null 2>&1 || true
        ditto_run_with_sudo systemctl start ollama >/dev/null 2>&1 || true
        for ((attempt = 1; attempt <= 8; attempt++)); do
            sleep 2
            if ditto_test_http "$DITTO_OLLAMA_BASE_URL/api/tags" 5; then
                ditto_ok "Ollama nativo raggiungibile."
                return 0
            fi
        done
    fi

    if ditto_command_exists systemd-run; then
        systemd-run --user --unit ditto-ollama --same-dir env OLLAMA_VULKAN="$DITTO_OLLAMA_NATIVE_VULKAN" ollama serve >/dev/null 2>&1 || true
    else
        (OLLAMA_VULKAN="$DITTO_OLLAMA_NATIVE_VULKAN" nohup ollama serve >/tmp/ditto-ollama.log 2>&1 &)
    fi

    for ((attempt = 1; attempt <= 20; attempt++)); do
        sleep 2
        if ditto_test_http "$DITTO_OLLAMA_BASE_URL/api/tags" 5; then
            ditto_ok "Ollama nativo raggiungibile."
            return 0
        fi
    done

    ditto_error "Ollama nativo non risponde ancora su $DITTO_OLLAMA_BASE_URL."
    if ditto_command_exists systemctl; then
        ditto_info "Controlla il servizio con: sudo systemctl status ollama --no-pager"
    else
        ditto_info "Controlla il log con: tail -n 100 /tmp/ditto-ollama.log"
    fi
    return 1
}

ditto_ensure_ollama_model() {
    local check_only="${1:-0}"
    local models_output

    if [[ "$check_only" == "1" ]]; then
        ditto_info "CheckOnly: non controllo ne scarico il modello Ollama."
        return 0
    fi

    ditto_info "Preparazione modello AI: $DITTO_OLLAMA_MODEL"
    ditto_ensure_native_ollama 0 || return 1
    models_output="$(ollama list 2>/dev/null || true)"
    if ! grep -Fq "$DITTO_OLLAMA_MODEL" <<<"$models_output"; then
        ditto_install_notice "Download modello Ollama in corso..."
        ollama pull "$DITTO_OLLAMA_MODEL" >/dev/null 2>&1
    fi
    ditto_ok "Modello $DITTO_OLLAMA_MODEL pronto su Ollama nativo."
}

ditto_ollama_warmup() {
    local check_only="${1:-0}"
    local body ready=0 attempt

    if [[ "$check_only" == "1" ]]; then
        ditto_info "CheckOnly: salto warmup Ollama."
        return 0
    fi

    ditto_info "Attendo che Ollama risponda su $DITTO_OLLAMA_BASE_URL..."
    for ((attempt = 1; attempt <= 30; attempt++)); do
        if ditto_test_http "$DITTO_OLLAMA_BASE_URL/api/tags" 5; then
            ready=1
            break
        fi
        sleep 2
    done

    if [[ "$ready" != "1" ]]; then
        ditto_warn "Ollama non risponde ancora all'endpoint /api/tags."
        return 0
    fi

    ditto_info "Warmup modello AI in corso..."
    body=$(cat <<EOF
{"model":"$DITTO_OLLAMA_MODEL","prompt":"Rispondi solo OK","stream":false,"think":false,"keep_alive":"$DITTO_OLLAMA_KEEP_ALIVE","options":{"temperature":0,"top_k":$DITTO_OLLAMA_TOP_K,"top_p":$DITTO_OLLAMA_TOP_P,"num_predict":12,"num_ctx":$DITTO_OLLAMA_NUM_CTX,"num_thread":$DITTO_OLLAMA_NUM_THREAD}}
EOF
)

    if curl -fsS "$DITTO_OLLAMA_BASE_URL/api/generate" -H "Content-Type: application/json" -d "$body" >/dev/null 2>&1; then
        ditto_ok "Modello AI pronto."
    else
        ditto_warn "Warmup Ollama non completato. Il primo prompt potrebbe essere piu lento."
    fi
}

ditto_start_terminal() {
    local title="$1"
    local command="$2"

    if ditto_command_exists gnome-terminal; then
        gnome-terminal --title="$title" -- bash -lc "$command; exec bash" &
    elif ditto_command_exists konsole; then
        konsole --new-tab --title "$title" -e bash -lc "$command; exec bash" &
    elif ditto_command_exists xterm; then
        xterm -title "$title" -e bash -lc "$command; exec bash" &
    else
        bash -lc "$command" &
    fi
}
