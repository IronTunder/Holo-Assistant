import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.rate_limit import InMemoryRateLimiter, RateLimitMiddleware, RateLimitRule


class FakeClock:
    def __init__(self) -> None:
        self.current = 0.0

    def now(self) -> float:
        return self.current

    def advance(self, seconds: float) -> None:
        self.current += seconds


class RateLimitMiddlewareTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = FakeClock()
        limiter = InMemoryRateLimiter(now_func=self.clock.now)
        rules = (
            RateLimitRule("auth", 2, 60, ("/auth/login",)),
            RateLimitRule("ai", 3, 60, ("/api/interactions/ask",)),
            RateLimitRule("default", 5, 60, ("/",)),
        )

        app = FastAPI()
        app.add_middleware(
            RateLimitMiddleware,
            limiter=limiter,
            rules=rules,
            enabled=True,
            trust_proxy=False,
        )

        @app.get("/health")
        async def health():
            return {"status": "ok"}

        @app.post("/auth/login")
        async def auth_login():
            return {"status": "ok"}

        @app.post("/api/interactions/ask")
        async def ask():
            return {"status": "ok"}

        @app.get("/machines")
        async def machines():
            return {"status": "ok"}

        self.client = TestClient(app)

    def test_health_is_exempt(self) -> None:
        for _ in range(10):
            response = self.client.get("/health")
            self.assertEqual(response.status_code, 200)

    def test_auth_rule_blocks_after_threshold(self) -> None:
        first = self.client.post("/auth/login")
        second = self.client.post("/auth/login")
        third = self.client.post("/auth/login")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(third.status_code, 429)
        self.assertEqual(third.json()["error"], "rate_limit_exceeded")
        self.assertEqual(third.headers["Retry-After"], "60")
        self.assertEqual(third.headers["X-RateLimit-Limit"], "2")

    def test_default_rule_resets_after_window(self) -> None:
        for _ in range(5):
            response = self.client.get("/machines")
            self.assertEqual(response.status_code, 200)

        blocked = self.client.get("/machines")
        self.assertEqual(blocked.status_code, 429)

        self.clock.advance(61)
        allowed_again = self.client.get("/machines")
        self.assertEqual(allowed_again.status_code, 200)

    def test_requests_are_isolated_by_proxy_only_when_trusted(self) -> None:
        for _ in range(5):
            response = self.client.get("/machines", headers={"x-forwarded-for": "198.51.100.10"})
            self.assertEqual(response.status_code, 200)

        blocked = self.client.get("/machines", headers={"x-forwarded-for": "203.0.113.10"})
        self.assertEqual(blocked.status_code, 429)

    def test_ai_rule_has_dedicated_threshold(self) -> None:
        for _ in range(3):
            response = self.client.post("/api/interactions/ask")
            self.assertEqual(response.status_code, 200)

        blocked = self.client.post("/api/interactions/ask")
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.headers["X-RateLimit-Limit"], "3")


class RateLimitProxyTrustTestCase(unittest.TestCase):
    def test_proxy_header_is_used_only_when_enabled(self) -> None:
        app = FastAPI()
        clock = FakeClock()
        limiter = InMemoryRateLimiter(now_func=clock.now)
        app.add_middleware(
            RateLimitMiddleware,
            limiter=limiter,
            rules=(RateLimitRule("default", 1, 60, ("/",)),),
            enabled=True,
            trust_proxy=True,
        )

        @app.get("/machines")
        async def machines():
            return {"status": "ok"}

        client = TestClient(app)
        first = client.get("/machines", headers={"x-forwarded-for": "198.51.100.10"})
        second = client.get("/machines", headers={"x-forwarded-for": "198.51.100.11"})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)


if __name__ == "__main__":
    unittest.main()
