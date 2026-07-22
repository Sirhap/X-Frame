/**
 * Creates the D1 persistence boundary for trial licenses and their single device slot.
 * @param {D1Database} database D1 binding.
 * @returns {object} License repository.
 */
export function createLicenseRepository(database) {
  if (!database?.prepare) throw Object.assign(new Error("License database is unavailable."), { status: 503 });
  return {
    /** @param {string} codeHash Normalized code hash. @returns {Promise<object|null>} License row. */
    findLicenseByCodeHash(codeHash) {
      return database
        .prepare(
          "SELECT id, code_hash, plan, duration_days, max_devices, redeem_by, first_activated_at, expires_at, revoked_at FROM licenses WHERE code_hash = ?1 LIMIT 1",
        )
        .bind(codeHash)
        .first();
    },
    /** @param {string} licenseId License id. @returns {Promise<object|null>} Device row. */
    findDeviceByLicenseId(licenseId) {
      return database
        .prepare(
          "SELECT id, license_id, public_key, public_key_hash, device_name, created_at, last_seen_at, revoked_at FROM license_devices WHERE license_id = ?1 LIMIT 1",
        )
        .bind(licenseId)
        .first();
    },
    /** @param {string} deviceId Device id. @returns {Promise<object|null>} Joined authorization row. */
    findAuthorizationByDeviceId(deviceId) {
      return database
        .prepare(
          `SELECT d.id AS device_id, d.license_id, d.public_key, d.public_key_hash,
                  d.revoked_at AS device_revoked_at, l.plan, l.expires_at,
                  l.revoked_at AS license_revoked_at
             FROM license_devices d
             JOIN licenses l ON l.id = d.license_id
            WHERE d.id = ?1 LIMIT 1`,
        )
        .bind(deviceId)
        .first();
    },
    /** @param {string} licenseId License id. @param {string} activatedAt ISO timestamp. @param {string} expiresAt ISO timestamp. @returns {Promise<object>} Mutation result. */
    activateLicense(licenseId, activatedAt, expiresAt) {
      return database
        .prepare(
          "UPDATE licenses SET first_activated_at = COALESCE(first_activated_at, ?2), expires_at = COALESCE(expires_at, ?3) WHERE id = ?1",
        )
        .bind(licenseId, activatedAt, expiresAt)
        .run();
    },
    /** @param {object} device New device record. @returns {Promise<object>} Mutation result. */
    createDevice(device) {
      return database
        .prepare(
          `INSERT INTO license_devices
             (id, license_id, public_key, public_key_hash, device_name,
              first_ip_hash, last_ip_hash, first_country, last_country, created_at, last_seen_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?7, ?8, ?8)`,
        )
        .bind(
          device.id,
          device.licenseId,
          device.publicKey,
          device.publicKeyHash,
          device.deviceName,
          device.ipHash,
          device.country,
          device.createdAt,
        )
        .run();
    },
    /** @param {string} deviceId Device id. @param {string} seenAt ISO timestamp. @param {string} ipHash Hashed IP. @param {string} country Country code. @returns {Promise<object>} Mutation result. */
    touchDevice(deviceId, seenAt, ipHash, country) {
      return database
        .prepare(
          "UPDATE license_devices SET last_seen_at = ?2, last_ip_hash = ?3, last_country = ?4 WHERE id = ?1",
        )
        .bind(deviceId, seenAt, ipHash, country)
        .run();
    },
  };
}
