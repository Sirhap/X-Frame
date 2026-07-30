export const TEST_ORIGIN = "https://app.example.test";
export const TEST_VERSION = "release-2026.07.21";
export const TEST_SIGNING_KEY = "test-only-signing-key-with-at-least-32-characters";

/**
 * Creates a deterministic KV-like state binding.
 * @param {Record<string, string>} records Initial string records.
 * @returns {{ get(key: string): Promise<string | null> }} Mock binding.
 */
export function createStateStore(records = {}) {
  const values = new Map(Object.entries(records));
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
  };
}

/**
 * Creates a native Rate Limiting binding stub.
 * @param {boolean} success Whether requests are allowed.
 * @returns {{ keys: string[], limit(options: { key: string }): Promise<{ success: boolean }> }} Stub.
 */
export function createRateLimiter(success = true) {
  const keys = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      return { success };
    },
  };
}

/**
 * Creates an authorization request with browser security headers.
 * @param {Record<string, unknown>} body JSON request body.
 * @param {string} origin Browser Origin.
 * @returns {Request} Request fixture.
 */
export function createAuthorizationRequest(body, origin = TEST_ORIGIN) {
  return new Request("https://authorization.example.test/v1/session", {
    method: "POST",
    headers: {
      "CF-Connecting-IP": "192.0.2.10",
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Creates the baseline Authorization Worker environment.
 * @returns {Record<string, unknown>} Environment fixture.
 */
export function createAuthorizationEnv() {
  return {
    ACTIVE_VERSIONS: TEST_VERSION,
    ALLOWED_ORIGINS: JSON.stringify([TEST_ORIGIN]),
    ARTIFACT_BASE_URL: "https://artifact.example.test",
    AUTH_RATE_LIMITER: createRateLimiter(),
    GATE_STATE: createStateStore(),
    REQUIRE_ENTITLEMENT: "false",
    REVOKED_VERSIONS: "",
    SESSION_SIGNING_KEY: TEST_SIGNING_KEY,
    SESSION_TTL_SECONDS: "300",
    TURNSTILE_ACTION: "algorithm-artifact-session",
    TURNSTILE_SECRET: "bound-test-secret",
  };
}
