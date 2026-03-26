import io
import os
import subprocess
import wave
from pathlib import Path


class PiperTTSService:
    """Generate WAV audio using a local Piper executable."""

    def __init__(self) -> None:
        default_piper_path = Path.home() / ".local/share/piper/bin/piper"
        default_model_path = Path.home() / ".local/share/piper/voices/it_IT-paola-medium.onnx"
        default_config_path = Path.home() / ".local/share/piper/voices/it_IT-paola-medium.onnx.json"

        self.enabled = os.getenv("TTS_ENABLED", "false").lower() == "true"
        self.sample_rate = int(os.getenv("TTS_SAMPLE_RATE", "22050"))
        self.piper_executable = Path(os.getenv("PIPER_EXECUTABLE", str(default_piper_path)))
        self.model_path = Path(os.getenv("PIPER_MODEL_PATH", str(default_model_path)))
        self.config_path = Path(os.getenv("PIPER_CONFIG_PATH", str(default_config_path)))

    def get_status(self) -> dict:
        return {
            "enabled": self.enabled,
            "piper_executable": str(self.piper_executable),
            "model_path": str(self.model_path),
            "config_path": str(self.config_path),
            "ready": self.is_ready(),
        }

    def is_ready(self) -> bool:
        return (
            self.enabled
            and self.piper_executable.exists()
            and self.model_path.exists()
            and self.config_path.exists()
        )

    def synthesize_wav(self, text: str) -> bytes:
        clean_text = text.strip()
        if not clean_text:
            raise ValueError("Il testo TTS non puo essere vuoto")

        if not self.enabled:
            raise RuntimeError("TTS disabilitato")

        if not self.piper_executable.exists():
            raise FileNotFoundError(f"Eseguibile Piper non trovato: {self.piper_executable}")

        if not self.model_path.exists():
            raise FileNotFoundError(f"Modello Piper non trovato: {self.model_path}")

        cmd = [
            str(self.piper_executable),
            "--model",
            str(self.model_path),
            "--output-raw",
        ]

        process = subprocess.run(
            cmd,
            input=clean_text.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )

        if process.returncode != 0:
            error_message = process.stderr.decode("utf-8", errors="ignore").strip()
            raise RuntimeError(error_message or "Errore durante la sintesi Piper")

        if not process.stdout:
            raise RuntimeError("Piper non ha generato audio")

        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(self.sample_rate)
            wav_file.writeframes(process.stdout)

        return wav_buffer.getvalue()


tts_service = PiperTTSService()
