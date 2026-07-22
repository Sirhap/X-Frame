import { hmacHex, safeEqual, signToken, verifyToken } from "./activation_crypto.mjs";
import { createAdminLicenseService } from "./admin_license_service.mjs";
import { createAdminRepository } from "./admin_repository.mjs";
import { isPermanentLicenseExpiry } from "./license_duration.mjs";

const ADMIN_COOKIE_NAME = "xsxb_admin";
const ADMIN_SESSION_TTL_SECONDS = 15 * 60;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const MAX_REQUEST_BYTES = 32 * 1024;
const DEFAULT_ADMIN_USERNAME = "admin";
const ADMIN_USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;
export const TOTP_PERIOD_SECONDS = 30;
const textEncoder = new TextEncoder();

/** @param {unknown} value Username-like value. @returns {string} Trimmed administrator username. */
function normalizeAdminUsername(value) {
  return String(value || "").trim();
}

/** @param {string} value Base32 text. @returns {Uint8Array} Decoded secret bytes. */
export function decodeBase32Secret(value) {
  const normalized = String(value || "")
    .toUpperCase()
    .replace(/[\s=-]/gu, "");
  if (!/^[A-Z2-7]+$/u.test(normalized)) throw new Error("TOTP secret must use Base32 encoding.");
  let buffer = 0;
  let bitCount = 0;
  const output = [];
  for (const character of normalized) {
    const characterValue = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    buffer = (buffer << 5) | characterValue;
    bitCount += 5;
    if (bitCount < 8) continue;
    bitCount -= 8;
    output.push((buffer >>> bitCount) & 0xff);
    buffer &= (1 << bitCount) - 1;
  }
  if (output.length < 10) throw new Error("TOTP secret must contain at least 80 bits.");
  return Uint8Array.from(output);
}

/** @param {number} counter HOTP counter. @returns {Uint8Array} Big-endian counter bytes. */
function counterBytes(counter) {
  const bytes = new Uint8Array(8);
  let remaining = BigInt(counter);
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

/**
 * Generates a six-digit Google Authenticator-compatible TOTP value.
 * @param {Uint8Array} secret Base32-decoded secret.
 * @param {number} counter TOTP counter.
 * @param {SubtleCrypto} subtle Web Crypto.
 * @returns {Promise<string>} Six-digit code.
 */
export async function generateTotp(secret, counter, subtle) {
  const key = await subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await subtle.sign("HMAC", key, counterBytes(counter)));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

/**
 * Verifies only the current standard 30-second TOTP window.
 * @param {string} code User-entered code.
 * @param {Uint8Array} secret TOTP secret bytes.
 * @param {number} now Current epoch milliseconds.
 * @param {SubtleCrypto} subtle Web Crypto.
 * @returns {Promise<number|null>} Accepted counter or null.
 */
export async function verifyTotp(code, secret, now, subtle) {
  const normalized = String(code || "").replace(/\s/gu, "");
  if (!/^\d{6}$/u.test(normalized)) return null;
  const currentCounter = Math.floor(now / (TOTP_PERIOD_SECONDS * 1000));
  const expected = await generateTotp(secret, currentCounter, subtle);
  return safeEqual(textEncoder.encode(normalized), textEncoder.encode(expected), subtle)
    ? currentCounter
    : null;
}

/** @param {Request} request Incoming request. @returns {string} Administrator cookie token. */
function readCookieToken(request) {
  for (const entry of String(request.headers.get("cookie") || "").split(";")) {
    const [name, ...parts] = entry.trim().split("=");
    if (name !== ADMIN_COOKIE_NAME) continue;
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
    throw Object.assign(new Error("Administrator request is too large."), { status: 413 });
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
        throw Object.assign(new Error("Administrator request is too large."), { status: 413 });
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
    throw Object.assign(new Error("Invalid administrator request JSON."), { status: 400 });
  }
}

/** @param {Request} request Incoming request. @returns {void} */
function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  const fetchSite = String(request.headers.get("sec-fetch-site") || "");
  if ((origin && origin !== new URL(request.url).origin) || ["cross-site", "same-site"].includes(fetchSite)) {
    throw Object.assign(new Error("Cross-origin administrator access is not allowed."), { status: 403 });
  }
}

