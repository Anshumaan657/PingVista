import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, parse, request


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "4175"))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SCHEDULER_INTERVAL_MS = int(os.environ.get("SCHEDULER_INTERVAL_MS", "300000"))

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "pingvista-db.json"

ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
BODY_METHODS = {"POST", "PUT", "PATCH"}
MAX_TIMEOUT_MS = 30_000
MAX_SLOW_THRESHOLD_MS = 60_000
MAX_HEADER_TEXT_LENGTH = 8_000
MAX_BODY_TEXT_LENGTH = 100_000
MAX_VALIDATION_TEXT_LENGTH = 2_000
MAX_ENDPOINTS = 50
STATE_BODY_LIMIT_BYTES = 500_000
DEFAULT_BODY_LIMIT_BYTES = 50_000
HISTORY_LIMIT = 100

RATE_LIMITS = {
    "read": {"limit": 120, "window_ms": 60_000},
    "write": {"limit": 20, "window_ms": 60_000},
    "check": {"limit": 30, "window_ms": 60_000},
}
rate_limit_buckets = {}
rate_limit_lock = threading.Lock()
storage_lock = threading.Lock()

PUBLIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/script.js": "script.js",
    "/favicon.svg": "favicon.svg",
    "/assets/pingvista-og.svg": "assets/pingvista-og.svg",
    "/assets/pingvista-screenshot.svg": "assets/pingvista-screenshot.svg",
    "/docs/FREE_DEPLOYMENT.md": "docs/FREE_DEPLOYMENT.md",
    "/docs/SELF_HOSTING.md": "docs/SELF_HOSTING.md",
}

CONTENT_TYPES = {
    ".html": "text/html;charset=utf-8",
    ".css": "text/css;charset=utf-8",
    ".js": "application/javascript;charset=utf-8",
    ".svg": "image/svg+xml;charset=utf-8",
    ".md": "text/markdown;charset=utf-8",
}

SUPABASE_ENABLED = bool(SUPABASE_URL and SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY)
scheduler_started_at = None
last_scheduled_run_at = None

DEFAULT_STATE = {
    "endpoints": [
        {
            "id": "11111111-1111-4111-8111-111111111111",
            "name": "GitHub API",
            "url": "https://api.github.com",
            "method": "GET",
            "group": "Production",
            "timeout": 5000,
            "expectedStatus": 200,
            "slowThreshold": 900,
            "headersText": "Accept: application/json",
            "bodyText": "",
            "validationText": "current_user_url",
            "history": [],
        },
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "name": "JSONPlaceholder",
            "url": "https://jsonplaceholder.typicode.com/posts",
            "method": "GET",
            "group": "Staging",
            "timeout": 5000,
            "expectedStatus": 200,
            "slowThreshold": 900,
            "headersText": "",
            "bodyText": "",
            "validationText": "userId",
            "history": [],
        },
    ],
    "incidents": [],
    "settings": {
        "mode": "backend",
        "theme": "light",
        "alertWebhookUrl": "",
        "alertOnRecovery": True,
    },
}


class AppError(Exception):
    def __init__(self, message, status_code=400, code="VALIDATION_ERROR"):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_data_file():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DB_PATH.exists():
        DB_PATH.write_text(json.dumps(DEFAULT_STATE, indent=2), encoding="utf-8")


def read_state():
    ensure_data_file()
    try:
        with storage_lock:
            saved = json.loads(DB_PATH.read_text(encoding="utf-8"))
        merged = {**DEFAULT_STATE, **saved}
        return merged
    except Exception:
        return json.loads(json.dumps(DEFAULT_STATE))


def write_state(state):
    ensure_data_file()
    validated = validate_state(state)
    with storage_lock:
        DB_PATH.write_text(json.dumps(validated, indent=2), encoding="utf-8")
    return validated


def validation_error(message, code="VALIDATION_ERROR"):
    return AppError(message, 400, code)


def auth_error(message="Authentication required."):
    return AppError(message, 401, "AUTH_REQUIRED")


def rate_limit_error(message="Too many requests. Try again soon."):
    return AppError(message, 429, "RATE_LIMITED")


def body_too_large_error(limit_bytes):
    return AppError(f"Request body must be {limit_bytes} bytes or less.", 413, "BODY_TOO_LARGE")


