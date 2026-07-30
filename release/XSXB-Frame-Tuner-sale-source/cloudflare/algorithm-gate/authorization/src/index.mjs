import { corsPreflight, jsonResponse, readBoundedJson, resolveAllowedOrigin } from "../../shared/http.mjs";
import { isActiveVersion, isEntitled, isVersionRevoked, passesRateLimit } from "../../shared/policy.mjs";
import { signSession } from "../../shared/session.mjs";

const SESSION_PATH = "/v1/session";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_REQUEST_BYTES = 4096;

/**
 * Validates the session request without accepting unknown object shapes.
 * @param {unknown} value Parsed request body.
 * @returns {{ challengeToken: string, entitlementCredential?: string, version: string } | null} Body.
 */
function validateSessionRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !["challengeToken", "entitlementCredential", "version"].includes(key))) {
    return null;
  }
  if (
    typeof value.challengeToken !== "string" ||
    value.challengeToken.length < 1 ||
    value.challengeToken.length > 4096 ||
    typeof value.version !== "string" ||
    (value.entitlementCredential !== undefined &&
      (typeof value.entitlementCredential !== "string" || value.entitlementCredential.length > 512))
  ) {
    return null;
  }
  return value;
}

/**
 * Parses a bounded Siteverify response.
 * @param {Response} response Cloudflare Siteverify response.
 * @returns {Promise<Record<string, unknown> | null>} Parsed validation result.
 */
async function parseSiteverifyResponse(response) {
  if (!response.ok) return null;
  try {
    const value = await readBoundedJson(response, 8192);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (_error) {
    return null;
  }
}

/**
 * Validates a single-use Turnstile token exclusively from the server.
 * @param {string} challengeToken Browser challenge token.
 * @param {Request} request Incoming authorization request.
 * @param {Record<string, unknown>} env Worker bindings and configuration.
 * @param {string} allowedOrigin Validated browser origin.
 * @returns {Promise<"valid" | "invalid" | "unavailable">} Validation status.
 */
async function verifyTurnstile(challengeToken, request, env, allowedOrigin) {
  if (typeof env.TURNSTILE_SECRET !== "string" || !env.TURNSTILE_SECRET) return "unavailable";
  const idempotencyKey = crypto.randomUUID();
  const payload = {
    idempotency_key: idempotencyKey,
    remoteip: request.headers.get("CF-Connecting-IP") || undefined,
    response: challengeToken,
    secret: env.TURNSTILE_SECRET,
  };

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await parseSiteverifyResponse(response);
    if (!result) return "unavailable";
    if (result.success !== true) {
      const errorCodes = Array.isArray(result["error-codes"]) ? result["error-codes"] : [];
      return errorCodes.includes("internal-error") ? "unavailable" : "invalid";
    }

    const expectedHostname = new URL(allowedOrigin).hostname;
    return result.hostname === expectedHostname && result.action === env.TURNSTILE_ACTION
      ? "valid"
      : "invalid";
  } catch (_error) {
    return "unavailable";
  }
}

/**
 * Normalizes the configurable short session lifetime.
 * @param {unknown} configuredValue Configured TTL in seconds.
 * @returns {number} TTL clamped to one through fifteen minutes.
 */
function resolveSessionTtl(configuredValue) {
  const parsed = Number(configuredValue);
  if (!Number.isFinite(parsed)) return 300;
  return Math.min(900, Math.max(60, Math.floor(parsed)));
}

/**
 * Creates a privacy-minimized rate-limit key without application logging.
 * @param {Request} request Incoming request.
 * @param {string} allowedOrigin Validated origin.
 * @returns {string} Native Rate Limiting binding key.
 */
function createRateLimitKey(request, allowedOrigin) {
  return request.headers.get("CF-Connecting-IP") || `origin:${allowedOrigin}`;
}

/**
 * Handles session issuance after all origin, rate, challenge, version, and entitlement checks.
 * @param {Request} request Incoming request.
 * @param {Record<string, unknown>} env Worker bindings and configuration.
 * @param {string} allowedOrigin Validated origin.
 * @returns {Promise<Response>} Authorization response.
 */
