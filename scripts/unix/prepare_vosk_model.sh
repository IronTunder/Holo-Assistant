#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
MODEL_NAME="vosk-model-small-it-0.22"
MODEL_ZIP_URL="https://alphacephei.com/vosk/models/${MODEL_NAME}.zip"
MODELS_DIR="$ROOT_DIR/frontend/my-app/public/models"
OUTPUT_ARCHIVE="$MODELS_DIR/${MODEL_NAME}.tar.gz"
TEMP_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

mkdir -p "$MODELS_DIR"

echo "[INFO] Download $MODEL_ZIP_URL"
if command -v curl >/dev/null 2>&1; then
    curl -L "$MODEL_ZIP_URL" -o "$TEMP_DIR/${MODEL_NAME}.zip"
elif command -v wget >/dev/null 2>&1; then
    wget "$MODEL_ZIP_URL" -O "$TEMP_DIR/${MODEL_NAME}.zip"
else
    echo "[ERRORE] curl o wget richiesto per scaricare il modello"
    exit 1
fi

echo "[INFO] Estrazione modello"
if command -v unzip >/dev/null 2>&1; then
    unzip -q "$TEMP_DIR/${MODEL_NAME}.zip" -d "$TEMP_DIR"
else
    echo "[ERRORE] unzip richiesto per estrarre il modello"
    exit 1
fi

mkdir -p "$TEMP_DIR/tar-root"
mv "$TEMP_DIR/$MODEL_NAME" "$TEMP_DIR/tar-root/model"

echo "[INFO] Creazione $OUTPUT_ARCHIVE"
rm -f "$OUTPUT_ARCHIVE"
tar -C "$TEMP_DIR/tar-root" -czf "$OUTPUT_ARCHIVE" model

echo "[OK] Modello Vosk pronto: $OUTPUT_ARCHIVE"
