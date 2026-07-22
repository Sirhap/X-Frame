import {
  bytesToBase64Url,
  canonicalPublicKey,
  hmacHex,
  sha256Hex,
  signToken,
  verifyDeviceSignature,
  verifyToken,
} from "./activation_crypto.mjs";
import { createLicenseRepository } from "./license_repository.mjs";

const COOKIE_NAME = "xsxb_activation";
const COOKIE_TTL_SECONDS = 24 * 60 * 60;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_REQUEST_BYTES = 8192;

/** @param {string} code Activation code. @param {SubtleCrypto} subtle Web Crypto. @returns {Promise<string>} Normalized code hash. */
export async function hashActivationCode(code, subtle) {
  return sha256Hex(
    String(code || "")
      .trim()
      .toUpperCase(),
    subtle,
  );
}

/** @param {Request} request Incoming request. @returns {string} Activation cookie token. */
function readCookieToken(request) {
  for (const entry of String(request.headers.get("cookie") || "").split(";")) {
    const [name, ...parts] = entry.trim().split("=");
    if (name !== COOKIE_NAME) continue;
    try {
      return decodeURIComponent(parts.join("="));
    } catch (_error) {
      return "";
    }
  }
  return "";
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
    throw Object.assign(new Error("Activation request is too large."), { status: 413 });
  }
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel("request too large");
        throw Object.assign(new Error("Activation request is too large."), { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid object");
    return payload;
  } catch (_error) {
    throw Object.assign(new Error("Invalid activation request JSON."), { status: 400 });
  }
}

/** @param {Request} request Incoming request. @returns {void} */
function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw Object.assign(new Error("Cross-origin activation is not allowed."), { status: 403 });
  }
}

/** @param {object} authorization Joined license/device row. @param {number} now Current epoch. @returns {number} License expiry epoch. */
function assertAuthorizationActive(authorization, now) {
  if (!authorization || authorization.license_revoked_at || authorization.device_revoked_at) {
    throw Object.assign(new Error("License or device has been revoked."), { status: 403 });
  }
  const expiresAt = Date.parse(authorization.expires_at || "");
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw Object.assign(new Error("Trial period has expired."), { status: 402 });
  }
  return expiresAt;
}

