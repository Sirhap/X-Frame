/**
 * Creates the D1 persistence boundary for activation codes and automatic trials.
 * @param {D1Database} database D1 binding.
 * @returns {object} License repository.
 */
export function createLicenseRepository(database) {
  if (!database?.prepare) throw Object.assign(new Error("License database is unavailable."), { status: 503 });

  const authorizationSelect = `SELECT d.id AS device_id, d.license_id, d.public_key, d.public_key_hash,
                                      d.revoked_at AS device_revoked_at, l.plan, l.expires_at,
                                      l.revoked_at AS license_revoked_at
                                 FROM license_devices d
                                 JOIN licenses l ON l.id = d.license_id`;

  return {
    /** @param {string} codeHash Normalized code hash. @returns {Promise<object|null>} License row. */
    findLicenseByCodeHash(codeHash) {
      return database
        .prepare(
          `SELECT id, code_hash, source, plan, duration_days, max_devices, redeem_by,
                  first_activated_at, expires_at, revoked_at
             FROM licenses
            WHERE code_hash = ?1 AND source = 'code'
            LIMIT 1`,
        )
        .bind(codeHash)
        .first();
    },

    /** @param {string} licenseId License ID. @param {string} publicKeyHash Public-key hash. @returns {Promise<object|null>} Matching device. */
    findDeviceByLicenseAndPublicKeyHash(licenseId, publicKeyHash) {
      return database
        .prepare(
          `SELECT id, license_id, public_key, public_key_hash, fingerprint_hash, device_name,
                  created_at, last_seen_at, revoked_at
             FROM license_devices
            WHERE license_id = ?1 AND public_key_hash = ?2
            LIMIT 1`,
        )
        .bind(licenseId, publicKeyHash)
        .first();
    },

    /** @param {string} deviceId Device ID. @returns {Promise<object|null>} Joined authorization row. */
    findAuthorizationByDeviceId(deviceId) {
      return database.prepare(`${authorizationSelect} WHERE d.id = ?1 LIMIT 1`).bind(deviceId).first();
    },

    /** @param {string} publicKeyHash Public-key hash. @returns {Promise<object|null>} Automatic-trial authorization. */
    findAutomaticTrialByPublicKeyHash(publicKeyHash) {
      return database
        .prepare(
          `${authorizationSelect}
             JOIN automatic_trial_claims t ON t.device_id = d.id
            WHERE d.public_key_hash = ?1 AND l.source = 'automatic_trial'
            LIMIT 1`,
        )
        .bind(publicKeyHash)
        .first();
    },

    /** @param {string} fingerprintHash Hashed composite fingerprint. @returns {Promise<object|null>} Automatic-trial authorization. */
    findAutomaticTrialByFingerprintHash(fingerprintHash) {
      return database
        .prepare(
          `${authorizationSelect}
             JOIN automatic_trial_claims t ON t.device_id = d.id
            WHERE t.fingerprint_hash = ?1 AND l.source = 'automatic_trial'
            LIMIT 1`,
        )
        .bind(fingerprintHash)
        .first();
    },

    /** @param {string} licenseId License ID. @param {string} activatedAt ISO timestamp. @param {string} expiresAt ISO timestamp. @returns {Promise<object>} Mutation result. */
    activateLicense(licenseId, activatedAt, expiresAt) {
      return database
        .prepare(
          "UPDATE licenses SET first_activated_at = COALESCE(first_activated_at, ?2), expires_at = COALESCE(expires_at, ?3) WHERE id = ?1",
        )
        .bind(licenseId, activatedAt, expiresAt)
        .run();
    },

    /**
     * Atomically occupies a code's available device slot.
     * @param {object} device New device record.
     * @returns {Promise<object>} D1 mutation result.
     */
    createCodeDeviceWithinLimit(device) {
      return database
        .prepare(
          `INSERT INTO license_devices
             (id, license_id, public_key, public_key_hash, fingerprint_hash, device_name,
              first_ip_hash, last_ip_hash, first_country, last_country, created_at, last_seen_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?8, ?9, ?9
            WHERE (SELECT COUNT(*) FROM license_devices WHERE license_id = ?2 AND revoked_at IS NULL) <
                  (SELECT max_devices FROM licenses WHERE id = ?2 AND revoked_at IS NULL)`,
        )
        .bind(
          device.id,
          device.licenseId,
          device.publicKey,
          device.publicKeyHash,
          device.fingerprintHash || null,
          device.deviceName,
          device.ipHash,
          device.country,
          device.createdAt,
        )
        .run();
    },

    /**
     * Atomically creates a per-device three-day trial and its fingerprint claim.
     * @param {object} trial Trial records.
     * @returns {Promise<object[]>} D1 batch results.
     */
    createAutomaticTrial(trial) {
      return database.batch([
        database
          .prepare(
            `INSERT INTO licenses
               (id, code_hash, source, plan, duration_days, max_devices, first_activated_at, expires_at)
             VALUES (?1, ?2, 'automatic_trial', 'trial', 3, 1, ?3, ?4)`,
          )
          .bind(trial.licenseId, trial.codeHash, trial.createdAt, trial.expiresAt),
        database
          .prepare(
            `INSERT INTO license_devices
               (id, license_id, public_key, public_key_hash, fingerprint_hash, device_name,
                first_ip_hash, last_ip_hash, first_country, last_country, created_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?8, ?9, ?9)`,
          )
          .bind(
            trial.deviceId,
            trial.licenseId,
            trial.publicKey,
            trial.publicKeyHash,
            trial.fingerprintHash,
            trial.deviceName,
            trial.ipHash,
            trial.country,
            trial.createdAt,
          ),
        database
          .prepare(
            `INSERT INTO automatic_trial_claims
               (id, fingerprint_hash, public_key_hash, hardware_hash, display_hash, license_id, device_id,
                first_ip_hash, last_ip_hash, first_country, last_country, created_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?9, ?10, ?10)`,
          )
          .bind(
            trial.claimId,
            trial.fingerprintHash,
            trial.publicKeyHash,
            trial.hardwareHash,
            trial.displayHash,
            trial.licenseId,
            trial.deviceId,
            trial.ipHash,
            trial.country,
            trial.createdAt,
          ),
      ]);
    },

    /** @param {string} deviceId Device ID. @param {string} seenAt ISO timestamp. @param {string} ipHash Hashed IP. @param {string} country Country code. @returns {Promise<object[]>} Mutation results. */
    touchDevice(deviceId, seenAt, ipHash, country) {
      return database.batch([
        database
          .prepare(
            "UPDATE license_devices SET last_seen_at = ?2, last_ip_hash = ?3, last_country = ?4 WHERE id = ?1",
          )
          .bind(deviceId, seenAt, ipHash, country),
        database
          .prepare(
            "UPDATE automatic_trial_claims SET last_seen_at = ?2, last_ip_hash = ?3, last_country = ?4 WHERE device_id = ?1",
          )
          .bind(deviceId, seenAt, ipHash, country),
      ]);
    },
  };
}