/** @param {object} row Stored license row. @param {number} now Current epoch. @param {string} [code] Decrypted activation code. @returns {object} Browser-safe license. */
function serializeLicense(row, now, code = "") {
  const expired = row.expires_at && Date.parse(row.expires_at) <= now;
  const status = row.revoked_at
    ? "revoked"
    : expired
      ? "expired"
      : row.first_activated_at
        ? "active"
        : "unused";
  const devices = Array.isArray(row.devices)
    ? row.devices.map((device) => ({
        id: device.id,
        name: device.device_name || "Browser device",
        country: device.last_country || device.first_country || "",
        createdAt: device.created_at || "",
        lastSeenAt: device.last_seen_at || "",
        revoked: Boolean(device.revoked_at),
      }))
    : [];
  return {
    id: row.id,
    code,
    codeAvailable: Boolean(code),
    codeHashPrefix: String(row.code_hash || "").slice(0, 12),
    durationDays: row.duration_days,
    maxDevices: row.max_devices === null ? null : Number(row.max_devices || 1),
    unlimitedDevices: row.max_devices === null,
    activeDeviceCount: devices.filter((device) => !device.revoked).length,
    devices,
    permanent: isPermanentLicenseExpiry(row.expires_at),
    redeemBy: row.redeem_by || "",
    activatedAt: row.first_activated_at || "",
    expiresAt: row.expires_at || "",
    status,
  };
}

/**
 * Creates the TOTP-protected administrator service.
 * @param {{LICENSE_DB?:D1Database,XSXB_ACTIVATION_SECRET?:string,XSXB_ADMIN_TOTP_SECRET?:string,XSXB_ADMIN_USERNAME?:string}} env Worker environment.
 * @param {{cryptoApi?:Crypto,now?:()=>number,repository?:object}} [options] Test adapters.
 * @returns {object} Administrator operations.
 */
