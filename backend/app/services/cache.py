import os
import pickle
import threading
from collections import OrderedDict
from dataclasses import dataclass
from time import monotonic
from typing import Any, Callable, Hashable


def _env_bool(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return int(raw_value)
    except ValueError:
        return default


CACHE_ENABLED = _env_bool("HOLO_ASSISTANT_CACHE_ENABLED", True)
TOTAL_CACHE_MAX_BYTES = _env_int("HOLO_ASSISTANT_CACHE_TOTAL_MAX_BYTES", 134_217_728)
RETRIEVAL_CACHE_TTL_SECONDS = _env_int("HOLO_ASSISTANT_RETRIEVAL_CACHE_TTL_SECONDS", 600)
RETRIEVAL_CACHE_MAX_ENTRIES = _env_int("HOLO_ASSISTANT_RETRIEVAL_CACHE_MAX_ENTRIES", 512)
TTS_CACHE_TTL_SECONDS = _env_int("HOLO_ASSISTANT_TTS_CACHE_TTL_SECONDS", 1800)
TTS_CACHE_MAX_BYTES = _env_int("HOLO_ASSISTANT_TTS_CACHE_MAX_BYTES", 67_108_864)
TTS_CACHE_MAX_TEXT_CHARS = _env_int("HOLO_ASSISTANT_TTS_CACHE_MAX_TEXT_CHARS", 500)
TTS_CACHE_MAX_AUDIO_BYTES = _env_int("HOLO_ASSISTANT_TTS_CACHE_MAX_AUDIO_BYTES", 2_097_152)
ADMIN_METADATA_CACHE_TTL_SECONDS = _env_int("HOLO_ASSISTANT_ADMIN_METADATA_CACHE_TTL_SECONDS", 10)


@dataclass(frozen=True)
class CacheStats:
    name: str
    enabled: bool
    entries: int
    bytes: int
    max_entries: int
    max_bytes: int
    ttl_seconds: float
    hits: int
    misses: int
    evictions: int


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float
    size_bytes: int


class BoundedTTLCache:
    def __init__(
        self,
        name: str,
        *,
        ttl_seconds: float,
        max_entries: int,
        max_bytes: int,
        enabled: bool = CACHE_ENABLED,
    ) -> None:
        self.name = name
        self.ttl_seconds = max(ttl_seconds, 0)
        self.max_entries = max(max_entries, 0)
        self.max_bytes = max(max_bytes, 0)
        self.enabled = enabled and self.ttl_seconds > 0 and self.max_entries > 0 and self.max_bytes > 0
        self._entries: OrderedDict[Hashable, _CacheEntry] = OrderedDict()
        self._lock = threading.RLock()
        self._bytes = 0
        self._hits = 0
        self._misses = 0
        self._evictions = 0

    def get(self, key: Hashable) -> Any | None:
        if not self.enabled:
            return None

        now = monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                self._misses += 1
                return None
            if entry.expires_at <= now:
                self._delete_locked(key)
                self._misses += 1
                return None

            self._entries.move_to_end(key)
            self._hits += 1
            return entry.value

    def set(self, key: Hashable, value: Any, *, size_bytes: int | None = None) -> bool:
        if not self.enabled:
            return False

        item_size = size_bytes if size_bytes is not None else estimate_size_bytes(value)
        if item_size > self.max_bytes:
            return False

        with self._lock:
            if key in self._entries:
                self._delete_locked(key)

            self._entries[key] = _CacheEntry(
                value=value,
                expires_at=monotonic() + self.ttl_seconds,
                size_bytes=item_size,
            )
            self._bytes += item_size
            self._evict_locked()
            return True

    def invalidate(
        self,
        key: Hashable | None = None,
        *,
        predicate: Callable[[Hashable], bool] | None = None,
    ) -> int:
        with self._lock:
            if key is not None:
                deleted = 1 if key in self._entries else 0
                self._delete_locked(key)
                return deleted

            if predicate is None:
                return 0

            keys_to_delete = [entry_key for entry_key in self._entries if predicate(entry_key)]
            for entry_key in keys_to_delete:
                self._delete_locked(entry_key)
            return len(keys_to_delete)

    def clear(self) -> int:
        with self._lock:
            deleted = len(self._entries)
            self._entries.clear()
            self._bytes = 0
            return deleted

    def stats(self) -> CacheStats:
        with self._lock:
            self._expire_locked()
            return CacheStats(
                name=self.name,
                enabled=self.enabled,
                entries=len(self._entries),
                bytes=self._bytes,
                max_entries=self.max_entries,
                max_bytes=self.max_bytes,
                ttl_seconds=self.ttl_seconds,
                hits=self._hits,
                misses=self._misses,
                evictions=self._evictions,
            )

    def _delete_locked(self, key: Hashable) -> None:
        entry = self._entries.pop(key, None)
        if entry is None:
            return
        self._bytes = max(self._bytes - entry.size_bytes, 0)

    def _evict_locked(self) -> None:
        self._expire_locked()
        while len(self._entries) > self.max_entries or self._bytes > self.max_bytes:
            _key, entry = self._entries.popitem(last=False)
            self._bytes = max(self._bytes - entry.size_bytes, 0)
            self._evictions += 1

    def _expire_locked(self) -> None:
        now = monotonic()
        expired_keys = [key for key, entry in self._entries.items() if entry.expires_at <= now]
        for key in expired_keys:
            self._delete_locked(key)


def estimate_size_bytes(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, bytes):
        return len(value)
    if isinstance(value, str):
        return len(value.encode("utf-8"))
    try:
        return len(pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL))
    except Exception:
        return 1


retrieval_result_cache = BoundedTTLCache(
    "retrieval_results",
    ttl_seconds=RETRIEVAL_CACHE_TTL_SECONDS,
    max_entries=RETRIEVAL_CACHE_MAX_ENTRIES,
    max_bytes=max(TOTAL_CACHE_MAX_BYTES - TTS_CACHE_MAX_BYTES, 1),
)
tts_synthesis_cache = BoundedTTLCache(
    "tts_synthesis",
    ttl_seconds=TTS_CACHE_TTL_SECONDS,
    max_entries=512,
    max_bytes=TTS_CACHE_MAX_BYTES,
)
admin_metadata_cache = BoundedTTLCache(
    "admin_metadata",
    ttl_seconds=ADMIN_METADATA_CACHE_TTL_SECONDS,
    max_entries=128,
    max_bytes=min(16_777_216, TOTAL_CACHE_MAX_BYTES),
)


def cache_stats_payload() -> dict:
    return {
        cache.name: cache.stats().__dict__
        for cache in (retrieval_result_cache, tts_synthesis_cache, admin_metadata_cache)
    }
