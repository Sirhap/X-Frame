import { base64UrlToBytes, bytesToBase64Url } from "./activation_crypto.mjs";

const CIPHERTEXT_VERSION = "v1";
const IV_BYTES = 12;
const textEncoder = new TextEncoder();

/**
 * Derives an AES-GCM key scoped only to administrator activation-code display.
 * @param {string} rootSecret Existing Worker root secret.
 * @param {SubtleCrypto} subtle Web Crypto API.
 * @returns {Promise<CryptoKey>} Non-extractable AES key.
 */
async function deriveDisplayKey(rootSecret, subtle) {
  const keyMaterial = await subtle.digest(
    "SHA-256",
    textEncoder.encode(`xsxb-admin-license-display:${CIPHERTEXT_VERSION}:${rootSecret}`),
  );
  return subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypts an activation code and binds it to its immutable SHA-256 hash.
 * @param {string} code Normalized activation code.
 * @param {string} codeHash Activation-code hash.
 * @param {string} rootSecret Worker root secret.
 * @param {Crypto} cryptoApi Web Crypto API.
 * @returns {Promise<string>} Versioned authenticated ciphertext.
 */
export async function encryptActivationCode(code, codeHash, rootSecret, cryptoApi) {
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: textEncoder.encode(codeHash) },
    await deriveDisplayKey(rootSecret, cryptoApi.subtle),
    textEncoder.encode(code),
  );
  return `${CIPHERTEXT_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
}

/**
 * Decrypts a stored activation code. Invalid or legacy values safely return an empty string.
 * @param {unknown} value Stored ciphertext.
 * @param {string} codeHash Activation-code hash.
 * @param {string} rootSecret Worker root secret.
 * @param {SubtleCrypto} subtle Web Crypto API.
 * @returns {Promise<string>} Normalized activation code, or empty for unavailable plaintext.
 */
export async function decryptActivationCode(value, codeHash, rootSecret, subtle) {
  const [version, encodedIv, encodedCiphertext, ...extra] = String(value || "").split(".");
  if (version !== CIPHERTEXT_VERSION || !encodedIv || !encodedCiphertext || extra.length) return "";
  try {
    const iv = base64UrlToBytes(encodedIv);
    if (iv.byteLength !== IV_BYTES) return "";
    const plaintext = await subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: textEncoder.encode(codeHash) },
      await deriveDisplayKey(rootSecret, subtle),
      base64UrlToBytes(encodedCiphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch (_error) {
    return "";
  }
}
