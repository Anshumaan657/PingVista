const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const PORT = Number(process.env.PORT) || 4175;
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "pingvista-db.json");
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
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
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

function parseHeaders(headersText = "") {
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

    headers[key] = value;
  }

  return headers;
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
  const webhookUrl = state.settings?.alertWebhookUrl;

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
    sendJson(response, 500, { error: error.message || "Server error." });
  }
});

server.listen(PORT, () => {
  ensureDataFile();
  console.log(`PingVista running at http://127.0.0.1:${PORT}`);
});
