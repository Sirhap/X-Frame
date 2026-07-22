"use strict";

const defaultCrypto = require("node:crypto");

const COOKIE_NAME = "xsxb_activation";
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Creates a signed-cookie activation service backed by configured code hashes.
 * @param {{codeHashes?:string[]|string,secret?:string,cryptoApi?:typeof import("node:crypto"),now?:()=>number,ttlSeconds?:number}} [options] Service options.
 * @returns {{activate:(code:string)=>object,cookieHeader:(token:string,request?:object)=>string,status:(request:object)=>object,isActivated:(request:object)=>boolean}}
 */
function createActivationService(options = {}) {
  const cryptoApi = options.cryptoApi || defaultCrypto;
  const now = options.now || Date.now;
  const ttlSeconds = Math.max(60, Number(options.ttlSeconds || DEFAULT_TTL_SECONDS));
  const secret = String(options.secret || "");
  const sourceHashes = Array.isArray(options.codeHashes)
    ? options.codeHashes
    : String(options.codeHashes || "").split(",");
  const codeHashes = sourceHashes
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .filter((value) => /^[a-f0-9]{64}$/.test(value));
  const configured = codeHashes.length > 0 && secret.length >= 32;

  /** @param {string} value Value to hash. @returns {string} Hex SHA-256. */
  function sha256(value) {
    return cryptoApi.createHash("sha256").update(value).digest("hex");
  }

  /** @param {string} value Activation code. @returns {string} Normalized code. */
  function normalizeCode(value) {
    return String(value || "")
      .trim()
      .toUpperCase();
  }

  /** @param {string} left First hex value. @param {string} right Second hex value. @returns {boolean} */
  function safeEqual(left, right) {
    if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
    return cryptoApi.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  }

  /** @param {number} expiresAt Expiry epoch milliseconds. @returns {string} Signed token. */
  function createToken(expiresAt) {
    const payload = String(expiresAt);
    const signature = cryptoApi.createHmac("sha256", secret).update(payload).digest("hex");
    return `${payload}.${signature}`;
  }

  /** @param {object} request HTTP request. @returns {string} Cookie token. */
  function readToken(request) {
    const cookies = String(request?.headers?.cookie || "").split(";");
    for (const entry of cookies) {
      const [name, ...parts] = entry.trim().split("=");
      if (name === COOKIE_NAME) return decodeURIComponent(parts.join("="));
    }
    return "";
  }

  /** @param {string} token Signed token. @returns {number} Valid expiry or zero. */
  function validateToken(token) {
    if (!configured) return 0;
    const [payload, signature, ...extra] = String(token || "").split(".");
    if (extra.length || !/^\d{10,16}$/.test(payload || "") || !signature) return 0;
    const expected = cryptoApi.createHmac("sha256", secret).update(payload).digest("hex");
    if (!safeEqual(expected, signature)) return 0;
    const expiresAt = Number(payload);
    return Number.isSafeInteger(expiresAt) && expiresAt > now() ? expiresAt : 0;
  }

  /** @param {object} request HTTP request. @returns {object} Public activation status. */
  function status(request) {
    const expiresAt = validateToken(readToken(request));
    return {
      activated: expiresAt > 0,
      configured,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
    };
  }

  /** @param {string} code User-entered activation code. @returns {object} Activation result. */
  function activate(code) {
    if (!configured) {
      return { ok: false, status: 503, error: "Activation verification is not configured." };
    }
    const normalized = normalizeCode(code);
    if (!normalized || normalized.length > 160) {
      return { ok: false, status: 401, error: "Invalid activation code." };
    }
    const candidate = sha256(normalized);
    if (!codeHashes.some((hash) => safeEqual(hash, candidate))) {
      return { ok: false, status: 401, error: "Invalid activation code." };
    }
    const expiresAt = now() + ttlSeconds * 1000;
    return {
      ok: true,
      status: 200,
      activated: true,
      expiresAt: new Date(expiresAt).toISOString(),
      token: createToken(expiresAt),
    };
  }

  /** @param {string} token Signed token. @param {object} request HTTP request. @returns {string} */
  function cookieHeader(token, request = {}) {
    const forwardedProtocol = String(request.headers?.["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim();
    const secure = Boolean(request.socket?.encrypted || forwardedProtocol === "https");
    return [
      `${COOKIE_NAME}=${encodeURIComponent(token)}`,
      "Path=/",
      `Max-Age=${Math.floor(ttlSeconds)}`,
      "HttpOnly",
      "SameSite=Strict",
      secure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  return Object.freeze({
    activate,
    cookieHeader,
    isActivated: (request) => status(request).activated,
    status,
  });
}

module.exports = { COOKIE_NAME, createActivationService };
