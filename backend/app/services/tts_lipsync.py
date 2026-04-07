from dataclasses import dataclass
import re
from typing import Sequence

from piper.voice import PhonemeAlignment, PiperVoice


WORD_PATTERN = re.compile(r"[^\W_]+(?:['\-][^\W_]+)*|[^\w\s]", re.UNICODE)

IGNORED_PHONEMES = {
    "",
    " ",
    ".",
    ",",
    "!",
    "?",
    ";",
    ":",
    "'",
    '"',
    "-",
    "\u02c8",
    "\u02cc",
    "\u02d0",
    "\u02d1",
    "\u0306",
    "\u0303",
    "\u032f",
    "\u0329",
    "\u2016",
    "|",
}

PUNCTUATION_PAUSE_WEIGHTS = {
    ",": 1.6,
    ";": 2.2,
    ":": 2.2,
    ".": 3.0,
    "!": 3.0,
    "?": 3.0,
    "-": 0.8,
}

PHONEME_WEIGHTS = {
    "PP": 1.05,
    "FF": 0.95,
    "TH": 1.0,
    "DD": 0.9,
    "kk": 1.05,
    "SS": 1.15,
    "nn": 0.85,
    "RR": 0.8,
    "aa": 1.15,
    "E": 1.0,
    "I": 0.95,
    "O": 1.05,
    "U": 1.05,
    "sil": 0.7,
}

LETTER_TO_VISEME = {
    "a": "aa",
    "\u0251": "aa",
    "\u0250": "aa",
    "\u00e4": "aa",
    "\u0252": "aa",
    "e": "E",
    "\u025b": "E",
    "\u0259": "E",
    "\u0153": "E",
    "\u025c": "E",
    "i": "I",
    "\u026a": "I",
    "j": "I",
    "y": "I",
    "o": "O",
    "\u0254": "O",
    "\u00f8": "O",
    "\u0275": "O",
    "u": "U",
    "\u028a": "U",
    "w": "U",
    "b": "PP",
    "p": "PP",
    "m": "PP",
    "f": "FF",
    "v": "FF",
    "\u03b8": "TH",
    "\u00f0": "TH",
    "t": "DD",
    "d": "DD",
    "l": "DD",
    "\u027e": "RR",
    "r": "RR",
    "\u0279": "RR",
    "n": "nn",
    "\u014b": "nn",
    "\u0272": "nn",
    "s": "SS",
    "z": "SS",
    "\u0283": "SS",
    "\u0292": "SS",
    "\u0282": "SS",
    "\u0290": "SS",
    "t\u0283": "SS",
    "d\u0292": "SS",
    "ts": "SS",
    "dz": "SS",
    "k": "kk",
    "g": "kk",
    "x": "kk",
    "\u0261": "kk",
    "c": "kk",
    "q": "kk",
    "h": "kk",
}


@dataclass(frozen=True)
class TtsLipsyncResult:
    words: list[str]
    wtimes: list[int]
    wdurations: list[int]
    visemes: list[str]
    vtimes: list[int]
    vdurations: list[int]


@dataclass
class _WordSegment:
    word: str
    phonemes: list[str]
    speech_weight: float
    pause_weight: float = 0.0
    start_ms: int = 0
    duration_ms: int = 0
    pause_start_ms: int = 0
    pause_duration_ms: int = 0


def build_lipsync_result(
    text: str,
    duration_ms: int,
    voice: PiperVoice,
    alignments: Sequence[PhonemeAlignment] | None = None,
) -> TtsLipsyncResult:
    text = text.strip()
    if not text:
        return TtsLipsyncResult([], [], [], [], [], [])

    segments = _build_word_segments(text, voice)
    if not segments:
        return TtsLipsyncResult([], [], [], [], [], [])

    if alignments:
        applied = _try_apply_alignment_timings(segments, alignments, voice.config.sample_rate)
        if not applied:
            _apply_weighted_timings(segments, duration_ms)
    else:
        _apply_weighted_timings(segments, duration_ms)

    words = [segment.word for segment in segments]
    wtimes = [segment.start_ms for segment in segments]
    wdurations = [segment.duration_ms for segment in segments]
    visemes, vtimes, vdurations = _build_viseme_segments(segments)

    return TtsLipsyncResult(words, wtimes, wdurations, visemes, vtimes, vdurations)


def _build_word_segments(text: str, voice: PiperVoice) -> list[_WordSegment]:
    segments: list[_WordSegment] = []

    for token in WORD_PATTERN.findall(text):
        if _is_word_token(token):
            phonemes = _phonemize_token(voice, token)
            speech_weight = sum(_phoneme_weight(phoneme) for phoneme in phonemes)
            if speech_weight <= 0:
                speech_weight = max(1.0, len(token) * 0.35)

            segments.append(
                _WordSegment(
                    word=token,
                    phonemes=phonemes,
                    speech_weight=speech_weight,
                )
            )
        elif segments:
            segments[-1].pause_weight += PUNCTUATION_PAUSE_WEIGHTS.get(token, 0.4)

    return segments


def _try_apply_alignment_timings(
    segments: list[_WordSegment],
    alignments: Sequence[PhonemeAlignment],
    sample_rate: int,
) -> bool:
    if sample_rate <= 0:
        return False

    durations = [
        max(1, int(round((alignment.num_samples / sample_rate) * 1000)))
        for alignment in alignments
        if alignment.num_samples > 0
    ]
    if not durations:
        return False

    total_duration_ms = sum(durations)
    _apply_weighted_timings(segments, total_duration_ms)
    return True


