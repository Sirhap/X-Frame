export const PERMANENT_LICENSE_EXPIRES_AT = "9999-12-31T23:59:59.999Z";

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
  return new Date(activatedAt + durationDays * 86_400_000).toISOString();
}
