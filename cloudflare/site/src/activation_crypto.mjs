const textEncoder = new TextEncoder();

/** @param {ArrayBuffer|Uint8Array} value Binary input. @returns {Uint8Array} Byte view. */
function bytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/** @param {ArrayBuffer|Uint8Array} value Binary input. @returns {string} Lowercase hex. */
export function bytesToHex(value) {
  return Array.from(bytes(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {ArrayBuffer|Uint8Array} value Binary input. @returns {string} Base64url text. */
export function bytesToBase64Url(value) {
  let binary = "";
  for (const byte of bytes(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

/** @param {string} value Base64url text. @returns {Uint8Array} Decoded bytes. */
export function base64UrlToBytes(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** @param {string} value Text input. @param {SubtleCrypto} subtle Web Crypto. @returns {Promise<string>} SHA-256 hex. */
export async function sha256Hex(value, subtle) {
  return bytesToHex(await subtle.digest("SHA-256", textEncoder.encode(value)));
}

/**
 * Performs a constant-work comparison for equal-sized byte arrays.
 * @param {Uint8Array} left First bytes.
 * @param {Uint8Array} right Second bytes.
 * @param {SubtleCrypto} subtle Web Crypto.
 * @returns {boolean} Equality result.
 */
export function safeEqual(left, right, subtle) {
  if (left.length !== right.length) return false;
  if (typeof subtle.timingSafeEqual === "function") return subtle.timingSafeEqual(left, right);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

/** @param {string} value Text to sign. @param {string} secret HMAC secret. @param {SubtleCrypto} subtle Web Crypto. @returns {Promise<string>} HMAC hex. */
export async function hmacHex(value, secret, subtle) {
  const key = await subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await subtle.sign("HMAC", key, textEncoder.encode(value)));
}

/** @param {object} payload Token payload. @param {string} secret HMAC secret. @param {SubtleCrypto} subtle Web Crypto. @returns {Promise<string>} Signed token. */
export async function signToken(payload, secret, subtle) {
  const encoded = bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)));
  return `${encoded}.${await hmacHex(encoded, secret, subtle)}`;
}

/** @param {string} token Signed token. @param {string} secret HMAC secret. @param {SubtleCrypto} subtle Web Crypto. @returns {Promise<object|null>} Verified payload. */
export async function verifyToken(token, secret, subtle) {
  const [encoded, signature, ...extra] = String(token || "").split(".");
  if (extra.length || !encoded || !/^[a-f0-9]{64}$/u.test(signature || "")) return null;
  const expected = await hmacHex(encoded, secret, subtle);
  if (!safeEqual(textEncoder.encode(expected), textEncoder.encode(signature), subtle)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch (_error) {
    return null;
  }
}

/** @param {JsonWebKey} publicKeyJwk P-256 public key. @returns {{jwk:JsonWebKey,canonical:string}} Validated canonical key. */
export function canonicalPublicKey(publicKeyJwk) {
  const source = publicKeyJwk && typeof publicKeyJwk === "object" ? publicKeyJwk : {};
  if (
    source.kty !== "EC" ||
    source.crv !== "P-256" ||
    typeof source.x !== "string" ||
    typeof source.y !== "string" ||
    source.d
  ) {
    throw Object.assign(new Error("A valid P-256 public key is required."), { status: 400 });
  }
  const jwk = { kty: "EC", crv: "P-256", x: source.x, y: source.y, ext: true, key_ops: ["verify"] };
  return { jwk, canonical: JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }) };
}

/** @param {string} challenge Signed challenge token. @param {string} signature Base64url signature. @param {JsonWebKey} publicKeyJwk Device public key. @param {SubtleCrypto} subtle Web Crypto. @returns {Promise<boolean>} Signature validity. */
export async function verifyDeviceSignature(challenge, signature, publicKeyJwk, subtle) {
  try {
    const key = await subtle.importKey("jwk", publicKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
    return subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      base64UrlToBytes(signature),
      textEncoder.encode(challenge),
    );
  } catch (_error) {
    return false;
  }
}
