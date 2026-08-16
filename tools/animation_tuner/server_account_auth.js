"use strict";

const defaultCrypto = require("node:crypto");

const COOKIE_NAME = "xsxb_account";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Creates the local email authentication adapter used by the Node development server.
 * @param {{secret?:string,codeHashes?:string[]|string,resendApiKey?:string,emailFrom?:string,cryptoApi?:typeof import("node:crypto"),fetchImpl?:typeof fetch,now?:()=>number,development?:boolean}} [options] Service options.
 * @returns {object} Local account service.
 */
function createLocalAccountAuthService(options = {}) {
  const cryptoApi = options.cryptoApi || defaultCrypto;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const secret = String(options.secret || "");
  const resendApiKey = String(options.resendApiKey || "");
  const emailFrom = String(options.emailFrom || "");
  const development = options.development !== false;
  const codes = new Map();
  const revokedTokens = new Map();
  const sourceHashes = Array.isArray(options.codeHashes)
    ? options.codeHashes
    : String(options.codeHashes || "").split(",");
  const activationHashes = new Set(
    sourceHashes.map((value) => String(value).trim().toLowerCase()).filter(Boolean),
  );
  const configured = secret.length >= 32;

  /** Compares two HMAC strings without leaking an early mismatch position. */
  function signaturesEqual(candidate, expected) {
    const candidateBuffer = Buffer.from(String(candidate || ""));
    const expectedBuffer = Buffer.from(String(expected || ""));
    return (
      candidateBuffer.length === expectedBuffer.length &&
      cryptoApi.timingSafeEqual(candidateBuffer, expectedBuffer)
    );
  }

  /** Removes expired one-time codes and revoked sessions from in-memory state. */
  function pruneExpiredState() {
    const timestamp = now();
    for (const [email, entry] of codes) {
      if (Number(entry?.expiresAt) <= timestamp) codes.delete(email);
    }
    for (const [token, expiresAt] of revokedTokens) {
      if (Number(expiresAt) <= timestamp) revokedTokens.delete(token);
    }
  }

  /** Reads a session expiration from a signed token without validating its signature. */
  function tokenExpiry(token) {
    try {
      const [payload] = String(token || "").split(".");
      const session = JSON.parse(Buffer.from(payload || "", "base64url").toString("utf8"));
      const expiresAt = Number(session?.exp);
      return Number.isFinite(expiresAt) ? expiresAt : 0;
    } catch (_error) {
      return 0;
    }
  }

  /** @param {string} value Value to hash. @returns {string} SHA-256 hex. */
  function sha256(value) {
    return cryptoApi.createHash("sha256").update(value).digest("hex");
  }

  /** @param {string} value Value to sign. @returns {string} HMAC hex. */
  function hmac(value) {
    return cryptoApi.createHmac("sha256", secret).update(value).digest("hex");
  }

  /** @param {unknown} value Raw email. @returns {string} Normalized email. */
  function normalizeEmail(value) {
    const email = String(value || "")
      .trim()
      .toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw Object.assign(new Error("请输入有效的邮箱地址。"), { status: 400 });
    }
    return email;
  }

  /** @param {object} request HTTP request. @returns {string} Account token. */
  function readToken(request) {
    for (const entry of String(request?.headers?.cookie || "").split(";")) {
      const [name, ...parts] = entry.trim().split("=");
      if (name === COOKIE_NAME) return decodeURIComponent(parts.join("="));
    }
    return "";
  }

  /** @param {string} email Email. @param {number} expiresAt Expiry. @returns {string} Signed token. */
  function createToken(email, expiresAt) {
    const payload = Buffer.from(JSON.stringify({ email, exp: expiresAt })).toString("base64url");
    return `${payload}.${hmac(payload)}`;
  }

  /** @param {string} token Token. @returns {{email:string,exp:number}|null} Session. */
  function validateToken(token) {
    pruneExpiredState();
    if (!configured || revokedTokens.has(token)) return null;
    const [payload, signature, ...extra] = String(token || "").split(".");
    if (!payload || !signature || extra.length) return null;
    const expected = hmac(payload);
    if (!signaturesEqual(signature, expected)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return session.email && Number(session.exp) > now() ? session : null;
    } catch (_error) {
      return null;
    }
  }

  /** @param {string} email Recipient. @param {string} code Code. @returns {Promise<void>} */
  async function sendCode(email, code) {
    if (resendApiKey && emailFrom && typeof fetchImpl === "function") {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: emailFrom,
          to: [email],
          subject: "XSXB Frame Tuner 登录验证码",
          text: `你的验证码是 ${code}，10 分钟内有效。`,
        }),
      });
      if (!response.ok) throw Object.assign(new Error("验证码邮件发送失败。"), { status: 502 });
      return;
    }
    if (!development) throw Object.assign(new Error("邮箱发送服务尚未配置。"), { status: 503 });
    console.info(`[XSXB] Local verification code for ${email}: ${code}`);
  }

  return Object.freeze({
    configured,
    async requestCode(value) {
      pruneExpiredState();
      if (!configured) throw Object.assign(new Error("邮箱登录服务尚未配置。"), { status: 503 });
      const email = normalizeEmail(value);
      const code = String(cryptoApi.randomInt(0, 1_000_000)).padStart(6, "0");
      codes.set(email, { hash: hmac(`code:${email}:${code}`), expiresAt: now() + CODE_TTL_MS, attempts: 0 });
      await sendCode(email, code);
      return { sent: true, ...(development && !resendApiKey ? { developmentCode: code } : {}) };
    },
    verifyCode(emailValue, codeValue) {
      pruneExpiredState();
      const email = normalizeEmail(emailValue);
      const entry = codes.get(email);
      const candidate = hmac(`code:${email}:${String(codeValue || "").trim()}`);
      if (!entry || entry.expiresAt <= now() || entry.attempts >= 5 || candidate !== entry.hash) {
        if (entry) entry.attempts += 1;
        throw Object.assign(new Error("验证码无效或已过期。"), { status: 401 });
      }
      codes.delete(email);
      const expiresAt = now() + SESSION_TTL_MS;
      return {
        authenticated: true,
        email,
        proEnabled: true,
        source: "global_default",
        expiresAt: "",
        sessionExpiresAt: new Date(expiresAt).toISOString(),
        token: createToken(email, expiresAt),
      };
    },
    status(request) {
      pruneExpiredState();
      const session = validateToken(readToken(request));
      return session
        ? {
            authenticated: true,
            configured,
            email: session.email,
            accountId: sha256(session.email),
            proEnabled: true,
            source: "global_default",
            sessionExpiresAt: new Date(session.exp).toISOString(),
          }
        : { authenticated: false, configured, proEnabled: false };
    },
    redeem(codeValue, request) {
      const session = this.status(request);
      if (!session.authenticated) throw Object.assign(new Error("请先使用邮箱登录。"), { status: 401 });
      const candidate = sha256(
        String(codeValue || "")
          .trim()
          .toUpperCase(),
      );
      if (!activationHashes.has(candidate)) throw Object.assign(new Error("激活码无效。"), { status: 403 });
      return { ...session, proEnabled: true, source: "activation_code" };
    },
    authorizeExport(features, request) {
      const session = this.status(request);
      if (!session.authenticated || !session.proEnabled) {
        throw Object.assign(new Error("邮箱账户需要有效的 Pro 权限。"), { status: 401 });
      }
      const expiresAt = now() + 60 * 1000;
      const payload = Buffer.from(
        JSON.stringify({
          accountId: session.accountId,
          features: Array.from(features || []).sort(),
          exp: expiresAt,
        }),
      ).toString("base64url");
      return {
        authorized: true,
        permit: `${payload}.${hmac(payload)}`,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },
    verifyExport(permit, features, request) {
      const session = this.status(request);
      const [payload, signature, ...extra] = String(permit || "").split(".");
      if (
        !session.authenticated ||
        !payload ||
        !signature ||
        extra.length ||
        !signaturesEqual(signature, hmac(payload))
      ) {
        throw Object.assign(new Error("导出许可无效或已过期。"), { status: 401 });
      }
      try {
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (
          decoded.accountId !== session.accountId ||
          Number(decoded.exp) <= now() ||
          JSON.stringify(decoded.features) !== JSON.stringify(Array.from(features || []).sort())
        ) {
          throw new Error("invalid");
        }
        return { authorized: true, expiresAt: new Date(decoded.exp).toISOString() };
      } catch (_error) {
        throw Object.assign(new Error("导出许可无效或已过期。"), { status: 401 });
      }
    },
    logout(request) {
      pruneExpiredState();
      const token = readToken(request);
      const expiresAt = tokenExpiry(token);
      if (token && expiresAt > now()) revokedTokens.set(token, expiresAt);
    },
    cookieHeader(token, request = {}) {
      const secure = Boolean(request.socket?.encrypted || request.headers?.["x-forwarded-proto"] === "https");
      return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
    },
    clearCookieHeader() {
      return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`;
    },
  });
}

module.exports = { COOKIE_NAME, createLocalAccountAuthService };