/** @param {Request} request Incoming request. @param {string} secret Risk hashing secret. @param {SubtleCrypto} subtle Web Crypto. @returns {Promise<{ipHash:string,country:string}>} Risk signals. */
async function requestRiskSignals(request, secret, subtle) {
  const ip = String(request.headers.get("cf-connecting-ip") || "").trim();
  const country = String(request.cf?.country || request.headers.get("cf-ipcountry") || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
  return { ipHash: ip ? await hmacHex(`ip:${ip}`, secret, subtle) : "", country };
}

/**
 * Creates the D1-backed device activation service.
 * @param {{LICENSE_DB?:D1Database,XSXB_ACTIVATION_SECRET?:string}} env Worker environment.
 * @param {{cryptoApi?:Crypto,now?:()=>number,repository?:object}} [options] Test adapters.
 * @returns {object} Activation operations.
 */
export function createActivationService(env, options = {}) {
  const cryptoApi = options.cryptoApi || globalThis.crypto;
  const subtle = cryptoApi.subtle;
  const now = options.now || Date.now;
  const secret = String(env?.XSXB_ACTIVATION_SECRET || "");
  const configured = Boolean((options.repository || env?.LICENSE_DB) && secret.length >= 32);
  const repository = configured ? options.repository || createLicenseRepository(env.LICENSE_DB) : null;

  /** @param {object} authorization Authorization row. @param {string} type Challenge type. @param {string} origin Request origin. @returns {Promise<object>} Signed challenge response. */
  async function challengeFor(authorization, type, origin) {
    const currentTime = now();
    const expiresAt = assertAuthorizationActive(authorization, currentTime);
    const nonce = bytesToBase64Url(cryptoApi.getRandomValues(new Uint8Array(18)));
    const challenge = await signToken(
      {
        type,
        deviceId: authorization.device_id,
        licenseId: authorization.license_id,
        origin,
        nonce,
        exp: currentTime + CHALLENGE_TTL_MS,
      },
      secret,
      subtle,
    );
    return {
      activated: false,
      challenge,
      deviceId: authorization.device_id,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  return {
    configured,
    async activationChallenge(payload, request) {
      if (!configured)
        throw Object.assign(new Error("Activation verification is not configured."), { status: 503 });
      const code = String(payload.code || "").trim();
      if (!code || code.length > 160)
        throw Object.assign(new Error("Invalid activation code."), { status: 401 });
      const { jwk, canonical } = canonicalPublicKey(payload.publicKey);
      try {
        await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      } catch (_error) {
        throw Object.assign(new Error("A valid P-256 public key is required."), { status: 400 });
      }
      const publicKeyHash = await sha256Hex(canonical, subtle);
      const license = await repository.findLicenseByCodeHash(await hashActivationCode(code, subtle));
      if (!license || license.revoked_at)
        throw Object.assign(new Error("Invalid activation code."), { status: 401 });
      const currentTime = now();
      if (!license.first_activated_at && license.redeem_by) {
        const redeemBy = Date.parse(license.redeem_by);
        if (!Number.isFinite(redeemBy)) {
          throw Object.assign(new Error("Activation code expiry is misconfigured."), { status: 500 });
        }
        if (redeemBy <= currentTime) {
          throw Object.assign(new Error("This activation code can no longer be redeemed."), {
            status: 410,
          });
        }
      }
      const activatedAt = license.first_activated_at || new Date(currentTime).toISOString();
      const durationDays = Math.max(1, Number(license.duration_days || 3));
      const expiresAt = license.expires_at || new Date(currentTime + durationDays * 86_400_000).toISOString();
      if (Date.parse(expiresAt) <= currentTime)
        throw Object.assign(new Error("Trial period has expired."), { status: 402 });
      if (!license.first_activated_at || !license.expires_at) {
        await repository.activateLicense(license.id, activatedAt, expiresAt);
      }
      let device = await repository.findDeviceByLicenseId(license.id);
      if (device && (device.public_key_hash !== publicKeyHash || device.revoked_at)) {
        throw Object.assign(new Error("This trial code is already bound to another device."), {
          status: 409,
        });
      }
      if (!device) {
        const risk = await requestRiskSignals(request, secret, subtle);
        const deviceId = cryptoApi.randomUUID();
        try {
          await repository.createDevice({
            id: deviceId,
            licenseId: license.id,
            publicKey: JSON.stringify(jwk),
            publicKeyHash,
            deviceName: String(payload.deviceName || "Browser device")
              .trim()
              .slice(0, 80),
            ipHash: risk.ipHash,
            country: risk.country,
            createdAt: new Date(currentTime).toISOString(),
          });
        } catch (_error) {
          device = await repository.findDeviceByLicenseId(license.id);
          if (!device || device.public_key_hash !== publicKeyHash) {
            throw Object.assign(new Error("This trial code is already bound to another device."), {
              status: 409,
            });
          }
        }
        device ||= {
          id: deviceId,
          license_id: license.id,
          public_key: JSON.stringify(jwk),
          public_key_hash: publicKeyHash,
        };
      }
      return challengeFor(
        {
          device_id: device.id,
          license_id: license.id,
          public_key: device.public_key,
          expires_at: expiresAt,
          plan: license.plan,
        },
        "activate",
        new URL(request.url).origin,
      );
    },
    async deviceChallenge(payload, request) {
      if (!configured)
        throw Object.assign(new Error("Activation verification is not configured."), { status: 503 });
      const deviceId = String(payload.deviceId || "");
      const authorization = deviceId ? await repository.findAuthorizationByDeviceId(deviceId) : null;
      return challengeFor(authorization, "renew", new URL(request.url).origin);
    },
    async verifyChallenge(payload, request) {
      if (!configured)
        throw Object.assign(new Error("Activation verification is not configured."), { status: 503 });
      const challenge = String(payload.challenge || "");
      const challengePayload = await verifyToken(challenge, secret, subtle);
      const requestOrigin = new URL(request.url).origin;
      if (
        !challengePayload ||
        !["activate", "renew"].includes(challengePayload.type) ||
        challengePayload.origin !== requestOrigin ||
        Number(challengePayload.exp || 0) <= now()
      ) {
        throw Object.assign(new Error("Activation challenge is invalid or expired."), { status: 401 });
      }
      const authorization = await repository.findAuthorizationByDeviceId(challengePayload.deviceId);
      const licenseExpiresAt = assertAuthorizationActive(authorization, now());
      if (authorization.license_id !== challengePayload.licenseId) {
        throw Object.assign(new Error("Activation challenge does not match this license."), { status: 401 });
      }
      const publicKey = JSON.parse(authorization.public_key);
      if (!(await verifyDeviceSignature(challenge, String(payload.signature || ""), publicKey, subtle))) {
        throw Object.assign(new Error("Device signature is invalid."), { status: 401 });
      }
      const risk = await requestRiskSignals(request, secret, subtle);
      await repository.touchDevice(
        authorization.device_id,
        new Date(now()).toISOString(),
        risk.ipHash,
        risk.country,
      );
      const sessionExpiresAt = Math.min(licenseExpiresAt, now() + COOKIE_TTL_SECONDS * 1000);
      const token = await signToken(
        {
          type: "session",
          deviceId: authorization.device_id,
          licenseId: authorization.license_id,
          exp: sessionExpiresAt,
        },
        secret,
        subtle,
      );
      return {
        activated: true,
        configured: true,
        deviceId: authorization.device_id,
        expiresAt: new Date(licenseExpiresAt).toISOString(),
        sessionExpiresAt: new Date(sessionExpiresAt).toISOString(),
        token,
      };
    },
    async status(request) {
      if (!configured) return { activated: false, configured: false, expiresAt: "" };
      const payload = await verifyToken(readCookieToken(request), secret, subtle);
      if (!payload || payload.type !== "session" || Number(payload.exp || 0) <= now()) {
        return { activated: false, configured: true, expiresAt: "" };
      }
      const authorization = await repository.findAuthorizationByDeviceId(payload.deviceId);
      try {
        const expiresAt = assertAuthorizationActive(authorization, now());
        if (authorization.license_id !== payload.licenseId) throw new Error("license mismatch");
        return {
          activated: true,
          configured: true,
          deviceId: authorization.device_id,
          plan: authorization.plan,
          expiresAt: new Date(expiresAt).toISOString(),
          sessionExpiresAt: new Date(Number(payload.exp)).toISOString(),
        };
      } catch (_error) {
        return { activated: false, configured: true, expiresAt: "" };
      }
    },
    cookieHeader(token, request) {
      return [
        `${COOKIE_NAME}=${encodeURIComponent(token)}`,
        "Path=/",
        `Max-Age=${COOKIE_TTL_SECONDS}`,
        "HttpOnly",
        "SameSite=Strict",
        new URL(request.url).protocol === "https:" ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; ");
    },
  };
}

/** @param {object} payload JSON payload. @param {number} [status] HTTP status. @param {HeadersInit} [extra] Additional headers. @returns {Response} JSON response. */
function jsonResponse(payload, status = 200, extra = {}) {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(payload), { status, headers });
}

/** @param {object} result Internal verification result. @returns {object} Browser-safe activation result. */
export function sanitizeActivationResult(result) {
  const payload = { ...result };
  delete payload.token;
  return payload;
}

/** @param {Request} request Incoming request. @param {object} env Worker environment. @returns {Promise<Response>} Activation API response. */
export async function handleActivationRequest(request, env) {
  const pathname = new URL(request.url).pathname;
  const service = createActivationService(env);
  if (request.method === "GET" && pathname === "/api/activation") {
    return jsonResponse(await service.status(request));
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405, { Allow: "GET, POST" });
  }
  try {
    assertSameOrigin(request);
    const payload = await readJsonObject(request);
    if (pathname === "/api/activation" || pathname === "/api/activation/challenge") {
      return jsonResponse(await service.activationChallenge(payload, request));
    }
    if (pathname === "/api/activation/device-challenge") {
      return jsonResponse(await service.deviceChallenge(payload, request));
    }
    if (pathname === "/api/activation/verify") {
      const result = await service.verifyChallenge(payload, request);
      return jsonResponse(sanitizeActivationResult(result), 200, {
        "Set-Cookie": service.cookieHeader(result.token, request),
      });
    }
    return jsonResponse({ error: "Not Found" }, 404);
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) {
      console.error(
        JSON.stringify({
          event: "activation_request_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return jsonResponse(
      {
        activated: false,
        configured: service.configured,
        error: status >= 500 ? "Activation service unavailable." : error.message,
      },
      status,
    );
  }
}

export { COOKIE_NAME };
