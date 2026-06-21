const STORAGE_KEY = "api-pulse-monitor-v4";
const AUTH_TOKEN_KEY = "pingvista-auth-token-v1";
const AUTH_EMAIL_KEY = "pingvista-auth-email-v1";
const LEGACY_KEYS = ["api-pulse-monitor-v3", "api-pulse-monitor-v2", "api-pulse-monitor-v1"];
const HISTORY_LIMIT = 30;
const DEFAULT_SLOW_THRESHOLD_MS = 900;
const DEFAULT_EXPECTED_STATUS = 200;
const DEFAULT_GROUPS = ["Production", "Staging", "Development"];
const BODY_METHODS = ["POST", "PUT", "PATCH"];
const MAX_ENDPOINTS = 50;

const seedEndpoints = [
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
];

const elements = {
  form: document.querySelector("#endpointForm"),
  formTitle: document.querySelector("#formTitle"),
  editingId: document.querySelector("#editingId"),
  name: document.querySelector("#endpointName"),
  url: document.querySelector("#endpointUrl"),
  method: document.querySelector("#endpointMethod"),
  group: document.querySelector("#endpointGroup"),
  timeout: document.querySelector("#endpointTimeout"),
  expectedStatus: document.querySelector("#expectedStatus"),
  slowThreshold: document.querySelector("#slowThreshold"),
  headers: document.querySelector("#endpointHeaders"),
  body: document.querySelector("#endpointBody"),
  validationText: document.querySelector("#validationText"),
  formError: document.querySelector("#formError"),
  saveEndpointButton: document.querySelector("#saveEndpointButton"),
  cancelEdit: document.querySelector("#cancelEditButton"),
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".tab-panel"),
  themeOptions: document.querySelectorAll(".theme-option"),
  search: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  groupFilter: document.querySelector("#groupFilter"),
  grid: document.querySelector("#endpointGrid"),
  groupGrid: document.querySelector("#groupGrid"),
  endpointTable: document.querySelector("#endpointTable"),
  incidentList: document.querySelector("#incidentList"),
  reportGrid: document.querySelector("#reportGrid"),
  template: document.querySelector("#endpointTemplate"),
  checkAll: document.querySelector("#checkAllButton"),
  exportCsv: document.querySelector("#exportCsvButton"),
  exportJson: document.querySelector("#exportJsonButton"),
  importJson: document.querySelector("#importJsonInput"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  signIn: document.querySelector("#signInButton"),
  signUp: document.querySelector("#signUpButton"),
  signOut: document.querySelector("#signOutButton"),
  authStatus: document.querySelector("#authStatus"),
  checkMode: document.querySelector("#checkMode"),
  syncBackend: document.querySelector("#syncBackendButton"),
  backendStatus: document.querySelector("#backendStatus"),
  refreshHealth: document.querySelector("#refreshHealthButton"),
  healthSummary: document.querySelector("#healthSummary"),
  theme: document.querySelector("#themeSelect"),
  alertWebhookUrl: document.querySelector("#alertWebhookUrl"),
  alertOnRecovery: document.querySelector("#alertOnRecovery"),
  clearLocalData: document.querySelector("#clearLocalDataButton"),
  reset: document.querySelector("#resetButton"),
  toastRegion: document.querySelector("#toastRegion"),
  monitorToggle: document.querySelector("#monitorToggle"),
  monitorInterval: document.querySelector("#monitorInterval"),
  monitoringStatus: document.querySelector("#monitoringStatus"),
  lastUpdated: document.querySelector("#lastUpdated"),
  metricTotal: document.querySelector("#metricTotal"),
  metricHealthy: document.querySelector("#metricHealthy"),
  metricLatency: document.querySelector("#metricLatency"),
  metricIncidents: document.querySelector("#metricIncidents"),
  storageSummary: document.querySelector("#storageSummary"),
  detailModal: document.querySelector("#detailModal"),
  detailTitle: document.querySelector("#detailTitle"),
  detailContent: document.querySelector("#detailContent"),
  closeDetail: document.querySelector("#closeDetailButton")
};

let state = loadState();
let endpoints = state.endpoints;
let incidents = state.incidents;
let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";
let authEmail = localStorage.getItem(AUTH_EMAIL_KEY) || "";
let supabaseAuthEnabled = false;
let monitorTimer = null;
let countdownTimer = null;
let nextCheckAt = null;

function demoCheck(minutesAgo, ok, latency, status, message, checkedBy = "demo") {
  return {
    checkedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    ok,
    latency,
    status,
    validationOk: ok,
    checkedBy,
    message
  };
}

function createDemoHistory(endpointName) {
  if (endpointName === "GitHub API") {
    return [
      demoCheck(58, true, 182, 200, "Responded in 182 ms. Body matched \"current_user_url\"."),
      demoCheck(44, true, 214, 200, "Responded in 214 ms. Body matched \"current_user_url\"."),
      demoCheck(30, true, 268, 200, "Responded in 268 ms. Body matched \"current_user_url\"."),
      demoCheck(16, true, 195, 200, "Responded in 195 ms. Body matched \"current_user_url\"."),
      demoCheck(3, true, 231, 200, "Responded in 231 ms. Body matched \"current_user_url\".")
    ];
  }

  return [
    demoCheck(72, true, 345, 200, "Responded in 345 ms. Body matched \"userId\"."),
    demoCheck(55, false, 5000, "ERR", "Timed out after 5 seconds."),
    demoCheck(39, false, 940, 503, "Expected HTTP 200, got 503."),
    demoCheck(24, true, 318, 200, "Responded in 318 ms. Body matched \"userId\"."),
    demoCheck(8, true, 287, 200, "Responded in 287 ms. Body matched \"userId\".")
  ];
}

