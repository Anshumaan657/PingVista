const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const PORT = Number(process.env.PORT) || 4175;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SCHEDULER_INTERVAL_MS = Number(process.env.SCHEDULER_INTERVAL_MS || 300_000);
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "pingvista-db.json");
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const MAX_TIMEOUT_MS = 30_000;
const MAX_SLOW_THRESHOLD_MS = 60_000;
const MAX_HEADER_TEXT_LENGTH = 8_000;
const MAX_BODY_TEXT_LENGTH = 100_000;
const MAX_VALIDATION_TEXT_LENGTH = 2_000;
const MAX_ENDPOINTS = 50;
const STATE_BODY_LIMIT_BYTES = 500_000;
const DEFAULT_BODY_LIMIT_BYTES = 50_000;
const rateLimitBuckets = new Map();
const RATE_LIMITS = {
  read: { limit: 120, windowMs: 60_000 },
  write: { limit: 20, windowMs: 60_000 },
  check: { limit: 30, windowMs: 60_000 }
};
const PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/script.js", "script.js"],
  ["/favicon.svg", "favicon.svg"],
  ["/assets/pingvista-og.svg", "assets/pingvista-og.svg"],
  ["/assets/pingvista-screenshot.svg", "assets/pingvista-screenshot.svg"],
  ["/docs/FREE_DEPLOYMENT.md", "docs/FREE_DEPLOYMENT.md"],
  ["/docs/SELF_HOSTING.md", "docs/SELF_HOSTING.md"]
]);

const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
let schedulerStartedAt = null;
let lastScheduledRunAt = null;

