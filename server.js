const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const PORT = Number(process.env.PORT) || 4175;
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "pingvista-db.json");
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const MAX_TIMEOUT_MS = 30_000;
const MAX_SLOW_THRESHOLD_MS = 60_000;
const MAX_HEADER_TEXT_LENGTH = 8_000;
const MAX_BODY_TEXT_LENGTH = 100_000;
const MAX_VALIDATION_TEXT_LENGTH = 2_000;
const PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/script.js", "script.js"]
]);

const DEFAULT_STATE = {
  endpoints: [
    {
      id: "demo-github-api",
      name: "GitHub API",
      url: "https://api.github.com",
      method: "GET",
      group: "Production",
      timeout: 5000,
      expectedStatus: 200,
      slowThreshold: 900,
      headersText: "Accept: application/json",
      bodyText: "",
      validationText: "current_user_url",
      history: []
    },
    {
      id: "demo-jsonplaceholder",
      name: "JSONPlaceholder",
      url: "https://jsonplaceholder.typicode.com/posts",
      method: "GET",
      group: "Staging",
      timeout: 5000,
      expectedStatus: 200,
      slowThreshold: 900,
      headersText: "",
      bodyText: "",
      validationText: "userId",
      history: []
    }
  ],
  incidents: [],
  settings: {
    mode: "backend",
    theme: "light",
    alertWebhookUrl: "",
    alertOnRecovery: true
  }
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_STATE, null, 2));
  }
}

function readState() {
  ensureDataFile();

  try {
    return {
      ...DEFAULT_STATE,
      ...JSON.parse(fs.readFileSync(DB_PATH, "utf8"))
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(state) {
  ensureDataFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(validateState(state), null, 2));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function validationError(message, code = "VALIDATION_ERROR") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function isPrivateIPv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isUnsafeHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");

  if (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal"
  ) {
    return true;
  }

  if (isPrivateIPv4(normalized)) {
    return true;
  }

  if (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized === "100.100.100.200" ||
    normalized === "169.254.169.254"
  ) {
    return true;
  }

  return false;
}

function validatePublicUrl(value, fieldName) {
  let parsed;

  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw validationError(`${fieldName} must be a valid URL.`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw validationError(`${fieldName} must use HTTP or HTTPS.`);
  }

  if (parsed.username || parsed.password) {
    throw validationError(`${fieldName} must not include credentials.`);
  }

  if (isUnsafeHostname(parsed.hostname)) {
    throw validationError(`${fieldName} points to a blocked private or metadata host.`);
  }

  return parsed.toString();
}

function validateNumber(value, fieldName, min, max) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw validationError(`${fieldName} must be an integer between ${min} and ${max}.`);
  }

  return number;
}

function parseHeaders(headersText = "") {
  if (headersText.length > MAX_HEADER_TEXT_LENGTH) {
    throw validationError("Headers are too large.");
  }

  const headers = {};
  const lines = headersText.split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const index = line.indexOf(":");

    if (index === -1) {
      throw new Error(`Header "${line}" must use Key: Value format.`);
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();

    if (!key || !value) {
      throw new Error(`Header "${line}" must include both key and value.`);
    }

    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) {
      throw validationError("Headers must not contain newline injection.");
    }

    headers[key] = value;
  }

  return headers;
}

