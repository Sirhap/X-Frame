import { encodeBase64Url, encodeText } from "./encoding.mjs";

const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

/**
 * Parses a comma-separated policy set.
 * @param {string | undefined} value Configuration value.
 * @returns {ReadonlySet<string>} Parsed values.
 */
export function parsePolicySet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/**
 * Validates an externally supplied artifact version.
 * @param {unknown} version Candidate version.
 * @param {string | undefined} activeVersions Allowed versions.
 * @returns {version is string} Whether the version is valid and active.
 */
export function isActiveVersion(version, activeVersions) {
  return (
    typeof version === "string" &&
    VERSION_PATTERN.test(version) &&
    parsePolicySet(activeVersions).has(version)
  );
}

/**
 * Checks static and dynamic version revocation.
 * @param {string} version Artifact version.
 * @param {{ get(key: string): Promise<string | null> } | undefined} stateStore Gate state KV binding.
 * @param {string | undefined} revokedVersions Static revoked versions.
 * @returns {Promise<boolean>} Whether the version is revoked.
 */
export async function isVersionRevoked(version, stateStore, revokedVersions) {
  if (parsePolicySet(revokedVersions).has(version)) return true;
  if (!stateStore) return false;
  return (await stateStore.get(`revoked:version:${version}`)) === "1";
}

/**
 * Checks whether a signed session has been explicitly revoked.
 * @param {string} sessionId Signed session identifier.
 * @param {{ get(key: string): Promise<string | null> } | undefined} stateStore Gate state KV binding.
 * @returns {Promise<boolean>} Whether the session is revoked.
 */
export async function isSessionRevoked(sessionId, stateStore) {
  if (!stateStore) return false;
  return (await stateStore.get(`revoked:session:${sessionId}`)) === "1";
}

/**
 * Hashes a credential before using it as a KV key.
 * @param {string} credential Opaque entitlement credential.
 * @returns {Promise<string>} Non-secret key suffix.
 */
export async function hashCredential(credential) {
  const digest = await crypto.subtle.digest("SHA-256", encodeText(credential));
  return encodeBase64Url(new Uint8Array(digest));
}

/**
 * Validates an optional entitlement record without persisting raw credentials.
 * @param {unknown} credential Candidate credential.
 * @param {string} version Requested version.
 * @param {{ get(key: string): Promise<string | null> } | undefined} stateStore Gate state KV binding.
 * @param {boolean} required Whether entitlement is mandatory.
 * @param {number} nowSeconds Current Unix time.
 * @returns {Promise<boolean>} Whether artifact access is authorized.
 */
export async function isEntitled(credential, version, stateStore, required, nowSeconds) {
  if (!required) return true;
  if (typeof credential !== "string" || credential.length < 32 || credential.length > 512 || !stateStore) {
    return false;
  }
  const key = await hashCredential(credential);
  const encodedRecord = await stateStore.get(`entitlement:${key}`);
  if (!encodedRecord) return false;
  try {
    const record = JSON.parse(encodedRecord);
    const versions = Array.isArray(record.versions) ? record.versions : [];
    return (
      record.active === true &&
      Number.isSafeInteger(record.expiresAt) &&
      record.expiresAt > nowSeconds &&
      versions.includes(version)
    );
  } catch (_error) {
    return false;
  }
}

/**
 * Calls a native Rate Limiting binding with a privacy-minimized key.
 * @param {{ limit(options: { key: string }): Promise<{ success: boolean }> } | undefined} limiter Binding.
 * @param {string} key Already hashed or platform-provided rate key.
 * @returns {Promise<boolean>} Whether the request is allowed.
 */
export async function passesRateLimit(limiter, key) {
  if (!limiter) return false;
  const result = await limiter.limit({ key });
  return result.success === true;
}
