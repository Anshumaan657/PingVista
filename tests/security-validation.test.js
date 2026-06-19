const assert = require("node:assert");

const blockedHosts = [
  "http://localhost:4175",
  "http://127.0.0.1:4175",
  "http://0.0.0.0",
  "http://10.0.0.1",
  "http://172.16.0.1",
  "http://192.168.1.1",
  "http://169.254.169.254",
  "file:///etc/passwd",
  "ftp://example.com"
];

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

  return (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal" ||
    normalized === "100.100.100.200" ||
    normalized === "169.254.169.254" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    isPrivateIPv4(normalized)
  );
}

function validatePublicUrl(value) {
  const parsed = new URL(String(value || "").trim());

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("blocked protocol");
  }

  if (parsed.username || parsed.password) {
    throw new Error("blocked credentials");
  }

  if (isUnsafeHostname(parsed.hostname)) {
    throw new Error("blocked host");
  }
}

for (const url of blockedHosts) {
  assert.throws(() => validatePublicUrl(url), undefined, `${url} should be blocked`);
}

assert.doesNotThrow(() => validatePublicUrl("https://api.github.com"));
assert.doesNotThrow(() => validatePublicUrl("https://jsonplaceholder.typicode.com/posts"));

console.log("Security validation checks passed");
