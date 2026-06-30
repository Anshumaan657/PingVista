import json
import os
import sys
from urllib import error, request


def fail(message):
    print(f"Deployment check failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def fetch(url):
    try:
        with request.urlopen(url, timeout=20) as response:
            body = response.read().decode("utf-8", errors="replace")
            return response.status, response.headers.get("content-type", ""), body
    except error.HTTPError as exc:
        fail(f"{url} returned HTTP {exc.code}")
    except Exception as exc:
        fail(f"{url} could not be reached: {exc}")


def main():
    base_url = (os.environ.get("PINGVISTA_DEPLOYMENT_URL") or "").rstrip("/")
    if not base_url:
        fail("set PINGVISTA_DEPLOYMENT_URL first")

    status, content_type, body = fetch(f"{base_url}/api/health")
    if status != 200:
        fail("/api/health did not return 200")

    try:
        health = json.loads(body)
    except json.JSONDecodeError:
        fail("/api/health did not return JSON")

    if health.get("status") != "ok":
        fail("/api/health status is not ok")
    if health.get("service") != "PingVista":
        fail("/api/health service is not PingVista")
    if health.get("runtime") != "python":
        fail("/api/health runtime is not python")

    status, content_type, body = fetch(base_url)
    if status != 200:
        fail("frontend did not return 200")
    if "text/html" not in content_type:
        fail("frontend did not return HTML")
    if "PingVista" not in body:
        fail("frontend HTML does not contain PingVista")

    print("PingVista deployment check passed")
    print(f"URL: {base_url}")
    print(f"Runtime: {health.get('runtime')}")
    print(f"Storage: {health.get('storage')}")


if __name__ == "__main__":
    main()