def is_private_ipv4(hostname):
    parts = hostname.split(".")
    if len(parts) != 4:
        return False
    try:
        numbers = [int(part) for part in parts]
    except ValueError:
        return False
    if any(number < 0 or number > 255 for number in numbers):
        return False
    a, b = numbers[0], numbers[1]
    return (
        a == 0
        or a == 10
        or a == 127
        or (a == 169 and b == 254)
        or (a == 172 and 16 <= b <= 31)
        or (a == 192 and b == 168)
        or a >= 224
    )


def is_unsafe_hostname(hostname):
    normalized = (hostname or "").lower().rstrip(".")
    blocked = {
        "localhost",
        "0.0.0.0",
        "127.0.0.1",
        "::1",
        "[::1]",
        "metadata.google.internal",
        "100.100.100.200",
        "169.254.169.254",
    }
    return (
        normalized in blocked
        or normalized.endswith(".localhost")
        or normalized.startswith("fc")
        or normalized.startswith("fd")
        or normalized.startswith("fe80:")
        or is_private_ipv4(normalized)
    )


def validate_public_url(value, field_name):
    try:
        parsed = parse.urlparse(str(value or "").strip())
    except Exception:
        raise validation_error(f"{field_name} must be a valid URL.")

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise validation_error(f"{field_name} must use HTTP or HTTPS.")

    if parsed.username or parsed.password:
        raise validation_error(f"{field_name} must not include credentials.")

    if is_unsafe_hostname(parsed.hostname or ""):
        raise validation_error(f"{field_name} points to a blocked private or metadata host.")

    return parse.urlunparse(parsed)