function createDemoIncidents() {
  return [
    normalizeIncident({
      id: "33333333-3333-4333-8333-333333333333",
      endpointId: "22222222-2222-4222-8222-222222222222",
      endpointName: "JSONPlaceholder",
      group: "Staging",
      status: "resolved",
      startedAt: new Date(Date.now() - 55 * 60_000).toISOString(),
      resolvedAt: new Date(Date.now() - 24 * 60_000).toISOString(),
      message: "Recovered after 2 failed checks.",
      checks: 2
    })
  ];
}

function syncStateRefs() {
  endpoints = state.endpoints;
  incidents = state.incidents;
}

function createSeedState() {
  return {
    endpoints: seedEndpoints.map((endpoint) =>
      normalizeEndpoint({
        ...endpoint,
        history: createDemoHistory(endpoint.name)
      })
    ),
    incidents: createDemoIncidents(),
    settings: {
      checkMode: "browser",
      theme: "light",
      alertWebhookUrl: "",
      alertOnRecovery: true
    }
  };
}

function showToast(message, type = "info") {
  if (!elements.toastRegion) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function setButtonBusy(button, isBusy, label = "Working...") {
  if (!button) return;

  if (isBusy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
    return;
  }

  button.textContent = button.dataset.originalText || button.textContent;
  button.disabled = false;
  delete button.dataset.originalText;
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const legacy = LEGACY_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
  const raw = saved || legacy;

  if (!raw) {
    return createSeedState();
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        endpoints: parsed.map(normalizeEndpoint),
        incidents: []
      };
    }

    return {
      endpoints: Array.isArray(parsed.endpoints)
        ? parsed.endpoints.map(normalizeEndpoint)
        : createSeedState().endpoints,
      incidents: Array.isArray(parsed.incidents)
        ? parsed.incidents.map(normalizeIncident)
        : [],
      settings: normalizeSettings(parsed.settings)
    };
  } catch {
    return createSeedState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  applyTheme();
  syncSettingsControls();

  if (state.settings.checkMode === "backend") {
    syncStateToBackend();
  }
}

function normalizeSettings(settings = {}) {
  return {
    checkMode: settings.checkMode === "backend" || settings.mode === "backend" ? "backend" : "browser",
    theme: settings.theme === "dark" ? "dark" : "light",
    alertWebhookUrl: settings.alertWebhookUrl || "",
    alertOnRecovery: settings.alertOnRecovery !== false
  };
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
  elements.themeOptions.forEach((button) => {
    button.classList.toggle("active", button.dataset.themeOption === state.settings.theme);
  });
}

function syncSettingsControls() {
  elements.authEmail.value = authEmail;
  elements.authStatus.textContent = authToken
    ? `Signed in as ${authEmail || "Supabase user"}`
    : supabaseAuthEnabled
      ? "Sign in to use Supabase storage"
      : "Supabase auth not configured";
  elements.checkMode.value = state.settings.checkMode;
  elements.theme.value = state.settings.theme;
  elements.alertWebhookUrl.value = state.settings.alertWebhookUrl;
  elements.alertOnRecovery.checked = state.settings.alertOnRecovery;
}

async function apiFetch(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  if (response.status === 401) {
    elements.authStatus.textContent = "Sign in required for Supabase mode";
  }

  return response;
}

async function checkAuthConfig() {
  try {
    const response = await fetch("/api/auth/config", { cache: "no-store" });
    const config = await response.json();
    supabaseAuthEnabled = Boolean(config.enabled);
  } catch {
    supabaseAuthEnabled = false;
  }

  syncSettingsControls();
}

async function authRequest(mode) {
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;

  if (!email || !password) {
    elements.authStatus.textContent = "Enter email and password";
    showToast("Enter email and password.", "error");
    return;
  }

  try {
    setButtonBusy(mode === "signin" ? elements.signIn : elements.signUp, true, "Please wait...");
    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Authentication failed.");
    }

    authToken = payload.access_token || payload.session?.access_token || "";
    authEmail = payload.user?.email || email;

    if (!authToken) {
      elements.authStatus.textContent = "Check your email to confirm signup";
      showToast("Check your email to confirm signup.", "success");
      return;
    }

    localStorage.setItem(AUTH_TOKEN_KEY, authToken);
    localStorage.setItem(AUTH_EMAIL_KEY, authEmail);
    elements.authPassword.value = "";
    elements.authStatus.textContent = `Signed in as ${authEmail}`;
    showToast(`Signed in as ${authEmail}.`, "success");
    await loadStateFromBackend();
    renderAll();
  } catch (error) {
    elements.authStatus.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    setButtonBusy(mode === "signin" ? elements.signIn : elements.signUp, false);
  }
}

function signOut() {
  authToken = "";
  authEmail = "";
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_EMAIL_KEY);
  syncSettingsControls();
  showToast("Signed out.", "info");
}

async function syncStateToBackend() {
  try {
    const response = await apiFetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...state,
        settings: {
          mode: state.settings.checkMode,
          theme: state.settings.theme,
          alertWebhookUrl: state.settings.alertWebhookUrl,
          alertOnRecovery: state.settings.alertOnRecovery
        }
      })
    });

    if (!response.ok) {
      throw new Error("Backend sync failed.");
    }

    elements.backendStatus.textContent = "Backend synced";
    showToast("Backend synced.", "success");
  } catch {
    elements.backendStatus.textContent = "Backend unavailable";
    showToast("Backend unavailable. Browser mode still works.", "error");
  }
}

