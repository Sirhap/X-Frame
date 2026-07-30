const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

/**
 * Parses the exact origins allowed to call the gate.
 * @param {string | undefined} configuredOrigins JSON array or comma-separated origins.
 * @returns {ReadonlySet<string>} Normalized URL origins.
 */
export function parseAllowedOrigins(configuredOrigins) {
  if (!configuredOrigins) return new Set();
  let values;
  try {
    const parsed = JSON.parse(configuredOrigins);
    values = Array.isArray(parsed) ? parsed : configuredOrigins.split(",");
  } catch (_error) {
    values = configuredOrigins.split(",");
  }
  const origins = values.map((value) => new URL(String(value).trim()).origin);
  return new Set(origins);
}

/**
 * Resolves a request Origin only when it is exactly allowlisted.
 * @param {Request} request Incoming request.
 * @param {string | undefined} configuredOrigins Origin configuration.
 * @returns {string | null} Allowed origin, or null.
 */
export function resolveAllowedOrigin(request, configuredOrigins) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  try {
    const normalized = new URL(origin).origin;
    return parseAllowedOrigins(configuredOrigins).has(normalized) ? normalized : null;
  } catch (_error) {
    return null;
  }
}

/**
 * Builds immutable security and strict CORS headers.
 * @param {string | null} allowedOrigin Validated origin.
 * @param {Record<string, string>} extraHeaders Additional response headers.
 * @returns {Headers} Response headers.
 */
export function createResponseHeaders(allowedOrigin, extraHeaders = {}) {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Vary", "Origin");
  if (allowedOrigin) headers.set("Access-Control-Allow-Origin", allowedOrigin);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return headers;
}

/**
 * Creates a structured JSON response without leaking internal details.
 * @param {unknown} body JSON-compatible response body.
 * @param {number} status HTTP status.
 * @param {string | null} allowedOrigin Validated origin.
 * @returns {Response} JSON response.
 */
export function jsonResponse(body, status, allowedOrigin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: createResponseHeaders(allowedOrigin, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

/**
 * Handles a strict CORS preflight.
 * @param {Request} request Incoming preflight request.
 * @param {string | undefined} configuredOrigins Origin configuration.
 * @param {string} allowedMethods Comma-separated methods.
 * @returns {Response} Preflight response.
 */
export function corsPreflight(request, configuredOrigins, allowedMethods) {
  const allowedOrigin = resolveAllowedOrigin(request, configuredOrigins);
  if (!allowedOrigin) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, null);

  const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") || "")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const supportedHeaders = new Set(["authorization", "content-type"]);
  if (requestedHeaders.some((header) => !supportedHeaders.has(header))) {
    return jsonResponse({ error: "CORS_HEADERS_NOT_ALLOWED" }, 403, allowedOrigin);
  }

  return new Response(null, {
    status: 204,
    headers: createResponseHeaders(allowedOrigin, {
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": allowedMethods,
      "Access-Control-Max-Age": "600",
    }),
  });
}

/**
 * Reads and parses a bounded JSON request body.
 * @param {Request} request Incoming request.
 * @param {number} maximumBytes Maximum UTF-8 body size.
 * @returns {Promise<unknown>} Parsed JSON value.
 */
export async function readBoundedJson(request, maximumBytes = 4096) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > maximumBytes) throw new RangeError("Request body is too large.");
  if (!request.body) throw new TypeError("Request body is required.");

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel("Request body is too large.");
        throw new RangeError("Request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}