export function createAdminService(env, options = {}) {
  const cryptoApi = options.cryptoApi || globalThis.crypto;
  const subtle = cryptoApi.subtle;
  const now = options.now || Date.now;
  const sessionSecret = String(env?.XSXB_ACTIVATION_SECRET || "");
  const adminUsername = normalizeAdminUsername(env?.XSXB_ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME);
  let totpSecret = null;
  try {
    totpSecret = decodeBase32Secret(env?.XSXB_ADMIN_TOTP_SECRET || "");
  } catch (_error) {
    totpSecret = null;
  }
  const configured = Boolean(
    (options.repository || env?.LICENSE_DB) &&
      sessionSecret.length >= 32 &&
      totpSecret &&
      ADMIN_USERNAME_PATTERN.test(adminUsername),
  );
  const repository = configured ? options.repository || createAdminRepository(env.LICENSE_DB) : null;
  const licenseService = configured
    ? createAdminLicenseService(repository, cryptoApi, now, serializeLicense, sessionSecret)
    : null;

  /** @param {Request} request Incoming request. @returns {Promise<object|null>} Valid session payload. */
  async function sessionPayload(request) {
    if (!configured) return null;
    const payload = await verifyToken(readCookieToken(request), sessionSecret, subtle);
    if (
      !payload ||
      payload.type !== "admin-session" ||
      payload.username !== adminUsername ||
      Number(payload.exp || 0) <= now()
    ) {
      return null;
    }
    return payload;
  }

  return {
    configured,
    async status(request) {
      const payload = await sessionPayload(request);
      return {
        authenticated: Boolean(payload),
        configured,
        periodSeconds: TOTP_PERIOD_SECONDS,
        sessionExpiresAt: payload ? new Date(Number(payload.exp)).toISOString() : "",
        username: payload ? payload.username : "",
      };
    },
    async login(payload, request) {
      if (!configured) {
        throw Object.assign(new Error("Administrator authentication is not configured."), { status: 503 });
      }
      const currentTime = now();
      const clientAddress = String(request.headers.get("cf-connecting-ip") || "unknown").trim();
      const fingerprintHash = await hmacHex(`admin-login:${clientAddress}`, sessionSecret, subtle);
      const attempt = await repository.findLoginAttempt(fingerprintHash);
      if (Number(attempt?.blocked_until || 0) > currentTime) {
        throw Object.assign(new Error("Too many attempts. Try again later."), {
          retryAfter: Math.ceil((Number(attempt.blocked_until) - currentTime) / 1000),
          status: 429,
        });
      }
      const submittedUsername = normalizeAdminUsername(payload.username);
      const usernameMatches =
        ADMIN_USERNAME_PATTERN.test(submittedUsername) &&
        safeEqual(textEncoder.encode(submittedUsername), textEncoder.encode(adminUsername), subtle);
      const counter = await verifyTotp(payload.code, totpSecret, currentTime, subtle);
      if (!usernameMatches || counter === null) {
        const withinWindow = currentTime - Number(attempt?.window_started_at || 0) < LOGIN_WINDOW_MS;
        const failedCount = withinWindow ? Number(attempt?.failed_count || 0) + 1 : 1;
        await repository.saveLoginAttempt({
          fingerprintHash,
          failedCount,
          windowStartedAt: withinWindow ? Number(attempt.window_started_at) : currentTime,
          blockedUntil: failedCount >= MAX_LOGIN_FAILURES ? currentTime + LOGIN_BLOCK_MS : 0,
          updatedAt: new Date(currentTime).toISOString(),
        });
        throw Object.assign(new Error("The username or verification code is invalid."), { status: 401 });
      }
      if (!(await repository.consumeTotpCounter(counter, new Date(currentTime).toISOString()))) {
        throw Object.assign(new Error("This verification code has already been used."), { status: 409 });
      }
      await repository.clearLoginAttempt(fingerprintHash);
      const expiresAt = currentTime + ADMIN_SESSION_TTL_SECONDS * 1000;
      const token = await signToken(
        { type: "admin-session", username: adminUsername, exp: expiresAt },
        sessionSecret,
        subtle,
      );
      return {
        authenticated: true,
        expiresAt: new Date(expiresAt).toISOString(),
        username: adminUsername,
        token,
      };
    },
    async listLicenses(request) {
      if (!(await sessionPayload(request))) {
        throw Object.assign(new Error("Administrator session is required."), { status: 401 });
      }
      const rows = await repository.listLicenses(200);
      const devices = await repository.listLicenseDevices(rows.map((row) => row.id));
      const devicesByLicense = new Map();
      for (const device of devices) {
        const entries = devicesByLicense.get(device.license_id) || [];
        entries.push(device);
        devicesByLicense.set(device.license_id, entries);
      }
      return licenseService.list(
        rows.map((row) => ({ ...row, devices: devicesByLicense.get(row.id) || [] })),
      );
    },
    async createLicenses(payload, request) {
      if (!(await sessionPayload(request))) {
        throw Object.assign(new Error("Administrator session is required."), { status: 401 });
      }
      return licenseService.create(payload);
    },
    async updateLicenses(payload, request) {
      if (!(await sessionPayload(request))) {
        throw Object.assign(new Error("Administrator session is required."), { status: 401 });
      }
      return licenseService.update(payload);
    },
    async setLicensesRevoked(payload, request) {
      if (!(await sessionPayload(request))) {
        throw Object.assign(new Error("Administrator session is required."), { status: 401 });
      }
      return licenseService.setRevoked(payload);
    },
    async deleteLicenses(payload, request) {
      if (!(await sessionPayload(request))) {
        throw Object.assign(new Error("Administrator session is required."), { status: 401 });
      }
      return licenseService.delete(payload);
    },
    async setDevicesRevoked(payload, request) {
      if (!(await sessionPayload(request))) {
        throw Object.assign(new Error("Administrator session is required."), { status: 401 });
      }
      return licenseService.setDevicesRevoked(payload);
    },
    async deleteDevices(payload, request) {
      if (!(await sessionPayload(request))) {
        throw Object.assign(new Error("Administrator session is required."), { status: 401 });
      }
      return licenseService.deleteDevices(payload);
    },
    cookieHeader(token, request) {
      return [
        `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
        "Path=/api/admin",
        `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`,
        "HttpOnly",
        "SameSite=Strict",
        new URL(request.url).protocol === "https:" ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; ");
    },
    clearCookieHeader(request) {
      return [
        `${ADMIN_COOKIE_NAME}=`,
        "Path=/api/admin",
        "Max-Age=0",
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
  headers.set("Vary", "Cookie");
  return new Response(JSON.stringify(payload), { status, headers });
}

/** @param {Request} request Incoming request. @param {object} env Worker environment. @returns {Promise<Response>} Administrator API response. */
export async function handleAdminRequest(request, env) {
  const pathname = new URL(request.url).pathname;
  const service = createAdminService(env);
  try {
    if (request.method === "GET" && pathname === "/api/admin/session") {
      return jsonResponse(await service.status(request));
    }
    if (request.method === "GET" && pathname === "/api/admin/licenses") {
      return jsonResponse({ licenses: await service.listLicenses(request) });
    }
    if (!["POST", "PATCH", "DELETE"].includes(request.method)) {
      return jsonResponse({ error: "Method Not Allowed" }, 405, { Allow: "GET, POST, PATCH, DELETE" });
    }
    assertSameOrigin(request);
    if (request.method === "POST" && pathname === "/api/admin/logout") {
      return jsonResponse({ authenticated: false }, 200, {
        "Set-Cookie": service.clearCookieHeader(request),
      });
    }
    const payload = await readJsonObject(request);
    if (request.method === "POST" && pathname === "/api/admin/login") {
      const result = await service.login(payload, request);
      return jsonResponse(
        { authenticated: true, expiresAt: result.expiresAt, username: result.username },
        200,
        {
          "Set-Cookie": service.cookieHeader(result.token, request),
        },
      );
    }
    if (request.method === "POST" && pathname === "/api/admin/licenses") {
      return jsonResponse(await service.createLicenses(payload, request), 201);
    }
    if (request.method === "PATCH" && pathname === "/api/admin/licenses") {
      return jsonResponse(await service.updateLicenses(payload, request));
    }
    if (request.method === "PATCH" && pathname === "/api/admin/licenses/revocation") {
      return jsonResponse(await service.setLicensesRevoked(payload, request));
    }
    if (request.method === "PATCH" && pathname === "/api/admin/licenses/devices/revocation") {
      return jsonResponse(await service.setDevicesRevoked(payload, request));
    }
    if (request.method === "DELETE" && pathname === "/api/admin/licenses/devices") {
      return jsonResponse(await service.deleteDevices(payload, request));
    }
    if (request.method === "DELETE" && pathname === "/api/admin/licenses") {
      return jsonResponse(await service.deleteLicenses(payload, request));
    }
    return jsonResponse({ error: "Not Found" }, 404);
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) {
      console.error(
        JSON.stringify({
          event: "admin_request_failed",
          pathname,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    const headers = error?.retryAfter ? { "Retry-After": String(error.retryAfter) } : {};
    return jsonResponse(
      { error: status >= 500 ? "Administrator service unavailable." : error.message },
      status,
      headers,
    );
  }
}

export { ADMIN_COOKIE_NAME };
