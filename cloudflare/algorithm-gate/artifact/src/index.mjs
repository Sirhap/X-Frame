import {
  corsPreflight,
  createResponseHeaders,
  jsonResponse,
  resolveAllowedOrigin,
} from "../../shared/http.mjs";
import {
  isActiveVersion,
  isSessionRevoked,
  isVersionRevoked,
  passesRateLimit,
} from "../../shared/policy.mjs";
import { readBearerToken, verifySession } from "../../shared/session.mjs";

const ARTIFACT_PATH = /^\/v1\/artifacts\/([a-z0-9][a-z0-9._-]{0,63})\/algorithm\.wasm$/u;

/**
 * Resolves a private R2 key from a prevalidated version.
 * @param {string} version Artifact version.
 * @param {string | undefined} configuredPrefix Private object prefix.
 * @returns {string} Private R2 object key.
 */
function createObjectKey(version, configuredPrefix) {
  const prefix = String(configuredPrefix || "protected-releases").replace(/^\/+|\/+$/gu, "");
  if (!/^[a-zA-Z0-9._/-]+$/u.test(prefix) || prefix.includes("..")) {
    throw new TypeError("Invalid private artifact prefix.");
  }
  return `${prefix}/${version}/algorithm-core.wasm`;
}

/**
 * Returns a private R2 object as an unbuffered response body.
 * @param {Request} request Incoming request.
 * @param {Record<string, unknown>} env Worker bindings and configuration.
 * @param {string} allowedOrigin Validated browser origin.
 * @param {string} version Validated artifact version.
 * @returns {Promise<Response>} Streaming artifact response.
 */
async function serveArtifact(request, env, allowedOrigin, version) {
  try {
    if (
      !env.GATE_STATE ||
      !env.ARTIFACT_RATE_LIMITER ||
      !env.ALGORITHM_ARTIFACTS ||
      typeof env.SESSION_SIGNING_KEY !== "string"
    ) {
      return jsonResponse({ error: "ARTIFACT_SERVICE_UNAVAILABLE" }, 503, allowedOrigin);
    }
    const rateKey = request.headers.get("CF-Connecting-IP") || `origin:${allowedOrigin}`;
    if (!(await passesRateLimit(env.ARTIFACT_RATE_LIMITER, rateKey))) {
      return jsonResponse({ error: "RATE_LIMITED" }, 429, allowedOrigin);
    }

    const token = readBearerToken(request);
    if (!token) return jsonResponse({ error: "SESSION_REQUIRED" }, 401, allowedOrigin);
    const claims = await verifySession(token, env.SESSION_SIGNING_KEY, {
      audience: "algorithm-artifact",
    });
    if (!claims || claims.origin !== allowedOrigin || claims.version !== version) {
      return jsonResponse({ error: "SESSION_INVALID" }, 401, allowedOrigin);
    }
    if (!isActiveVersion(version, env.ACTIVE_VERSIONS)) {
      return jsonResponse({ error: "VERSION_UNAVAILABLE" }, 404, allowedOrigin);
    }
    if (
      (await isVersionRevoked(version, env.GATE_STATE, env.REVOKED_VERSIONS)) ||
      (await isSessionRevoked(claims.jti, env.GATE_STATE))
    ) {
      return jsonResponse({ error: "ACCESS_REVOKED" }, 403, allowedOrigin);
    }

    const object = await env.ALGORITHM_ARTIFACTS.get(createObjectKey(version, env.R2_OBJECT_PREFIX));
    if (!object) return jsonResponse({ error: "ARTIFACT_UNAVAILABLE" }, 404, allowedOrigin);

    const headers = createResponseHeaders(allowedOrigin, {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Length": String(object.size),
      "Content-Type": "application/wasm",
      ETag: object.httpEtag,
      Vary: "Origin, Authorization",
    });
    return new Response(object.body, { status: 200, headers });
  } catch (_error) {
    return jsonResponse({ error: "ARTIFACT_SERVICE_UNAVAILABLE" }, 503, allowedOrigin);
  }
}

/** @type {{ fetch(request: Request, env: Record<string, unknown>): Promise<Response> }} */
const worker = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const match = ARTIFACT_PATH.exec(url.pathname);
      if (!match) return jsonResponse({ error: "NOT_FOUND" }, 404, null);
      if (request.method === "OPTIONS") {
        return corsPreflight(request, env.ALLOWED_ORIGINS, "GET, OPTIONS");
      }

      const allowedOrigin = resolveAllowedOrigin(request, env.ALLOWED_ORIGINS);
      if (!allowedOrigin) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, null);
      if (request.method !== "GET") {
        return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, allowedOrigin);
      }
      return await serveArtifact(request, env, allowedOrigin, match[1]);
    } catch (_error) {
      return jsonResponse({ error: "ARTIFACT_SERVICE_UNAVAILABLE" }, 503, null);
    }
  },
};

export default worker;
export { createObjectKey, serveArtifact };