const DEFAULT_STATE = {
  endpoints: [
    {
      id: "11111111-1111-4111-8111-111111111111",
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
      id: "22222222-2222-4222-8222-222222222222",
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

function authError(message = "Authentication required.") {
  const error = new Error(message);
  error.statusCode = 401;
  error.code = "AUTH_REQUIRED";
  return error;
}

function supabaseHeaders(useServiceRole = true, token = "") {
  const apiKey = useServiceRole ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;

  return {
    apikey: apiKey,
    Authorization: token ? `Bearer ${token}` : `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

async function supabaseRequest(pathname, options = {}) {
  if (!supabaseEnabled) {
    throw validationError("Supabase is not configured.", "SUPABASE_NOT_CONFIGURED");
  }

  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: {
      ...supabaseHeaders(options.useServiceRole !== false, options.token || ""),
      Prefer: options.prefer || "",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(payload?.msg || payload?.message || payload?.error || "Supabase request failed.");
    error.statusCode = response.status;
    error.code = "SUPABASE_ERROR";
    throw error;
  }

  return payload;
}

async function verifyUser(request) {
  if (!supabaseEnabled) {
    return null;
  }

  const authHeader = request.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    throw authError();
  }

  const user = await supabaseRequest("/auth/v1/user", {
    method: "GET",
    useServiceRole: false,
    token
  });

  if (!user?.id) {
    throw authError("Invalid Supabase session.");
  }

  await supabaseRequest("/rest/v1/users", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: JSON.stringify({
      id: user.id,
      email: user.email || ""
    })
  });

  return { id: user.id, email: user.email || "", token };
}

async function proxySupabaseAuth(pathname, body) {
  if (!supabaseEnabled) {
    throw validationError("Supabase auth is not configured.", "SUPABASE_NOT_CONFIGURED");
  }

  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(payload?.msg || payload?.message || payload?.error || "Authentication failed.");
    error.statusCode = response.status;
    error.code = "AUTH_FAILED";
    throw error;
  }

  return payload;
}

function rateLimitError(message = "Too many requests. Try again soon.") {
  const error = new Error(message);
  error.statusCode = 429;
  error.code = "RATE_LIMITED";
  return error;
}

function bodyTooLargeError(limitBytes) {
  const error = new Error(`Request body must be ${limitBytes} bytes or less.`);
  error.statusCode = 413;
  error.code = "BODY_TOO_LARGE";
  return error;
}

function getClientKey(request) {
  const forwarded = request.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (ip || request.socket.remoteAddress || "unknown").trim();
}

function enforceRateLimit(request, bucketName) {
  const config = RATE_LIMITS[bucketName];

  if (!config) {
    return;
  }

  const key = `${bucketName}:${getClientKey(request)}`;
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + config.windowMs
    });
    return;
  }

  bucket.count += 1;

  if (bucket.count > config.limit) {
    throw rateLimitError();
  }
}

function collectBody(request, limitBytes = DEFAULT_BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (Buffer.byteLength(body, "utf8") > limitBytes) {
        reject(bodyTooLargeError(limitBytes));
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
  if (Array.isArray(state.endpoints) && state.endpoints.length > MAX_ENDPOINTS) {
    throw validationError(`Workspace can contain at most ${MAX_ENDPOINTS} endpoints.`);
  }

  return {
    endpoints: Array.isArray(state.endpoints)
      ? state.endpoints.map(validateEndpoint)
      : [],
    incidents: Array.isArray(state.incidents) ? state.incidents : [],
    settings: validateSettings(state.settings || {})
  };
}

function normalizeIncident(incident) {
  return {
    id: incident.id || crypto.randomUUID(),
    endpointId: incident.endpointId,
    endpointName: incident.endpointName || "Unknown endpoint",
    group: incident.group || "Production",
    status: incident.status === "resolved" ? "resolved" : "open",
    startedAt: incident.startedAt || new Date().toISOString(),
    resolvedAt: incident.resolvedAt || null,
    message: incident.message || "Endpoint failed.",
    checks: Number(incident.checks) || 1
  };
}

function dbEndpointToApp(row, checks = []) {
  return validateEndpoint({
    id: row.id,
    name: row.name,
    url: row.url,
    method: row.method,
    group: row.environment_group,
    timeout: row.timeout,
    expectedStatus: row.expected_status,
    slowThreshold: row.slow_threshold,
    headersText: row.headers_text,
    bodyText: row.body_text,
    validationText: row.validation_text,
    history: checks.map((check) => ({
      checkedAt: check.checked_at,
      ok: check.ok,
      latency: Number(check.latency),
      status: check.status,
      validationOk: check.validation_ok,
      checkedBy: check.checked_by,
      message: check.message
    }))
  });
}

function appEndpointToDb(endpoint, userId) {
  const valid = validateEndpoint(endpoint);

  return {
    id: valid.id,
    user_id: userId,
    name: valid.name,
    url: valid.url,
    method: valid.method,
    environment_group: valid.group,
    timeout: valid.timeout,
    expected_status: valid.expectedStatus,
    slow_threshold: valid.slowThreshold,
    headers_text: valid.headersText,
    body_text: valid.bodyText,
    validation_text: valid.validationText,
    updated_at: new Date().toISOString()
  };
}

function dbIncidentToApp(row) {
  return normalizeIncident({
    id: row.id,
    endpointId: row.endpoint_id,
    endpointName: row.endpoint_name,
    group: row.environment_group,
    status: row.status,
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
    message: row.message,
    checks: row.checks
  });
}

function appIncidentToDb(incident, userId) {
  const valid = normalizeIncident(incident);

  return {
    id: valid.id,
    user_id: userId,
    endpoint_id: valid.endpointId,
    endpoint_name: valid.endpointName,
    environment_group: valid.group,
    status: valid.status,
    started_at: valid.startedAt,
    resolved_at: valid.resolvedAt,
    message: valid.message,
    checks: valid.checks
  };
}

function dbSettingsToApp(row = {}) {
  return validateSettings({
    mode: row.mode || "backend",
    theme: row.theme || "light",
    alertWebhookUrl: row.alert_webhook_url || "",
    alertOnRecovery: row.alert_on_recovery
  });
}

function appSettingsToDb(settings, userId) {
  const valid = validateSettings(settings);

  return {
    user_id: userId,
    mode: valid.mode,
    theme: valid.theme,
    alert_webhook_url: valid.alertWebhookUrl,
    alert_on_recovery: valid.alertOnRecovery,
    updated_at: new Date().toISOString()
  };
}

async function readUserState(user) {
  if (!supabaseEnabled || !user) {
    return readState();
  }

  const [endpointRows, checkRows, incidentRows, settingRows] = await Promise.all([
    supabaseRequest(`/rest/v1/endpoints?user_id=eq.${user.id}&select=*&order=created_at.desc`),
    supabaseRequest(`/rest/v1/checks?user_id=eq.${user.id}&select=*&order=checked_at.desc&limit=1000`),
    supabaseRequest(`/rest/v1/incidents?user_id=eq.${user.id}&select=*&order=started_at.desc`),
    supabaseRequest(`/rest/v1/settings?user_id=eq.${user.id}&select=*&limit=1`)
  ]);

  const checksByEndpoint = new Map();

  for (const check of checkRows || []) {
    const list = checksByEndpoint.get(check.endpoint_id) || [];
    list.push(check);
    checksByEndpoint.set(check.endpoint_id, list);
  }

  return {
    endpoints: (endpointRows || []).map((endpoint) =>
      dbEndpointToApp(endpoint, (checksByEndpoint.get(endpoint.id) || []).reverse().slice(-100))
    ),
    incidents: (incidentRows || []).map(dbIncidentToApp),
    settings: dbSettingsToApp(settingRows?.[0])
  };
}

async function writeUserState(user, nextState) {
  if (!supabaseEnabled || !user) {
    writeState(nextState);
    return readState();
  }

  const valid = validateState(nextState);

  await supabaseRequest(`/rest/v1/endpoints?user_id=eq.${user.id}`, {
    method: "DELETE"
  });

  if (valid.endpoints.length) {
    await supabaseRequest("/rest/v1/endpoints", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify(valid.endpoints.map((endpoint) => appEndpointToDb(endpoint, user.id)))
    });
  }

  if (valid.incidents.length) {
    await supabaseRequest("/rest/v1/incidents", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify(valid.incidents.map((incident) => appIncidentToDb(incident, user.id)))
    });
  }

  await supabaseRequest("/rest/v1/settings", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify(appSettingsToDb(valid.settings, user.id))
  });

  return readUserState(user);
}

async function appendCheck(user, endpoint, result) {
  if (!supabaseEnabled || !user) {
    endpoint.history = Array.isArray(endpoint.history) ? endpoint.history : [];
    endpoint.history = endpoint.history.concat(result).slice(-100);
    return;
  }

  await supabaseRequest("/rest/v1/checks", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify({
      user_id: user.id,
      endpoint_id: endpoint.id,
      checked_at: result.checkedAt,
      ok: result.ok,
      latency: result.latency,
      status: String(result.status),
      validation_ok: Boolean(result.validationOk),
      checked_by: result.checkedBy || "backend",
      message: result.message || ""
    })
  });
}

async function persistUserIncidents(user, state) {
  if (!supabaseEnabled || !user) {
    writeState(state);
    return;
  }

  await supabaseRequest(`/rest/v1/incidents?user_id=eq.${user.id}`, {
    method: "DELETE"
  });

  if (state.incidents.length) {
    await supabaseRequest("/rest/v1/incidents", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify(state.incidents.map((incident) => appIncidentToDb(incident, user.id)))
    });
  }
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

async function checkAndPersist(endpointId, user = null) {
  const state = await readUserState(user);
  const endpoint = state.endpoints.find((item) => item.id === endpointId);

  if (!endpoint) {
    return { statusCode: 404, payload: { error: "Endpoint not found." } };
  }

  const result = await runEndpointCheck(endpoint);
  await appendCheck(user, endpoint, result);
  await updateIncident(state, endpoint, result);
  await persistUserIncidents(user, state);

  return { statusCode: 200, payload: { endpoint, result, state: await readUserState(user) } };
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health" && request.method === "GET") {
    enforceRateLimit(request, "read");
    sendJson(response, 200, {
      status: "ok",
      service: "PingVista",
      version: "5.0.0",
      uptimeSeconds: Math.round(process.uptime()),
      storage: supabaseEnabled ? "supabase" : "local-json",
      limits: {
        maxEndpoints: MAX_ENDPOINTS,
        maxChecksPerMinute: RATE_LIMITS.check.limit,
        maxStateBodyBytes: STATE_BODY_LIMIT_BYTES,
        maxEndpointBodyBytes: MAX_BODY_TEXT_LENGTH
      },
      scheduler: {
        enabled: Boolean(SCHEDULER_INTERVAL_MS && SCHEDULER_INTERVAL_MS >= 10_000),
        intervalMs: SCHEDULER_INTERVAL_MS,
        startedAt: schedulerStartedAt,
        lastRunAt: lastScheduledRunAt
      },
      supabase: {
        enabled: supabaseEnabled
      }
    });
    return;
  }

  if (url.pathname === "/api/auth/config" && request.method === "GET") {
    enforceRateLimit(request, "read");
    sendJson(response, 200, { enabled: supabaseEnabled });
    return;
  }

  if (url.pathname === "/api/auth/signup" && request.method === "POST") {
    enforceRateLimit(request, "write");
    const body = JSON.parse(await collectBody(request, DEFAULT_BODY_LIMIT_BYTES) || "{}");
    sendJson(response, 200, await proxySupabaseAuth("/auth/v1/signup", body));
    return;
  }

  if (url.pathname === "/api/auth/signin" && request.method === "POST") {
    enforceRateLimit(request, "write");
    const body = JSON.parse(await collectBody(request, DEFAULT_BODY_LIMIT_BYTES) || "{}");
    sendJson(response, 200, await proxySupabaseAuth("/auth/v1/token?grant_type=password", body));
    return;
  }

  if (url.pathname === "/api/state" && request.method === "GET") {
    enforceRateLimit(request, "read");
    const user = await verifyUser(request);
    sendJson(response, 200, await readUserState(user));
    return;
  }

  if (url.pathname === "/api/state" && request.method === "PUT") {
    enforceRateLimit(request, "write");
    const user = await verifyUser(request);
    const body = await collectBody(request, STATE_BODY_LIMIT_BYTES);
    const nextState = JSON.parse(body || "{}");
    const saved = await writeUserState(user, {
      ...DEFAULT_STATE,
      ...nextState,
      settings: {
        ...DEFAULT_STATE.settings,
        ...(nextState.settings || {})
      }
    });
    sendJson(response, 200, saved);
    return;
  }

  if (url.pathname === "/api/check-all" && request.method === "POST") {
    enforceRateLimit(request, "check");
    const user = await verifyUser(request);
    const state = await readUserState(user);

    for (const endpoint of state.endpoints) {
      const result = await runEndpointCheck(endpoint);
      await appendCheck(user, endpoint, result);
      await updateIncident(state, endpoint, result);
    }

    await persistUserIncidents(user, state);
    sendJson(response, 200, await readUserState(user));
    return;
  }

  const checkMatch = url.pathname.match(/^\/api\/check\/([^/]+)$/);

  if (checkMatch && request.method === "POST") {
    enforceRateLimit(request, "check");
    const user = await verifyUser(request);
    const { statusCode, payload } = await checkAndPersist(decodeURIComponent(checkMatch[1]), user);
    sendJson(response, statusCode, payload);
    return;
  }

  sendJson(response, 404, { error: "API route not found." });
}

async function runScheduledChecks() {
  lastScheduledRunAt = new Date().toISOString();

  if (supabaseEnabled) {
    const endpointRows = await supabaseRequest("/rest/v1/endpoints?select=*");
    const userIds = Array.from(new Set((endpointRows || []).map((endpoint) => endpoint.user_id)));

    for (const userId of userIds) {
      const user = { id: userId };
      const userState = await readUserState(user);

      for (const endpoint of userState.endpoints) {
        const result = await runEndpointCheck(endpoint);
        await appendCheck(user, endpoint, result);
        await updateIncident(userState, endpoint, result);
      }

      await persistUserIncidents(user, userState);
    }

    return;
  }

  const state = readState();

  for (const endpoint of state.endpoints) {
    const result = await runEndpointCheck(endpoint);
    await appendCheck(null, endpoint, result);
    await updateIncident(state, endpoint, result);
  }

  writeState(state);
}

function startScheduler() {
  if (!SCHEDULER_INTERVAL_MS || SCHEDULER_INTERVAL_MS < 10_000) {
    return;
  }

  schedulerStartedAt = new Date().toISOString();
  setInterval(() => {
    runScheduledChecks().catch((error) => {
      console.error("Scheduled check failed:", error.message);
    });
  }, SCHEDULER_INTERVAL_MS);
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
    ".js": "application/javascript;charset=utf-8",
    ".svg": "image/svg+xml;charset=utf-8",
    ".md": "text/markdown;charset=utf-8"
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
  startScheduler();
  console.log(`PingVista running at http://127.0.0.1:${PORT}`);
});
