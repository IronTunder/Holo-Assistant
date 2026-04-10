#!/usr/bin/env bash

set -euo pipefail

HOLO_ASSISTANT_DEFAULT_BACKEND_PORT=8000
HOLO_ASSISTANT_DEFAULT_FRONTEND_PORT=5173
HOLO_ASSISTANT_DEFAULT_OLLAMA_MODEL="qwen3.5:9b"
HOLO_ASSISTANT_DEFAULT_OLLAMA_BASE_URL="http://127.0.0.1:11434"
HOLO_ASSISTANT_VOSK_MODEL_PUBLIC_URL="/models/vosk-model-small-it-0.22.tar.gz"
HOLO_ASSISTANT_VOSK_MODEL_ARCHIVE_NAME="vosk-model-small-it-0.22.tar.gz"
HOLO_ASSISTANT_PIPER_DEFAULT_VOICE_KEY="it_IT-paola-medium"
HOLO_ASSISTANT_PIPER_DEFAULT_VOICE_MODEL_FILENAME="${HOLO_ASSISTANT_PIPER_DEFAULT_VOICE_KEY}.onnx"
HOLO_ASSISTANT_PIPER_DEFAULT_VOICE_CONFIG_FILENAME="${HOLO_ASSISTANT_PIPER_DEFAULT_VOICE_MODEL_FILENAME}.json"
HOLO_ASSISTANT_UNIX_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOLO_ASSISTANT_ROOT_DIR="$(cd "$HOLO_ASSISTANT_UNIX_SCRIPT_DIR/../.." && pwd)"

if [[ -t 1 ]]; then
    HOLO_ASSISTANT_RED=$'\033[0;31m'
    HOLO_ASSISTANT_GREEN=$'\033[0;32m'
    HOLO_ASSISTANT_YELLOW=$'\033[1;33m'
    HOLO_ASSISTANT_BLUE=$'\033[0;34m'
    HOLO_ASSISTANT_CYAN=$'\033[0;36m'
    HOLO_ASSISTANT_BOLD=$'\033[1m'
    HOLO_ASSISTANT_NC=$'\033[0m'
else
    HOLO_ASSISTANT_RED=''
    HOLO_ASSISTANT_GREEN=''
    HOLO_ASSISTANT_YELLOW=''
    HOLO_ASSISTANT_BLUE=''
    HOLO_ASSISTANT_CYAN=''
    HOLO_ASSISTANT_BOLD=''
    HOLO_ASSISTANT_NC=''
fi

HOLO_ASSISTANT_OLLAMA_USE_NATIVE=0
declare -ag HOLO_ASSISTANT_OLLAMA_COMPOSE_ARGS=("-f" "docker-compose.yml")

HOLO_ASSISTANT_OLLAMA_MODEL="$HOLO_ASSISTANT_DEFAULT_OLLAMA_MODEL"
HOLO_ASSISTANT_OLLAMA_BASE_URL="$HOLO_ASSISTANT_DEFAULT_OLLAMA_BASE_URL"
HOLO_ASSISTANT_OLLAMA_RUNTIME="auto"
HOLO_ASSISTANT_OLLAMA_ACCELERATOR="auto"
HOLO_ASSISTANT_OLLAMA_NATIVE_VULKAN="1"
HOLO_ASSISTANT_OLLAMA_KEEP_ALIVE="30m"
HOLO_ASSISTANT_OLLAMA_TOP_K="20"
HOLO_ASSISTANT_OLLAMA_TOP_P="0.8"
HOLO_ASSISTANT_OLLAMA_NUM_CTX="2048"
HOLO_ASSISTANT_OLLAMA_NUM_THREAD="4"
HOLO_ASSISTANT_OS_ID=""
HOLO_ASSISTANT_OS_NAME=""
HOLO_ASSISTANT_PACKAGE_MANAGER=""
HOLO_ASSISTANT_PACKAGE_INDEX_UPDATED=0
declare -ag HOLO_ASSISTANT_DOCKER_CMD=("docker")
declare -ag HOLO_ASSISTANT_DOCKER_COMPOSE_CMD=("docker" "compose")
HOLO_ASSISTANT_DOCKER_USE_SUDO=0
HOLO_ASSISTANT_DOCKER_COMPOSE_MODE="compose"

holo_assistant_info() {
    printf '%b[INFO]%b %s\n' "$HOLO_ASSISTANT_BLUE" "$HOLO_ASSISTANT_NC" "$1"
}

holo_assistant_ok() {
    printf '%b[OK]%b %s\n' "$HOLO_ASSISTANT_GREEN" "$HOLO_ASSISTANT_NC" "$1"
}

holo_assistant_warn() {
    printf '%b[AVVISO]%b %s\n' "$HOLO_ASSISTANT_YELLOW" "$HOLO_ASSISTANT_NC" "$1"
}

holo_assistant_error() {
    printf '%b[ERRORE]%b %s\n' "$HOLO_ASSISTANT_RED" "$HOLO_ASSISTANT_NC" "$1" >&2
}

holo_assistant_step() {
    printf '\n%b%s%b\n' "$HOLO_ASSISTANT_CYAN$HOLO_ASSISTANT_BOLD" "$1" "$HOLO_ASSISTANT_NC"
}

holo_assistant_install_notice() {
    printf '\n%b%s%b\n' "$HOLO_ASSISTANT_CYAN$HOLO_ASSISTANT_BOLD" "$1" "$HOLO_ASSISTANT_NC"
}

holo_assistant_root() {
    printf '%s\n' "$HOLO_ASSISTANT_ROOT_DIR"
}

holo_assistant_command_exists() {
    command -v "$1" >/dev/null 2>&1
}