function validateEndpoint(endpoint) {
  const method = String(endpoint.method || "GET").toUpperCase();

  if (!ALLOWED_METHODS.has(method)) {
    throw validationError("HTTP method is not supported.");
  }

  const bodyText = String(endpoint.bodyText || "").trim();

  if (bodyText.length > MAX_BODY_TEXT_LENGTH) {
    throw validationError("JSON body is too large.");
  }

  if (bodyText && !BODY_METHODS.has(method)) {
    throw validationError("JSON body is only allowed for POST, PUT, and PATCH.");
  }

  if (bodyText) {
    try {
      JSON.parse(bodyText);
    } catch {
      throw validationError("JSON body must be valid JSON.");
    }
  }

  parseHeaders(String(endpoint.headersText || ""));

  const validationText = String(endpoint.validationText || "").trim();

  if (validationText.length > MAX_VALIDATION_TEXT_LENGTH) {
    throw validationError("Response validation text is too large.");
  }

  return {
    id: endpoint.id || crypto.randomUUID(),
    name: String(endpoint.name || "Untitled API").trim().slice(0, 120),
    url: validatePublicUrl(endpoint.url, "Endpoint URL"),
    method,
    group: String(endpoint.group || "Production").trim().slice(0, 80),
    timeout: validateNumber(endpoint.timeout || 5000, "Timeout", 500, MAX_TIMEOUT_MS),
    expectedStatus: validateNumber(endpoint.expectedStatus || 200, "Expected status", 100, 599),
    slowThreshold: validateNumber(endpoint.slowThreshold || 900, "Slow threshold", 100, MAX_SLOW_THRESHOLD_MS),
    headersText: String(endpoint.headersText || "").trim(),
    bodyText,
    validationText,
    history: Array.isArray(endpoint.history) ? endpoint.history.slice(-100) : []
  };
}

function validateSettings(settings = {}) {
  const alertWebhookUrl = String(settings.alertWebhookUrl || "").trim();

  return {
    mode: settings.mode === "backend" ? "backend" : "browser",
    theme: settings.theme === "dark" ? "dark" : "light",
    alertWebhookUrl: alertWebhookUrl
      ? validatePublicUrl(alertWebhookUrl, "Webhook URL")
      : "",
    alertOnRecovery: settings.alertOnRecovery !== false
  };
}

function validateState(state = {}) {
  return {
    endpoints: Array.isArray(state.endpoints)
      ? state.endpoints.map(validateEndpoint)
      : [],
    incidents: Array.isArray(state.incidents) ? state.incidents : [],
    settings: validateSettings(state.settings || {})
  };
}

function validateResponseBody(endpoint, bodyText) {
  if (!endpoint.validationText) {
    return { ok: true, message: "" };
  }

  return bodyText.includes(endpoint.validationText)
    ? { ok: true, message: `Body matched "${endpoint.validationText}".` }
    : { ok: false, message: `Body did not contain "${endpoint.validationText}".` };
}

async function runEndpointCheck(endpoint) {
  endpoint = validateEndpoint(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(endpoint.timeout) || 5000);
  const startedAt = performance.now();
  const method = (endpoint.method || "GET").toUpperCase();

  try {
    const headers = parseHeaders(endpoint.headersText || "");
    const options = {
      method,
      headers,
      signal: controller.signal
    };

    if (["POST", "PUT", "PATCH"].includes(method) && endpoint.bodyText?.trim()) {
      options.body = endpoint.bodyText.trim();

      if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
        options.headers["Content-Type"] = "application/json";
      }
    }

    const response = await fetch(endpoint.url, options);
    const bodyText = await response.text();
    const latency = performance.now() - startedAt;
    const expectedStatus = Number(endpoint.expectedStatus) || 200;
    const statusMatches = response.status === expectedStatus;
    const validation = validateResponseBody(endpoint, bodyText);
    const ok = response.ok && statusMatches && validation.ok;

    return {
      checkedAt: new Date().toISOString(),
      ok,
      latency,
      status: response.status,
      validationOk: validation.ok,
      checkedBy: "backend",
      message: ok
        ? `Responded in ${Math.round(latency)} ms. ${validation.message}`.trim()
        : statusMatches
          ? validation.message || `Returned HTTP ${response.status}.`
          : `Expected HTTP ${expectedStatus}, got ${response.status}.`
    };
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      ok: false,
      latency: performance.now() - startedAt,
      status: "ERR",
      validationOk: false,
      checkedBy: "backend",
      message:
        error.name === "AbortError"
          ? `Timed out after ${(Number(endpoint.timeout) || 5000) / 1000} seconds.`
          : error.message || "Request failed."
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function maybeSendAlert(state, incident, eventType) {
  const webhookUrl = validateSettings(state.settings || {}).alertWebhookUrl;

  if (!webhookUrl) {
    return;
  }

  if (eventType === "recovered" && state.settings?.alertOnRecovery === false) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app: "PingVista",
        event: eventType,
        incident
      })
    });
  } catch {
    // Alert delivery should never block monitoring persistence.
  }
}

