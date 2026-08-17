import { hmacHex, safeEqual, signToken, verifyToken } from "./activation_crypto.mjs";
import { createAdminLicenseService } from "./admin_license_service.mjs";
import { createAdminAccountService } from "./admin_account_service.mjs";
import { createAdminRepository } from "./admin_repository.mjs";
import { isPermanentLicenseExpiry } from "./license_duration.mjs";

const ADMIN_COOKIE_NAME = "xsxb_admin";
const ADMIN_WORKBENCH_COOKIE_NAME = "xsxb_admin_workbench";
const DEFAULT_ADMIN_SESSION_MINUTES = 4 * 60;
const MIN_ADMIN_SESSION_MINUTES = 15;
const MAX_ADMIN_SESSION_MINUTES = 24 * 60;
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

/** @param {unknown} value Configured session duration in minutes. @returns {number} Valid session duration in seconds. */
function resolveAdminSessionTtlSeconds(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return DEFAULT_ADMIN_SESSION_MINUTES * 60;
  }
  const minutes = Number(value);
  if (
    !Number.isSafeInteger(minutes) ||
    minutes < MIN_ADMIN_SESSION_MINUTES ||
    minutes > MAX_ADMIN_SESSION_MINUTES
  ) {
    return DEFAULT_ADMIN_SESSION_MINUTES * 60;
  }
  return minutes * 60;
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
  return {
    id: row.id,
    source: ["code", "email_trial", "admin_grant"].includes(row.source) ? row.source : "code",
    code,
    codeAvailable: Boolean(code),
    codeHashPrefix: String(row.code_hash || "").slice(0, 12),
    durationDays: row.duration_days,
    permanent: isPermanentLicenseExpiry(row.expires_at),
    redeemBy: row.redeem_by || "",
    activatedAt: row.first_activated_at || "",
    expiresAt: row.expires_at || "",
    accountId: row.account_id || "",
    accountEmail: row.account_email || "",
    adminNote: row.admin_note || "",
    status,
  };
}

/**
 * Creates the TOTP-protected administrator service.
 * @param {{LICENSE_DB?:D1Database,PASSWORD?:string,XSXB_ACTIVATION_SECRET?:string,XSXB_ADMIN_SESSION_MINUTES?:string|number,XSXB_ADMIN_TOTP_SECRET?:string,XSXB_ADMIN_USERNAME?:string}} env Worker environment.
 * @param {{cryptoApi?:Crypto,now?:()=>number,repository?:object}} [options] Test adapters.
 * @returns {object} Administrator operations.
 */