async function issueSession(request, env, allowedOrigin) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415, allowedOrigin);
  }

  let body;
  try {
    body = validateSessionRequest(await readBoundedJson(request, MAX_REQUEST_BYTES));
  } catch (_error) {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400, allowedOrigin);
  }
  if (!body) return jsonResponse({ error: "INVALID_REQUEST" }, 400, allowedOrigin);

  try {
    if (
      !env.GATE_STATE ||
      !env.AUTH_RATE_LIMITER ||
      typeof env.SESSION_SIGNING_KEY !== "string" ||
      typeof env.TURNSTILE_SECRET !== "string"
    ) {
      return jsonResponse({ error: "AUTHORIZATION_UNAVAILABLE" }, 503, allowedOrigin);
    }
    const rateAllowed = await passesRateLimit(
      env.AUTH_RATE_LIMITER,
      createRateLimitKey(request, allowedOrigin),
    );
    if (!rateAllowed) return jsonResponse({ error: "RATE_LIMITED" }, 429, allowedOrigin);

    if (!isActiveVersion(body.version, env.ACTIVE_VERSIONS)) {
      return jsonResponse({ error: "VERSION_UNAVAILABLE" }, 404, allowedOrigin);
    }
    if (await isVersionRevoked(body.version, env.GATE_STATE, env.REVOKED_VERSIONS)) {
      return jsonResponse({ error: "VERSION_REVOKED" }, 403, allowedOrigin);
    }

    const challengeStatus = await verifyTurnstile(body.challengeToken, request, env, allowedOrigin);
    if (challengeStatus === "unavailable") {
      return jsonResponse({ error: "AUTHORIZATION_UNAVAILABLE" }, 503, allowedOrigin);
    }
    if (challengeStatus !== "valid") {
      return jsonResponse({ error: "CHALLENGE_FAILED" }, 403, allowedOrigin);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const entitlementRequired = env.REQUIRE_ENTITLEMENT === "true";
    const entitled = await isEntitled(
      body.entitlementCredential,
      body.version,
      env.GATE_STATE,
      entitlementRequired,
      nowSeconds,
    );
    if (!entitled) return jsonResponse({ error: "NOT_AUTHORIZED" }, 403, allowedOrigin);

    const expiresAt = nowSeconds + resolveSessionTtl(env.SESSION_TTL_SECONDS);
    const token = await signSession(
      {
        aud: "algorithm-artifact",
        exp: expiresAt,
        iat: nowSeconds,
        jti: crypto.randomUUID(),
        origin: allowedOrigin,
        version: body.version,
      },
      env.SESSION_SIGNING_KEY,
    );
    const artifactBaseUrl = new URL(String(env.ARTIFACT_BASE_URL)).origin;
    if (new URL(artifactBaseUrl).protocol !== "https:") {
      return jsonResponse({ error: "AUTHORIZATION_UNAVAILABLE" }, 503, allowedOrigin);
    }
    return jsonResponse(
      {
        artifactUrl: `${artifactBaseUrl}/v1/artifacts/${body.version}/algorithm.wasm`,
        expiresAt,
        token,
      },
      201,
      allowedOrigin,
    );
  } catch (_error) {
    return jsonResponse({ error: "AUTHORIZATION_UNAVAILABLE" }, 503, allowedOrigin);
  }
}

/** @type {{ fetch(request: Request, env: Record<string, unknown>): Promise<Response> }} */
const worker = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname !== SESSION_PATH) return jsonResponse({ error: "NOT_FOUND" }, 404, null);
      if (request.method === "OPTIONS") {
        return corsPreflight(request, env.ALLOWED_ORIGINS, "POST, OPTIONS");
      }

      const allowedOrigin = resolveAllowedOrigin(request, env.ALLOWED_ORIGINS);
      if (!allowedOrigin) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, null);
      if (request.method !== "POST") {
        return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, allowedOrigin);
      }
      return await issueSession(request, env, allowedOrigin);
    } catch (_error) {
      return jsonResponse({ error: "AUTHORIZATION_UNAVAILABLE" }, 503, null);
    }
  },
};

export default worker;
export { issueSession, verifyTurnstile };
