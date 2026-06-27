import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import app  # noqa: E402


class UrlSafetyTests(unittest.TestCase):
    def test_blocks_unsafe_urls(self):
        blocked = [
            "http://localhost:4175",
            "http://127.0.0.1:4175",
            "http://0.0.0.0",
            "http://10.0.0.1",
            "http://172.16.0.1",
            "http://192.168.1.1",
            "http://169.254.169.254",
            "file:///etc/passwd",
            "ftp://example.com",
            "http://user:pass@example.com",
            "http://metadata.google.internal",
        ]

        for url in blocked:
            with self.subTest(url=url):
                with self.assertRaises(app.AppError):
                    app.validate_public_url(url, "Endpoint URL")

    def test_allows_public_http_urls(self):
        app.validate_public_url("https://api.github.com", "Endpoint URL")
        app.validate_public_url("https://jsonplaceholder.typicode.com/posts", "Endpoint URL")


class ValidationTests(unittest.TestCase):
    def test_endpoint_count_limit(self):
        endpoints = [
            {
                "name": f"API {index}",
                "url": f"https://example.com/{index}",
                "method": "GET",
                "timeout": 5000,
                "expectedStatus": 200,
                "slowThreshold": 900,
            }
            for index in range(app.MAX_ENDPOINTS + 1)
        ]

        with self.assertRaises(app.AppError):
            app.validate_state({"endpoints": endpoints})

    def test_json_body_requires_body_method(self):
        with self.assertRaises(app.AppError):
            app.validate_endpoint(
                {
                    "name": "Bad body",
                    "url": "https://example.com",
                    "method": "GET",
                    "bodyText": '{"ok":true}',
                }
            )


class RateLimitTests(unittest.TestCase):
    def test_rate_limit_bucket_blocks_after_limit(self):
        class FakeHandler:
            headers = {}
            client_address = ("127.0.0.1", 1111)

        original_limits = app.RATE_LIMITS["check"]
        app.RATE_LIMITS["check"] = {"limit": 3, "window_ms": 60_000}
        app.rate_limit_buckets.clear()

        try:
            app.enforce_rate_limit(FakeHandler(), "check")
            app.enforce_rate_limit(FakeHandler(), "check")
            app.enforce_rate_limit(FakeHandler(), "check")
            with self.assertRaises(app.AppError) as ctx:
                app.enforce_rate_limit(FakeHandler(), "check")
            self.assertEqual(ctx.exception.status_code, 429)
        finally:
            app.RATE_LIMITS["check"] = original_limits
            app.rate_limit_buckets.clear()


if __name__ == "__main__":
    unittest.main()