export function createAdminService(env, options = {}) {
  const cryptoApi = options.cryptoApi || globalThis.crypto;
  const subtle = cryptoApi.subtle;
  const now = options.now || Date.now;
  const sessionSecret = String(env?.XSXB_ACTIVATION_SECRET || "");
  const adminPassword = String(env?.PASSWORD || "");
  const adminUsername = normalizeAdminUsername(env?.XSXB_ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME);
  const adminSessionTtlSeconds = resolveAdminSessionTtlSeconds(env?.XSXB_ADMIN_SESSION_MINUTES);
  let totpSecret = null;
  try {
    totpSecret = decodeBase32Secret(env?.XSXB_ADMIN_TOTP_SECRET || "");
  } catch (_error) {
    totpSecret = null;
  }
  const configured = Boolean(
    (options.repository || env?.LICENSE_DB) &&
      sessionSecret.length >= 32 &&
      adminPassword.length >= 8 &&
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
    /** Verifies administrator credentials before revealing the TOTP step. */
    async startLogin(payload, request) {
      if (!configured)
        throw Object.assign(new Error("Administrator authentication is not configured."), { status: 503 });
      const currentTime = now();
      const clientAddress = String(request.headers.get("cf-connecting-ip") || "unknown").trim();
      const fingerprintHash = await hmacHex(`admin-login:${clientAddress}`, sessionSecret, subtle);
      const attempt = await repository.findLoginAttempt(fingerprintHash);
      if (Number(attempt?.blocked_until || 0) > currentTime) {
        throw Object.assign(new Error("Too many attempts. Try again later."), { status: 429 });
      }
      const submittedUsername = normalizeAdminUsername(payload.username);
      const submittedPassword = String(payload.password || "");
      const usernameMatches =
        ADMIN_USERNAME_PATTERN.test(submittedUsername) &&
        (await safeEqual(textEncoder.encode(submittedUsername), textEncoder.encode(adminUsername), subtle));
      const passwordMatches = await safeEqual(
        textEncoder.encode(submittedPassword),
        textEncoder.encode(adminPassword),
        subtle,
      );
      if (!usernameMatches || !passwordMatches) {
        const withinWindow = currentTime - Number(attempt?.window_started_at || 0) < LOGIN_WINDOW_MS;
        const failedCount = withinWindow ? Number(attempt?.failed_count || 0) + 1 : 1;
        await repository.saveLoginAttempt({
          fingerprintHash,
          failedCount,
          windowStartedAt: withinWindow ? Number(attempt.window_started_at) : currentTime,
          blockedUntil: failedCount >= MAX_LOGIN_FAILURES ? currentTime + LOGIN_BLOCK_MS : 0,
          updatedAt: new Date(currentTime).toISOString(),
        });
        throw Object.assign(new Error("用户名或密码错误。"), { status: 401 });
      }
      await repository.clearLoginAttempt(fingerprintHash);
      const expiresAt = currentTime + 5 * 60 * 1000;
      return {
        challengeType: "admin_totp",
        challengeToken: await signToken(
          { type: "admin-login-challenge", username: adminUsername, exp: expiresAt },
          sessionSecret,
          subtle,
        ),
        expiresInSeconds: 300,
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
      const loginChallenge = payload.challengeToken
        ? await verifyToken(String(payload.challengeToken), sessionSecret, subtle)
        : null;
      const challengeMatches =
        loginChallenge?.type === "admin-login-challenge" &&
        loginChallenge.username === adminUsername &&
        Number(loginChallenge.exp || 0) > currentTime;
      const submittedUsername = normalizeAdminUsername(payload.username);
      const submittedPassword = String(payload.password || "");
      const usernameMatches =
        challengeMatches ||
        (ADMIN_USERNAME_PATTERN.test(submittedUsername) &&
          (await safeEqual(
            textEncoder.encode(submittedUsername),
            textEncoder.encode(adminUsername),
            subtle,
          )));
      const passwordMatches =
        challengeMatches ||
        (await safeEqual(textEncoder.encode(submittedPassword), textEncoder.encode(adminPassword), subtle));
      const counter = await verifyTotp(payload.code, totpSecret, currentTime, subtle);
      if (!usernameMatches || !passwordMatches || counter === null) {
        const withinWindow = currentTime - Number(attempt?.window_started_at || 0) < LOGIN_WINDOW_MS;
        const failedCount = withinWindow ? Number(attempt?.failed_count || 0) + 1 : 1;
        await repository.saveLoginAttempt({
          fingerprintHash,
          failedCount,
          windowStartedAt: withinWindow ? Number(attempt.window_started_at) : currentTime,
          blockedUntil: failedCount >= MAX_LOGIN_FAILURES ? currentTime + LOGIN_BLOCK_MS : 0,
          updatedAt: new Date(currentTime).toISOString(),
        });
        throw Object.assign(new Error("The username, password, or verification code is invalid."), {
          status: 401,
        });
      }
      if (!(await repository.consumeTotpCounter(counter, new Date(currentTime).toISOString()))) {
        throw Object.assign(new Error("This verification code has already been used."), { status: 409 });
      }
      await repository.clearLoginAttempt(fingerprintHash);
      const expiresAt = currentTime + adminSessionTtlSeconds * 1000;
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
      return licenseService.list(rows);
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
        `Max-Age=${adminSessionTtlSeconds}`,
        "HttpOnly",
        "SameSite=Strict",
        new URL(request.url).protocol === "https:" ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; ");
    },
    workbenchCookieHeader(token, request) {
      return [
        `${ADMIN_WORKBENCH_COOKIE_NAME}=${encodeURIComponent(token)}`,
        "Path=/",
        `Max-Age=${adminSessionTtlSeconds}`,
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
    clearWorkbenchCookieHeader(request) {
      return [
        `${ADMIN_WORKBENCH_COOKIE_NAME}=`,
        "Path=/",
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

/** @param {string} value CSV cell. @returns {string} Escaped CSV field. */
function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

/** @param {string[]} headings Column headings. @param {Array<Array<unknown>>} rows CSV rows. @param {string} filename Download filename. @returns {Response} Private CSV response. */
function csvResponse(headings, rows, filename) {
  const body = [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new Response(`\uFEFF${body}\r\n`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** @param {Request} request Request. @param {object} service Administrator auth service. @returns {Promise<void>} */
async function requireAdministrator(request, service) {
  const session = await service.status(request);
  if (!session.authenticated) {
    throw Object.assign(new Error("Administrator session is required."), { status: 401 });
  }
}

/** @param {Request} request Incoming request. @param {object} env Worker environment. @returns {Promise<Response>} Administrator API response. */
export async function handleAdminRequest(request, env) {
  const pathname = new URL(request.url).pathname;
  const service = createAdminService(env);
  const accountService = env?.LICENSE_DB ? createAdminAccountService(env) : null;
  try {
    if (request.method === "GET" && pathname === "/api/admin/session") {
      return jsonResponse(await service.status(request));
    }
    if (request.method === "GET" && pathname === "/api/admin/licenses") {
      return jsonResponse({ licenses: await service.listLicenses(request) });
    }
    if (request.method === "GET" && pathname === "/api/admin/accounts") {
      await requireAdministrator(request, service);
      return jsonResponse(await accountService.list(new URL(request.url).searchParams.get("q")));
    }
    if (request.method === "GET" && pathname === "/api/admin/accounts/export") {
      await requireAdministrator(request, service);
      const { accounts } = await accountService.list(new URL(request.url).searchParams.get("q"));
      return csvResponse(
        [
          "email",
          "status",
          "last_login_at",
          "license_count",
          "trial_count",
          "admin_grant_count",
          "expires_at",
        ],
        accounts.map((account) => [
          account.email,
          account.status || "active",
          account.last_login_at,
          account.license_count,
          account.trial_count,
          account.admin_grant_count,
          account.license_expires_at,
        ]),
        "accounts.csv",
      );
    }
    const accountDetailMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)$/u);
    if (request.method === "GET" && accountDetailMatch) {
      await requireAdministrator(request, service);
      return jsonResponse(await accountService.detail(decodeURIComponent(accountDetailMatch[1])));
    }
    if (request.method === "GET" && pathname === "/api/admin/trials") {
      await requireAdministrator(request, service);
      const params = new URL(request.url).searchParams;
      return jsonResponse(
        await accountService.listTrials({
          q: params.get("q"),
          state: params.get("state"),
          expiresBefore: params.get("expiresBefore"),
        }),
      );
    }
    if (request.method === "GET" && pathname === "/api/admin/audit-log") {
      await requireAdministrator(request, service);
      return jsonResponse(await accountService.listAudit(new URL(request.url).searchParams.get("q")));
    }
    if (request.method === "GET" && pathname === "/api/admin/audit-log/export") {
      await requireAdministrator(request, service);
      const { entries } = await accountService.listAudit(new URL(request.url).searchParams.get("q"));
      return csvResponse(
        ["created_at", "actor", "action", "target_type", "target_id", "details"],
        entries.map((entry) => [
          entry.created_at,
          entry.actor_id,
          entry.action,
          entry.target_type,
          entry.target_id,
          entry.details_json,
        ]),
        "authorization-audit.csv",
      );
    }
    if (request.method === "GET" && pathname === "/api/admin/metrics/authorization") {
      await requireAdministrator(request, service);
      return jsonResponse(await accountService.metrics());
    }
    if (!["POST", "PATCH", "DELETE"].includes(request.method)) {
      return jsonResponse({ error: "Method Not Allowed" }, 405, { Allow: "GET, POST, PATCH, DELETE" });
    }
    assertSameOrigin(request);
    if (request.method === "POST" && pathname === "/api/admin/logout") {
      const response = jsonResponse({ authenticated: false });
      response.headers.append("Set-Cookie", service.clearCookieHeader(request));
      response.headers.append("Set-Cookie", service.clearWorkbenchCookieHeader(request));
      return response;
    }
    const revokeSessionsMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)\/sessions\/revoke$/u);
    const payload = revokeSessionsMatch && request.method === "POST" ? {} : await readJsonObject(request);
    if (request.method === "POST" && pathname === "/api/admin/login") {
      const result = await service.login(payload, request);
      const response = jsonResponse({
        authenticated: true,
        expiresAt: result.expiresAt,
        username: result.username,
      });
      response.headers.append("Set-Cookie", service.cookieHeader(result.token, request));
      response.headers.append("Set-Cookie", service.workbenchCookieHeader(result.token, request));
      return response;
    }
    if (request.method === "POST" && pathname === "/api/admin/login/start") {
      return jsonResponse(await service.startLogin(payload, request));
    }
    if (
      pathname.startsWith("/api/admin/accounts") ||
      pathname.startsWith("/api/admin/grants") ||
      pathname.startsWith("/api/admin/trials/") ||
      pathname === "/api/admin/email-licenses/revocation" ||
      pathname === "/api/admin/settings/authorization" ||
      pathname === "/api/admin/licenses/account"
    ) {
      const session = await service.status(request);
      if (!session.authenticated) {
        throw Object.assign(new Error("Administrator session is required."), { status: 401 });
      }
    }
    if (request.method === "PATCH" && pathname === "/api/admin/accounts/authorization") {
      return jsonResponse(await accountService.updateAccount(payload));
    }
    if (request.method === "PATCH" && pathname === "/api/admin/accounts/status") {
      return jsonResponse(await accountService.updateAccountStatus(payload));
    }
    const accountStatusMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)\/status$/u);
    if (request.method === "PATCH" && accountStatusMatch) {
      return jsonResponse(
        await accountService.updateAccountStatus({
          ...payload,
          accountId: decodeURIComponent(accountStatusMatch[1]),
        }),
      );
    }
    if (request.method === "POST" && revokeSessionsMatch) {
      return jsonResponse(
        await accountService.revokeAccountSessions(decodeURIComponent(revokeSessionsMatch[1])),
      );
    }
    if (request.method === "POST" && pathname === "/api/admin/grants") {
      return jsonResponse(await accountService.createGrant(payload), 201);
    }
    if (request.method === "POST" && pathname === "/api/admin/grants/batch") {
      return jsonResponse(
        await accountService.createGrantBatch({
          ...payload,
          idempotencyKey: request.headers.get("idempotency-key") || payload.idempotencyKey,
        }),
        201,
      );
    }
    if (request.method === "POST" && pathname === "/api/admin/accounts/batch/status") {
      return jsonResponse(await accountService.updateAccountStatusBatch(payload));
    }
    if (request.method === "PATCH" && pathname === "/api/admin/email-licenses/revocation") {
      return jsonResponse(await accountService.setEmailLicenseRevoked(payload));
    }
    const trialMatch = pathname.match(/^\/api\/admin\/trials\/([^/]+)$/u);
    if (request.method === "PATCH" && trialMatch) {
      return jsonResponse(
        await accountService.updateEmailLicense({ ...payload, licenseId: decodeURIComponent(trialMatch[1]) }),
      );
    }
    const trialRevocationMatch = pathname.match(/^\/api\/admin\/trials\/([^/]+)\/revocation$/u);
    if (request.method === "PATCH" && trialRevocationMatch) {
      return jsonResponse(
        await accountService.setEmailLicenseRevoked({
          ...payload,
          licenseId: decodeURIComponent(trialRevocationMatch[1]),
        }),
      );
    }
    const grantMatch = pathname.match(/^\/api\/admin\/grants\/([^/]+)$/u);
    if (request.method === "PATCH" && grantMatch) {
      return jsonResponse(
        await accountService.updateEmailLicense({ ...payload, licenseId: decodeURIComponent(grantMatch[1]) }),
      );
    }
    const grantRevocationMatch = pathname.match(/^\/api\/admin\/grants\/([^/]+)\/revocation$/u);
    if (request.method === "PATCH" && grantRevocationMatch) {
      return jsonResponse(
        await accountService.setEmailLicenseRevoked({
          ...payload,
          licenseId: decodeURIComponent(grantRevocationMatch[1]),
        }),
      );
    }
    if (request.method === "PATCH" && pathname === "/api/admin/settings/authorization") {
      return jsonResponse(await accountService.updateSettings(payload));
    }
    if (request.method === "PATCH" && pathname === "/api/admin/licenses/account") {
      return jsonResponse(await accountService.rebindLicense(payload));
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

export { ADMIN_COOKIE_NAME, ADMIN_WORKBENCH_COOKIE_NAME };