holo_assistant_try_add_common_paths() {
    local candidate

    for candidate in /usr/local/bin /usr/bin /bin /snap/bin; do
        if [[ ":$PATH:" != *":$candidate:"* && -d "$candidate" ]]; then
            PATH="$candidate:$PATH"
        fi
    done
    export PATH
}

holo_assistant_detect_system() {
    if [[ -n "$HOLO_ASSISTANT_OS_ID" ]]; then
        return
    fi

    if [[ -f /etc/os-release ]]; then
        # shellcheck disable=SC1091
        source /etc/os-release
        HOLO_ASSISTANT_OS_ID="${ID:-linux}"
        HOLO_ASSISTANT_OS_NAME="${PRETTY_NAME:-${NAME:-Linux}}"
    else
        HOLO_ASSISTANT_OS_ID="linux"
        HOLO_ASSISTANT_OS_NAME="Linux"
    fi

    if holo_assistant_command_exists apt-get; then
        HOLO_ASSISTANT_PACKAGE_MANAGER="apt"
    elif holo_assistant_command_exists dnf; then
        HOLO_ASSISTANT_PACKAGE_MANAGER="dnf"
    elif holo_assistant_command_exists yum; then
        HOLO_ASSISTANT_PACKAGE_MANAGER="yum"
    elif holo_assistant_command_exists pacman; then
        HOLO_ASSISTANT_PACKAGE_MANAGER="pacman"
    elif holo_assistant_command_exists zypper; then
        HOLO_ASSISTANT_PACKAGE_MANAGER="zypper"
    else
        HOLO_ASSISTANT_PACKAGE_MANAGER="unknown"
    fi
}

holo_assistant_install_hint() {
    local command_name="$1"

    holo_assistant_detect_system
    case "$command_name:$HOLO_ASSISTANT_PACKAGE_MANAGER" in
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

holo_assistant_print_install_hint() {
    local command_name="$1"
    local display_name="$2"
    local hint

    holo_assistant_detect_system
    hint="$(holo_assistant_install_hint "$command_name")"
    if [[ -n "$hint" ]]; then
        holo_assistant_info "Installazione consigliata per $display_name su $HOLO_ASSISTANT_OS_NAME:"
        printf '       %s\n' "$hint"
    fi
}

holo_assistant_package_names_for_command() {
    local command_name="$1"

    holo_assistant_detect_system
    case "$command_name:$HOLO_ASSISTANT_PACKAGE_MANAGER" in
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

holo_assistant_run_with_sudo() {
    if [[ "$(id -u)" == "0" ]]; then
        "$@"
    else
        sudo "$@"
    fi
}

holo_assistant_run_quiet() {
    "$@" >/dev/null 2>&1
}

holo_assistant_run_with_sudo_quiet() {
    if [[ "$(id -u)" == "0" ]]; then
        "$@" >/dev/null 2>&1
    else
        sudo "$@" >/dev/null 2>&1
    fi
}

holo_assistant_run_quiet_checked() {
    local failure_message="$1"
    shift

    local log_file
    log_file="$(mktemp)"
    if "$@" >"$log_file" 2>&1; then
        rm -f "$log_file"
        return 0
    fi

    holo_assistant_error "$failure_message"
    if [[ -s "$log_file" ]]; then
        tail -n 20 "$log_file" >&2
    fi
    rm -f "$log_file"
    return 1
}

holo_assistant_configure_docker_commands() {
    local use_sudo="${1:-0}"
    local compose_binary="${2:-compose}"

    HOLO_ASSISTANT_DOCKER_USE_SUDO="$use_sudo"
    HOLO_ASSISTANT_DOCKER_COMPOSE_MODE="$compose_binary"

    if [[ "$use_sudo" == "1" ]]; then
        HOLO_ASSISTANT_DOCKER_CMD=("sudo" "docker")
        if [[ "$compose_binary" == "docker-compose" ]]; then
            HOLO_ASSISTANT_DOCKER_COMPOSE_CMD=("sudo" "docker-compose")
        else
            HOLO_ASSISTANT_DOCKER_COMPOSE_CMD=("sudo" "docker" "compose")
        fi
        return
    fi

    HOLO_ASSISTANT_DOCKER_CMD=("docker")
    if [[ "$compose_binary" == "docker-compose" ]]; then
        HOLO_ASSISTANT_DOCKER_COMPOSE_CMD=("docker-compose")
    else
        HOLO_ASSISTANT_DOCKER_COMPOSE_CMD=("docker" "compose")
    fi
}

holo_assistant_update_package_index_once() {
    holo_assistant_detect_system
    if [[ "$HOLO_ASSISTANT_PACKAGE_INDEX_UPDATED" == "1" ]]; then
        return 0
    fi

    case "$HOLO_ASSISTANT_PACKAGE_MANAGER" in
        apt)
            holo_assistant_run_with_sudo_quiet apt-get -qq update
            ;;
    esac

    HOLO_ASSISTANT_PACKAGE_INDEX_UPDATED=1
}

holo_assistant_install_docker_official_apt() {
    local packages_to_remove codename arch

    holo_assistant_install_notice "Installazione Docker ufficiale in corso..."
    packages_to_remove="$(dpkg --get-selections docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc 2>/dev/null | cut -f1 | xargs || true)"
    if [[ -n "${packages_to_remove:-}" ]]; then
        holo_assistant_run_with_sudo_quiet apt -qq remove -y $packages_to_remove
    fi

    holo_assistant_update_package_index_once || return 1
    holo_assistant_run_with_sudo_quiet apt-get -qq install -y ca-certificates curl || return 1
    holo_assistant_run_with_sudo_quiet install -m 0755 -d /etc/apt/keyrings || return 1
    holo_assistant_run_with_sudo_quiet curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc || return 1
    holo_assistant_run_with_sudo_quiet chmod a+r /etc/apt/keyrings/docker.asc || return 1

    # shellcheck disable=SC1091
    source /etc/os-release
    codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
    arch="$(dpkg --print-architecture)"
    if [[ -z "$codename" || -z "$arch" ]]; then
        return 1
    fi

    printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$codename" "$arch" | holo_assistant_run_with_sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null || return 1

    HOLO_ASSISTANT_PACKAGE_INDEX_UPDATED=0
    holo_assistant_update_package_index_once || return 1
    holo_assistant_run_with_sudo_quiet apt-get -qq install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || return 1
}

holo_assistant_try_install_command() {
    local command_name="$1"
    local display_name="$2"
    local packages

    holo_assistant_detect_system
    if [[ "$command_name" == "docker" && "$HOLO_ASSISTANT_PACKAGE_MANAGER" == "apt" ]]; then
        holo_assistant_install_docker_official_apt || return 1
        holo_assistant_try_add_common_paths
        if holo_assistant_command_exists docker; then
            holo_assistant_ok "$display_name installato automaticamente."
            return 0
        fi
        return 1
    fi

    packages="$(holo_assistant_package_names_for_command "$command_name")"
    if [[ -z "$packages" ]]; then
        return 1
    fi

    holo_assistant_install_notice "Installazione $display_name in corso..."
    case "$HOLO_ASSISTANT_PACKAGE_MANAGER" in
        apt)
            holo_assistant_update_package_index_once || return 1
            holo_assistant_run_with_sudo_quiet apt-get -qq install -y $packages || return 1
            ;;
        dnf)
            holo_assistant_run_with_sudo_quiet dnf -q install -y $packages || return 1
            ;;
        yum)
            holo_assistant_run_with_sudo_quiet yum -q install -y $packages || return 1
            ;;
        pacman)
            holo_assistant_run_with_sudo_quiet pacman -S --needed --noconfirm $packages || return 1
            ;;
        zypper)
            holo_assistant_run_with_sudo_quiet zypper --quiet install -y $packages || return 1
            ;;
        *)
            return 1
            ;;
    esac

    holo_assistant_try_add_common_paths
    if holo_assistant_command_exists "$command_name"; then
        holo_assistant_ok "$display_name installato automaticamente."
        return 0
    fi

    return 1
}

