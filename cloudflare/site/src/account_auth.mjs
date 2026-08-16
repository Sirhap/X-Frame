import { bytesToBase64Url, hmacHex, safeEqual, sha256Hex, verifyToken } from "./activation_crypto.mjs";
import { createAccountRepository } from "./account_repository.mjs";
import { createEmailSender } from "./email_sender.mjs";
import { resolveLicenseExpiry } from "./license_duration.mjs";
import { hashPassword, verifyPassword } from "./password_crypto.mjs";
import { createAdminService } from "./admin.mjs";

const COOKIE_NAME = "xsxb_account";
const ADMIN_WORKBENCH_COOKIE_NAME = "xsxb_admin_workbench";
const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_EMAIL_SENDS_PER_HOUR = 5;
const MAX_IP_SENDS_PER_HOUR = 20;
const MAX_CODE_ATTEMPTS = 5;
const MIN_RESEND_INTERVAL_MS = 60 * 1000;
const MAX_REQUEST_BYTES = 4096;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** @param {unknown} value Raw email. @returns {string} Normalized email. */
export function normalizeEmail(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw Object.assign(new Error("请输入有效的邮箱地址。"), { status: 400 });
  }
  return email;
}

/** @param {Request} request Incoming request. @returns {string} Cookie token. */
function readCookieToken(request, cookieName = COOKIE_NAME) {
  for (const entry of String(request.headers.get("cookie") || "").split(";")) {
    const [name, ...parts] = entry.trim().split("=");
    if (name !== cookieName) continue;
    try {
      return decodeURIComponent(parts.join("="));
    } catch (_error) {
      return "";
    }
  }
  return "";
}

/** @param {Request} request Incoming request. @returns {void} */
function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  const fetchSite = String(request.headers.get("sec-fetch-site") || "");
  if ((origin && origin !== new URL(request.url).origin) || ["cross-site", "same-site"].includes(fetchSite)) {
    throw Object.assign(new Error("不允许跨站账户请求。"), { status: 403 });
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
    throw Object.assign(new Error("账户请求过大。"), { status: 413 });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw Object.assign(new Error("账户请求过大。"), { status: 413 });
  }
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid");
    return payload;
  } catch (_error) {
    throw Object.assign(new Error("账户请求 JSON 无效。"), { status: 400 });
  }
}

/**
 * Computes effective Pro access from account overrides, licenses, and the global default.
 * @param {object} account Account row.
 * @param {object[]} licenses Bound code licenses.
 * @param {boolean} defaultEnabled Global default.
 * @param {number} now Current epoch.
 * @returns {{proEnabled:boolean,source:string,expiresAt:string}}
 */
export function resolveAccountEntitlement(account, licenses, defaultEnabled, now) {
  if (
    !account ||
    account.status === "suspended" ||
    account.status === "deleted" ||
    account.revoked_at ||
    account.pro_override === "disabled"
  ) {
    return { proEnabled: false, source: "account_disabled", expiresAt: "" };
  }
  const overrideExpiry = Date.parse(account.pro_expires_at || "");
  if (account.pro_override === "enabled" && (!account.pro_expires_at || overrideExpiry > now)) {
    return { proEnabled: true, source: "account_override", expiresAt: account.pro_expires_at || "" };
  }
  const activeLicenses = (Array.isArray(licenses) ? licenses : []).filter((license) => {
    const expiry = Date.parse(license.expires_at || "");
    return !license.revoked_at && Number.isFinite(expiry) && expiry > now;
  });
  if (activeLicenses.length) {
    activeLicenses.sort((left, right) => Date.parse(right.expires_at) - Date.parse(left.expires_at));
    return { proEnabled: true, source: "activation_code", expiresAt: activeLicenses[0].expires_at };
  }
  return { proEnabled: Boolean(defaultEnabled), source: "global_default", expiresAt: "" };
}

/**
 * Creates email authentication and account entitlement operations.
 * @param {{LICENSE_DB?:D1Database,XSXB_ACTIVATION_SECRET?:string}} env Worker environment.
 * @param {{cryptoApi?:Crypto,now?:()=>number,repository?:object,emailSender?:object}} [options] Adapters.
 * @returns {object} Account service.
 */
