import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("HOLO_ASSISTANT_ALLOW_INSECURE_DEFAULTS", "true")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth.auth import get_current_user
from app.api.tts import router


class TtsApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(router, prefix="/tts")
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
        self.client = TestClient(app)

    def test_synthesize_returns_multipart_when_requested(self) -> None:
        synthesis = SimpleNamespace(
            audio_bytes=b"RIFFfakewav",
            mime_type="audio/wav",
            duration_ms=420,
            words=["ciao"],
            wtimes=[0],
            wdurations=[420],
            visemes=["aa"],
            vtimes=[0],
            vdurations=[420],
        )

        with patch("app.api.tts.tts_service.synthesize_with_lipsync", return_value=synthesis):
            response = self.client.post(
                "/tts/synthesize",
                json={"text": "ciao"},
                headers={"accept": "multipart/form-data"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("multipart/form-data", response.headers["content-type"])
        self.assertIn(b'name="metadata"', response.content)
        self.assertIn(b'name="audio"; filename="speech.wav"', response.content)
        self.assertIn(b"RIFFfakewav", response.content)

    def test_synthesize_returns_json_by_default(self) -> None:
        synthesis = SimpleNamespace(
            audio_bytes=b"RIFFfakewav",
            mime_type="audio/wav",
            duration_ms=420,
            words=["ciao"],
            wtimes=[0],
            wdurations=[420],
            visemes=[],
            vtimes=[],
            vdurations=[],
        )

        with patch("app.api.tts.tts_service.synthesize_with_lipsync", return_value=synthesis):
            response = self.client.post("/tts/synthesize", json={"text": "ciao"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mime_type"], "audio/wav")
        self.assertEqual(response.json()["duration_ms"], 420)
        self.assertIn("audio_base64", response.json())


if __name__ == "__main__":
    unittest.main()
