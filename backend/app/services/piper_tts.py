import io
import json
import os
import threading
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from piper import PiperVoice

from app.services.tts_lipsync import build_lipsync_result
from app.services.tts_models import TtsSynthesisResult


@dataclass(frozen=True)
class VoiceModel:
    key: str
    language_code: str
    family: str
    name: str
    quality: str
    model_path: Path
    config_path: Path
    aliases: Tuple[str, ...] = ()


class PiperTTSService:
    """Generate WAV audio using Piper voices stored in the local voice_models repository."""

    def __init__(self) -> None:
        service_dir = Path(__file__).resolve().parent

        self.enabled = os.getenv("TTS_ENABLED", "false").lower() == "true"
        self.use_cuda = os.getenv("PIPER_USE_CUDA", "false").lower() == "true"
        self.voice_models_dir = Path(
            os.getenv("PIPER_VOICE_MODELS_DIR", str(service_dir / "voice_models"))
        )
        self.voice_manifest_path = Path(
            os.getenv("PIPER_VOICES_MANIFEST", str(self.voice_models_dir / "voices.json"))
        )
        self.default_voice_key = os.getenv("PIPER_DEFAULT_VOICE", "it_IT-paola-medium")
        self.default_language = os.getenv("PIPER_DEFAULT_LANGUAGE", "it-IT")
        self.preferred_qualities = self._parse_quality_order(
            os.getenv("PIPER_PREFERRED_QUALITIES", "medium,low,x_low,high")
        )

        self._voice_cache: Dict[str, PiperVoice] = {}
        self._voice_cache_lock = threading.Lock()
        self._available_models = self._load_available_models()
        self._alias_to_key = self._build_alias_index(self._available_models.values())

    def get_status(self) -> dict:
        languages = sorted({model.language_code for model in self._available_models.values()})
        return {
            "enabled": self.enabled,
            "voice_models_dir": str(self.voice_models_dir),
            "voice_manifest_path": str(self.voice_manifest_path),
            "default_voice_key": self.default_voice_key,
            "default_language": self.default_language,
            "preferred_qualities": self.preferred_qualities,
            "available_models": sorted(self._available_models.keys()),
            "available_languages": languages,
            "ready": self.is_ready(),
        }

    def is_ready(self) -> bool:
        return self.enabled and bool(self._available_models)

    def synthesize_wav(self, text: str, language: Optional[str] = None) -> bytes:
        clean_text = text.strip()
        if not clean_text:
            raise ValueError("Il testo TTS non puo essere vuoto")

        voice_model = self.resolve_voice_model(language)
        voice = self._get_voice(voice_model)
        wav_buffer = io.BytesIO()

        with wave.open(wav_buffer, "wb") as wav_file:
            voice.synthesize_wav(clean_text, wav_file)

        return wav_buffer.getvalue()

    def synthesize_with_lipsync(
        self, text: str, language: Optional[str] = None
    ) -> TtsSynthesisResult:
        clean_text = text.strip()
        if not clean_text:
            raise ValueError("Il testo TTS non puo essere vuoto")

        voice_model = self.resolve_voice_model(language)
        voice = self._get_voice(voice_model)
        wav_buffer = io.BytesIO()

        with wave.open(wav_buffer, "wb") as wav_file:
            alignments = voice.synthesize_wav(
                clean_text,
                wav_file,
                include_alignments=True,
            ) or []

        audio_bytes = wav_buffer.getvalue()
        duration_ms = self._get_wav_duration_ms(audio_bytes)
        lipsync = build_lipsync_result(clean_text, duration_ms, voice, alignments)

        return TtsSynthesisResult(
            audio_bytes=audio_bytes,
            mime_type="audio/wav",
            duration_ms=duration_ms,
            words=lipsync.words,
            wtimes=lipsync.wtimes,
            wdurations=lipsync.wdurations,
            visemes=lipsync.visemes,
            vtimes=lipsync.vtimes,
            vdurations=lipsync.vdurations,
        )

    def resolve_voice_model(self, language: Optional[str] = None) -> VoiceModel:
        if not self.enabled:
            raise RuntimeError("TTS disabilitato")

        if not self._available_models:
            raise FileNotFoundError(
                f"Nessun modello Piper disponibile in {self.voice_models_dir}"
            )

        requested = language or self.default_language
        requested_codes = self._expand_language_candidates(requested)

        for code in requested_codes:
            direct = self._match_direct_key_or_alias(code)
            if direct is not None:
                return direct

            exact_matches = [
                model
                for model in self._available_models.values()
                if model.language_code.lower() == code.lower()
            ]
            if exact_matches:
                return self._pick_best_model(exact_matches)

            family = self._language_family(code)
            family_matches = [
                model
                for model in self._available_models.values()
                if model.family.lower() == family.lower()
            ]
            if family_matches:
                return self._pick_best_model(family_matches)

        default_model = self._available_models.get(self.default_voice_key)
        if default_model is not None:
            return default_model

        return self._pick_best_model(self._available_models.values())

    def _get_voice(self, voice_model: VoiceModel) -> PiperVoice:
        cached = self._voice_cache.get(voice_model.key)
        if cached is not None:
            return cached

        with self._voice_cache_lock:
            cached = self._voice_cache.get(voice_model.key)
            if cached is None:
                cached = PiperVoice.load(
                    voice_model.model_path,
                    config_path=voice_model.config_path,
                    use_cuda=self.use_cuda,
                )
                self._voice_cache[voice_model.key] = cached

        return cached

    def _load_available_models(self) -> Dict[str, VoiceModel]:
        manifest_models = self._load_models_from_manifest()
        if manifest_models:
            return manifest_models
        return self._scan_models_from_filesystem()

    def _load_models_from_manifest(self) -> Dict[str, VoiceModel]:
        if not self.voice_manifest_path.exists():
            return {}

        try:
            raw_manifest = json.loads(self.voice_manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

        models: Dict[str, VoiceModel] = {}
        for key, entry in raw_manifest.items():
            files = entry.get("files") or {}
            model_relative = next(
                (Path(relative_path) for relative_path in files if relative_path.endswith(".onnx")),
                None,
            )
            if model_relative is None:
                continue

            model_path = self.voice_models_dir / model_relative
            config_path = model_path.with_suffix(f"{model_path.suffix}.json")
            if not model_path.exists() or not config_path.exists():
                continue

            language = entry.get("language") or {}
            aliases = tuple(entry.get("aliases") or [])
            model = VoiceModel(
                key=key,
                language_code=language.get("code", self._extract_language_code_from_key(key)),
                family=language.get("family", self._language_family(key)),
                name=entry.get("name", key),
                quality=entry.get("quality", "medium"),
                model_path=model_path,
                config_path=config_path,
                aliases=aliases,
            )
            models[model.key] = model

        return models

    def _scan_models_from_filesystem(self) -> Dict[str, VoiceModel]:
        models: Dict[str, VoiceModel] = {}
        for model_path in self.voice_models_dir.rglob("*.onnx"):
            config_path = model_path.with_suffix(f"{model_path.suffix}.json")
            if not config_path.exists():
                continue

            key = model_path.stem
            parts = key.split("-")
            language_code = parts[0] if parts else self.default_language.replace("-", "_")
            quality = parts[-1] if len(parts) > 1 else "medium"
            voice_name = "-".join(parts[1:-1]) if len(parts) > 2 else key

            models[key] = VoiceModel(
                key=key,
                language_code=language_code,
                family=self._language_family(language_code),
                name=voice_name or key,
                quality=quality,
                model_path=model_path,
                config_path=config_path,
            )

        return models

    def _pick_best_model(self, models: Iterable[VoiceModel]) -> VoiceModel:
        ranked = sorted(
            models,
            key=lambda model: (
                self._quality_rank(model.quality),
                model.name.lower(),
                model.key.lower(),
            ),
        )
        return ranked[0]

    def _match_direct_key_or_alias(self, value: str) -> Optional[VoiceModel]:
        if not value:
            return None

        direct = self._available_models.get(value)
        if direct is not None:
            return direct

        alias_key = self._alias_to_key.get(value.lower())
        if alias_key is None:
            return None

        return self._available_models.get(alias_key)

    def _build_alias_index(self, models: Iterable[VoiceModel]) -> Dict[str, str]:
        alias_index: Dict[str, str] = {}
        for model in models:
            alias_index[model.key.lower()] = model.key
            alias_index[model.key.replace("_", "-").lower()] = model.key
            for alias in model.aliases:
                alias_index[alias.lower()] = model.key
        return alias_index

    def _expand_language_candidates(self, raw_language: str) -> List[str]:
        candidates: List[str] = []
        for token in (raw_language or "").split(","):
            clean = token.split(";", 1)[0].strip()
            if not clean:
                continue

            normalized = clean.replace("-", "_")
            candidates.append(normalized)

            family = self._language_family(normalized)
            if family and family not in candidates:
                candidates.append(family)

        if not candidates:
            fallback = self.default_language.replace("-", "_")
            candidates.extend([fallback, self._language_family(fallback)])

        return [candidate for candidate in candidates if candidate]

    def _extract_language_code_from_key(self, key: str) -> str:
        return key.split("-", 1)[0].replace("-", "_")

    def _language_family(self, language_code: str) -> str:
        return language_code.replace("-", "_").split("_", 1)[0]

    def _quality_rank(self, quality: str) -> int:
        try:
            return self.preferred_qualities.index(quality)
        except ValueError:
            return len(self.preferred_qualities)

    def _parse_quality_order(self, raw_value: str) -> List[str]:
        qualities = [value.strip() for value in raw_value.split(",") if value.strip()]
        return qualities or ["medium", "low", "x_low", "high"]

    def _get_wav_duration_ms(self, audio_bytes: bytes) -> int:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
            frame_rate = wav_file.getframerate()
            frame_count = wav_file.getnframes()

        if frame_rate <= 0:
            return 0

        return int(round((frame_count / frame_rate) * 1000))


tts_service = PiperTTSService()