export function createAccountAuthService(env, options = {}) {
  const cryptoApi = options.cryptoApi || globalThis.crypto;
  const now = options.now || Date.now;
  const secret = String(env?.XSXB_ACTIVATION_SECRET || "");
  const repository = options.repository || (env?.LICENSE_DB ? createAccountRepository(env.LICENSE_DB) : null);
  const emailSender = options.emailSender || createEmailSender(env);
  const adminUsername = String(env?.XSXB_ADMIN_USERNAME || "admin");
  const configured = Boolean(repository && secret.length >= 32);

  /** @param {string} value Value to HMAC. @returns {Promise<string>} Digest. */
  function keyedHash(value) {
    return hmacHex(value, secret, cryptoApi.subtle);
  }

  /** @param {Request} request Request. @returns {Promise<string>} Hashed client IP. */
  async function requestIpHash(request) {
    const ip = String(request.headers.get("cf-connecting-ip") || "").trim();
    return ip ? keyedHash(`account-ip:${ip}`) : "";
  }

  /** @param {object} account Account row. @returns {Promise<object>} Public session. */
  async function serializeAccount(account) {
    const licenses = await repository.listAccountLicenses(account.id);
    const defaultEnabled = await repository.defaultProEnabled();
    const entitlement = resolveAccountEntitlement(account, licenses, defaultEnabled, now());
    return {
      authenticated: true,
      accountId: account.id,
      email: account.email,
      ...entitlement,
    };
  }

  /** @param {object|null} account Account record. @returns {void} */
  function assertAccountCanAuthenticate(account) {
    if (account?.status === "suspended") {
      throw Object.assign(new Error("该账户已被暂停，请联系支持人员。"), { status: 403 });
    }
    if (account?.status === "deleted") {
      throw Object.assign(new Error("该账户已被删除，无法登录。"), { status: 403 });
    }
  }

  /** @param {object} account Newly verified active account. @returns {Promise<void>} */
  async function claimPendingGrants(account) {
    if (typeof repository.claimPendingGrantsForAccount === "function") {
      await repository.claimPendingGrantsForAccount(account.id, account.email);
    }
  }

  return {
    configured,

    /** Starts password authentication and returns only the server-selected second factor. */
    async startPasswordLogin(identifierValue, passwordValue, request) {
      if (!configured || !emailSender.configured) {
        throw Object.assign(new Error("邮箱登录服务尚未配置。"), { status: 503 });
      }
      const email = normalizeEmail(identifierValue);
      const password = String(passwordValue || "");
      const account = await repository.findAccountByEmail(email);
      assertAccountCanAuthenticate(account);
      let passwordRecord;
      if (account?.password_hash) {
        if (!(await verifyPassword(password, account, cryptoApi))) {
          throw Object.assign(new Error("账号或密码错误。"), { status: 401 });
        }
      } else {
        passwordRecord = await hashPassword(password, cryptoApi);
      }
      const currentTime = now();
      const token = bytesToBase64Url(cryptoApi.getRandomValues(new Uint8Array(32)));
      const code = String(cryptoApi.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      const kind = account?.password_hash
        ? "email_login"
        : account
          ? "email_password_setup"
          : "email_registration";
      await repository.createAuthChallenge({
        id: cryptoApi.randomUUID(),
        tokenHash: await sha256Hex(token, cryptoApi.subtle),
        kind,
        email,
        accountId: account?.id,
        passwordHash: passwordRecord?.hash,
        passwordSalt: passwordRecord?.salt,
        passwordIterations: passwordRecord?.iterations,
        codeHash: await keyedHash(`auth-code:${token}:${code}`),
        ipHash: await requestIpHash(request),
        createdAt: new Date(currentTime).toISOString(),
        expiresAt: new Date(currentTime + CODE_TTL_MS).toISOString(),
      });
      try {
        await emailSender.sendVerificationCode(email, code);
      } catch (error) {
        console.error(
          JSON.stringify({ event: "password_challenge_delivery_failed", message: error.message }),
        );
        throw Object.assign(new Error("验证码邮件暂时无法发送，请稍后重试。"), { status: 502 });
      }
      return {
        challengeToken: token,
        challengeType: "email_code",
        registration: !account,
        passwordSetup: Boolean(account && !account.password_hash),
        expiresInSeconds: 600,
      };
    },

    /** Completes a server-issued email challenge and creates a seven-day session. */
    async verifyPasswordChallenge(tokenValue, codeValue) {
      if (!configured) throw Object.assign(new Error("邮箱登录服务尚未配置。"), { status: 503 });
      const token = String(tokenValue || "");
      const code = String(codeValue || "").replace(/\D/gu, "");
      const entry = token
        ? await repository.findAuthChallenge(await sha256Hex(token, cryptoApi.subtle))
        : null;
      const currentTime = now();
      if (
        !entry ||
        entry.consumed_at ||
        Number(entry.attempts) >= MAX_CODE_ATTEMPTS ||
        Date.parse(entry.expires_at) <= currentTime ||
        code.length !== 6
      ) {
        throw Object.assign(new Error("验证码无效或已过期。"), { status: 401 });
      }
      const expected = await keyedHash(`auth-code:${token}:${code}`);
      if (
        !(await safeEqual(
          new TextEncoder().encode(expected),
          new TextEncoder().encode(entry.code_hash),
          cryptoApi.subtle,
        ))
      ) {
        await repository.recordAuthChallengeAttempt(entry.id, Number(entry.attempts || 0) + 1);
        throw Object.assign(new Error("验证码无效或已过期。"), { status: 401 });
      }
      const verifiedAt = new Date(currentTime).toISOString();
      const consumed = await repository.consumeAuthChallenge(entry.id, verifiedAt);
      if (Number(consumed?.meta?.changes ?? 1) !== 1)
        throw Object.assign(new Error("验证码无效或已过期。"), { status: 401 });
      if (entry.kind === "email_registration") {
        await repository.createPasswordAccount({
          id: cryptoApi.randomUUID(),
          email: entry.email,
          passwordHash: entry.password_hash,
          passwordSalt: entry.password_salt,
          passwordIterations: entry.password_iterations,
          verifiedAt,
        });
      } else if (entry.kind === "email_password_setup") {
        const updated = await repository.setAccountPassword({
          id: entry.account_id,
          passwordHash: entry.password_hash,
          passwordSalt: entry.password_salt,
          passwordIterations: entry.password_iterations,
          verifiedAt,
        });
        if (Number(updated?.meta?.changes ?? 1) !== 1) {
          throw Object.assign(new Error("账户密码已设置，请重新登录。"), { status: 409 });
        }
      }
      const account = await repository.findAccountByEmail(entry.email);
      assertAccountCanAuthenticate(account);
      await claimPendingGrants(account);
      const sessionToken = bytesToBase64Url(cryptoApi.getRandomValues(new Uint8Array(32)));
      const expiresAt = new Date(currentTime + SESSION_TTL_MS).toISOString();
      await repository.createSession({
        id: cryptoApi.randomUUID(),
        accountId: account.id,
        tokenHash: await sha256Hex(sessionToken, cryptoApi.subtle),
        createdAt: verifiedAt,
        expiresAt,
      });
      return { ...(await serializeAccount(account)), token: sessionToken, sessionExpiresAt: expiresAt };
    },

    /** @param {unknown} value Raw email. @param {Request} request Request. @returns {Promise<object>} Generic result. */
    async requestCode(value, request) {
      if (!configured || !emailSender.configured) {
        throw Object.assign(new Error("邮箱登录服务尚未配置。"), { status: 503 });
      }
      const email = normalizeEmail(value);
      assertAccountCanAuthenticate(await repository.findAccountByEmail(email));
      const currentTime = now();
      const latest = await repository.findLatestVerificationCode(email);
      if (latest && currentTime - Date.parse(latest.created_at) < MIN_RESEND_INTERVAL_MS) {
        return { sent: true, retryAfterSeconds: 60 };
      }
      const since = new Date(currentTime - HOUR_MS).toISOString();
      const ipHash = await requestIpHash(request);
      const [emailCount, ipCount] = await Promise.all([
        repository.countRecentCodesForEmail(email, since),
        repository.countRecentCodesForIp(ipHash, since),
      ]);
      if (emailCount >= MAX_EMAIL_SENDS_PER_HOUR || ipCount >= MAX_IP_SENDS_PER_HOUR) {
        return { sent: true, retryAfterSeconds: 3600 };
      }
      const code = String(cryptoApi.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      const createdAt = new Date(currentTime).toISOString();
      await repository.createVerificationCode({
        id: cryptoApi.randomUUID(),
        email,
        codeHash: await keyedHash(`email-code:${email}:${code}`),
        ipHash,
        createdAt,
        expiresAt: new Date(currentTime + CODE_TTL_MS).toISOString(),
      });
      try {
        await emailSender.sendVerificationCode(email, code);
      } catch (error) {
        console.error(
          JSON.stringify({ event: "email_verification_delivery_failed", message: error.message }),
        );
        throw Object.assign(new Error("验证码邮件暂时无法发送，请稍后重试。"), { status: 502 });
      }
      return { sent: true, retryAfterSeconds: 60 };
    },

    /** @param {unknown} emailValue Email. @param {unknown} codeValue Code. @returns {Promise<object>} Login result. */
    async verifyCode(emailValue, codeValue) {
      if (!configured) throw Object.assign(new Error("邮箱登录服务尚未配置。"), { status: 503 });
      const email = normalizeEmail(emailValue);
      const code = String(codeValue || "").trim();
      if (!/^\d{6}$/u.test(code)) throw Object.assign(new Error("验证码无效或已过期。"), { status: 401 });
      const entry = await repository.findLatestVerificationCode(email);
      const currentTime = now();
      if (
        !entry ||
        entry.consumed_at ||
        Number(entry.attempts || 0) >= MAX_CODE_ATTEMPTS ||
        Date.parse(entry.expires_at) <= currentTime
      ) {
        throw Object.assign(new Error("验证码无效或已过期。"), { status: 401 });
      }
      const expected = await keyedHash(`email-code:${email}:${code}`);
      const valid = await safeEqual(
        new TextEncoder().encode(expected),
        new TextEncoder().encode(entry.code_hash),
        cryptoApi.subtle,
      );
      if (!valid) {
        await repository.recordVerificationAttempt(entry.id, Number(entry.attempts || 0) + 1);
        throw Object.assign(new Error("验证码无效或已过期。"), { status: 401 });
      }
      const verifiedAt = new Date(currentTime).toISOString();
      const consumed = await repository.consumeVerificationCode(entry.id, verifiedAt);
      if (Number(consumed?.meta?.changes ?? 1) !== 1) {
        throw Object.assign(new Error("验证码无效或已过期。"), { status: 401 });
      }
      const accountId = cryptoApi.randomUUID();
      await repository.createAccount({ id: accountId, email, verifiedAt });
      const account = await repository.findAccountByEmail(email);
      assertAccountCanAuthenticate(account);
      await claimPendingGrants(account);
      const token = bytesToBase64Url(cryptoApi.getRandomValues(new Uint8Array(32)));
      const expiresAt = new Date(currentTime + SESSION_TTL_MS).toISOString();
      await repository.createSession({
        id: cryptoApi.randomUUID(),
        accountId: account.id,
        tokenHash: await sha256Hex(token, cryptoApi.subtle),
        createdAt: verifiedAt,
        expiresAt,
      });
      return { ...(await serializeAccount(account)), token, sessionExpiresAt: expiresAt };
    },

    /** @param {Request} request Request. @returns {Promise<object>} Session status. */
    async status(request) {
      if (!configured) return { authenticated: false, configured: false };
      const adminToken = readCookieToken(request, ADMIN_WORKBENCH_COOKIE_NAME);
      if (adminToken) {
        const adminSession = await verifyToken(adminToken, secret, cryptoApi.subtle);
        if (
          adminSession?.type === "admin-session" &&
          adminSession.username === adminUsername &&
          Number(adminSession.exp || 0) > now()
        ) {
          return {
            authenticated: true,
            configured: true,
            accountId: `administrator:${adminUsername}`,
            identityLabel: `管理员 ${adminUsername}`,
            administrator: true,
            proEnabled: true,
            source: "administrator",
            expiresAt: "",
            sessionExpiresAt: new Date(Number(adminSession.exp)).toISOString(),
          };
        }
      }
      const token = readCookieToken(request);
      if (!token) return { authenticated: false, configured: true };
      const tokenHash = await sha256Hex(token, cryptoApi.subtle);
      const session = await repository.findSessionByTokenHash(tokenHash);
      if (
        !session ||
        session.session_revoked_at ||
        session.status === "suspended" ||
        session.status === "deleted" ||
        session.revoked_at ||
        Date.parse(session.session_expires_at) <= now()
      ) {
        return { authenticated: false, configured: true };
      }
      await repository.touchSession(tokenHash, new Date(now()).toISOString());
      return { ...(await serializeAccount(session)), sessionExpiresAt: session.session_expires_at };
    },

    /** @param {Request} request Request. @returns {Promise<void>} Revokes current session. */
    async logout(request) {
      if (readCookieToken(request, ADMIN_WORKBENCH_COOKIE_NAME)) {
        return { administrator: true };
      }
      const token = readCookieToken(request);
      if (configured && token) {
        await repository.revokeSession(
          await sha256Hex(token, cryptoApi.subtle),
          new Date(now()).toISOString(),
        );
      }
      return { administrator: false };
    },

    /** @param {string} token Session token. @param {Request} request Request. @returns {string} Cookie header. */
    cookieHeader(token, request) {
      const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
      return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
    },

    /** @param {Request} request Request. @returns {string} Expired cookie header. */
    clearCookieHeader(request) {
      const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
      return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
    },

    /** @param {Request} request Request. @returns {string} Expired administrator workbench cookie. */
    clearAdminWorkbenchCookieHeader(request) {
      const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
      return `${ADMIN_WORKBENCH_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
    },

    /** @param {unknown} codeValue Activation code. @param {Request} request Request. @returns {Promise<object>} Entitlement. */
    async redeem(codeValue, request) {
      const session = await this.status(request);
      if (!session.authenticated) throw Object.assign(new Error("请先使用邮箱登录。"), { status: 401 });
      if (session.administrator) return session;
      const code = String(codeValue || "").trim();
      if (!code || code.length > 512) throw Object.assign(new Error("激活码无效。"), { status: 400 });
      const codeHash = await sha256Hex(code.toUpperCase(), cryptoApi.subtle);
      const license = await repository.findLicenseByCodeHash(codeHash);
      const currentTime = now();
      if (
        !license ||
        license.revoked_at ||
        (license.redeem_by && Date.parse(license.redeem_by) <= currentTime)
      ) {
        throw Object.assign(new Error("激活码无效、已撤销或已过兑换期。"), { status: 403 });
      }
      if (license.account_id && license.account_id !== session.accountId) {
        throw Object.assign(new Error("该激活码已绑定其他邮箱。"), { status: 409 });
      }
      const activatedAt = license.first_activated_at || new Date(currentTime).toISOString();
      const expiresAt =
        license.expires_at || resolveLicenseExpiry(currentTime, Number(license.duration_days), false);
      const result = await repository.bindLicenseToAccount({
        licenseId: license.id,
        accountId: session.accountId,
        activatedAt,
        expiresAt,
      });
      if (Number(result?.meta?.changes ?? 1) !== 1) {
        throw Object.assign(new Error("激活码绑定失败，请刷新后重试。"), { status: 409 });
      }
      const account = await repository.findAccountById(session.accountId);
      return serializeAccount(account);
    },

    /** @param {Request} request Request. @returns {Promise<object>} Account after claiming its one email trial. */
    async claimTrial(request) {
      const session = await this.status(request);
      if (!session.authenticated || session.administrator) {
        throw Object.assign(new Error("请先使用邮箱登录。"), { status: 401 });
      }
      const existing = await repository.findEmailTrialByAccountId(session.accountId);
      if (existing) throw Object.assign(new Error("该邮箱已经领取过试用。"), { status: 409 });
      const currentTime = now();
      const activatedAt = new Date(currentTime).toISOString();
      try {
        await repository.createEmailTrial({
          id: cryptoApi.randomUUID(),
          accountId: session.accountId,
          createdAt: activatedAt,
          expiresAt: resolveLicenseExpiry(currentTime, 3, false),
        });
      } catch (error) {
        if (String(error?.message || error).includes("UNIQUE constraint failed")) {
          throw Object.assign(new Error("该邮箱已经领取过试用。"), { status: 409 });
        }
        throw error;
      }
      const account = await repository.findAccountById(session.accountId);
      return serializeAccount(account);
    },
  };
}

/** @param {object} payload JSON payload. @param {number} [status] HTTP status. @returns {Response} JSON response. */
function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * Handles public account and entitlement routes.
 * @param {Request} request Incoming request.
 * @param {object} env Worker environment.
 * @param {{service?:object}} [options] Test adapters.
 * @returns {Promise<Response>} API response.
 */
export async function handleAccountAuthRequest(request, env, options = {}) {
  const pathname = new URL(request.url).pathname;
  const service = options.service || createAccountAuthService(env);
  const adminService = options.adminService || createAdminService(env);
  try {
    assertSameOrigin(request);
    if (pathname === "/api/auth/session" && request.method === "GET") {
      return jsonResponse(await service.status(request));
    }
    if (pathname === "/api/auth/password/start" && request.method === "POST") {
      const payload = await readJsonObject(request);
      const identifier = String(payload.identifier || "").trim();
      if (identifier && identifier === String(env?.XSXB_ADMIN_USERNAME || "admin")) {
        return jsonResponse(
          await adminService.startLogin({ username: identifier, password: payload.password }, request),
        );
      }
      return jsonResponse(await service.startPasswordLogin(payload.identifier, payload.password, request));
    }
    if (pathname === "/api/auth/challenge/verify" && request.method === "POST") {
      const payload = await readJsonObject(request);
      if (payload.challengeType === "admin_totp") {
        const result = await adminService.login(
          { challengeToken: payload.challengeToken, code: payload.code },
          request,
        );
        const response = jsonResponse({
          authenticated: true,
          administrator: true,
          identityLabel: `管理员 ${result.username}`,
          proEnabled: true,
          source: "administrator",
          expiresAt: "",
          sessionExpiresAt: result.expiresAt,
        });
        response.headers.append("Set-Cookie", adminService.cookieHeader(result.token, request));
        response.headers.append("Set-Cookie", adminService.workbenchCookieHeader(result.token, request));
        return response;
      }
      const result = await service.verifyPasswordChallenge(payload.challengeToken, payload.code);
      const { token, ...body } = result;
      const response = jsonResponse(body);
      response.headers.append("Set-Cookie", service.cookieHeader(token, request));
      return response;
    }
    if (pathname === "/api/auth/logout" && request.method === "POST") {
      const logout = await service.logout(request);
      const response = jsonResponse({ authenticated: false });
      response.headers.append(
        "Set-Cookie",
        logout?.administrator
          ? service.clearAdminWorkbenchCookieHeader(request)
          : service.clearCookieHeader(request),
      );
      return response;
    }
    if (pathname === "/api/entitlements/current" && request.method === "GET") {
      return jsonResponse(await service.status(request));
    }
    if (pathname === "/api/entitlements/redeem" && request.method === "POST") {
      const payload = await readJsonObject(request);
      return jsonResponse(await service.redeem(payload.code, request));
    }
    if (pathname === "/api/entitlements/trial" && request.method === "POST") {
      await readJsonObject(request);
      return jsonResponse(await service.claimTrial(request));
    }
    return jsonResponse({ error: "Not Found" }, 404);
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500)
      console.error(JSON.stringify({ event: "account_auth_failed", pathname, message: error.message }));
    return jsonResponse({ error: status >= 500 ? "账户服务暂时不可用。" : error.message }, status);
  }
}
