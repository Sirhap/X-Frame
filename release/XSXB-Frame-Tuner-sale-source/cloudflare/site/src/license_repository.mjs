/**
 * Creates the D1 persistence boundary for activation codes and automatic trials.
 * @param {D1Database} database D1 binding.
 * @returns {object} License repository.
 */
export function createLicenseRepository(database) {
  if (!database?.prepare) throw Object.assign(new Error("License database is unavailable."), { status: 503 });

  const authorizationColumns = `d.id AS device_id, d.license_id, d.public_key, d.public_key_hash,
                                d.revoked_at AS device_revoked_at, l.source, l.plan, l.expires_at,
                                l.revoked_at AS license_revoked_at`;
  const authorizationFrom = `FROM license_devices d
                              JOIN licenses l ON l.id = d.license_id`;
  const authorizationSelect = `SELECT ${authorizationColumns} ${authorizationFrom}`;
  const trialAuthorizationSelect = `SELECT ${authorizationColumns}, t.id AS trial_claim_id
                                       ${authorizationFrom}
                                       JOIN automatic_trial_claims t ON t.device_id = d.id`;
  const browserAuthorizationSelect = `SELECT b.id AS device_id, t.license_id, b.public_key,
                                             b.public_key_hash,
                                             COALESCE(b.revoked_at, d.revoked_at) AS device_revoked_at,
                                             l.source, l.plan, l.expires_at,
                                             l.revoked_at AS license_revoked_at,
                                             t.id AS trial_claim_id
                                        FROM automatic_trial_browser_bindings b
                                        JOIN automatic_trial_claims t ON t.id = b.claim_id
                                        JOIN license_devices d ON d.id = t.device_id
                                        JOIN licenses l ON l.id = t.license_id`;

  /**
   * Prepares an insert-or-restore statement that still enforces the license device limit.
   * @param {object} device Device binding record.
   * @param {string} [replacementDeviceId] Exact active device being replaced.
   * @returns {D1PreparedStatement} Bound D1 statement.
   */
  function prepareCodeDeviceBinding(device, replacementDeviceId = "") {
    const slotCondition = replacementDeviceId
      ? `EXISTS (
           SELECT 1
             FROM license_devices replacement
            WHERE replacement.id = ?10
              AND replacement.license_id = ?2
              AND replacement.public_key_hash <> ?4
              AND replacement.revoked_at IS NULL
         )`
      : `(l.max_devices IS NULL OR
          (SELECT COUNT(*)
             FROM license_devices
            WHERE license_id = ?2
              AND revoked_at IS NULL) < l.max_devices)`;
    const statement = database.prepare(
      `INSERT INTO license_devices
           (id, license_id, public_key, public_key_hash, fingerprint_hash, device_name,
            first_ip_hash, last_ip_hash, first_country, last_country, created_at, last_seen_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?8, ?9, ?9
           FROM licenses l
          WHERE l.id = ?2
            AND l.source = 'code'
            AND l.revoked_at IS NULL
            AND ${slotCondition}
         ON CONFLICT(license_id, public_key_hash) DO UPDATE SET
           public_key = excluded.public_key,
           fingerprint_hash = excluded.fingerprint_hash,
           device_name = excluded.device_name,
           last_ip_hash = excluded.last_ip_hash,
           last_country = excluded.last_country,
           last_seen_at = excluded.last_seen_at,
           revoked_at = NULL`,
    );
    const values = [
      device.id,
      device.licenseId,
      device.publicKey,
      device.publicKeyHash,
      device.fingerprintHash || null,
      device.deviceName,
      device.ipHash,
      device.country,
      device.createdAt,
    ];
    if (replacementDeviceId) values.push(replacementDeviceId);
    return statement.bind(...values);
  }

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
    async findAuthorizationByDeviceId(deviceId) {
      const primaryAuthorization = await database
        .prepare(`${authorizationSelect} WHERE d.id = ?1 LIMIT 1`)
        .bind(deviceId)
        .first();
      if (primaryAuthorization) return primaryAuthorization;
      return database.prepare(`${browserAuthorizationSelect} WHERE b.id = ?1 LIMIT 1`).bind(deviceId).first();
    },

    /** @param {string} publicKeyHash Public-key hash. @returns {Promise<object|null>} Automatic-trial authorization. */
    async findAutomaticTrialByPublicKeyHash(publicKeyHash) {
      const primaryAuthorization = await database
        .prepare(
          `${trialAuthorizationSelect}
                  WHERE d.public_key_hash = ?1 AND l.source = 'automatic_trial'
                  LIMIT 1`,
        )
        .bind(publicKeyHash)
        .first();
      if (primaryAuthorization) return primaryAuthorization;
      return database
        .prepare(
          `${browserAuthorizationSelect}
                  WHERE b.public_key_hash = ?1 AND l.source = 'automatic_trial'
                  LIMIT 1`,
        )
        .bind(publicKeyHash)
        .first();
    },

    /** @param {string} fingerprintHash Hashed composite fingerprint. @returns {Promise<object|null>} Automatic-trial authorization. */
    findAutomaticTrialByFingerprintHash(fingerprintHash) {
      return database
        .prepare(
          `${trialAuthorizationSelect}
            WHERE t.fingerprint_hash = ?1 AND l.source = 'automatic_trial'
            LIMIT 1`,
        )
        .bind(fingerprintHash)
        .first();
    },

    /**
     * Finds a trial claimed by the same browser-independent device signature.
     * Both hashes must match to avoid treating similar hardware on a shared network as one device.
     * @param {string} hardwareHash Hashed hardware core.
     * @param {string} displayHash Hashed display environment.
     * @returns {Promise<object|null>} Automatic-trial authorization.
     */
    findAutomaticTrialByDeviceSignature(hardwareHash, displayHash) {
      return database
        .prepare(
          `${trialAuthorizationSelect}
            WHERE t.hardware_hash = ?1
              AND t.display_hash = ?2
              AND l.source = 'automatic_trial'
            LIMIT 1`,
        )
        .bind(hardwareHash, displayHash)
        .first();
    },

    /**
     * Lazily upgrades an existing trial from an older fingerprint algorithm.
     * @param {string} deviceId Device ID.
     * @param {string} hardwareHash Current browser-independent hardware hash.
     * @param {string} displayHash Current browser-independent display hash.
     * @returns {Promise<object>} Mutation result.
     */
    updateAutomaticTrialDeviceSignature(deviceId, hardwareHash, displayHash) {
      return database
        .prepare(
          `UPDATE automatic_trial_claims
              SET hardware_hash = ?2, display_hash = ?3
            WHERE device_id = ?1
               OR id = (SELECT claim_id
                          FROM automatic_trial_browser_bindings
                         WHERE id = ?1)`,
        )
        .bind(deviceId, hardwareHash, displayHash)
        .run();
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
     * Atomically occupies a code's available slot or restores the same browser binding.
     * @param {object} device New device record.
     * @returns {Promise<object>} D1 mutation result.
     */
    createCodeDeviceWithinLimit(device) {
      return prepareCodeDeviceBinding(device).run();
    },

    /**
     * Lists one bounded page of active devices that the code owner may replace.
     * @param {string} licenseId License ID.
     * @param {number} limit Maximum rows.
     * @param {number} offset Page offset.
     * @returns {Promise<object[]>} Safe device summaries.
     */
    async listActiveCodeDevices(licenseId, limit, offset) {
      const result = await database
        .prepare(
          `SELECT id, device_name, created_at, last_seen_at,
                  COUNT(*) OVER() AS total_count
             FROM license_devices
            WHERE license_id = ?1
              AND revoked_at IS NULL
            ORDER BY last_seen_at ASC, created_at ASC, id ASC
            LIMIT ?2 OFFSET ?3`,
        )
        .bind(licenseId, limit, offset)
        .all();
      return result.results || [];
    },

    /**
     * Atomically revokes the selected device and binds the requesting browser.
     * @param {object} device New or restored device record.
     * @param {string} replacementDeviceId User-selected active device.
     * @param {string} revokedAt Revocation timestamp.
     * @returns {Promise<object[]>} D1 batch results.
     */
    replaceCodeDeviceWithinLimit(device, replacementDeviceId, revokedAt) {
      return database.batch([
        prepareCodeDeviceBinding(device, replacementDeviceId),
        database
          .prepare(
            `UPDATE license_devices
                SET revoked_at = ?4
              WHERE id = ?1
                AND license_id = ?2
                AND public_key_hash <> ?3
                AND revoked_at IS NULL
                AND EXISTS (
                      SELECT 1
                        FROM licenses
                       WHERE id = ?2
                         AND source = 'code'
                         AND revoked_at IS NULL
                    )
                AND EXISTS (
                      SELECT 1
                        FROM license_devices current
                       WHERE current.license_id = ?2
                         AND current.public_key_hash = ?3
                         AND current.revoked_at IS NULL
                    )`,
          )
          .bind(replacementDeviceId, device.licenseId, device.publicKeyHash, revokedAt),
      ]);
    },

    /**
     * Revokes the current code device without affecting other bindings.
     * @param {string} deviceId Device ID.
     * @param {string} licenseId License ID.
     * @param {string} revokedAt Revocation timestamp.
     * @returns {Promise<object>} D1 mutation result.
     */
    revokeCodeDevice(deviceId, licenseId, revokedAt) {
      return database
        .prepare(
          `UPDATE license_devices
              SET revoked_at = ?3
            WHERE id = ?1
              AND license_id = ?2
              AND revoked_at IS NULL
              AND EXISTS (
                    SELECT 1
                      FROM licenses
                     WHERE id = ?2
                       AND source = 'code'
                  )`,
        )
        .bind(deviceId, licenseId, revokedAt)
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

    /**
     * Atomically adds another browser key to an existing physical-device trial.
     * @param {object} binding Browser credential and risk metadata.
     * @returns {Promise<object>} D1 mutation result.
     */
    createAutomaticTrialBrowserBinding(binding) {
      return database
        .prepare(
          `INSERT INTO automatic_trial_browser_bindings
             (id, claim_id, public_key, public_key_hash, device_name,
              first_ip_hash, last_ip_hash, first_country, last_country, created_at, last_seen_at)
           SELECT ?1, t.id, ?3, ?4, ?5, ?6, ?6, ?7, ?7, ?8, ?8
             FROM automatic_trial_claims t
             JOIN license_devices d ON d.id = t.device_id
             JOIN licenses l ON l.id = t.license_id
            WHERE t.id = ?2
              AND d.revoked_at IS NULL
              AND l.revoked_at IS NULL
              AND l.expires_at > ?8
              AND NOT EXISTS (
                    SELECT 1
                      FROM automatic_trial_claims
                     WHERE public_key_hash = ?4
                  )
              AND (
                    SELECT COUNT(*)
                      FROM automatic_trial_browser_bindings
                     WHERE claim_id = t.id
                       AND revoked_at IS NULL
                  ) < ?9`,
        )
        .bind(
          binding.id,
          binding.claimId,
          binding.publicKey,
          binding.publicKeyHash,
          binding.deviceName,
          binding.ipHash,
          binding.country,
          binding.createdAt,
          binding.maxBindings,
        )
        .run();
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
            `UPDATE automatic_trial_browser_bindings
                SET last_seen_at = ?2, last_ip_hash = ?3, last_country = ?4
              WHERE id = ?1`,
          )
          .bind(deviceId, seenAt, ipHash, country),
        database
          .prepare(
            `UPDATE automatic_trial_claims
                SET last_seen_at = ?2, last_ip_hash = ?3, last_country = ?4
              WHERE device_id = ?1
                 OR id = (SELECT claim_id
                            FROM automatic_trial_browser_bindings
                           WHERE id = ?1)`,
          )
          .bind(deviceId, seenAt, ipHash, country),
      ]);
    },
  };
}