holo_assistant_try_install_ollama() {
    local display_name="$1"

    if ! holo_assistant_command_exists curl; then
        return 1
    fi

    holo_assistant_install_notice "Installazione $display_name in corso..."
    if ! bash -c "$(curl -fsSL https://ollama.com/install.sh)" >/dev/null 2>&1; then
        return 1
    fi

    holo_assistant_try_add_common_paths
    if holo_assistant_command_exists ollama; then
        holo_assistant_ok "$display_name installato automaticamente."
        return 0
    fi

    return 1
}

holo_assistant_require_command() {
    local command_name="$1"
    local display_name="$2"
    local check_only="${3:-0}"

    holo_assistant_try_add_common_paths
    if holo_assistant_command_exists "$command_name"; then
        holo_assistant_ok "$display_name disponibile."
        return 0
    fi

    if [[ "$check_only" != "1" ]]; then
        if [[ "$command_name" == "ollama" ]]; then
            if holo_assistant_try_install_ollama "$display_name"; then
                return 0
            fi
        else
            if holo_assistant_try_install_command "$command_name" "$display_name"; then
                return 0
            fi
        fi
    fi

    holo_assistant_error "$display_name non trovato nel PATH."
    if [[ "$check_only" != "1" ]]; then
        holo_assistant_warn "Installazione automatica non riuscita oppure non supportata."
    fi
    holo_assistant_print_install_hint "$command_name" "$display_name"
    return 1
}

holo_assistant_read_env_value() {
    local env_path="$1"
    local key="$2"

    if [[ ! -f "$env_path" ]]; then
        return 1
    fi

    awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, "", $0); print $0; exit }' "$env_path"
}

