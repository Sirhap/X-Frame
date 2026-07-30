export const PERMANENT_LICENSE_EXPIRES_AT = "9999-12-31T23:59:59.999Z";
const PERMANENT_LICENSE_EXPIRY_EPOCH = Date.parse(PERMANENT_LICENSE_EXPIRES_AT);

/** @param {unknown} value Stored expiry value. @returns {boolean} Whether the expiry represents a permanent license. */
export function isPermanentLicenseExpiry(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) && new Date(timestamp).getUTCFullYear() >= 9999;
}

/**
 * Resolves the expiry stored for a duration change.
 * @param {number} activatedAt First activation epoch.
 * @param {number} durationDays Finite duration in days.
 * @param {boolean} permanent Whether the license never expires.
 * @returns {string|null} ISO expiry or null until first activation.
 */
export function resolveLicenseExpiry(activatedAt, durationDays, permanent) {
  if (permanent) return PERMANENT_LICENSE_EXPIRES_AT;
  if (!Number.isFinite(activatedAt)) return null;
  const expiresAt = activatedAt + durationDays * 86_400_000;
  if (!Number.isFinite(expiresAt) || expiresAt >= PERMANENT_LICENSE_EXPIRY_EPOCH) {
    throw new RangeError("Finite license expiry must be before year 9999.");
  }
  return new Date(expiresAt).toISOString();
}
