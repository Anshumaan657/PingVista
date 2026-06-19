const assert = require("node:assert");

function createLimiter({ limit, windowMs }) {
  const buckets = new Map();

  return function enforce(key, now = Date.now()) {
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, {
        count: 1,
        resetAt: now + windowMs
      });
      return true;
    }

    bucket.count += 1;

    if (bucket.count > limit) {
      const error = new Error("Too many requests. Try again soon.");
      error.statusCode = 429;
      throw error;
    }

    return true;
  };
}

function validateEndpointCount(endpoints, maxEndpoints) {
  if (Array.isArray(endpoints) && endpoints.length > maxEndpoints) {
    throw new Error(`Workspace can contain at most ${maxEndpoints} endpoints.`);
  }
}

const enforce = createLimiter({ limit: 3, windowMs: 60_000 });

assert.doesNotThrow(() => enforce("check:127.0.0.1", 1000));
assert.doesNotThrow(() => enforce("check:127.0.0.1", 1001));
assert.doesNotThrow(() => enforce("check:127.0.0.1", 1002));
assert.throws(() => enforce("check:127.0.0.1", 1003), { statusCode: 429 });
assert.doesNotThrow(() => enforce("check:127.0.0.1", 61_001));

assert.doesNotThrow(() => validateEndpointCount(Array.from({ length: 50 }), 50));
assert.throws(
  () => validateEndpointCount(Array.from({ length: 51 }), 50),
  /at most 50 endpoints/
);

console.log("Rate limit checks passed");