holo_assistant_set_env_values() {
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

holo_assistant_export_env_value() {
    local env_path="$1"
    local key="$2"
    local value

    value="$(holo_assistant_read_env_value "$env_path" "$key" || true)"
    if [[ -z "${value:-}" ]]; then
        holo_assistant_error "Variabile $key mancante in $env_path"
        return 1
    fi

    export "$key=$value"
}

holo_assistant_generate_secret() {
    if holo_assistant_command_exists openssl; then
        openssl rand -hex 32
        return
    fi

    local value
    set +o pipefail
    value="$(tr -dc 'a-f0-9' < /dev/urandom | head -c 64)"
    set -o pipefail
    printf '%s\n' "$value"
}

holo_assistant_generate_admin_password() {
    local value
    set +o pipefail
    value="$(tr -dc 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&?' < /dev/urandom | head -c 20)"
    set -o pipefail
    printf '%s\n' "$value"
}

holo_assistant_get_local_ip() {
    local ip route_ip

    if holo_assistant_command_exists ip; then
        route_ip="$(ip route get 1 2>/dev/null | awk '/src/ { for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }')"
        if [[ -n "${route_ip:-}" ]]; then
            printf '%s\n' "$route_ip"
            return
        fi
    fi

    if holo_assistant_command_exists hostname; then
        ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
        if [[ -n "${ip:-}" ]]; then
            printf '%s\n' "$ip"
            return
        fi
    fi

    printf 'localhost\n'
}

holo_assistant_invoke_checked() {
    local failure_message="$1"
    shift

    if ! "$@"; then
        holo_assistant_error "$failure_message"
        return 1
    fi
}

holo_assistant_parse_check_only() {
    HOLO_ASSISTANT_CHECK_ONLY=0
    declare -ga HOLO_ASSISTANT_SCRIPT_ARGS=()

    while (($#)); do
        case "$1" in
            --check-only)
                HOLO_ASSISTANT_CHECK_ONLY=1
                ;;
            *)
                HOLO_ASSISTANT_SCRIPT_ARGS+=("$1")
                ;;
        esac
        shift
    done
}

holo_assistant_ensure_mkcert_trust() {
    local install_log

    install_log="$(mktemp)"
    if mkcert -install >"$install_log" 2>&1; then
        rm -f "$install_log"
        return 0
    fi

    holo_assistant_detect_system
    if [[ "$HOLO_ASSISTANT_PACKAGE_MANAGER" == "apt" ]]; then
        holo_assistant_install_notice "Configurazione trust HTTPS locale in corso..."
        holo_assistant_update_package_index_once || true
        holo_assistant_run_with_sudo_quiet apt install -y libnss3-tools || true
        if mkcert -install >"$install_log" 2>&1; then
            rm -f "$install_log"
            return 0
        fi
    fi

    holo_assistant_error "Installazione della CA locale mkcert fallita."
    if [[ -s "$install_log" ]]; then
        tail -n 20 "$install_log" >&2
    fi
    rm -f "$install_log"
    return 1
}

holo_assistant_trust_system_certificate() {
    local cert_file="$1"
    local ca_store_dir="/usr/local/share/ca-certificates"
    local system_cert_name="holo-assistant-local.crt"
    local caroot=""
    local root_ca=""

    if ! holo_assistant_command_exists update-ca-certificates; then
        return 0
    fi

    holo_assistant_install_notice "Aggiornamento certificati trusted di sistema in corso..."
    holo_assistant_run_with_sudo_quiet install -m 0755 -d "$ca_store_dir" || return 1
    holo_assistant_run_with_sudo_quiet cp "$cert_file" "$ca_store_dir/$system_cert_name" || return 1

    caroot="$(mkcert -CAROOT 2>/dev/null || true)"
    root_ca="${caroot%/}/rootCA.pem"
    if [[ -n "${caroot:-}" && -f "$root_ca" ]]; then
        holo_assistant_run_with_sudo_quiet cp "$root_ca" "$ca_store_dir/holo-assistant-mkcert-root-ca.crt" || return 1
    fi

    holo_assistant_run_with_sudo_quiet update-ca-certificates || return 1
    return 0
}

holo_assistant_ensure_https_certificate() {
    local root_dir="$1"
    local ip="$2"
    local check_only="${3:-0}"
    local cert_file="$root_dir/certs/holo-assistant.crt"
    local key_file="$root_dir/certs/holo-assistant.key"

    if [[ "$check_only" != "1" ]]; then
        holo_assistant_ensure_mkcert_trust || return 1
    fi

    if [[ -f "$cert_file" && -f "$key_file" ]]; then
        if [[ "$check_only" != "1" ]]; then
            holo_assistant_trust_system_certificate "$cert_file" || return 1
        fi
        holo_assistant_ok "HTTPS attivo con certificato: $cert_file"
        HOLO_ASSISTANT_CERT_FILE="$cert_file"
        HOLO_ASSISTANT_KEY_FILE="$key_file"
        return 0
    fi

    if ! holo_assistant_require_command mkcert "mkcert" "$check_only"; then
        holo_assistant_error "Certificato HTTPS mancante e mkcert non e disponibile. Installa mkcert oppure genera manualmente certs/holo-assistant.crt e certs/holo-assistant.key."
        return 1
    fi

    if [[ "$check_only" == "1" ]]; then
        holo_assistant_info "CheckOnly: certificato HTTPS mancante, ma non genero file."
        HOLO_ASSISTANT_CERT_FILE="$cert_file"
        HOLO_ASSISTANT_KEY_FILE="$key_file"
        return 0
    fi

    mkdir -p "$root_dir/certs"
    mkcert -cert-file "$cert_file" -key-file "$key_file" "$ip" localhost 127.0.0.1 holo-assistant.lan >/dev/null

    if [[ ! -f "$cert_file" || ! -f "$key_file" ]]; then
        holo_assistant_error "Certificato HTTPS non creato correttamente."
        return 1
    fi

    holo_assistant_trust_system_certificate "$cert_file" || return 1

    holo_assistant_ok "Certificato HTTPS generato."
    HOLO_ASSISTANT_CERT_FILE="$cert_file"
    HOLO_ASSISTANT_KEY_FILE="$key_file"
}

holo_assistant_ensure_docker() {
    local check_only="${1:-0}"
    local docker_info_output=""

    holo_assistant_require_command docker Docker "$check_only" || return 1
    if docker compose version >/dev/null 2>&1; then
        holo_assistant_configure_docker_commands 0 compose
    elif holo_assistant_command_exists docker-compose; then
        holo_assistant_configure_docker_commands 0 docker-compose
    else
        holo_assistant_error "Docker Compose non disponibile."
        holo_assistant_print_install_hint "docker" "Docker"
        return 1
    fi
    holo_assistant_ok "Docker Compose disponibile: ${HOLO_ASSISTANT_DOCKER_COMPOSE_CMD[*]}"

    if [[ "$check_only" == "1" ]]; then
        holo_assistant_info "CheckOnly: non invoco Docker Compose e non controllo il daemon."
        return 0
    fi

    if holo_assistant_docker info >/dev/null 2>&1; then
        holo_assistant_ok "Docker daemon gia pronto."
        return 0
    fi

    docker_info_output="$(holo_assistant_docker info 2>&1 || true)"

    if grep -qi "permission denied" <<<"$docker_info_output"; then
        if getent group docker >/dev/null 2>&1; then
            holo_assistant_run_with_sudo usermod -aG docker "${USER:-$LOGNAME}" >/dev/null 2>&1 || true
        fi

        if [[ "${HOLO_ASSISTANT_DOCKER_COMPOSE_CMD[*]}" == "docker-compose" ]]; then
            holo_assistant_configure_docker_commands 1 docker-compose
        else
            holo_assistant_configure_docker_commands 1 compose
        fi

        if holo_assistant_docker info >/dev/null 2>&1; then
            holo_assistant_ok "Docker disponibile automaticamente tramite sudo."
            return 0
        fi

        docker_info_output="$(holo_assistant_docker info 2>&1 || true)"
    fi

    if holo_assistant_command_exists systemctl; then
        if systemctl is-active --quiet docker 2>/dev/null; then
            holo_assistant_error "Docker risponde in modo anomalo anche se il servizio risulta attivo."
            holo_assistant_info "Dettaglio docker info: ${docker_info_output:-nessun output}"
            return 1
        fi

        holo_assistant_warn "Docker e installato ma il servizio non sembra attivo."
        if holo_assistant_run_with_sudo systemctl start docker >/dev/null 2>&1 && holo_assistant_docker info >/dev/null 2>&1; then
            holo_assistant_ok "Docker daemon avviato."
            return 0
        fi

        holo_assistant_info "Avvia Docker con:"
        printf '       sudo systemctl start docker\n'
        printf '       sudo systemctl enable docker\n'
        return 1
    fi

    if holo_assistant_command_exists service; then
        holo_assistant_warn "Docker e installato ma il servizio non sembra attivo."
        holo_assistant_info "Avvia Docker con:"
        printf '       sudo service docker start\n'
        return 1
    fi

    holo_assistant_error "Docker non risponde. Avvia il daemon Docker e rilancia lo script."
    if [[ -n "$docker_info_output" ]]; then
        holo_assistant_info "Dettaglio docker info: $docker_info_output"
    fi
    return 1
}

holo_assistant_docker_compose() {
    if [[ "$HOLO_ASSISTANT_DOCKER_USE_SUDO" == "1" ]]; then
        if [[ "$HOLO_ASSISTANT_DOCKER_COMPOSE_MODE" == "docker-compose" ]]; then
            sudo --preserve-env=DATABASE_PASSWORD docker-compose "$@"
        else
            sudo --preserve-env=DATABASE_PASSWORD docker compose "$@"
        fi
        return
    fi

    "${HOLO_ASSISTANT_DOCKER_COMPOSE_CMD[@]}" "$@"
}

holo_assistant_docker() {
    "${HOLO_ASSISTANT_DOCKER_CMD[@]}" "$@"
}

holo_assistant_install_python_apt() {
    holo_assistant_install_notice "Installazione Python 3 in corso..."
    holo_assistant_run_with_sudo_quiet apt update || return 1
    holo_assistant_run_with_sudo_quiet apt upgrade -y || return 1
    holo_assistant_run_with_sudo_quiet apt install python3 python3-pip python3-venv python3-dev -y || return 1

    holo_assistant_try_add_common_paths
    holo_assistant_command_exists python3 || return 1
    holo_assistant_command_exists pip3 || return 1
    return 0
}

holo_assistant_get_python_command() {
    local check_only="${1:-0}"

    if holo_assistant_command_exists python3; then
        if [[ "$check_only" != "1" ]]; then
            holo_assistant_detect_system
            if [[ "$HOLO_ASSISTANT_PACKAGE_MANAGER" == "apt" ]] && ! holo_assistant_command_exists pip3; then
                holo_assistant_install_python_apt || return 1
            fi
        fi
        HOLO_ASSISTANT_PYTHON_CMD=(python3)
        return 0
    fi

    if [[ "$check_only" != "1" ]]; then
        holo_assistant_detect_system
        if [[ "$HOLO_ASSISTANT_PACKAGE_MANAGER" == "apt" ]]; then
            holo_assistant_install_python_apt || return 1
            if holo_assistant_command_exists python3; then
                HOLO_ASSISTANT_PYTHON_CMD=(python3)
                return 0
            fi
        fi
    fi

    if holo_assistant_require_command python3 "Python 3" "$check_only"; then
        if holo_assistant_command_exists python3; then
            HOLO_ASSISTANT_PYTHON_CMD=(python3)
            return 0
        fi
    fi

    holo_assistant_error "Python 3 non trovato. Installa Python 3.10+ e rilancia."
    holo_assistant_print_install_hint "python3" "Python 3"
    return 1
}

holo_assistant_get_python_version() {
    "${HOLO_ASSISTANT_PYTHON_CMD[@]}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
}

holo_assistant_try_fix_python_venv() {
    local error_output="$1"
    local python_version=""
    local versioned_package=""

    if ! grep -qi "ensurepip is not available" <<<"$error_output"; then
        return 1
    fi

    holo_assistant_detect_system
    if [[ "$HOLO_ASSISTANT_PACKAGE_MANAGER" != "apt" ]]; then
        return 1
    fi

    python_version="$(holo_assistant_get_python_version 2>/dev/null || true)"
    holo_assistant_install_notice "Installazione supporto venv Python in corso..."
    holo_assistant_update_package_index_once || return 1

    if [[ -n "$python_version" ]]; then
        versioned_package="python${python_version}-venv"
        if holo_assistant_run_with_sudo_quiet apt install -y "$versioned_package"; then
            return 0
        fi
    fi

    holo_assistant_run_with_sudo_quiet apt install -y python3-venv || return 1
    return 0
}

holo_assistant_create_backend_venv() {
    local backend_dir="$1"
    local venv_log="$2"

    if (cd "$backend_dir" && "${HOLO_ASSISTANT_PYTHON_CMD[@]}" -m venv venv) >"$venv_log" 2>&1; then
        return 0
    fi

    if holo_assistant_try_fix_python_venv "$(cat "$venv_log")"; then
        (cd "$backend_dir" && "${HOLO_ASSISTANT_PYTHON_CMD[@]}" -m venv venv) >"$venv_log" 2>&1
        return $?
    fi

    return 1
}

holo_assistant_ensure_venv_pip() {
    local backend_dir="$1"
    local venv_dir="$2"
    local venv_python="$3"
    local venv_log
    local backup_dir

    if "$venv_python" -m pip --version >/dev/null 2>&1; then
        return 0
    fi

    holo_assistant_install_notice "Riparazione pip ambiente virtuale in corso..."
    "$venv_python" -m ensurepip --upgrade >/dev/null 2>&1 || true
    if "$venv_python" -m pip --version >/dev/null 2>&1; then
        return 0
    fi

    backup_dir="${venv_dir}.broken.$(date +%Y%m%d_%H%M%S)"
    mv "$venv_dir" "$backup_dir"
    venv_log="$(mktemp)"
    if ! holo_assistant_create_backend_venv "$backend_dir" "$venv_log"; then
        holo_assistant_error "Riparazione ambiente virtuale backend fallita."
        cat "$venv_log" >&2
        rm -f "$venv_log"
        return 1
    fi
    rm -f "$venv_log"

    if ! "$venv_python" -m pip --version >/dev/null 2>&1; then
        holo_assistant_error "pip non disponibile neppure dopo la ricreazione del virtualenv."
        return 1
    fi
}

holo_assistant_ensure_frontend_dependencies() {
    local frontend_dir="$1"
    local check_only="${2:-0}"

    holo_assistant_require_command node Node.js "$check_only" || return 1
    holo_assistant_require_command npm npm "$check_only" || return 1

    if [[ "$check_only" == "1" ]]; then
        holo_assistant_info "CheckOnly: verifico solo se node_modules esiste: $( [[ -d "$frontend_dir/node_modules" ]] && printf true || printf false )"
        return 0
    fi

    if [[ ! -d "$frontend_dir/node_modules" ]]; then
        (cd "$frontend_dir" && npm install --silent --no-fund --no-audit >/dev/null 2>&1)
    else
        holo_assistant_ok "Dipendenze Node.js gia installate."
    fi
}

holo_assistant_ensure_backend_dependencies() {
    local backend_dir="$1"
    local check_only="${2:-0}"
    local venv_dir="$backend_dir/venv"
    local venv_python="$venv_dir/bin/python"
    local venv_log=""

    if [[ "$check_only" == "1" ]]; then
        holo_assistant_info "CheckOnly: verifico solo se venv esiste: $( [[ -d "$venv_dir" ]] && printf true || printf false )"
        return 0
    fi

    holo_assistant_get_python_command "$check_only" || return 1
    holo_assistant_ok "Python disponibile: ${HOLO_ASSISTANT_PYTHON_CMD[*]}"

    if [[ ! -d "$venv_dir" ]]; then
        holo_assistant_info "Creo ambiente virtuale backend..."
        venv_log="$(mktemp)"
        if ! holo_assistant_create_backend_venv "$backend_dir" "$venv_log"; then
            holo_assistant_error "Creazione ambiente virtuale backend fallita."
            cat "$venv_log" >&2
            rm -f "$venv_log"
            return 1
        fi
        rm -f "$venv_log"
    fi

    if [[ ! -x "$venv_python" ]]; then
        holo_assistant_error "Python del virtualenv non trovato: $venv_python"
        return 1
    fi

    holo_assistant_ensure_venv_pip "$backend_dir" "$venv_dir" "$venv_python" || return 1

    "$venv_python" -m pip install --upgrade pip --quiet --disable-pip-version-check || holo_assistant_warn "Aggiornamento pip non completato; continuo con la versione installata."

    if [[ -f "$backend_dir/requirements.txt" ]]; then
        (cd "$backend_dir" && "$venv_python" -m pip install -r requirements.txt --quiet)
    else
        holo_assistant_warn "requirements.txt non trovato, installo dipendenze base."
        (cd "$backend_dir" && "$venv_python" -m pip install fastapi uvicorn sqlalchemy psycopg2-binary "python-jose[cryptography]" "passlib[bcrypt]" python-multipart python-dotenv requests --quiet)
    fi
}

holo_assistant_load_ollama_config() {
    local backend_env_path="$1"

    HOLO_ASSISTANT_OLLAMA_MODEL="$(holo_assistant_read_env_value "$backend_env_path" "OLLAMA_MODEL" || true)"
    HOLO_ASSISTANT_OLLAMA_BASE_URL="$(holo_assistant_read_env_value "$backend_env_path" "OLLAMA_BASE_URL" || true)"
    HOLO_ASSISTANT_OLLAMA_RUNTIME="$(holo_assistant_read_env_value "$backend_env_path" "OLLAMA_RUNTIME" || true)"
    HOLO_ASSISTANT_OLLAMA_ACCELERATOR="$(holo_assistant_read_env_value "$backend_env_path" "OLLAMA_ACCELERATOR" || true)"
    HOLO_ASSISTANT_OLLAMA_NATIVE_VULKAN="$(holo_assistant_read_env_value "$backend_env_path" "OLLAMA_NATIVE_VULKAN" || true)"
    HOLO_ASSISTANT_OLLAMA_KEEP_ALIVE="$(holo_assistant_read_env_value "$backend_env_path" "OLLAMA_KEEP_ALIVE" || true)"
    HOLO_ASSISTANT_OLLAMA_TOP_K="$(holo_assistant_read_env_value "$backend_env_path" "OLLAMA_TOP_K" || true)"
    HOLO_ASSISTANT_OLLAMA_TOP_P="$(holo_assistant_read_env_value "$backend_env_path" "OLLAMA_TOP_P" || true)"
    HOLO_ASSISTANT_OLLAMA_NUM_CTX="$(holo_assistant_read_env_value "$backend_env_path" "OLLAMA_NUM_CTX" || true)"
    HOLO_ASSISTANT_OLLAMA_NUM_THREAD="$(holo_assistant_read_env_value "$backend_env_path" "OLLAMA_NUM_THREAD" || true)"

    HOLO_ASSISTANT_OLLAMA_MODEL="${HOLO_ASSISTANT_OLLAMA_MODEL:-$HOLO_ASSISTANT_DEFAULT_OLLAMA_MODEL}"
    HOLO_ASSISTANT_OLLAMA_BASE_URL="${HOLO_ASSISTANT_OLLAMA_BASE_URL:-$HOLO_ASSISTANT_DEFAULT_OLLAMA_BASE_URL}"
    HOLO_ASSISTANT_OLLAMA_RUNTIME="native"
    HOLO_ASSISTANT_OLLAMA_ACCELERATOR="${HOLO_ASSISTANT_OLLAMA_ACCELERATOR:-auto}"
    HOLO_ASSISTANT_OLLAMA_NATIVE_VULKAN="${HOLO_ASSISTANT_OLLAMA_NATIVE_VULKAN:-1}"
    HOLO_ASSISTANT_OLLAMA_KEEP_ALIVE="${HOLO_ASSISTANT_OLLAMA_KEEP_ALIVE:-30m}"
    HOLO_ASSISTANT_OLLAMA_TOP_K="${HOLO_ASSISTANT_OLLAMA_TOP_K:-20}"
    HOLO_ASSISTANT_OLLAMA_TOP_P="${HOLO_ASSISTANT_OLLAMA_TOP_P:-0.8}"
    HOLO_ASSISTANT_OLLAMA_NUM_CTX="${HOLO_ASSISTANT_OLLAMA_NUM_CTX:-2048}"
    HOLO_ASSISTANT_OLLAMA_NUM_THREAD="${HOLO_ASSISTANT_OLLAMA_NUM_THREAD:-4}"
}

holo_assistant_resolve_ollama_runtime() {
    HOLO_ASSISTANT_OLLAMA_USE_NATIVE=1
    HOLO_ASSISTANT_OLLAMA_RUNTIME="native"
    holo_assistant_require_command ollama "Ollama nativo" 0 || return 1
}

holo_assistant_new_backend_env() {
    local env_path="$1"
    local ip="$2"
    local frontend_port="${3:-$HOLO_ASSISTANT_DEFAULT_FRONTEND_PORT}"
    local database_password secret_key admin_password existing_database_password

    database_password="$(holo_assistant_generate_secret)"
    secret_key="$(holo_assistant_generate_secret)"
    admin_password="$(holo_assistant_generate_admin_password)"

    if [[ -f "$env_path" ]]; then
        existing_database_password="$(holo_assistant_read_env_value "$env_path" "DATABASE_PASSWORD" || true)"
        if [[ -n "${existing_database_password:-}" ]]; then
            database_password="$existing_database_password"
        fi
    fi

    cat > "$env_path" <<EOF
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=$database_password
DATABASE_NAME=holo_assistant_db
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
OLLAMA_BASE_URL=$HOLO_ASSISTANT_OLLAMA_BASE_URL
OLLAMA_MODEL=$HOLO_ASSISTANT_OLLAMA_MODEL
OLLAMA_RUNTIME=native
OLLAMA_ACCELERATOR=$HOLO_ASSISTANT_OLLAMA_ACCELERATOR
OLLAMA_NATIVE_VULKAN=$HOLO_ASSISTANT_OLLAMA_NATIVE_VULKAN
OLLAMA_TIMEOUT_SECONDS=120
OLLAMA_HEALTH_TIMEOUT_SECONDS=5
OLLAMA_KEEP_ALIVE=$HOLO_ASSISTANT_OLLAMA_KEEP_ALIVE
OLLAMA_NUM_PREDICT_CLASSIFY=4
OLLAMA_NUM_PREDICT_SELECT=2
OLLAMA_NUM_PREDICT_RERANK=12
OLLAMA_TOP_K=$HOLO_ASSISTANT_OLLAMA_TOP_K
OLLAMA_TOP_P=$HOLO_ASSISTANT_OLLAMA_TOP_P
OLLAMA_TEMPERATURE_CLASSIFY=0.0
OLLAMA_TEMPERATURE_SELECT=0.0
OLLAMA_NUM_CTX=$HOLO_ASSISTANT_OLLAMA_NUM_CTX
OLLAMA_NUM_THREAD=$HOLO_ASSISTANT_OLLAMA_NUM_THREAD
TTS_ENABLED=true
EOF
}

holo_assistant_wait_postgres() {
    local attempts="${1:-30}"
    local attempt

    for ((attempt = 1; attempt <= attempts; attempt++)); do
        if holo_assistant_docker exec holo_assistant_postgres pg_isready -U postgres >/dev/null 2>&1; then
            holo_assistant_ok "PostgreSQL e pronto."
            return 0
        fi
        sleep 2
    done

    holo_assistant_warn "PostgreSQL potrebbe non essere ancora pronto."
    return 1
}

holo_assistant_wait_postgres_healthy() {
    local attempts="${1:-30}"
    local attempt health

    holo_assistant_info "Attendo che il container PostgreSQL diventi healthy..."
    for ((attempt = 1; attempt <= attempts; attempt++)); do
        health="$(holo_assistant_docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' holo_assistant_postgres 2>/dev/null || true)"
        if [[ "$health" == "healthy" ]]; then
            holo_assistant_ok "Container PostgreSQL healthy."
            return 0
        fi
        if (( attempt == 1 || attempt % 5 == 0 )); then
            holo_assistant_info "Stato health PostgreSQL corrente: ${health:-unknown}"
        fi
        sleep 2
    done

    holo_assistant_warn "Il container PostgreSQL non e diventato healthy in tempo."
    return 1
}

holo_assistant_test_http() {
    local url="$1"
    local timeout="${2:-3}"
    curl -fsS --max-time "$timeout" "$url" >/dev/null 2>&1
}

holo_assistant_ensure_native_ollama() {
    local check_only="${1:-0}"
    local attempt

    holo_assistant_require_command ollama "Ollama nativo" "$check_only" || return 1

    if [[ "$check_only" == "1" ]]; then
        holo_assistant_info "CheckOnly: non avvio Ollama nativo."
        return 0
    fi

    if holo_assistant_test_http "$HOLO_ASSISTANT_OLLAMA_BASE_URL/api/tags" 5; then
        holo_assistant_ok "Ollama nativo raggiungibile."
        return 0
    fi

    holo_assistant_install_notice "Avvio Ollama nativo in corso..."
    if holo_assistant_command_exists systemctl; then
        holo_assistant_run_with_sudo systemctl enable ollama >/dev/null 2>&1 || true
        holo_assistant_run_with_sudo systemctl start ollama >/dev/null 2>&1 || true
        for ((attempt = 1; attempt <= 8; attempt++)); do
            sleep 2
            if holo_assistant_test_http "$HOLO_ASSISTANT_OLLAMA_BASE_URL/api/tags" 5; then
                holo_assistant_ok "Ollama nativo raggiungibile."
                return 0
            fi
        done
    fi

    if holo_assistant_command_exists systemd-run; then
        systemd-run --user --unit holo-assistant-ollama --same-dir env OLLAMA_VULKAN="$HOLO_ASSISTANT_OLLAMA_NATIVE_VULKAN" ollama serve >/dev/null 2>&1 || true
    else
        (OLLAMA_VULKAN="$HOLO_ASSISTANT_OLLAMA_NATIVE_VULKAN" nohup ollama serve >/tmp/holo-assistant-ollama.log 2>&1 &)
    fi

    for ((attempt = 1; attempt <= 20; attempt++)); do
        sleep 2
        if holo_assistant_test_http "$HOLO_ASSISTANT_OLLAMA_BASE_URL/api/tags" 5; then
            holo_assistant_ok "Ollama nativo raggiungibile."
            return 0
        fi
    done

    holo_assistant_error "Ollama nativo non risponde ancora su $HOLO_ASSISTANT_OLLAMA_BASE_URL."
    if holo_assistant_command_exists systemctl; then
        holo_assistant_info "Controlla il servizio con: sudo systemctl status ollama --no-pager"
    else
        holo_assistant_info "Controlla il log con: tail -n 100 /tmp/holo-assistant-ollama.log"
    fi
    return 1
}

holo_assistant_ensure_ollama_model() {
    local check_only="${1:-0}"
    local models_output

    if [[ "$check_only" == "1" ]]; then
        holo_assistant_info "CheckOnly: non controllo ne scarico il modello Ollama."
        return 0
    fi

    holo_assistant_info "Preparazione modello AI: $HOLO_ASSISTANT_OLLAMA_MODEL"
    holo_assistant_ensure_native_ollama 0 || return 1
    models_output="$(ollama list 2>/dev/null || true)"
    if ! grep -Fq "$HOLO_ASSISTANT_OLLAMA_MODEL" <<<"$models_output"; then
        holo_assistant_install_notice "Download modello Ollama in corso..."
        ollama pull "$HOLO_ASSISTANT_OLLAMA_MODEL" >/dev/null 2>&1
    fi
    holo_assistant_ok "Modello $HOLO_ASSISTANT_OLLAMA_MODEL pronto su Ollama nativo."
}

holo_assistant_ollama_warmup() {
    local check_only="${1:-0}"
    local body ready=0 attempt

    if [[ "$check_only" == "1" ]]; then
        holo_assistant_info "CheckOnly: salto warmup Ollama."
        return 0
    fi

    holo_assistant_info "Attendo che Ollama risponda su $HOLO_ASSISTANT_OLLAMA_BASE_URL..."
    for ((attempt = 1; attempt <= 30; attempt++)); do
        if holo_assistant_test_http "$HOLO_ASSISTANT_OLLAMA_BASE_URL/api/tags" 5; then
            ready=1
            break
        fi
        sleep 2
    done

    if [[ "$ready" != "1" ]]; then
        holo_assistant_warn "Ollama non risponde ancora all'endpoint /api/tags."
        return 0
    fi

    holo_assistant_info "Warmup modello AI in corso..."
    body=$(cat <<EOF
{"model":"$HOLO_ASSISTANT_OLLAMA_MODEL","prompt":"Rispondi solo OK","stream":false,"think":false,"keep_alive":"$HOLO_ASSISTANT_OLLAMA_KEEP_ALIVE","options":{"temperature":0,"top_k":$HOLO_ASSISTANT_OLLAMA_TOP_K,"top_p":$HOLO_ASSISTANT_OLLAMA_TOP_P,"num_predict":12,"num_ctx":$HOLO_ASSISTANT_OLLAMA_NUM_CTX,"num_thread":$HOLO_ASSISTANT_OLLAMA_NUM_THREAD}}
EOF
)

    if curl -fsS "$HOLO_ASSISTANT_OLLAMA_BASE_URL/api/generate" -H "Content-Type: application/json" -d "$body" >/dev/null 2>&1; then
        holo_assistant_ok "Modello AI pronto."
    else
        holo_assistant_warn "Warmup Ollama non completato. Il primo prompt potrebbe essere piu lento."
    fi
}

holo_assistant_start_terminal() {
    local title="$1"
    local command="$2"

    if holo_assistant_command_exists gnome-terminal; then
        gnome-terminal --title="$title" -- bash -lc "$command; exec bash" &
    elif holo_assistant_command_exists konsole; then
        konsole --new-tab --title "$title" -e bash -lc "$command; exec bash" &
    elif holo_assistant_command_exists xterm; then
        xterm -title "$title" -e bash -lc "$command; exec bash" &
    else
        bash -lc "$command" &
    fi
}
