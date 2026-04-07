import time
import unittest

from app.services.cache import BoundedTTLCache


class BoundedTTLCacheTestCase(unittest.TestCase):
    def test_get_set_and_stats(self) -> None:
        cache = BoundedTTLCache("test", ttl_seconds=10, max_entries=3, max_bytes=1024)

        self.assertIsNone(cache.get("missing"))
        self.assertTrue(cache.set("key", {"value": 1}))

        self.assertEqual(cache.get("key"), {"value": 1})
        stats = cache.stats()
        self.assertEqual(stats.entries, 1)
        self.assertEqual(stats.hits, 1)
        self.assertEqual(stats.misses, 1)

    def test_ttl_expiration(self) -> None:
        cache = BoundedTTLCache("test", ttl_seconds=0.01, max_entries=3, max_bytes=1024)
        cache.set("key", "value")

        time.sleep(0.02)

        self.assertIsNone(cache.get("key"))
        self.assertEqual(cache.stats().entries, 0)

    def test_lru_eviction_by_entries(self) -> None:
        cache = BoundedTTLCache("test", ttl_seconds=10, max_entries=2, max_bytes=1024)
        cache.set("a", "A")
        cache.set("b", "B")
        self.assertEqual(cache.get("a"), "A")
        cache.set("c", "C")

        self.assertEqual(cache.get("a"), "A")
        self.assertIsNone(cache.get("b"))
        self.assertEqual(cache.get("c"), "C")
        self.assertEqual(cache.stats().evictions, 1)

    def test_eviction_by_bytes_and_invalidate(self) -> None:
        cache = BoundedTTLCache("test", ttl_seconds=10, max_entries=10, max_bytes=10)
        self.assertTrue(cache.set("a", "12345", size_bytes=5))
        self.assertTrue(cache.set("b", "67890", size_bytes=5))
        self.assertTrue(cache.set("c", "x", size_bytes=1))

        self.assertIsNone(cache.get("a"))
        self.assertEqual(cache.invalidate("b"), 1)
        self.assertIsNone(cache.get("b"))
        self.assertEqual(cache.clear(), 1)
        self.assertEqual(cache.stats().entries, 0)


if __name__ == "__main__":
    unittest.main()
