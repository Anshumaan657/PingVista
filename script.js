const STORAGE_KEY = "api-pulse-monitor-v1";
const HISTORY_LIMIT = 10;
const SLOW_THRESHOLD_MS = 900;

const seedEndpoints = [
  {
    id: crypto.randomUUID(),
    name: "GitHub API",
    url: "https://api.github.com",
    timeout: 5000,
    history: []
  },
  {
    id: crypto.randomUUID(),
    name: "JSONPlaceholder",
    url: "https://jsonplaceholder.typicode.com/posts",
    timeout: 5000,
    history: []
  }
];

const elements = {
  form: document.querySelector("#endpointForm"),
  name: document.querySelector("#endpointName"),
  url: document.querySelector("#endpointUrl"),
  timeout: document.querySelector("#endpointTimeout"),
  grid: document.querySelector("#endpointGrid"),
  template: document.querySelector("#endpointTemplate"),
  checkAll: document.querySelector("#checkAllButton"),
  reset: document.querySelector("#resetButton"),
  lastUpdated: document.querySelector("#lastUpdated"),
  metricTotal: document.querySelector("#metricTotal"),
  metricHealthy: document.querySelector("#metricHealthy"),
  metricLatency: document.querySelector("#metricLatency"),
  metricUptime: document.querySelector("#metricUptime")
};

let endpoints = loadEndpoints();

function loadEndpoints() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return seedEndpoints;
  }

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : seedEndpoints;
  } catch {
    return seedEndpoints;
  }
}

function saveEndpoints() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints));
}

function formatLatency(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : "--";
}

function getLatest(endpoint) {
  return endpoint.history.at(-1);
}

function getStatus(result) {
  if (!result) return "unknown";
  if (!result.ok) return "down";
  if (result.latency > SLOW_THRESHOLD_MS) return "slow";
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

  const total = successful.reduce((sum, item) => sum + item.latency, 0);
  return Math.round(total / successful.length);
}

function renderMetrics() {
  const latestResults = endpoints.map(getLatest).filter(Boolean);
  const healthy = latestResults.filter((item) => getStatus(item) === "healthy").length;
  const checks = endpoints.flatMap((endpoint) => endpoint.history);
  const successfulChecks = checks.filter((item) => item.ok).length;
  const uptime = checks.length ? Math.round((successfulChecks / checks.length) * 100) : null;
  const latency = averageLatency(checks);

  elements.metricTotal.textContent = endpoints.length;
  elements.metricHealthy.textContent = healthy;
  elements.metricLatency.textContent = latency ? `${latency} ms` : "--";
  elements.metricUptime.textContent = uptime === null ? "--" : `${uptime}%`;
}

function renderChart(container, history) {
  container.textContent = "";
  const recent = history.slice(-HISTORY_LIMIT);
  const maxLatency = Math.max(300, ...recent.map((item) => item.latency || 0));
  const padded = Array.from({ length: HISTORY_LIMIT - recent.length }, () => null).concat(recent);

  padded.forEach((item) => {
    const bar = document.createElement("span");
    bar.className = "bar";

    if (!item) {
      bar.style.height = "4px";
      bar.style.opacity = "0.2";
    } else {
      bar.style.height = `${Math.max(8, (item.latency / maxLatency) * 100)}%`;
      bar.title = item.ok ? formatLatency(item.latency) : item.message;

      if (!item.ok) {
        bar.classList.add("down");
      }
    }

    container.append(bar);
  });
}

function renderEndpoints() {
  elements.grid.textContent = "";

  if (!endpoints.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Add an API endpoint to start monitoring.";
    elements.grid.append(empty);
    renderMetrics();
    return;
  }

  endpoints.forEach((endpoint) => {
    const latest = getLatest(endpoint);
    const status = getStatus(latest);
    const uptime = endpointUptime(endpoint);
    const node = elements.template.content.firstElementChild.cloneNode(true);

    node.dataset.id = endpoint.id;
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
    node.querySelector(".uptime-value").textContent =
      uptime === null ? "--" : `${uptime}%`;
    node.querySelector(".code-value").textContent = latest?.status || "--";
    node.querySelector(".message").textContent =
      latest?.message || "Ready for the first check.";

    renderChart(node.querySelector(".chart"), endpoint.history);
    elements.grid.append(node);
  });

  renderMetrics();
}

async function pingEndpoint(endpoint) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), endpoint.timeout);
  const startedAt = performance.now();

  try {
    const response = await fetch(endpoint.url, {
      cache: "no-store",
      mode: "cors",
      signal: controller.signal
    });
    const latency = performance.now() - startedAt;

    return {
      checkedAt: new Date().toISOString(),
      ok: response.ok,
      latency,
      status: response.status,
      message: response.ok
        ? `Responded in ${Math.round(latency)} ms.`
        : `Returned HTTP ${response.status}.`
    };
  } catch (error) {
    const latency = performance.now() - startedAt;
    const message =
      error.name === "AbortError"
        ? `Timed out after ${endpoint.timeout / 1000} seconds.`
        : "Request failed or was blocked by CORS.";

    return {
      checkedAt: new Date().toISOString(),
      ok: false,
      latency,
      status: "ERR",
      message
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function checkEndpoint(id) {
  const endpoint = endpoints.find((item) => item.id === id);
  if (!endpoint) return;

  const card = document.querySelector(`[data-id="${id}"]`);
  card?.classList.add("is-checking");

  const result = await pingEndpoint(endpoint);
  endpoint.history = endpoint.history.concat(result).slice(-HISTORY_LIMIT);
  elements.lastUpdated.textContent = `Last checked ${new Date().toLocaleTimeString()}`;

  saveEndpoints();
  renderEndpoints();
}

async function checkAllEndpoints() {
  elements.checkAll.classList.add("is-checking");
  await Promise.all(endpoints.map((endpoint) => checkEndpoint(endpoint.id)));
  elements.checkAll.classList.remove("is-checking");
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();

  endpoints.unshift({
    id: crypto.randomUUID(),
    name: elements.name.value.trim(),
    url: elements.url.value.trim(),
    timeout: Number(elements.timeout.value),
    history: []
  });

  elements.form.reset();
  elements.timeout.value = "5000";
  saveEndpoints();
  renderEndpoints();
});

elements.grid.addEventListener("click", (event) => {
  const card = event.target.closest(".endpoint-card");
  if (!card) return;

  if (event.target.matches(".check-one")) {
    checkEndpoint(card.dataset.id);
  }

  if (event.target.matches(".remove-one")) {
    endpoints = endpoints.filter((endpoint) => endpoint.id !== card.dataset.id);
    saveEndpoints();
    renderEndpoints();
  }
});

elements.checkAll.addEventListener("click", checkAllEndpoints);

elements.reset.addEventListener("click", () => {
  endpoints = seedEndpoints.map((endpoint) => ({ ...endpoint, history: [] }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints));
  elements.lastUpdated.textContent = "Demo data reset";
  renderEndpoints();
});

renderEndpoints();
