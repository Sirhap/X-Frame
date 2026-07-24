const MAX_D1_BIND_PARAMETERS = 100;

/**
 * Creates the D1 persistence boundary for administrator authentication and licenses.
 * @param {D1Database} database D1 binding.
 * @returns {object} Administrator repository.
 */
export function createAdminRepository(database) {
  if (!database?.prepare) throw Object.assign(new Error("License database is unavailable."), { status: 503 });
  return {
    /** @param {string} fingerprintHash Hashed client fingerprint. @returns {Promise<object|null>} Attempt row. */
    findLoginAttempt(fingerprintHash) {
      return database
        .prepare(
          "SELECT fingerprint_hash, failed_count, window_started_at, blocked_until FROM admin_login_attempts WHERE fingerprint_hash = ?1 LIMIT 1",
        )
        .bind(fingerprintHash)
        .first();
    },

    /** @param {object} attempt Login attempt state. @returns {Promise<object>} Mutation result. */
    saveLoginAttempt(attempt) {
      return database
        .prepare(
          `INSERT INTO admin_login_attempts
             (fingerprint_hash, failed_count, window_started_at, blocked_until, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(fingerprint_hash) DO UPDATE SET
             failed_count = excluded.failed_count,
             window_started_at = excluded.window_started_at,
             blocked_until = excluded.blocked_until,
             updated_at = excluded.updated_at`,
        )
        .bind(
          attempt.fingerprintHash,
          attempt.failedCount,
          attempt.windowStartedAt,
          attempt.blockedUntil,
          attempt.updatedAt,
        )
        .run();
    },

    /** @param {string} fingerprintHash Hashed client fingerprint. @returns {Promise<object>} Mutation result. */
    clearLoginAttempt(fingerprintHash) {
      return database
        .prepare("DELETE FROM admin_login_attempts WHERE fingerprint_hash = ?1")
        .bind(fingerprintHash)
        .run();
    },

    /** @param {number} counter Accepted TOTP counter. @param {string} usedAt ISO timestamp. @returns {Promise<boolean>} Whether the counter was unused. */
    async consumeTotpCounter(counter, usedAt) {
      try {
        await database.batch([
          database.prepare("DELETE FROM admin_totp_uses WHERE counter < ?1").bind(counter - 1440),
          database
            .prepare("INSERT INTO admin_totp_uses (counter, used_at) VALUES (?1, ?2)")
            .bind(counter, usedAt),
        ]);
        return true;
      } catch (error) {
        if (String(error?.message || error).includes("UNIQUE constraint failed")) return false;
        throw error;
      }
    },

    /** @param {number} limit Maximum rows. @returns {Promise<object[]>} Recent licenses and trials. */
    async listLicenses(limit) {
      const results = await database.batch(
        ["code", "automatic_trial"].map((source) =>
          database
            .prepare(
              `SELECT rowid AS source_rowid, id, code_hash, code_ciphertext, source, plan,
                      duration_days, max_devices, redeem_by, first_activated_at, expires_at, revoked_at
                 FROM licenses
                WHERE source = ?1
                ORDER BY rowid DESC
                LIMIT ?2`,
            )
            .bind(source, limit),
        ),
      );
      return results
        .flatMap((result) => result.results || [])
        .sort((left, right) => Number(right.source_rowid) - Number(left.source_rowid));
    },

    /** @param {string[]} licenseIds License IDs. @returns {Promise<object[]>} Devices grouped by license. */
    async listLicenseDevices(licenseIds) {
      if (!licenseIds.length) return [];
      const statements = [];
      for (let offset = 0; offset < licenseIds.length; offset += MAX_D1_BIND_PARAMETERS) {
        const batchIds = licenseIds.slice(offset, offset + MAX_D1_BIND_PARAMETERS);
        const placeholders = batchIds.map((_licenseId, index) => `?${index + 1}`).join(", ");
        statements.push(
          database
            .prepare(
              `SELECT id, license_id, device_name, first_country, last_country,
                      created_at, last_seen_at, revoked_at
                 FROM license_devices
                WHERE license_id IN (${placeholders})
                ORDER BY created_at ASC`,
            )
            .bind(...batchIds),
        );
      }
      const results = await database.batch(statements);
      return results.flatMap((result) => result.results || []);
    },

    /** @param {object[]} licenses New license records. @returns {Promise<object[]>} Batch results. */
    createLicenses(licenses) {
      return database.batch(
        licenses.map((license) =>
          database
            .prepare(
              `INSERT INTO licenses
                 (id, code_hash, code_ciphertext, source, plan, duration_days, max_devices, redeem_by, expires_at)
               VALUES (?1, ?2, ?3, 'code', 'standard', ?4, ?5, ?6, ?7)`,
            )
            .bind(
              license.id,
              license.codeHash,
              license.codeCiphertext,
              license.durationDays,
              license.maxDevices,
              license.redeemBy,
              license.expiresAt,
            ),
        ),
      );
    },

    /** @param {string[]} ids License IDs. @returns {Promise<object[]>} Matching license rows. */
    async findLicensesByIds(ids) {
      const results = await database.batch(
        ids.map((id) =>
          database
            .prepare(
              `SELECT id, code_hash, code_ciphertext, source, plan, duration_days, max_devices, redeem_by,
                      first_activated_at, expires_at, revoked_at
                 FROM licenses
                WHERE id = ?1 AND source = 'code'
                LIMIT 1`,
            )
            .bind(id),
        ),
      );
      return results.flatMap((result) => result.results || []);
    },

    /** @param {object[]} licenses Updated license records. @returns {Promise<object[]>} Batch results. */
    updateLicenses(licenses) {
      return database.batch(
        licenses.map((license) =>
          database
            .prepare(
              `UPDATE licenses
                  SET duration_days = ?2, max_devices = ?3, redeem_by = ?4, expires_at = ?5
                WHERE id = ?1 AND source = 'code'`,
            )
            .bind(license.id, license.durationDays, license.maxDevices, license.redeemBy, license.expiresAt),
        ),
      );
    },

    /** @param {string[]} ids License IDs. @param {string|null} revokedAt Revocation time. @returns {Promise<object[]>} Batch results. */
    setLicensesRevoked(ids, revokedAt) {
      return database.batch(
        ids.map((id) =>
          database
            .prepare("UPDATE licenses SET revoked_at = ?2 WHERE id = ?1 AND source = 'code'")
            .bind(id, revokedAt),
        ),
      );
    },

    /** @param {string[]} ids License IDs. @returns {Promise<object[]>} Batch results. */
    deleteLicenses(ids) {
      return database.batch(
        ids.map((id) => database.prepare("DELETE FROM licenses WHERE id = ?1 AND source = 'code'").bind(id)),
      );
    },

    /** @param {string[]} ids Device IDs. @returns {Promise<object[]>} Matching managed devices. */
    async findDevicesByIds(ids) {
      const results = await database.batch(
        ids.map((id) =>
          database
            .prepare(
              `SELECT d.id, d.license_id, d.revoked_at
                 FROM license_devices d
                WHERE d.id = ?1
                LIMIT 1`,
            )
            .bind(id),
        ),
      );
      return results.flatMap((result) => result.results || []);
    },

    /** @param {string[]} ids Device IDs. @param {string|null} revokedAt Revocation time. @returns {Promise<object[]>} Batch results. */
    setDevicesRevoked(ids, revokedAt) {
      return database.batch(
        ids.map((id) =>
          database.prepare("UPDATE license_devices SET revoked_at = ?2 WHERE id = ?1").bind(id, revokedAt),
        ),
      );
    },

    /** @param {string[]} ids Device IDs. @returns {Promise<object[]>} Batch results. */
    deleteDevices(ids) {
      return database.batch(
        ids.map((id) => database.prepare("DELETE FROM license_devices WHERE id = ?1").bind(id)),
      );
    },
  };
}
