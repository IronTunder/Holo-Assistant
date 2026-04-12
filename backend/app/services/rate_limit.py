import logging
import os
import time
from collections import deque
from dataclasses import dataclass
from threading import Lock
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.datastructures import MutableHeaders


logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return int(raw_value)
    except ValueError:
        logger.warning("[rate-limit] Invalid %s=%r, using default %s", name, raw_value, default)
        return default


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    max_requests: int
    window_seconds: int
    path_prefixes: tuple[str, ...]

    def matches(self, path: str) -> bool:
        return any(path.startswith(prefix) for prefix in self.path_prefixes)


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    limit: int
    remaining: int
    reset_after_seconds: int


class InMemoryRateLimiter:
    def __init__(self, now_func: Callable[[], float] | None = None) -> None:
        self._now_func = now_func or time.monotonic
        self._lock = Lock()
        self._buckets: dict[tuple[str, str], deque[float]] = {}

    def evaluate(self, bucket_key: tuple[str, str], rule: RateLimitRule) -> RateLimitDecision:
        now = self._now_func()
        window_start = now - rule.window_seconds

        with self._lock:
            bucket = self._buckets.setdefault(bucket_key, deque())
            while bucket and bucket[0] <= window_start:
                bucket.popleft()

            if len(bucket) >= rule.max_requests:
                retry_after = max(1, int(bucket[0] + rule.window_seconds - now))
                return RateLimitDecision(
                    allowed=False,
                    limit=rule.max_requests,
                    remaining=0,
                    reset_after_seconds=retry_after,
                )

            bucket.append(now)
            remaining = max(rule.max_requests - len(bucket), 0)
            return RateLimitDecision(
                allowed=True,
                limit=rule.max_requests,
                remaining=remaining,
                reset_after_seconds=rule.window_seconds,
            )


def load_rate_limit_rules() -> tuple[bool, bool, tuple[RateLimitRule, ...]]:
    enabled = _env_bool("HOLO_ASSISTANT_RATE_LIMIT_ENABLED", True)
    trust_proxy = _env_bool("HOLO_ASSISTANT_RATE_LIMIT_TRUST_PROXY", False)
    rules = (
        RateLimitRule(
            name="auth",
            max_requests=max(1, _env_int("HOLO_ASSISTANT_AUTH_RATE_LIMIT_MAX_REQUESTS", 10)),
            window_seconds=max(1, _env_int("HOLO_ASSISTANT_AUTH_RATE_LIMIT_WINDOW_SECONDS", 60)),
            path_prefixes=(
                "/auth/badge-login",
                "/auth/credentials-login",
                "/auth/admin-login",
                "/auth/refresh",
                "/auth/sse-token",
            ),
        ),
        RateLimitRule(
            name="ai",
            max_requests=max(1, _env_int("HOLO_ASSISTANT_AI_RATE_LIMIT_MAX_REQUESTS", 30)),
            window_seconds=max(1, _env_int("HOLO_ASSISTANT_AI_RATE_LIMIT_WINDOW_SECONDS", 60)),
            path_prefixes=(
                "/api/interactions/ask",
                "/api/interactions/quick-action",
                "/tts/synthesize",
            ),
        ),
        RateLimitRule(
            name="default",
            max_requests=max(1, _env_int("HOLO_ASSISTANT_RATE_LIMIT_MAX_REQUESTS", 120)),
            window_seconds=max(1, _env_int("HOLO_ASSISTANT_RATE_LIMIT_WINDOW_SECONDS", 60)),
            path_prefixes=("/",),
        ),
    )
    return enabled, trust_proxy, rules


EXEMPT_PATHS = frozenset({"/health", "/tts/health", "/api/interactions/health"})


class RateLimitMiddleware:
    def __init__(
        self,
        app,
        *,
        limiter: InMemoryRateLimiter | None = None,
        rules: tuple[RateLimitRule, ...] | None = None,
        enabled: bool = True,
        trust_proxy: bool = False,
    ) -> None:
        self.app = app
        self.limiter = limiter or InMemoryRateLimiter()
        self.rules = rules or load_rate_limit_rules()[2]
        self.enabled = enabled
        self.trust_proxy = trust_proxy

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or not self.enabled:
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        if request.method == "OPTIONS" or request.url.path in EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return

        rule = self._select_rule(request.url.path)
        client_key = self._get_client_key(request)
        decision = self.limiter.evaluate((rule.name, client_key), rule)

        if not decision.allowed:
            response = JSONResponse(
                status_code=429,
                content={
                    "detail": "Too many requests",
                    "error": "rate_limit_exceeded",
                    "scope": rule.name,
                    "retry_after_seconds": decision.reset_after_seconds,
                },
            )
            self._apply_headers(response, decision)
            response.headers["Retry-After"] = str(decision.reset_after_seconds)
            await response(scope, receive, send)
            return

        async def send_with_headers(message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-RateLimit-Limit"] = str(decision.limit)
                headers["X-RateLimit-Remaining"] = str(decision.remaining)
                headers["X-RateLimit-Reset"] = str(decision.reset_after_seconds)
            await send(message)

        await self.app(scope, receive, send_with_headers)

    def _select_rule(self, path: str) -> RateLimitRule:
        for rule in self.rules:
            if rule.matches(path):
                return rule
        return self.rules[-1]

    def _get_client_key(self, request: Request) -> str:
        if self.trust_proxy:
            forwarded_for = request.headers.get("x-forwarded-for", "")
            first_hop = forwarded_for.split(",", 1)[0].strip()
            if first_hop:
                return first_hop

        client = request.client
        if client and client.host:
            return client.host
        return "unknown"

    @staticmethod
    def _apply_headers(response: Response, decision: RateLimitDecision) -> None:
        response.headers["X-RateLimit-Limit"] = str(decision.limit)
        response.headers["X-RateLimit-Remaining"] = str(decision.remaining)
        response.headers["X-RateLimit-Reset"] = str(decision.reset_after_seconds)