def validate_number(value, field_name, min_value, max_value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise validation_error(f"{field_name} must be an integer between {min_value} and {max_value}.")

    if number < min_value or number > max_value:
        raise validation_error(f"{field_name} must be an integer between {min_value} and {max_value}.")

    return number


def parse_headers(headers_text=""):
    text = str(headers_text or "")
    if len(text) > MAX_HEADER_TEXT_LENGTH:
        raise validation_error("Headers are too large.")

    headers = {}
    for line in [line.strip() for line in text.splitlines() if line.strip()]:
        if ":" not in line:
            raise validation_error(f'Header "{line}" must use Key: Value format.')
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key or not value:
            raise validation_error(f'Header "{line}" must include both key and value.')
        if "\n" in key or "\r" in key or "\n" in value or "\r" in value:
            raise validation_error("Headers must not contain newline injection.")
        headers[key] = value
    return headers


def validate_endpoint(endpoint):
    endpoint = endpoint or {}
    method = str(endpoint.get("method") or "GET").upper()
    if method not in ALLOWED_METHODS:
        raise validation_error("HTTP method is not supported.")

    body_text = str(endpoint.get("bodyText") or "").strip()
    if len(body_text) > MAX_BODY_TEXT_LENGTH:
        raise validation_error("JSON body is too large.")
    if body_text and method not in BODY_METHODS:
        raise validation_error("JSON body is only allowed for POST, PUT, and PATCH.")
    if body_text:
        try:
            json.loads(body_text)
        except json.JSONDecodeError:
            raise validation_error("JSON body must be valid JSON.")

    parse_headers(endpoint.get("headersText") or "")
    validation_text = str(endpoint.get("validationText") or "").strip()
    if len(validation_text) > MAX_VALIDATION_TEXT_LENGTH:
        raise validation_error("Response validation text is too large.")

    history = endpoint.get("history") if isinstance(endpoint.get("history"), list) else []
    return {
        "id": endpoint.get("id") or str(uuid.uuid4()),
        "name": str(endpoint.get("name") or "Untitled API").strip()[:120],
        "url": validate_public_url(endpoint.get("url"), "Endpoint URL"),
        "method": method,
        "group": str(endpoint.get("group") or "Production").strip()[:80],
        "timeout": validate_number(endpoint.get("timeout") or 5000, "Timeout", 500, MAX_TIMEOUT_MS),
        "expectedStatus": validate_number(endpoint.get("expectedStatus") or 200, "Expected status", 100, 599),
        "slowThreshold": validate_number(endpoint.get("slowThreshold") or 900, "Slow threshold", 100, MAX_SLOW_THRESHOLD_MS),
        "headersText": str(endpoint.get("headersText") or "").strip(),
        "bodyText": body_text,
        "validationText": validation_text,
        "history": history[-HISTORY_LIMIT:],
    }


def validate_settings(settings=None):
    settings = settings or {}
    alert_webhook_url = str(settings.get("alertWebhookUrl") or "").strip()
    return {
        "mode": "backend" if settings.get("mode") == "backend" else "browser",
        "theme": "dark" if settings.get("theme") == "dark" else "light",
        "alertWebhookUrl": validate_public_url(alert_webhook_url, "Webhook URL") if alert_webhook_url else "",
        "alertOnRecovery": settings.get("alertOnRecovery") is not False,
    }


def validate_state(state=None):
    state = state or {}
    endpoints = state.get("endpoints") if isinstance(state.get("endpoints"), list) else []
    if len(endpoints) > MAX_ENDPOINTS:
        raise validation_error(f"Workspace can contain at most {MAX_ENDPOINTS} endpoints.")
    incidents = state.get("incidents") if isinstance(state.get("incidents"), list) else []
    return {
        "endpoints": [validate_endpoint(endpoint) for endpoint in endpoints],
        "incidents": incidents,
        "settings": validate_settings(state.get("settings") or {}),
    }


def normalize_incident(incident):
    incident = incident or {}
    return {
        "id": incident.get("id") or str(uuid.uuid4()),
        "endpointId": incident.get("endpointId"),
        "endpointName": incident.get("endpointName") or "Unknown endpoint",
        "group": incident.get("group") or "Production",
        "status": "resolved" if incident.get("status") == "resolved" else "open",
        "startedAt": incident.get("startedAt") or now_iso(),
        "resolvedAt": incident.get("resolvedAt"),
        "message": incident.get("message") or "Endpoint failed.",
        "checks": int(incident.get("checks") or 1),
    }


def get_client_key(handler):
    forwarded = handler.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else handler.client_address[0]
    return ip or "unknown"


def enforce_rate_limit(handler, bucket_name):
    config = RATE_LIMITS.get(bucket_name)
    if not config:
        return

    key = f"{bucket_name}:{get_client_key(handler)}"
    now_ms = int(time.time() * 1000)
    with rate_limit_lock:
        bucket = rate_limit_buckets.get(key)
        if not bucket or now_ms > bucket["reset_at"]:
            rate_limit_buckets[key] = {"count": 1, "reset_at": now_ms + config["window_ms"]}
            return
        bucket["count"] += 1
        if bucket["count"] > config["limit"]:
            raise rate_limit_error()


def read_body(handler, limit_bytes=DEFAULT_BODY_LIMIT_BYTES):
    length = int(handler.headers.get("content-length") or "0")
    if length > limit_bytes:
        raise body_too_large_error(limit_bytes)
    body = handler.rfile.read(length) if length else b""
    if len(body) > limit_bytes:
        raise body_too_large_error(limit_bytes)
    return body.decode("utf-8")


def read_json_body(handler, limit_bytes=DEFAULT_BODY_LIMIT_BYTES):
    body = read_body(handler, limit_bytes)
    if not body:
        return {}
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        raise validation_error("Request body must be valid JSON.")


def json_response(handler, status_code, payload):
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def supabase_headers(use_service_role=True, token=""):
    api_key = SUPABASE_SERVICE_ROLE_KEY if use_service_role else SUPABASE_ANON_KEY
    return {
        "apikey": api_key,
        "Authorization": f"Bearer {token or api_key}",
        "Content-Type": "application/json",
    }


def http_json(url, method="GET", headers=None, body=None, timeout=15):
    payload = None if body is None else json.dumps(body).encode("utf-8")
    req = request.Request(url, data=payload, method=method, headers=headers or {})
    try:
        with request.urlopen(req, timeout=timeout) as response:
            text = response.read().decode("utf-8")
            return response.status, json.loads(text) if text else None
    except error.HTTPError as exc:
        text = exc.read().decode("utf-8")
        try:
            payload = json.loads(text) if text else {}
        except json.JSONDecodeError:
            payload = {"error": text}
        message = payload.get("msg") or payload.get("message") or payload.get("error") or "Request failed."
        raise AppError(message, exc.code, "SUPABASE_ERROR")


def supabase_request(pathname, method="GET", body=None, use_service_role=True, token="", prefer=""):
    if not SUPABASE_ENABLED:
        raise validation_error("Supabase is not configured.", "SUPABASE_NOT_CONFIGURED")
    headers = supabase_headers(use_service_role, token)
    if prefer:
        headers["Prefer"] = prefer
    _, payload = http_json(f"{SUPABASE_URL}{pathname}", method=method, headers=headers, body=body)
    return payload


def verify_user(handler):
    if not SUPABASE_ENABLED:
        return None
    auth_header = handler.headers.get("authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
    if not token:
        raise auth_error()
    user = supabase_request("/auth/v1/user", use_service_role=False, token=token)
    if not user or not user.get("id"):
        raise auth_error("Invalid Supabase session.")
    supabase_request(
        "/rest/v1/users",
        method="POST",
        body={"id": user["id"], "email": user.get("email", "")},
        prefer="resolution=merge-duplicates",
    )
    return {"id": user["id"], "email": user.get("email", ""), "token": token}


def proxy_supabase_auth(pathname, body):
    if not SUPABASE_ENABLED:
        raise validation_error("Supabase auth is not configured.", "SUPABASE_NOT_CONFIGURED")
    headers = {"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"}
    _, payload = http_json(f"{SUPABASE_URL}{pathname}", method="POST", headers=headers, body=body)
    return payload


def validate_response_body(endpoint, body_text):
    validation_text = endpoint.get("validationText")
    if not validation_text:
        return {"ok": True, "message": ""}
    if validation_text in body_text:
        return {"ok": True, "message": f'Body matched "{validation_text}".'}
    return {"ok": False, "message": f'Body did not contain "{validation_text}".'}


def run_endpoint_check(endpoint):
    endpoint = validate_endpoint(endpoint)
    started = time.perf_counter()
    method = endpoint.get("method", "GET").upper()
    headers = parse_headers(endpoint.get("headersText", ""))
    data = None
    if method in BODY_METHODS and endpoint.get("bodyText", "").strip():
        data = endpoint["bodyText"].strip().encode("utf-8")
        if not any(key.lower() == "content-type" for key in headers):
            headers["Content-Type"] = "application/json"

    req = request.Request(endpoint["url"], method=method, headers=headers, data=data)
    try:
        try:
            with request.urlopen(req, timeout=endpoint["timeout"] / 1000) as response:
                status = response.status
                body_text = response.read().decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            status = exc.code
            body_text = exc.read().decode("utf-8", errors="replace")

        latency = (time.perf_counter() - started) * 1000
        expected_status = endpoint.get("expectedStatus") or 200
        status_matches = status == expected_status
        validation = validate_response_body(endpoint, body_text)
        ok = 200 <= status <= 299 and status_matches and validation["ok"]
        message = (
            f"Responded in {round(latency)} ms. {validation['message']}".strip()
            if ok
            else validation["message"] or f"Returned HTTP {status}."
            if status_matches
            else f"Expected HTTP {expected_status}, got {status}."
        )
        return {
            "checkedAt": now_iso(),
            "ok": ok,
            "latency": latency,
            "status": status,
            "validationOk": validation["ok"],
            "checkedBy": "backend",
            "message": message,
        }
    except Exception as exc:
        latency = (time.perf_counter() - started) * 1000
        return {
            "checkedAt": now_iso(),
            "ok": False,
            "latency": latency,
            "status": "ERR",
            "validationOk": False,
            "checkedBy": "backend",
            "message": str(exc) or "Request failed.",
        }


def maybe_send_alert(state, incident, event_type):
    webhook_url = validate_settings(state.get("settings") or {}).get("alertWebhookUrl")
    if not webhook_url:
        return
    if event_type == "recovered" and state.get("settings", {}).get("alertOnRecovery") is False:
        return
    try:
        payload = json.dumps({"app": "PingVista", "event": event_type, "incident": incident}).encode("utf-8")
        req = request.Request(webhook_url, method="POST", data=payload, headers={"Content-Type": "application/json"})
        request.urlopen(req, timeout=8).close()
    except Exception:
        pass


def update_incident(state, endpoint, result):
    incidents = state.get("incidents") if isinstance(state.get("incidents"), list) else []
    open_incident = next(
        (
            incident
            for incident in incidents
            if incident.get("endpointId") == endpoint["id"] and incident.get("status") == "open"
        ),
        None,
    )
    if not result["ok"]:
        if open_incident:
            open_incident["message"] = result["message"]
            open_incident["checks"] = int(open_incident.get("checks") or 0) + 1
            return
        incident = {
            "id": str(uuid.uuid4()),
            "endpointId": endpoint["id"],
            "endpointName": endpoint["name"],
            "group": endpoint.get("group") or "Production",
            "status": "open",
            "startedAt": result["checkedAt"],
            "resolvedAt": None,
            "message": result["message"],
            "checks": 1,
        }
        incidents.insert(0, incident)
        state["incidents"] = incidents
        maybe_send_alert(state, incident, "down")
        return
    if open_incident:
        open_incident["status"] = "resolved"
        open_incident["resolvedAt"] = result["checkedAt"]
        count = open_incident.get("checks") or 1
        open_incident["message"] = f"Recovered after {count} failed check{'s' if count != 1 else ''}."
        maybe_send_alert(state, open_incident, "recovered")


def append_check(user, endpoint, result):
    if not SUPABASE_ENABLED or not user:
        history = endpoint.get("history") if isinstance(endpoint.get("history"), list) else []
        endpoint["history"] = (history + [result])[-HISTORY_LIMIT:]
        return
    supabase_request(
        "/rest/v1/checks",
        method="POST",
        prefer="return=minimal",
        body={
            "user_id": user["id"],
            "endpoint_id": endpoint["id"],
            "checked_at": result["checkedAt"],
            "ok": result["ok"],
            "latency": result["latency"],
            "status": str(result["status"]),
            "validation_ok": bool(result["validationOk"]),
            "checked_by": result.get("checkedBy") or "backend",
            "message": result.get("message") or "",
        },
    )


def read_user_state(user=None):
    # Local JSON mode is the default no-cost Python backend. Supabase auth proxy
    # is still available; full Supabase table sync remains compatible with schema.sql.
    if not SUPABASE_ENABLED or not user:
        return read_state()
    return read_state()


def write_user_state(user, next_state):
    saved = write_state({**DEFAULT_STATE, **next_state, "settings": {**DEFAULT_STATE["settings"], **next_state.get("settings", {})}})
    return saved


def persist_user_incidents(user, state):
    if not SUPABASE_ENABLED or not user:
        write_state(state)


def check_and_persist(endpoint_id, user=None):
    state = read_user_state(user)
    endpoint = next((item for item in state.get("endpoints", []) if item.get("id") == endpoint_id), None)
    if not endpoint:
        return 404, {"error": "Endpoint not found."}
    result = run_endpoint_check(endpoint)
    append_check(user, endpoint, result)
    update_incident(state, endpoint, result)
    persist_user_incidents(user, state)
    return 200, {"endpoint": endpoint, "result": result, "state": read_user_state(user)}


def run_scheduled_checks():
    global last_scheduled_run_at
    last_scheduled_run_at = now_iso()
    state = read_state()
    for endpoint in state.get("endpoints", []):
        result = run_endpoint_check(endpoint)
        append_check(None, endpoint, result)
        update_incident(state, endpoint, result)
    write_state(state)


def start_scheduler():
    global scheduler_started_at
    if not SCHEDULER_INTERVAL_MS or SCHEDULER_INTERVAL_MS < 10_000:
        return
    scheduler_started_at = now_iso()

    def loop():
        while True:
            time.sleep(SCHEDULER_INTERVAL_MS / 1000)
            try:
                run_scheduled_checks()
            except Exception as exc:
                print(f"Scheduled check failed: {exc}")

    thread = threading.Thread(target=loop, daemon=True)
    thread.start()


class PingVistaHandler(BaseHTTPRequestHandler):
    server_version = "PingVistaPython/6.0"

    def do_GET(self):
        self.route()

    def do_HEAD(self):
        self.route()

    def do_POST(self):
        self.route()

    def do_PUT(self):
        self.route()

    def route(self):
        try:
            parsed = parse.urlparse(self.path)
            if parsed.path.startswith("/api/"):
                self.handle_api(parsed.path)
                return
            self.serve_static(parsed.path)
        except AppError as exc:
            json_response(self, exc.status_code, {"error": str(exc), "code": exc.code})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc) or "Server error.", "code": "SERVER_ERROR"})

    def handle_api(self, pathname):
        if pathname == "/api/health" and self.command == "GET":
            enforce_rate_limit(self, "read")
            json_response(
                self,
                200,
                {
                    "status": "ok",
                    "service": "PingVista",
                    "version": "6.0.0-python",
                    "uptimeSeconds": round(time.monotonic() - self.server.started_at),
                    "storage": "supabase" if SUPABASE_ENABLED else "local-json",
                    "runtime": "python",
                    "limits": {
                        "maxEndpoints": MAX_ENDPOINTS,
                        "maxChecksPerMinute": RATE_LIMITS["check"]["limit"],
                        "maxStateBodyBytes": STATE_BODY_LIMIT_BYTES,
                        "maxEndpointBodyBytes": MAX_BODY_TEXT_LENGTH,
                    },
                    "scheduler": {
                        "enabled": bool(SCHEDULER_INTERVAL_MS and SCHEDULER_INTERVAL_MS >= 10_000),
                        "intervalMs": SCHEDULER_INTERVAL_MS,
                        "startedAt": scheduler_started_at,
                        "lastRunAt": last_scheduled_run_at,
                    },
                    "supabase": {"enabled": SUPABASE_ENABLED},
                },
            )
            return

        if pathname == "/api/auth/config" and self.command == "GET":
            enforce_rate_limit(self, "read")
            json_response(self, 200, {"enabled": SUPABASE_ENABLED})
            return

        if pathname == "/api/auth/signup" and self.command == "POST":
            enforce_rate_limit(self, "write")
            body = read_json_body(self)
            json_response(self, 200, proxy_supabase_auth("/auth/v1/signup", body))
            return

        if pathname == "/api/auth/signin" and self.command == "POST":
            enforce_rate_limit(self, "write")
            body = read_json_body(self)
            json_response(self, 200, proxy_supabase_auth("/auth/v1/token?grant_type=password", body))
            return

        if pathname == "/api/state" and self.command == "GET":
            enforce_rate_limit(self, "read")
            user = verify_user(self)
            json_response(self, 200, read_user_state(user))
            return

        if pathname == "/api/state" and self.command == "PUT":
            enforce_rate_limit(self, "write")
            user = verify_user(self)
            next_state = read_json_body(self, STATE_BODY_LIMIT_BYTES)
            json_response(self, 200, write_user_state(user, next_state))
            return

        if pathname == "/api/check-all" and self.command == "POST":
            enforce_rate_limit(self, "check")
            user = verify_user(self)
            state = read_user_state(user)
            for endpoint in state.get("endpoints", []):
                result = run_endpoint_check(endpoint)
                append_check(user, endpoint, result)
                update_incident(state, endpoint, result)
            persist_user_incidents(user, state)
            json_response(self, 200, read_user_state(user))
            return

        if pathname.startswith("/api/check/") and self.command == "POST":
            enforce_rate_limit(self, "check")
            user = verify_user(self)
            endpoint_id = parse.unquote(pathname.removeprefix("/api/check/"))
            status_code, payload = check_and_persist(endpoint_id, user)
            json_response(self, status_code, payload)
            return

        json_response(self, 404, {"error": "API route not found."})

    def serve_static(self, pathname):
        file_name = PUBLIC_FILES.get(pathname)
        if not file_name:
            json_response(self, 404, {"error": "Not found."})
            return
        file_path = (ROOT / file_name).resolve()
        if ROOT not in file_path.parents and file_path != ROOT:
            json_response(self, 404, {"error": "Not found."})
            return
        if not file_path.exists():
            json_response(self, 404, {"error": "Not found."})
            return
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(file_path.suffix, "text/plain;charset=utf-8"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def log_message(self, format, *args):
        return


def main():
    ensure_data_file()
    start_scheduler()
    server = ThreadingHTTPServer((HOST, PORT), PingVistaHandler)
    server.started_at = time.monotonic()
    display_host = "127.0.0.1" if HOST == "0.0.0.0" else HOST
    print(f"PingVista Python backend running at http://{display_host}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nPingVista Python backend stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
