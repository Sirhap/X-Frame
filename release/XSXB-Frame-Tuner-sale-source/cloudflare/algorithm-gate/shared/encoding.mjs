const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Encodes bytes using unpadded base64url.
 * @param {Uint8Array} bytes Binary value to encode.
 * @returns {string} Encoded value.
 */
export function encodeBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/**
 * Decodes an unpadded base64url value.
 * @param {string} value Encoded value.
 * @returns {Uint8Array} Decoded bytes.
 */
export function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new TypeError("Invalid base64url value.");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) throw new TypeError("Non-canonical base64url value.");
  return bytes;
}

/**
 * Encodes UTF-8 text.
 * @param {string} value Text value.
 * @returns {Uint8Array} UTF-8 bytes.
 */
export function encodeText(value) {
  return textEncoder.encode(value);
}

/**
 * Decodes UTF-8 bytes and rejects malformed input.
 * @param {Uint8Array} value UTF-8 bytes.
 * @returns {string} Text value.
 */
export function decodeText(value) {
  return textDecoder.decode(value);
}
