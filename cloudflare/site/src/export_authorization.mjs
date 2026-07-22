import { createActivationService } from "./activation.mjs";
import { bytesToBase64Url, signToken, verifyToken } from "./activation_crypto.mjs";

const EXPORT_PERMIT_TTL_MS = 60 * 1000;
const MAX_REQUEST_BYTES = 4096;
const PREMIUM_FEATURE_IDS = new Set([
  "organizer.output",
  "cutout.edge-refinement",
  "cutout.alpha-control",
  "cutout.color-protection",
  "cutout.local-repair",
  "cutout.repair-propagation",
  "organizer.sequence-analysis",
  "organizer.loop-finder",
  "tuner.collision-boxes",
  "tuner.frame-audio",
  "tuner.image-attachments",
  "tuner.frame-playback",
]);

/** @param {Request} request Incoming request. @returns {void} */
function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  const fetchSite = String(request.headers.get("sec-fetch-site") || "");
  if ((origin && origin !== new URL(request.url).origin) || ["cross-site", "same-site"].includes(fetchSite)) {
    throw Object.assign(new Error("Cross-origin export authorization is not allowed."), { status: 403 });
  }
}

/** @param {Request} request Incoming request. @returns {Promise<object>} Bounded JSON object. */
async function readJsonObject(request) {
  if (
    !String(request.headers.get("content-type") || "")
      .toLowerCase()
      .startsWith("application/json")
  ) {
    throw Object.assign(new Error("Content-Type must be application/json."), { status: 415 });
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES) {
    throw Object.assign(new Error("Export authorization request is too large."), { status: 413 });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw Object.assign(new Error("Export authorization request is too large."), { status: 413 });
  }
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid object");
    return payload;
  } catch (_error) {
    throw Object.assign(new Error("Invalid export authorization JSON."), { status: 400 });
  }
}

/** @param {unknown} value Raw feature list. @returns {string[]} Validated feature IDs. */
function normalizeFeatureIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > PREMIUM_FEATURE_IDS.size) {
    throw Object.assign(new Error("At least one valid Pro feature is required."), { status: 400 });
  }
  const features = [...new Set(value.map(String))].sort();
  if (features.length !== value.length || features.some((featureId) => !PREMIUM_FEATURE_IDS.has(featureId))) {
    throw Object.assign(new Error("Export feature selection is invalid."), { status: 400 });
  }
  return features;
}

/** @param {object} payload Response payload. @param {number} [status] HTTP status. @returns {Response} */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Handles device-bound short-lived permits for the official Pro export path.
 * Animation pixels and tuning data never leave the browser.
 * @param {Request} request Incoming request.
 * @param {{LICENSE_DB?:D1Database,XSXB_ACTIVATION_SECRET?:string}} env Worker environment.
 * @param {{activationService?:object,cryptoApi?:Crypto,now?:()=>number}} [options] Test adapters.
 * @returns {Promise<Response>} Export authorization response.
 */
export async function handleExportAuthorizationRequest(request, env, options = {}) {
  const pathname = new URL(request.url).pathname;
  if (request.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);
  try {
    assertSameOrigin(request);
    const payload = await readJsonObject(request);
    const features = normalizeFeatureIds(payload.features);
    const cryptoApi = options.cryptoApi || globalThis.crypto;
    const now = options.now || Date.now;
    const secret = String(env?.XSXB_ACTIVATION_SECRET || "");
    const activation = options.activationService || createActivationService(env, { cryptoApi, now });
    const session = await activation.status(request);
    if (!session.activated || !session.deviceId) {
      throw Object.assign(new Error("An active device license is required for this Pro export."), {
        status: 401,
      });
    }
    if (pathname === "/api/export/authorize") {
      const expiresAt = now() + EXPORT_PERMIT_TTL_MS;
      const nonce = bytesToBase64Url(cryptoApi.getRandomValues(new Uint8Array(18)));
      const permit = await signToken(
        {
          type: "export-permit",
          deviceId: session.deviceId,
          features,
          nonce,
          exp: expiresAt,
        },
        secret,
        cryptoApi.subtle,
      );
      return jsonResponse({ authorized: true, permit, expiresAt: new Date(expiresAt).toISOString() });
    }
    if (pathname === "/api/export/verify") {
      const permit = await verifyToken(String(payload.permit || ""), secret, cryptoApi.subtle);
      if (
        !permit ||
        permit.type !== "export-permit" ||
        permit.deviceId !== session.deviceId ||
        Number(permit.exp || 0) <= now() ||
        JSON.stringify(permit.features) !== JSON.stringify(features)
      ) {
        throw Object.assign(new Error("Export permit is invalid or expired."), { status: 401 });
      }
      return jsonResponse({ authorized: true, expiresAt: new Date(Number(permit.exp)).toISOString() });
    }
    return jsonResponse({ error: "Not Found" }, 404);
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) {
      console.error(
        JSON.stringify({
          event: "export_authorization_failed",
          pathname,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return jsonResponse(
      { error: status >= 500 ? "Export authorization unavailable." : error.message },
      status,
    );
  }
}