async function loadStateFromBackend() {
  try {
    const response = await apiFetch("/api/state", { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Backend unavailable.");
    }

    const backendState = await response.json();
    state = {
      endpoints: Array.isArray(backendState.endpoints)
        ? backendState.endpoints.map(normalizeEndpoint)
        : endpoints,
      incidents: Array.isArray(backendState.incidents)
        ? backendState.incidents.map(normalizeIncident)
        : incidents,
      settings: normalizeSettings({
        checkMode: backendState.settings?.mode || state.settings.checkMode,
        theme: backendState.settings?.theme || state.settings.theme,
        alertWebhookUrl: backendState.settings?.alertWebhookUrl || "",
        alertOnRecovery: backendState.settings?.alertOnRecovery
      })
    };
    syncStateRefs();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    elements.backendStatus.textContent = "Backend connected";
    checkBackendHealth();
    return true;
  } catch {
    elements.backendStatus.textContent = "Backend unavailable";
    return false;
  }
}

async function checkBackendHealth() {
  try {
    setButtonBusy(elements.refreshHealth, true, "Checking...");
    const response = await fetch("/api/health", { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Backend health endpoint unavailable.");
    }

    const health = await response.json();
    const database = health.supabase.enabled ? "Supabase" : "local JSON";
    const scheduler = health.scheduler.enabled ? "scheduler on" : "scheduler off";
    elements.healthSummary.textContent = `${health.status} · ${database} · ${scheduler}`;
    return health;
  } catch {
    elements.healthSummary.textContent = "No backend detected. Static/browser deployment is active.";
    return null;
  } finally {
    setButtonBusy(elements.refreshHealth, false);
  }
}

function normalizeEndpoint(endpoint) {
  return {
    id: endpoint.id || crypto.randomUUID(),
    name: endpoint.name || "Untitled API",
    url: endpoint.url || "",
    method: (endpoint.method || "GET").toUpperCase(),
    group: endpoint.group || "Production",
    timeout: Number(endpoint.timeout) || 5000,
    expectedStatus: Number(endpoint.expectedStatus) || DEFAULT_EXPECTED_STATUS,
    slowThreshold: Number(endpoint.slowThreshold) || DEFAULT_SLOW_THRESHOLD_MS,
    headersText: endpoint.headersText || "",
    bodyText: endpoint.bodyText || "",
    validationText: endpoint.validationText || "",
    history: Array.isArray(endpoint.history)
      ? endpoint.history.slice(-HISTORY_LIMIT)
      : []
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

function formatLatency(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : "--";
}

function formatDateTime(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function getLatest(endpoint) {
  return endpoint.history.at(-1);
}

function getStatus(endpoint, result = getLatest(endpoint)) {
  if (!result) return "unknown";
  if (!result.ok) return "down";
  if (result.latency > endpoint.slowThreshold) return "slow";
  return "healthy";
}

function statusLabel(status) {
  return {
    healthy: "Healthy",
    slow: "Slow",
    down: "Down",
    unknown: "Unknown"
  }[status];
}

function endpointUptime(endpoint) {
  if (!endpoint.history.length) return null;
  const successes = endpoint.history.filter((item) => item.ok).length;
  return Math.round((successes / endpoint.history.length) * 100);
}

function averageLatency(results) {
  const successful = results.filter((item) => item.ok && Number.isFinite(item.latency));
  if (!successful.length) return null;
  return Math.round(successful.reduce((sum, item) => sum + item.latency, 0) / successful.length);
}

function allGroups() {
  return Array.from(new Set(DEFAULT_GROUPS.concat(endpoints.map((endpoint) => endpoint.group))));
}

function parseHeaders(headersText) {
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

function validateBody(method, bodyText) {
  if (!bodyText.trim()) return "";
  if (!BODY_METHODS.includes(method)) {
    throw new Error("JSON body is only used for POST, PUT, and PATCH requests.");
  }

  JSON.parse(bodyText);
  return bodyText.trim();
}

function buildEndpointFromForm() {
  const method = elements.method.value.toUpperCase();
  parseHeaders(elements.headers.value);
  validateBody(method, elements.body.value);

  if (!elements.editingId.value && endpoints.length >= MAX_ENDPOINTS) {
    throw new Error(`Free deployment safety limit reached: ${MAX_ENDPOINTS} endpoints maximum.`);
  }

  return normalizeEndpoint({
    id: elements.editingId.value || crypto.randomUUID(),
    name: elements.name.value.trim(),
    url: elements.url.value.trim(),
    method,
    group: elements.group.value,
    timeout: Number(elements.timeout.value),
    expectedStatus: Number(elements.expectedStatus.value),
    slowThreshold: Number(elements.slowThreshold.value),
    headersText: elements.headers.value.trim(),
    bodyText: elements.body.value.trim(),
    validationText: elements.validationText.value.trim(),
    history: elements.editingId.value
      ? endpoints.find((endpoint) => endpoint.id === elements.editingId.value)?.history || []
      : []
  });
}

function filteredEndpoints() {
  const query = elements.search.value.trim().toLowerCase();
  const status = elements.statusFilter.value;
  const group = elements.groupFilter.value;

  return endpoints.filter((endpoint) => {
    const matchesText =
      !query ||
      endpoint.name.toLowerCase().includes(query) ||
      endpoint.url.toLowerCase().includes(query) ||
      endpoint.group.toLowerCase().includes(query);
    const matchesStatus = status === "all" || getStatus(endpoint) === status;
    const matchesGroup = group === "all" || endpoint.group === group;

    return matchesText && matchesStatus && matchesGroup;
  });
}

function renderAll() {
  renderGroupOptions();
  renderMetrics();
  renderGroups();
  renderEndpoints();
  renderEndpointTable();
  renderIncidents();
  renderReports();
  renderStorageSummary();
}

function renderGroupOptions() {
  const selected = elements.groupFilter.value || "all";
  elements.groupFilter.innerHTML = '<option value="all">All groups</option>';

  allGroups().forEach((group) => {
    const option = document.createElement("option");
    option.value = group;
    option.textContent = group;
    elements.groupFilter.append(option);
  });

  elements.groupFilter.value = allGroups().includes(selected) ? selected : "all";
}

function renderMetrics() {
  const latestResults = endpoints.map(getLatest).filter(Boolean);
  const healthy = endpoints.filter((endpoint) => getStatus(endpoint) === "healthy").length;
  const checks = endpoints.flatMap((endpoint) => endpoint.history);
  const latency = averageLatency(checks);
  const openIncidents = incidents.filter((incident) => incident.status === "open").length;

  elements.metricTotal.textContent = endpoints.length;
  elements.metricHealthy.textContent = latestResults.length ? healthy : 0;
  elements.metricLatency.textContent = latency ? `${latency} ms` : "--";
  elements.metricIncidents.textContent = openIncidents;
}

function renderGroups() {
  elements.groupGrid.textContent = "";

  allGroups().forEach((group) => {
    const groupEndpoints = endpoints.filter((endpoint) => endpoint.group === group);
    if (!groupEndpoints.length) return;

    const open = incidents.filter(
      (incident) => incident.group === group && incident.status === "open"
    ).length;
    const healthy = groupEndpoints.filter((endpoint) => getStatus(endpoint) === "healthy").length;
    const card = document.createElement("article");
    card.className = "group-card";
    card.innerHTML = `
      <span>${group}</span>
      <strong>${healthy}/${groupEndpoints.length}</strong>
      <p>${open} open incident${open === 1 ? "" : "s"}</p>
    `;
    elements.groupGrid.append(card);
  });
}

function chartPoint(index, item, history, maxLatency) {
  const chartLeft = 8;
  const chartRight = 112;
  const chartTop = 12;
  const chartBottom = 62;
  const x = history.length === 1
    ? (chartLeft + chartRight) / 2
    : chartLeft + (index / (history.length - 1)) * (chartRight - chartLeft);
  const value = Math.min(item.latency || 0, maxLatency);
  const y = chartBottom - (value / maxLatency) * (chartBottom - chartTop);
  return { x, y };
}

function renderChart(container, endpoint) {
  const history = endpoint.history.slice(-HISTORY_LIMIT);
  container.textContent = "";

  if (!history.length) {
    const empty = document.createElement("span");
    empty.className = "chart-empty";
    empty.textContent = "No checks yet";
    container.append(empty);
    return;
  }

  const maxLatency = Math.max(
    endpoint.slowThreshold,
    300,
    ...history.map((item) => item.latency || 0)
  );
  const points = history.map((item, index) => chartPoint(index, item, history, maxLatency));
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const thresholdY = 62 - (Math.min(endpoint.slowThreshold, maxLatency) / maxLatency) * 50;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 72");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("line-chart");

  const threshold = document.createElementNS("http://www.w3.org/2000/svg", "line");
  threshold.setAttribute("x1", "8");
  threshold.setAttribute("x2", "112");
  threshold.setAttribute("y1", thresholdY);
  threshold.setAttribute("y2", thresholdY);
  threshold.classList.add("threshold-line");
  svg.append(threshold);

  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("d", linePath);
  line.classList.add("latency-line");
  svg.append(line);

  points.forEach((point, index) => {
    const result = history[index];
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    marker.setAttribute("cx", point.x);
    marker.setAttribute("cy", point.y);
    marker.setAttribute("r", "2.3");
    marker.classList.add(result.ok ? "point-ok" : "point-down");

    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${formatDateTime(result.checkedAt)} - ${
      result.ok ? formatLatency(result.latency) : result.message
    }`;
    marker.append(title);
    svg.append(marker);
  });

  container.append(svg);
}

function renderEndpoints() {
  elements.grid.textContent = "";
  const visibleEndpoints = filteredEndpoints();

  if (!endpoints.length) {
    elements.grid.append(emptyState("Add an API endpoint to start monitoring."));
    return;
  }

  if (!visibleEndpoints.length) {
    elements.grid.append(emptyState("No endpoints match the current filters."));
    return;
  }

  visibleEndpoints.forEach((endpoint) => {
    const latest = getLatest(endpoint);
    const status = getStatus(endpoint, latest);
    const uptime = endpointUptime(endpoint);
    const node = elements.template.content.firstElementChild.cloneNode(true);

    node.dataset.id = endpoint.id;
    node.querySelector(".method-badge").textContent = endpoint.method;
    node.querySelector(".group-badge").textContent = endpoint.group;
    node.querySelector(".endpoint-title").textContent = endpoint.name;

    const link = node.querySelector(".endpoint-url");
    link.href = endpoint.url;
    link.textContent = endpoint.url;

    const pill = node.querySelector(".status-pill");
    pill.textContent = statusLabel(status);
    pill.classList.add(status);

    node.querySelector(".latency-value").textContent = latest
      ? formatLatency(latest.latency)
      : "--";
    node.querySelector(".uptime-value").textContent = uptime === null ? "--" : `${uptime}%`;
    node.querySelector(".code-value").textContent = latest?.status || "--";
    node.querySelector(".expected-code").textContent = `Expected ${endpoint.expectedStatus}`;
    node.querySelector(".slow-rule").textContent = `Slow > ${endpoint.slowThreshold} ms`;
    node.querySelector(".validation-rule").textContent = endpoint.validationText
      ? `Body contains "${endpoint.validationText}"`
      : "No body rule";
    node.querySelector(".message").textContent =
      latest?.message || "Ready for the first check.";

    renderChart(node.querySelector(".chart"), endpoint);
    node.querySelector(".chart-scale").textContent = latest
      ? `max ${Math.round(Math.max(endpoint.slowThreshold, ...endpoint.history.map((item) => item.latency || 0)))} ms`
      : `slow > ${endpoint.slowThreshold} ms`;
    elements.grid.append(node);
  });
}

function emptyState(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function renderEndpointTable() {
  elements.endpointTable.textContent = "";

  if (!endpoints.length) {
    elements.endpointTable.append(emptyState("No endpoints configured."));
    return;
  }

  endpoints.forEach((endpoint) => {
    const latest = getLatest(endpoint);
    const row = document.createElement("article");
    row.className = "table-row";
    row.dataset.id = endpoint.id;
    row.innerHTML = `
      <div>
        <span class="method-badge">${endpoint.method}</span>
        <span class="group-badge">${endpoint.group}</span>
        <h3>${endpoint.name}</h3>
        <p>${endpoint.url}</p>
      </div>
      <div>
        <span>Status</span>
        <strong>${statusLabel(getStatus(endpoint))}</strong>
      </div>
      <div>
        <span>Rules</span>
        <strong>${endpoint.expectedStatus} / ${endpoint.slowThreshold} ms</strong>
      </div>
      <div>
        <span>Last check</span>
        <strong>${latest ? formatDateTime(latest.checkedAt) : "--"}</strong>
      </div>
      <div class="row-actions">
        <button class="secondary detail-one" type="button">Details</button>
        <button class="secondary edit-one" type="button">Edit</button>
      </div>
    `;
    elements.endpointTable.append(row);
  });
}

function renderIncidents() {
  elements.incidentList.textContent = "";
  const sorted = incidents
    .slice()
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  if (!sorted.length) {
    elements.incidentList.append(emptyState("No incidents yet. Failed checks will appear here."));
    return;
  }

  sorted.forEach((incident) => {
    const item = document.createElement("article");
    item.className = `incident-item ${incident.status}`;
    item.innerHTML = `
      <div>
        <span class="status-pill ${incident.status === "open" ? "down" : "healthy"}">
          ${incident.status === "open" ? "Open" : "Resolved"}
        </span>
        <h3>${incident.endpointName}</h3>
        <p>${incident.message}</p>
      </div>
      <div>
        <span>Started</span>
        <strong>${formatDateTime(incident.startedAt)}</strong>
      </div>
      <div>
        <span>Resolved</span>
        <strong>${formatDateTime(incident.resolvedAt)}</strong>
      </div>
      <div>
        <span>Checks</span>
        <strong>${incident.checks}</strong>
      </div>
    `;
    elements.incidentList.append(item);
  });
}

function renderReports() {
  const checks = endpoints.flatMap((endpoint) => endpoint.history);
  const successfulChecks = checks.filter((check) => check.ok);
  const average = averageLatency(checks);
  const uptime = checks.length
    ? Math.round((successfulChecks.length / checks.length) * 100)
    : 0;
  const backendChecks = checks.filter((check) => check.checkedBy === "backend").length;
  const reportItems = [
    ["Total checks", checks.length],
    ["Failed checks", checks.filter((check) => !check.ok).length],
    ["Overall uptime", `${uptime}%`],
    ["Avg latency", average ? `${average} ms` : "--"],
    ["Backend checks", backendChecks],
    ["Validated endpoints", endpoints.filter((endpoint) => endpoint.validationText).length],
    ["Open incidents", incidents.filter((incident) => incident.status === "open").length],
    ["Resolved incidents", incidents.filter((incident) => incident.status === "resolved").length],
    ["Groups", allGroups().filter((group) => endpoints.some((endpoint) => endpoint.group === group)).length]
  ];

  elements.reportGrid.textContent = "";
  reportItems.forEach(([label, value]) => {
    const item = document.createElement("article");
    item.className = "report-card";
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    elements.reportGrid.append(item);
  });
}

function renderStorageSummary() {
  const bytes = new Blob([JSON.stringify(state)]).size;
  elements.storageSummary.textContent = `${endpoints.length} endpoints, ${incidents.length} incidents, ${bytes} bytes saved, ${state.settings.checkMode} mode`;
}

function validateResponseBody(endpoint, bodyText) {
  if (!endpoint.validationText) {
    return { ok: true, message: "" };
  }

  return bodyText.includes(endpoint.validationText)
    ? { ok: true, message: `Body matched "${endpoint.validationText}".` }
    : { ok: false, message: `Body did not contain "${endpoint.validationText}".` };
}

async function pingEndpoint(endpoint) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), endpoint.timeout);
  const startedAt = performance.now();

  try {
    const headers = parseHeaders(endpoint.headersText);
    const options = {
      cache: "no-store",
      method: endpoint.method,
      mode: "cors",
      signal: controller.signal,
      headers
    };

    if (BODY_METHODS.includes(endpoint.method) && endpoint.bodyText.trim()) {
      options.body = endpoint.bodyText.trim();
      if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
        options.headers["Content-Type"] = "application/json";
      }
    }

    const response = await fetch(endpoint.url, options);
    const bodyText = await response.text();
    const latency = performance.now() - startedAt;
    const statusMatches = response.status === endpoint.expectedStatus;
    const validation = validateResponseBody(endpoint, bodyText);
    const ok = response.ok && statusMatches && validation.ok;

    return {
      checkedAt: new Date().toISOString(),
      ok,
      latency,
      status: response.status,
      validationOk: validation.ok,
      message: ok
        ? `Responded in ${Math.round(latency)} ms. ${validation.message}`.trim()
        : statusMatches
          ? validation.message || `Returned HTTP ${response.status}.`
          : `Expected HTTP ${endpoint.expectedStatus}, got ${response.status}.`
    };
  } catch (error) {
    const latency = performance.now() - startedAt;
    const message =
      error.name === "AbortError"
        ? `Timed out after ${endpoint.timeout / 1000} seconds.`
        : error.message || "Request failed or was blocked by CORS.";

    return {
      checkedAt: new Date().toISOString(),
      ok: false,
      latency,
      status: "ERR",
      validationOk: false,
      message
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function updateIncident(endpoint, result) {
  const openIncident = incidents.find(
    (incident) => incident.endpointId === endpoint.id && incident.status === "open"
  );

  if (!result.ok) {
    if (openIncident) {
      openIncident.message = result.message;
      openIncident.checks += 1;
    } else {
      incidents.unshift(
        normalizeIncident({
          id: crypto.randomUUID(),
          endpointId: endpoint.id,
          endpointName: endpoint.name,
          group: endpoint.group,
          status: "open",
          startedAt: result.checkedAt,
          message: result.message,
          checks: 1
        })
      );
    }
    return;
  }

  if (openIncident) {
    openIncident.status = "resolved";
    openIncident.resolvedAt = result.checkedAt;
    openIncident.message = `Recovered after ${openIncident.checks} failed check${openIncident.checks === 1 ? "" : "s"}.`;
  }
}

async function checkEndpoint(id) {
  const endpoint = endpoints.find((item) => item.id === id);
  if (!endpoint) return;

  const card = document.querySelector(`[data-id="${id}"]`);
  card?.classList.add("is-checking");
  const button = card?.querySelector(".check-one");
  setButtonBusy(button, true, "Checking...");

  if (state.settings.checkMode === "backend") {
    try {
      const response = await apiFetch(`/api/check/${encodeURIComponent(id)}`, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error("Backend check failed.");
      }

      const payload = await response.json();
      state = {
        endpoints: payload.state.endpoints.map(normalizeEndpoint),
        incidents: payload.state.incidents.map(normalizeIncident),
        settings: state.settings
      };
      syncStateRefs();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      elements.backendStatus.textContent = "Backend check completed";
    } catch {
      elements.backendStatus.textContent = "Backend unavailable, used browser check";
      showToast("Backend unavailable. Used browser check instead.", "info");
      const result = await pingEndpoint(endpoint);
      endpoint.history = endpoint.history.concat({ ...result, checkedBy: "browser" }).slice(HISTORY_LIMIT * -1);
      updateIncident(endpoint, result);
    }
  } else {
    const result = await pingEndpoint(endpoint);
    endpoint.history = endpoint.history.concat({ ...result, checkedBy: "browser" }).slice(HISTORY_LIMIT * -1);
    updateIncident(endpoint, result);
  }

  elements.lastUpdated.textContent = `Last checked ${new Date().toLocaleTimeString()}`;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
  setButtonBusy(button, false);
}

async function checkAllEndpoints() {
  elements.checkAll.classList.add("is-checking");
  setButtonBusy(elements.checkAll, true, "Checking...");

  if (state.settings.checkMode === "backend") {
    try {
      const response = await apiFetch("/api/check-all", { method: "POST" });

      if (!response.ok) {
        throw new Error("Backend check failed.");
      }

      const backendState = await response.json();
      state = {
        endpoints: backendState.endpoints.map(normalizeEndpoint),
        incidents: backendState.incidents.map(normalizeIncident),
        settings: state.settings
      };
      syncStateRefs();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      elements.backendStatus.textContent = "Backend check completed";
      elements.lastUpdated.textContent = `Last checked ${new Date().toLocaleTimeString()}`;
      renderAll();
      showToast("Backend checks completed.", "success");
    } catch {
      elements.backendStatus.textContent = "Backend unavailable, used browser checks";
      showToast("Backend unavailable. Running browser checks.", "info");
      await Promise.all(endpoints.map((endpoint) => checkEndpoint(endpoint.id)));
    }
  } else {
    await Promise.all(endpoints.map((endpoint) => checkEndpoint(endpoint.id)));
  }

  elements.checkAll.classList.remove("is-checking");
  setButtonBusy(elements.checkAll, false);
  showToast("Checks completed.", "success");
}

function updateMonitoringStatus() {
  if (!monitorTimer || !nextCheckAt) {
    elements.monitoringStatus.textContent = "Paused";
    elements.monitorToggle.textContent = "Start";
    return;
  }

  const seconds = Math.max(0, Math.ceil((nextCheckAt - Date.now()) / 1000));
  elements.monitoringStatus.textContent = `Running - next check in ${seconds}s`;
  elements.monitorToggle.textContent = "Pause";
}

function scheduleNextCheck() {
  window.clearTimeout(monitorTimer);
  const interval = Number(elements.monitorInterval.value);
  nextCheckAt = Date.now() + interval;
  updateMonitoringStatus();

  monitorTimer = window.setTimeout(async () => {
    await checkAllEndpoints();
    scheduleNextCheck();
  }, interval);
}

function startMonitoring() {
  if (monitorTimer) return;
  checkAllEndpoints();
  scheduleNextCheck();
  countdownTimer = window.setInterval(updateMonitoringStatus, 1000);
  showToast("Auto monitoring started.", "success");
}

function stopMonitoring() {
  const wasRunning = Boolean(monitorTimer);
  window.clearTimeout(monitorTimer);
  window.clearInterval(countdownTimer);
  monitorTimer = null;
  countdownTimer = null;
  nextCheckAt = null;
  updateMonitoringStatus();

  if (wasRunning) {
    showToast("Auto monitoring paused.", "info");
  }
}

function setActiveTab(tabName) {
  elements.tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
  elements.panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${tabName}Panel`);
  });
}

function resetForm() {
  elements.form.reset();
  elements.editingId.value = "";
  elements.formTitle.textContent = "Add endpoint";
  elements.saveEndpointButton.textContent = "Add endpoint";
  elements.cancelEdit.style.display = "none";
  elements.timeout.value = "5000";
  elements.method.value = "GET";
  elements.group.value = "Production";
  elements.expectedStatus.value = DEFAULT_EXPECTED_STATUS;
  elements.slowThreshold.value = DEFAULT_SLOW_THRESHOLD_MS;
  elements.formError.textContent = "";
}

function editEndpoint(id) {
  const endpoint = endpoints.find((item) => item.id === id);
  if (!endpoint) return;

  setActiveTab("overview");
  elements.editingId.value = endpoint.id;
  elements.name.value = endpoint.name;
  elements.url.value = endpoint.url;
  elements.method.value = endpoint.method;
  elements.group.value = endpoint.group;
  elements.timeout.value = String(endpoint.timeout);
  elements.expectedStatus.value = endpoint.expectedStatus;
  elements.slowThreshold.value = endpoint.slowThreshold;
  elements.headers.value = endpoint.headersText;
  elements.body.value = endpoint.bodyText;
  elements.validationText.value = endpoint.validationText;
  elements.formTitle.textContent = "Edit endpoint";
  elements.saveEndpointButton.textContent = "Save changes";
  elements.cancelEdit.style.display = "block";
  elements.formError.textContent = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showDetails(id) {
  const endpoint = endpoints.find((item) => item.id === id);
  if (!endpoint) return;

  const latest = getLatest(endpoint);
  const endpointIncidents = incidents.filter((incident) => incident.endpointId === endpoint.id);
  elements.detailTitle.textContent = endpoint.name;
  elements.detailContent.innerHTML = `
    <article>
      <span>Configuration</span>
      <strong>${endpoint.method} ${endpoint.url}</strong>
      <p>${endpoint.group} · Expected ${endpoint.expectedStatus} · Slow after ${endpoint.slowThreshold} ms</p>
    </article>
    <article>
      <span>Validation</span>
      <strong>${endpoint.validationText || "No body validation"}</strong>
      <p>${endpoint.headersText ? "Custom headers configured" : "No custom headers"}</p>
    </article>
    <article>
      <span>Latest result</span>
      <strong>${statusLabel(getStatus(endpoint))}</strong>
      <p>${latest?.message || "No checks yet"}</p>
    </article>
    <article>
      <span>Incidents</span>
      <strong>${endpointIncidents.length}</strong>
      <p>${endpointIncidents.filter((incident) => incident.status === "open").length} currently open</p>
    </article>
    <article class="wide-detail">
      <span>Recent checks</span>
      <div class="history-list">
        ${
          endpoint.history
            .slice()
            .reverse()
            .slice(0, 8)
            .map(
              (item) =>
                `<p><strong>${item.ok ? "OK" : "FAIL"}</strong> ${formatDateTime(item.checkedAt)} · ${formatLatency(item.latency)} · ${item.message}</p>`
            )
            .join("") || "<p>No checks recorded yet.</p>"
        }
      </div>
    </article>
  `;
  elements.detailModal.showModal();
}

function removeEndpoint(id) {
  state.endpoints = endpoints.filter((endpoint) => endpoint.id !== id);
  state.incidents = incidents.filter((incident) => incident.endpointId !== id);
  syncStateRefs();
  saveState();
  renderAll();
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const rows = [
    [
      "name",
      "group",
      "method",
      "url",
      "status",
      "latency_ms",
      "uptime_percent",
      "last_code",
      "expected_code",
      "slow_threshold_ms",
      "checked_at",
      "message"
    ]
  ];

  endpoints.forEach((endpoint) => {
    const latest = getLatest(endpoint);
    rows.push([
      endpoint.name,
      endpoint.group,
      endpoint.method,
      endpoint.url,
      statusLabel(getStatus(endpoint)),
      latest ? Math.round(latest.latency) : "",
      endpointUptime(endpoint) ?? "",
      latest?.status ?? "",
      endpoint.expectedStatus,
      endpoint.slowThreshold,
      latest?.checkedAt ?? "",
      latest?.message ?? "No checks yet"
    ]);
  });

  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  downloadText(`pingvista-report-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
}

function exportJson() {
  downloadText(
    `pingvista-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(state, null, 2),
    "application/json;charset=utf-8"
  );
}

function importJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(reader.result);
      state = {
        endpoints: Array.isArray(parsed.endpoints)
          ? parsed.endpoints.map(normalizeEndpoint)
          : [],
        incidents: Array.isArray(parsed.incidents)
          ? parsed.incidents.map(normalizeIncident)
          : [],
        settings: normalizeSettings(parsed.settings || state.settings)
      };
      syncStateRefs();
      stopMonitoring();
      saveState();
      resetForm();
      renderAll();
      showToast("JSON backup imported.", "success");
    } catch {
      showToast("That JSON file could not be imported.", "error");
    }
  });
  reader.readAsText(file);
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  elements.formError.textContent = "";

  try {
    const endpoint = buildEndpointFromForm();
    const index = endpoints.findIndex((item) => item.id === endpoint.id);

    if (index === -1) {
      state.endpoints.unshift(endpoint);
    } else {
      state.endpoints[index] = endpoint;
    }

    saveState();
    resetForm();
    renderAll();
    showToast(index === -1 ? "Endpoint added." : "Endpoint updated.", "success");
  } catch (error) {
    elements.formError.textContent = error.message;
    showToast(error.message, "error");
  }
});

elements.cancelEdit.addEventListener("click", resetForm);
elements.tabs.forEach((tab) => tab.addEventListener("click", () => setActiveTab(tab.dataset.tab)));
elements.search.addEventListener("input", renderEndpoints);
elements.statusFilter.addEventListener("change", renderEndpoints);
elements.groupFilter.addEventListener("change", renderEndpoints);
elements.checkAll.addEventListener("click", checkAllEndpoints);
elements.exportCsv.addEventListener("click", exportCsv);
elements.exportCsv.addEventListener("click", () => showToast("CSV report exported.", "success"));
elements.exportJson.addEventListener("click", () => {
  exportJson();
  showToast("JSON backup exported.", "success");
});
elements.importJson.addEventListener("change", (event) => importJson(event.target.files[0]));
elements.signIn.addEventListener("click", () => authRequest("signin"));
elements.signUp.addEventListener("click", () => authRequest("signup"));
elements.signOut.addEventListener("click", signOut);
elements.checkMode.addEventListener("change", async () => {
  state.settings.checkMode = elements.checkMode.value;
  saveState();

  if (state.settings.checkMode === "backend") {
    await syncStateToBackend();
  }

  renderAll();
});
elements.theme.addEventListener("change", () => {
  state.settings.theme = elements.theme.value;
  saveState();
});
elements.themeOptions.forEach((button) => {
  button.addEventListener("click", () => {
    state.settings.theme = button.dataset.themeOption;
    saveState();
    renderAll();
  });
});
elements.alertWebhookUrl.addEventListener("change", () => {
  state.settings.alertWebhookUrl = elements.alertWebhookUrl.value.trim();
  saveState();
});
elements.alertOnRecovery.addEventListener("change", () => {
  state.settings.alertOnRecovery = elements.alertOnRecovery.checked;
  saveState();
});
elements.syncBackend.addEventListener("click", async () => {
  if (state.settings.checkMode === "backend") {
    await loadStateFromBackend();
  } else {
    await syncStateToBackend();
  }

  renderAll();
});
elements.refreshHealth.addEventListener("click", checkBackendHealth);
elements.clearLocalData.addEventListener("click", () => {
  stopMonitoring();
  localStorage.removeItem(STORAGE_KEY);
  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
  state = { endpoints: [], incidents: [], settings: normalizeSettings() };
  syncStateRefs();
  resetForm();
  renderAll();
  elements.lastUpdated.textContent = "Local data cleared";
  showToast("Local data cleared.", "info");
});
elements.monitorInterval.addEventListener("change", () => {
  if (monitorTimer) scheduleNextCheck();
});

elements.monitorToggle.addEventListener("click", () => {
  if (monitorTimer) {
    stopMonitoring();
  } else {
    startMonitoring();
  }
});

document.addEventListener("click", (event) => {
  const action = event.target;
  const container = action.closest("[data-id]");
  if (!container) return;

  if (action.matches(".check-one")) checkEndpoint(container.dataset.id);
  if (action.matches(".detail-one")) showDetails(container.dataset.id);
  if (action.matches(".edit-one")) editEndpoint(container.dataset.id);
  if (action.matches(".remove-one")) removeEndpoint(container.dataset.id);
});

elements.reset.addEventListener("click", () => {
  stopMonitoring();
  state = createSeedState();
  syncStateRefs();
  saveState();
  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
  elements.search.value = "";
  elements.statusFilter.value = "all";
  elements.groupFilter.value = "all";
  elements.lastUpdated.textContent = "Demo data reset";
  resetForm();
  renderAll();
  showToast("Demo data restored.", "success");
});

elements.closeDetail.addEventListener("click", () => elements.detailModal.close());

resetForm();
applyTheme();
syncSettingsControls();
checkAuthConfig();
checkBackendHealth();
loadStateFromBackend().then((connected) => {
  if (!connected && state.settings.checkMode === "backend") {
    state.settings.checkMode = "browser";
    saveState();
  }

  renderAll();
  updateMonitoringStatus();
});