async function updateIncident(state, endpoint, result) {
  const incidents = Array.isArray(state.incidents) ? state.incidents : [];
  const openIncident = incidents.find(
    (incident) => incident.endpointId === endpoint.id && incident.status === "open"
  );

  if (!result.ok) {
    if (openIncident) {
      openIncident.message = result.message;
      openIncident.checks = Number(openIncident.checks || 0) + 1;
      return;
    }

    const incident = {
      id: crypto.randomUUID(),
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      group: endpoint.group || "Production",
      status: "open",
      startedAt: result.checkedAt,
      resolvedAt: null,
      message: result.message,
      checks: 1
    };

    incidents.unshift(incident);
    state.incidents = incidents;
    await maybeSendAlert(state, incident, "down");
    return;
  }

  if (openIncident) {
    openIncident.status = "resolved";
    openIncident.resolvedAt = result.checkedAt;
    openIncident.message = `Recovered after ${openIncident.checks} failed check${openIncident.checks === 1 ? "" : "s"}.`;
    await maybeSendAlert(state, openIncident, "recovered");
  }
}

async function checkAndPersist(endpointId) {
  const state = readState();
  const endpoint = state.endpoints.find((item) => item.id === endpointId);

  if (!endpoint) {
    return { statusCode: 404, payload: { error: "Endpoint not found." } };
  }

  const result = await runEndpointCheck(endpoint);
  endpoint.history = Array.isArray(endpoint.history) ? endpoint.history : [];
  endpoint.history = endpoint.history.concat(result).slice(-100);
  await updateIncident(state, endpoint, result);
  writeState(state);

  return { statusCode: 200, payload: { endpoint, result, state } };
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/state" && request.method === "GET") {
    sendJson(response, 200, readState());
    return;
  }

  if (url.pathname === "/api/state" && request.method === "PUT") {
    const body = await collectBody(request);
    const nextState = JSON.parse(body || "{}");
    writeState({
      ...DEFAULT_STATE,
      ...nextState,
      settings: {
        ...DEFAULT_STATE.settings,
        ...(nextState.settings || {})
      }
    });
    sendJson(response, 200, readState());
    return;
  }

  if (url.pathname === "/api/check-all" && request.method === "POST") {
    const state = readState();

    for (const endpoint of state.endpoints) {
      const result = await runEndpointCheck(endpoint);
      endpoint.history = Array.isArray(endpoint.history) ? endpoint.history : [];
      endpoint.history = endpoint.history.concat(result).slice(-100);
      await updateIncident(state, endpoint, result);
    }

    writeState(state);
    sendJson(response, 200, state);
    return;
  }

  const checkMatch = url.pathname.match(/^\/api\/check\/([^/]+)$/);

  if (checkMatch && request.method === "POST") {
    const { statusCode, payload } = await checkAndPersist(decodeURIComponent(checkMatch[1]));
    sendJson(response, statusCode, payload);
    return;
  }

  sendJson(response, 404, { error: "API route not found." });
}

function serveStatic(response, pathname) {
  const fileName = PUBLIC_FILES.get(pathname);

  if (!fileName) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  const filePath = path.join(__dirname, fileName);
  const ext = path.extname(filePath);
  const type = {
    ".html": "text/html;charset=utf-8",
    ".css": "text/css;charset=utf-8",
    ".js": "application/javascript;charset=utf-8"
  }[ext] || "text/plain;charset=utf-8";

  response.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message || "Server error.",
      code: error.code || "SERVER_ERROR"
    });
  }
});

server.listen(PORT, () => {
  ensureDataFile();
  console.log(`PingVista running at http://127.0.0.1:${PORT}`);
});