def _apply_weighted_timings(segments: list[_WordSegment], duration_ms: int) -> None:
    pieces: list[tuple[str, int, float]] = []
    for index, segment in enumerate(segments):
        pieces.append(("word", index, max(segment.speech_weight, 0.1)))
        if segment.pause_weight > 0:
            pieces.append(("pause", index, segment.pause_weight))

    boundaries = _allocate_piece_boundaries([piece[2] for piece in pieces], max(1, duration_ms))

    for piece_index, (piece_type, segment_index, _weight) in enumerate(pieces):
        start_ms = boundaries[piece_index]
        end_ms = boundaries[piece_index + 1]
        duration = max(0, end_ms - start_ms)
        segment = segments[segment_index]

        if piece_type == "word":
            segment.start_ms = start_ms
            segment.duration_ms = max(40, duration)
        else:
            segment.pause_start_ms = start_ms
            segment.pause_duration_ms = duration

    _ensure_total_duration(segments, max(1, duration_ms))


def _build_viseme_segments(
    segments: Sequence[_WordSegment],
) -> tuple[list[str], list[int], list[int]]:
    visemes: list[str] = []
    vtimes: list[int] = []
    vdurations: list[int] = []

    for segment in segments:
        phoneme_visemes = [_phoneme_to_viseme(phoneme) for phoneme in segment.phonemes]
        phoneme_visemes = [viseme for viseme in phoneme_visemes if viseme is not None]

        if not phoneme_visemes:
            phoneme_visemes = ["sil"]

        weights = [_phoneme_weight_from_viseme(viseme) for viseme in phoneme_visemes]
        boundaries = _allocate_piece_boundaries(weights, max(1, segment.duration_ms))

        for index, viseme in enumerate(phoneme_visemes):
            start_ms = segment.start_ms + boundaries[index]
            duration = max(1, boundaries[index + 1] - boundaries[index])
            _append_viseme(visemes, vtimes, vdurations, viseme, start_ms, duration)

        if segment.pause_duration_ms > 0:
            _append_viseme(
                visemes,
                vtimes,
                vdurations,
                "sil",
                segment.pause_start_ms,
                segment.pause_duration_ms,
            )

    return visemes, vtimes, vdurations


def _append_viseme(
    visemes: list[str],
    vtimes: list[int],
    vdurations: list[int],
    viseme: str,
    start_ms: int,
    duration_ms: int,
) -> None:
    if visemes and visemes[-1] == viseme and vtimes[-1] + vdurations[-1] >= start_ms:
        new_end = max(vtimes[-1] + vdurations[-1], start_ms + duration_ms)
        vdurations[-1] = new_end - vtimes[-1]
        return

    visemes.append(viseme)
    vtimes.append(start_ms)
    vdurations.append(duration_ms)


def _allocate_piece_boundaries(weights: Sequence[float], total_ms: int) -> list[int]:
    if not weights:
        return [0, total_ms]

    total_weight = sum(max(weight, 0.0) for weight in weights) or float(len(weights))
    boundaries = [0]
    cumulative = 0.0

    for weight in weights:
        cumulative += max(weight, 0.0) / total_weight * total_ms
        boundaries.append(int(round(cumulative)))

    boundaries[0] = 0
    boundaries[-1] = total_ms
    for index in range(1, len(boundaries)):
        if boundaries[index] < boundaries[index - 1]:
            boundaries[index] = boundaries[index - 1]

    return boundaries


def _ensure_total_duration(segments: list[_WordSegment], total_duration_ms: int) -> None:
    if not segments:
        return

    current_end = 0
    for segment in segments:
        current_end = max(current_end, segment.start_ms + segment.duration_ms)
        if segment.pause_duration_ms > 0:
            current_end = max(current_end, segment.pause_start_ms + segment.pause_duration_ms)

    overflow = current_end - total_duration_ms
    if overflow <= 0:
        return

    last_segment = segments[-1]
    if last_segment.pause_duration_ms >= overflow:
        last_segment.pause_duration_ms -= overflow
    else:
        remaining = overflow - last_segment.pause_duration_ms
        last_segment.pause_duration_ms = 0
        last_segment.duration_ms = max(40, last_segment.duration_ms - remaining)


def _phonemize_token(voice: PiperVoice, token: str) -> list[str]:
    phonemes = voice.phonemize(token)
    flattened = [phoneme for sentence in phonemes for phoneme in sentence]
    return [phoneme for phoneme in flattened if _is_relevant_phoneme(phoneme)]


def _phoneme_weight(phoneme: str) -> float:
    viseme = _phoneme_to_viseme(phoneme)
    return _phoneme_weight_from_viseme(viseme or "DD")


def _phoneme_weight_from_viseme(viseme: str) -> float:
    return PHONEME_WEIGHTS.get(viseme, 0.9)


def _phoneme_to_viseme(phoneme: str) -> str | None:
    phoneme = phoneme.strip()
    if not phoneme or phoneme in IGNORED_PHONEMES:
        return None

    if phoneme in LETTER_TO_VISEME:
        return LETTER_TO_VISEME[phoneme]

    if phoneme.startswith(("t\u0283", "d\u0292", "ts", "dz")):
        return "SS"

    for symbol, viseme in LETTER_TO_VISEME.items():
        if symbol in phoneme:
            return viseme

    return "DD"


def _is_word_token(token: str) -> bool:
    return bool(token and any(char.isalnum() for char in token))


def _is_relevant_phoneme(phoneme: str) -> bool:
    clean = phoneme.strip()
    return clean not in IGNORED_PHONEMES and clean != ""
