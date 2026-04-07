import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.services.cache import TTS_CACHE_MAX_TEXT_CHARS, tts_synthesis_cache
from app.services.piper_tts import PiperTTSService, VoiceModel


class FakeVoice:
    def synthesize_wav(self, _text: str, wav_file, include_alignments: bool = False):
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"\x00\x00" * 16)
        return [] if include_alignments else None


def _voice_model(key: str) -> VoiceModel:
    return VoiceModel(
        key=key,
        language_code="it_IT",
        family="it",
        name=key,
        quality="medium",
        model_path=Path(f"{key}.onnx"),
        config_path=Path(f"{key}.onnx.json"),
    )


class PiperTTSCacheTestCase(unittest.TestCase):
    def setUp(self) -> None:
        tts_synthesis_cache.clear()
        self.service = PiperTTSService.__new__(PiperTTSService)
        self.service.use_cuda = False

    def tearDown(self) -> None:
        tts_synthesis_cache.clear()

    def _patch_lipsync(self):
        return patch(
            "app.services.piper_tts.build_lipsync_result",
            return_value=SimpleNamespace(
                words=["ciao"],
                wtimes=[0],
                wdurations=[10],
                visemes=[],
                vtimes=[],
                vdurations=[],
            ),
        )

    def test_synthesize_with_lipsync_uses_cache_for_same_text_and_voice(self) -> None:
        voice_model = _voice_model("it_IT-paola-medium")

        with (
            patch.object(self.service, "resolve_voice_model", return_value=voice_model),
            patch.object(self.service, "_get_voice", return_value=FakeVoice()) as get_voice,
            self._patch_lipsync(),
        ):
            first = self.service.synthesize_with_lipsync(" Ciao operatore ", language="it-IT")
            second = self.service.synthesize_with_lipsync("Ciao operatore", language="it-IT")

        self.assertEqual(first.audio_bytes, second.audio_bytes)
        self.assertEqual(first.words, ["ciao"])
        self.assertEqual(second.words, ["ciao"])
        self.assertEqual(get_voice.call_count, 1)

    def test_synthesize_with_lipsync_skips_cache_for_long_text(self) -> None:
        voice_model = _voice_model("it_IT-paola-medium")
        long_text = "a" * (TTS_CACHE_MAX_TEXT_CHARS + 1)

        with (
            patch.object(self.service, "resolve_voice_model", return_value=voice_model),
            patch.object(self.service, "_get_voice", return_value=FakeVoice()) as get_voice,
            self._patch_lipsync(),
        ):
            self.service.synthesize_with_lipsync(long_text, language="it-IT")
            self.service.synthesize_with_lipsync(long_text, language="it-IT")

        self.assertEqual(get_voice.call_count, 2)

    def test_synthesize_with_lipsync_uses_distinct_cache_key_for_voice(self) -> None:
        with (
            patch.object(
                self.service,
                "resolve_voice_model",
                side_effect=[_voice_model("voice-a"), _voice_model("voice-b")],
            ),
            patch.object(self.service, "_get_voice", return_value=FakeVoice()) as get_voice,
            self._patch_lipsync(),
        ):
            self.service.synthesize_with_lipsync("Ciao", language="it-IT")
            self.service.synthesize_with_lipsync("Ciao", language="it-IT")

        self.assertEqual(get_voice.call_count, 2)


if __name__ == "__main__":
    unittest.main()
