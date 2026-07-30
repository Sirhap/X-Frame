import { decodeBase64Url, decodeText, encodeBase64Url, encodeText } from "./encoding.mjs";

const SESSION_ALGORITHM = Object.freeze({ name: "HMAC", hash: "SHA-256" });

/**
 * Imports a session signing key from a Worker secret binding.
 * @param {string} secret High-entropy secret value.
 * @param {KeyUsage[]} usages Permitted key operations.
 * @returns {Promise<CryptoKey>} Imported HMAC key.
 */
async function importSigningKey(secret, usages) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new TypeError("Session signing key is unavailable.");
  }
  return crypto.subtle.importKey("raw", encodeText(secret), SESSION_ALGORITHM, false, usages);
}

/**
 * Signs a short-lived artifact session.
 * @param {Record<string, unknown>} claims Validated session claims.
 * @param {string} secret HMAC signing secret.
 * @returns {Promise<string>} Compact signed session.
 */
export async function signSession(claims, secret) {
  const payload = encodeBase64Url(encodeText(JSON.stringify(claims)));
  const key = await importSigningKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign(SESSION_ALGORITHM.name, key, encodeText(payload));
  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verifies a signed session and its time/audience invariants.
 * @param {string} token Compact signed session.
 * @param {string} secret HMAC signing secret.
 * @param {{ audience: string, nowSeconds?: number }} options Verification options.
 * @returns {Promise<Record<string, unknown> | null>} Valid claims, or null.
 */
export async function verifySession(token, secret, options) {
  try {
    if (typeof token !== "string" || token.length > 4096) return null;
    const segments = token.split(".");
    if (segments.length !== 2) return null;
    const [payload, encodedSignature] = segments;
    const signature = decodeBase64Url(encodedSignature);
    if (signature.byteLength !== 32) return null;
    const key = await importSigningKey(secret, ["verify"]);
    const verified = await crypto.subtle.verify(SESSION_ALGORITHM.name, key, signature, encodeText(payload));
    if (!verified) return null;

    const claims = JSON.parse(decodeText(decodeBase64Url(payload)));
    const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (
      !claims ||
      typeof claims !== "object" ||
      claims.aud !== options.audience ||
      !Number.isSafeInteger(claims.exp) ||
      !Number.isSafeInteger(claims.iat) ||
      typeof claims.jti !== "string" ||
      typeof claims.origin !== "string" ||
      typeof claims.version !== "string" ||
      claims.iat > nowSeconds + 30 ||
      claims.exp <= nowSeconds ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 900
    ) {
      return null;
    }
    return claims;
  } catch (_error) {
    return null;
  }
}

/**
 * Extracts a Bearer token without accepting alternate schemes.
 * @param {Request} request Incoming request.
 * @returns {string | null} Bearer value.
 */
export function readBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (authorization.length > 4103) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(authorization);
  return match?.[1] || null;
}
