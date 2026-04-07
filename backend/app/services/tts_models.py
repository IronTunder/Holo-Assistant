from dataclasses import dataclass


@dataclass(frozen=True)
class TtsSynthesisResult:
    audio_bytes: bytes
    mime_type: str
    duration_ms: int
    words: list[str]
    wtimes: list[int]
    wdurations: list[int]
    visemes: list[str]
    vtimes: list[int]
    vdurations: list[int]
