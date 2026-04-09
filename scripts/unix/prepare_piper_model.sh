#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "$SCRIPT_DIR/common.sh"

ROOT_DIR="$(ditto_root)"
VOICE_KEY="${DITTO_PIPER_DEFAULT_VOICE_KEY}"
VOICE_MODEL_FILENAME="${DITTO_PIPER_DEFAULT_VOICE_MODEL_FILENAME}"
VOICE_CONFIG_FILENAME="${DITTO_PIPER_DEFAULT_VOICE_CONFIG_FILENAME}"
VOICE_BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium"
VOICE_MODELS_DIR="$ROOT_DIR/backend/app/services/voice_models"
MODEL_OUTPUT_PATH="$VOICE_MODELS_DIR/$VOICE_MODEL_FILENAME"
CONFIG_OUTPUT_PATH="$VOICE_MODELS_DIR/$VOICE_CONFIG_FILENAME"
TEMP_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

download_file() {
    local source_url="$1"
    local target_path="$2"

    if command -v curl >/dev/null 2>&1; then
        curl -fL "$source_url" -o "$target_path"
        return 0
    fi

    if command -v wget >/dev/null 2>&1; then
        wget "$source_url" -O "$target_path"
        return 0
    fi

    echo "[ERRORE] curl o wget richiesto per scaricare il modello Piper"
    exit 1
}

mkdir -p "$VOICE_MODELS_DIR"

if [[ -f "$MODEL_OUTPUT_PATH" && -f "$CONFIG_OUTPUT_PATH" ]]; then
    echo "[OK] Modello Piper gia presente: $VOICE_KEY"
    exit 0
fi

echo "[INFO] Download modello Piper $VOICE_KEY"
download_file "$VOICE_BASE_URL/$VOICE_MODEL_FILENAME" "$TEMP_DIR/$VOICE_MODEL_FILENAME"
download_file "$VOICE_BASE_URL/$VOICE_CONFIG_FILENAME" "$TEMP_DIR/$VOICE_CONFIG_FILENAME"

mv "$TEMP_DIR/$VOICE_MODEL_FILENAME" "$MODEL_OUTPUT_PATH"
mv "$TEMP_DIR/$VOICE_CONFIG_FILENAME" "$CONFIG_OUTPUT_PATH"

echo "[OK] Modello Piper pronto: $MODEL_OUTPUT_PATH"
