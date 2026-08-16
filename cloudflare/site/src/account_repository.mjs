/**
 * Creates the D1 persistence boundary for email accounts and entitlements.
 * @param {D1Database} database D1 binding.
 * @returns {object} Account repository.
 */
export function createAccountRepository(database) {
  if (!database?.prepare) throw Object.assign(new Error("Account database is unavailable."), { status: 503 });

  return {
    /** Creates a short-lived password-authentication challenge. */
    createAuthChallenge(entry) {
      return database
        .prepare(
          `INSERT INTO auth_challenges
          (id, token_hash, kind, email, account_id, password_hash, password_salt,
           password_iterations, code_hash, ip_hash, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        .bind(
          entry.id,
          entry.tokenHash,
          entry.kind,
          entry.email,
          entry.accountId || null,
          entry.passwordHash || null,
          entry.passwordSalt || null,
          entry.passwordIterations || null,
          entry.codeHash,
          entry.ipHash || null,
          entry.createdAt,
          entry.expiresAt,
        )
        .run();
    },

    /** Finds an authentication challenge by its opaque token hash. */
    findAuthChallenge(tokenHash) {
      return database
        .prepare("SELECT * FROM auth_challenges WHERE token_hash = ?1 LIMIT 1")
        .bind(tokenHash)
        .first();
    },

    /** Records an unsuccessful challenge verification. */
    recordAuthChallengeAttempt(id, attempts) {
      return database
        .prepare("UPDATE auth_challenges SET attempts = ?2 WHERE id = ?1 AND consumed_at IS NULL")
        .bind(id, attempts)
        .run();
    },

    /** Atomically consumes a valid authentication challenge. */
    consumeAuthChallenge(id, consumedAt) {
      return database
        .prepare(
          "UPDATE auth_challenges SET consumed_at = ?2 WHERE id = ?1 AND consumed_at IS NULL AND attempts < 5",
        )
        .bind(id, consumedAt)
        .run();
    },

    /** @param {string} email Normalized email. @returns {Promise<object|null>} Account row. */
    findAccountByEmail(email) {
      return database.prepare("SELECT * FROM accounts WHERE email = ?1 LIMIT 1").bind(email).first();
    },

    /** @param {string} accountId Account ID. @returns {Promise<object|null>} Account row. */
    findAccountById(accountId) {
      return database.prepare("SELECT * FROM accounts WHERE id = ?1 LIMIT 1").bind(accountId).first();
    },

    /** @param {object} entry Verification record. @returns {Promise<object>} Mutation result. */
    createVerificationCode(entry) {
      return database
        .prepare(
          `INSERT INTO email_verification_codes
             (id, email, code_hash, purpose, ip_hash, created_at, expires_at)
           VALUES (?1, ?2, ?3, 'login', ?4, ?5, ?6)`,
        )
        .bind(entry.id, entry.email, entry.codeHash, entry.ipHash || null, entry.createdAt, entry.expiresAt)
        .run();
    },

    /** @param {string} email Normalized email. @returns {Promise<object|null>} Latest code. */
    findLatestVerificationCode(email) {
      return database
        .prepare(
          `SELECT * FROM email_verification_codes
            WHERE email = ?1 AND purpose = 'login'
            ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(email)
        .first();
    },

    /** @param {string} email Normalized email. @param {string} since ISO lower bound. @returns {Promise<number>} Count. */
    async countRecentCodesForEmail(email, since) {
      const row = await database
        .prepare(
          "SELECT COUNT(*) AS count FROM email_verification_codes WHERE email = ?1 AND created_at >= ?2",
        )
        .bind(email, since)
        .first();
      return Number(row?.count || 0);
    },

    /** @param {string} ipHash Hashed IP. @param {string} since ISO lower bound. @returns {Promise<number>} Count. */
    async countRecentCodesForIp(ipHash, since) {
      if (!ipHash) return 0;
      const row = await database
        .prepare(
          "SELECT COUNT(*) AS count FROM email_verification_codes WHERE ip_hash = ?1 AND created_at >= ?2",
        )
        .bind(ipHash, since)
        .first();
      return Number(row?.count || 0);
    },

    /** @param {string} id Code ID. @param {number} attempts Next attempt count. @returns {Promise<object>} Mutation result. */
    recordVerificationAttempt(id, attempts) {
      return database
        .prepare("UPDATE email_verification_codes SET attempts = ?2 WHERE id = ?1 AND consumed_at IS NULL")
        .bind(id, attempts)
        .run();
    },

    /** @param {string} id Code ID. @param {string} consumedAt Consumption time. @returns {Promise<object>} Mutation result. */
    consumeVerificationCode(id, consumedAt) {
      return database
        .prepare(
          "UPDATE email_verification_codes SET consumed_at = ?2 WHERE id = ?1 AND consumed_at IS NULL AND attempts < 5",
        )
        .bind(id, consumedAt)
        .run();
    },

    /** @param {object} account New account. @returns {Promise<object>} Mutation result. */
    createAccount(account) {
      return database
        .prepare(
          `INSERT INTO accounts
             (id, email, created_at, verified_at, last_login_at)
           VALUES (?1, ?2, ?3, ?3, ?3)
           ON CONFLICT(email) DO UPDATE SET
             verified_at = excluded.verified_at,
             last_login_at = excluded.last_login_at`,
        )
        .bind(account.id, account.email, account.verifiedAt)
        .run();
    },

    /** Creates a verified password account after registration challenge consumption. */
    createPasswordAccount(account) {
      return database
        .prepare(
          `INSERT INTO accounts
          (id, email, password_hash, password_salt, password_iterations, password_set_at,
           created_at, verified_at, last_login_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6, ?6)`,
        )
        .bind(
          account.id,
          account.email,
          account.passwordHash,
          account.passwordSalt,
          account.passwordIterations,
          account.verifiedAt,
        )
        .run();
    },

    /** Sets the initial password for an account created by the former passwordless flow. */
    setAccountPassword(account) {
      return database
        .prepare(
          `UPDATE accounts SET password_hash = ?2, password_salt = ?3,
             password_iterations = ?4, password_set_at = ?5, last_login_at = ?5
           WHERE id = ?1 AND password_hash IS NULL`,
        )
        .bind(
          account.id,
          account.passwordHash,
          account.passwordSalt,
          account.passwordIterations,
          account.verifiedAt,
        )
        .run();
    },

    /** @param {object} session Session record. @returns {Promise<object>} Mutation result. */
    createSession(session) {
      return database
        .prepare(
          `INSERT INTO account_sessions
             (id, account_id, token_hash, created_at, expires_at, last_seen_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?4)`,
        )
        .bind(session.id, session.accountId, session.tokenHash, session.createdAt, session.expiresAt)
        .run();
    },

    /** @param {string} tokenHash Session token hash. @returns {Promise<object|null>} Joined session. */
    findSessionByTokenHash(tokenHash) {
      return database
        .prepare(
          `SELECT s.id AS session_id, s.expires_at AS session_expires_at, s.revoked_at AS session_revoked_at,
                  a.*
             FROM account_sessions s JOIN accounts a ON a.id = s.account_id
            WHERE s.token_hash = ?1 LIMIT 1`,
        )
        .bind(tokenHash)
        .first();
    },

    /** @param {string} tokenHash Session token hash. @param {string} seenAt Time. @returns {Promise<object>} Result. */
    touchSession(tokenHash, seenAt) {
      return database
        .prepare("UPDATE account_sessions SET last_seen_at = ?2 WHERE token_hash = ?1 AND revoked_at IS NULL")
        .bind(tokenHash, seenAt)
        .run();
    },

    /** @param {string} tokenHash Session token hash. @param {string} revokedAt Time. @returns {Promise<object>} Result. */
    revokeSession(tokenHash, revokedAt) {
      return database
        .prepare("UPDATE account_sessions SET revoked_at = ?2 WHERE token_hash = ?1 AND revoked_at IS NULL")
        .bind(tokenHash, revokedAt)
        .run();
    },

    /** @param {string} accountId Account ID. @param {string} revokedAt Time. @returns {Promise<object>} Result. */
    revokeAccountSessions(accountId, revokedAt) {
      return database
        .prepare("UPDATE account_sessions SET revoked_at = ?2 WHERE account_id = ?1 AND revoked_at IS NULL")
        .bind(accountId, revokedAt)
        .run();
    },

    /** @returns {Promise<boolean>} Global default Pro state. */
    async defaultProEnabled() {
      const row = await database
        .prepare("SELECT value FROM authorization_settings WHERE key = 'default_pro_enabled'")
        .first();
      return String(row?.value || "true") === "true";
    },

    /** @param {string} accountId Account ID. @returns {Promise<object[]>} Bound email licenses. */
    async listAccountLicenses(accountId) {
      const result = await database
        .prepare(
          `SELECT id, duration_days, first_activated_at, expires_at, revoked_at
             FROM licenses WHERE account_id = ?1 AND source IN ('code', 'email_trial', 'admin_grant')`,
        )
        .bind(accountId)
        .all();
      return result.results || [];
    },

    /** @param {string} codeHash Code hash. @returns {Promise<object|null>} Code license. */
    findLicenseByCodeHash(codeHash) {
      return database
        .prepare(
          `SELECT id, account_id, duration_days, first_activated_at, expires_at, revoked_at, redeem_by
             FROM licenses WHERE code_hash = ?1 AND source = 'code' LIMIT 1`,
        )
        .bind(codeHash)
        .first();
    },

    /** @param {object} binding License binding. @returns {Promise<object>} Result. */
    bindLicenseToAccount(binding) {
      return database
        .prepare(
          `UPDATE licenses
              SET account_id = ?2,
                  first_activated_at = COALESCE(first_activated_at, ?3),
                  expires_at = COALESCE(expires_at, ?4)
            WHERE id = ?1 AND (account_id IS NULL OR account_id = ?2) AND revoked_at IS NULL`,
        )
        .bind(binding.licenseId, binding.accountId, binding.activatedAt, binding.expiresAt)
        .run();
    },

    /** @param {{id:string,accountId:string,createdAt:string,expiresAt:string}} trial Email trial entry. @returns {Promise<object>} Result. */
    createEmailTrial(trial) {
      return database
        .prepare(
          `INSERT INTO licenses
             (id, source, plan, duration_days, first_activated_at, expires_at, account_id)
           VALUES (?1, 'email_trial', 'trial', 3, ?3, ?4, ?2)`,
        )
        .bind(trial.id, trial.accountId, trial.createdAt, trial.expiresAt)
        .run();
    },

    /** @param {string} accountId Account ID. @returns {Promise<object|null>} Existing email trial. */
    findEmailTrialByAccountId(accountId) {
      return database
        .prepare(
          `SELECT id, expires_at, revoked_at FROM licenses
            WHERE account_id = ?1 AND source = 'email_trial' LIMIT 1`,
        )
        .bind(accountId)
        .first();
    },

    /** @param {string} query Email search. @param {number} limit Maximum rows. @returns {Promise<object[]>} Accounts. */
    async listAccounts(query, limit = 200) {
      const result = await database
        .prepare(
          `SELECT a.*,
                  COUNT(l.id) AS license_count,
                  SUM(CASE WHEN l.source = 'email_trial' THEN 1 ELSE 0 END) AS trial_count,
                  SUM(CASE WHEN l.source = 'admin_grant' THEN 1 ELSE 0 END) AS admin_grant_count,
                  MAX(l.expires_at) AS license_expires_at
             FROM accounts a
             LEFT JOIN licenses l ON l.account_id = a.id AND l.revoked_at IS NULL
            WHERE (?1 = '' OR a.email LIKE ?2)
            GROUP BY a.id
            ORDER BY a.last_login_at DESC
            LIMIT ?3`,
        )
        .bind(query, `%${query}%`, limit)
        .all();
      return result.results || [];
    },

    /** @param {string} accountId Account ID. @returns {Promise<number>} Current usable session count. */
    async countActiveSessions(accountId) {
      const row = await database
        .prepare(
          `SELECT COUNT(*) AS count FROM account_sessions
            WHERE account_id = ?1 AND revoked_at IS NULL
              AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        )
        .bind(accountId)
        .first();
      return Number(row?.count || 0);
    },

    /** @param {string} accountId Account ID. @returns {Promise<object[]>} Full account-bound authorization history. */
    async listAccountLicenseTimeline(accountId) {
      const result = await database
        .prepare(
          `SELECT id, source, plan, duration_days, first_activated_at, expires_at,
                  revoked_at, admin_note, granted_by_account_id
             FROM licenses WHERE account_id = ?1
            ORDER BY first_activated_at DESC, id DESC`,
        )
        .bind(accountId)
        .all();
      return result.results || [];
    },

    /** @param {string} accountId Account ID. @param {number} limit Row limit. @returns {Promise<object[]>} Latest related audit rows. */
    async listAuditEntriesForAccount(accountId, limit = 20) {
      const result = await database
        .prepare(
          `SELECT id, actor_type, actor_id, action, target_type, target_id, details_json, created_at
             FROM authorization_audit_log
            WHERE (target_type = 'account' AND target_id = ?1)
               OR details_json LIKE ?2
            ORDER BY created_at DESC, id DESC LIMIT ?3`,
        )
        .bind(accountId, `%${accountId}%`, limit)
        .all();
      return result.results || [];
    },

    /** @param {string} query Email search. @param {string} state Trial state. @param {string} expiresBefore Upper expiry bound. @param {number} limit Row limit. @returns {Promise<object[]>} Email trials. */
    async listTrials(query, state, expiresBefore, limit = 200) {
      const result = await database
        .prepare(
          `SELECT l.id, l.account_id, a.email AS account_email, l.first_activated_at,
                  l.expires_at, l.revoked_at, l.admin_note
             FROM licenses l JOIN accounts a ON a.id = l.account_id
            WHERE l.source = 'email_trial'
              AND (?1 = '' OR a.email LIKE ?2)
              AND (?3 = '' OR (?3 = 'revoked' AND l.revoked_at IS NOT NULL)
                OR (?3 = 'active' AND l.revoked_at IS NULL AND l.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                OR (?3 = 'expired' AND l.revoked_at IS NULL AND l.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
              AND (?4 = '' OR l.expires_at <= ?4)
            ORDER BY l.first_activated_at DESC, l.id DESC LIMIT ?5`,
        )
        .bind(query, `%${query}%`, state, expiresBefore, limit)
        .all();
      return result.results || [];
    },

    /** @param {string} query Search query. @param {number} limit Maximum rows. @returns {Promise<object[]>} Recent immutable audit entries. */
    async listAuditEntries(query, limit = 200) {
      const result = await database
        .prepare(
          `SELECT log.id, log.actor_type, log.actor_id, log.action, log.target_type,
                  log.target_id, log.details_json, log.created_at, a.email AS account_email
             FROM authorization_audit_log log
             LEFT JOIN accounts a ON a.id = log.target_id AND log.target_type = 'account'
            WHERE (?1 = '' OR log.action LIKE ?2 OR log.target_id LIKE ?2 OR a.email LIKE ?2)
            ORDER BY log.created_at DESC, log.id DESC
            LIMIT ?3`,
        )
        .bind(query, `%${query}%`, limit)
        .all();
      return result.results || [];
    },

    /** @returns {Promise<object>} Compact authorization dashboard metrics. */
    async authorizationMetrics() {
      return database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM accounts) AS accounts,
             (SELECT COUNT(*) FROM accounts WHERE status = 'active') AS active_accounts,
             (SELECT COUNT(*) FROM licenses WHERE source = 'email_trial') AS trial_claims,
             (SELECT COUNT(*) FROM licenses WHERE source = 'admin_grant' AND revoked_at IS NULL) AS active_grants,
             (SELECT COUNT(*) FROM licenses WHERE expires_at IS NOT NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days') AND revoked_at IS NULL) AS expiring_soon`,
        )
        .first();
    },

    /** @param {object} update Account authorization update. @returns {Promise<object>} Result. */
    updateAccountAuthorization(update) {
      return database
        .prepare(
          `UPDATE accounts
              SET pro_override = ?2, pro_expires_at = ?3, revoked_at = ?4
            WHERE id = ?1`,
        )
        .bind(update.accountId, update.proOverride, update.proExpiresAt || null, update.revokedAt || null)
        .run();
    },

    /** @param {{accountId:string,status:string,reason?:string,changedAt:string}} update Account lifecycle update. @returns {Promise<object>} Result. */
    updateAccountStatus(update) {
      return database
        .prepare(
          `UPDATE accounts
              SET status = ?2,
                  suspended_at = CASE WHEN ?2 = 'suspended' THEN ?4 ELSE NULL END,
                  suspension_reason = CASE WHEN ?2 = 'suspended' THEN ?3 ELSE NULL END,
                  deleted_at = CASE WHEN ?2 = 'deleted' THEN ?4 ELSE NULL END
            WHERE id = ?1`,
        )
        .bind(update.accountId, update.status, update.reason || null, update.changedAt)
        .run();
    },

    /** @param {{id:string,accountId:string,durationDays:number,createdAt:string,expiresAt:string|null,note?:string}} grant Direct email authorization. @returns {Promise<object>} Result. */
    createAdminGrant(grant) {
      return database
        .prepare(
          `INSERT INTO licenses
             (id, source, plan, duration_days, first_activated_at, expires_at, account_id, admin_note)
           VALUES (?1, 'admin_grant', 'pro', ?3, ?4, ?5, ?2, ?6)`,
        )
        .bind(
          grant.id,
          grant.accountId,
          grant.durationDays,
          grant.createdAt,
          grant.expiresAt,
          grant.note || null,
        )
        .run();
    },

    /** @param {{id:string,email:string,durationDays:number,createdAt:string,expiresAt:string,note?:string}} grant Pending direct email authorization. @returns {Promise<object>} Result. */
    createPendingAdminGrant(grant) {
      return database
        .prepare(
          `INSERT INTO pending_email_grants
             (id, email, duration_days, expires_at, admin_note, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(grant.id, grant.email, grant.durationDays, grant.expiresAt, grant.note || null, grant.createdAt)
        .run();
    },

    /** @param {string} key Client supplied idempotency key. @returns {Promise<object|null>} Previously recorded batch response. */
    findBatchIdempotency(key) {
      return database
        .prepare(
          `SELECT response_json, expires_at FROM admin_batch_idempotency
            WHERE idempotency_key = ?1 LIMIT 1`,
        )
        .bind(key)
        .first();
    },

    /** @param {{key:string,action:string,responseJson:string,createdAt:string,expiresAt:string}} entry Recorded batch result. @returns {Promise<object>} Result. */
    saveBatchIdempotency(entry) {
      return database
        .prepare(
          `INSERT INTO admin_batch_idempotency
             (idempotency_key, action, response_json, created_at, expires_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(entry.key, entry.action, entry.responseJson, entry.createdAt, entry.expiresAt)
        .run();
    },

    /** @param {string} accountId Verified account ID. @param {string} email Verified email. @returns {Promise<object[]>} Binding results. */
    async claimPendingGrantsForAccount(accountId, email) {
      const pending = await database
        .prepare(
          `SELECT id, duration_days, created_at, expires_at, admin_note
             FROM pending_email_grants WHERE email = ?1 ORDER BY created_at ASC`,
        )
        .bind(email)
        .all();
      const grants = pending.results || [];
      if (!grants.length) return [];
      const results = await database.batch([
        ...grants.map((grant) =>
          database
            .prepare(
              `INSERT INTO licenses
                 (id, source, plan, duration_days, first_activated_at, expires_at, account_id, admin_note)
               VALUES (?1, 'admin_grant', 'pro', ?2, ?3, ?4, ?5, ?6)`,
            )
            .bind(
              grant.id,
              grant.duration_days,
              grant.created_at,
              grant.expires_at,
              accountId,
              grant.admin_note,
            ),
        ),
        database.prepare("DELETE FROM pending_email_grants WHERE email = ?1").bind(email),
      ]);
      return results;
    },

    /** @param {string} licenseId Grant or trial ID. @param {string|null} expiresAt New expiry. @param {string|null} note New note. @returns {Promise<object>} Result. */
    updateEmailLicense(licenseId, expiresAt, note) {
      return database
        .prepare(
          `UPDATE licenses SET expires_at = COALESCE(?2, expires_at),
                               admin_note = COALESCE(?3, admin_note)
            WHERE id = ?1 AND source IN ('email_trial', 'admin_grant')`,
        )
        .bind(licenseId, expiresAt, note)
        .run();
    },

    /** @param {string} licenseId Trial or direct grant ID. @returns {Promise<object|null>} Email authorization row. */
    findEmailLicenseById(licenseId) {
      return database
        .prepare(
          `SELECT id, source, account_id, expires_at, revoked_at, admin_note
             FROM licenses WHERE id = ?1 AND source IN ('email_trial', 'admin_grant') LIMIT 1`,
        )
        .bind(licenseId)
        .first();
    },

    /** @param {string} licenseId Grant or trial record. @param {string|null} revokedAt Revocation time. @returns {Promise<object>} Result. */
    setEmailLicenseRevoked(licenseId, revokedAt) {
      return database
        .prepare(
          "UPDATE licenses SET revoked_at = ?2 WHERE id = ?1 AND source IN ('email_trial', 'admin_grant')",
        )
        .bind(licenseId, revokedAt)
        .run();
    },

    /** @param {boolean} enabled Global default. @param {string} updatedAt Time. @returns {Promise<object>} Result. */
    setDefaultProEnabled(enabled, updatedAt) {
      return database
        .prepare(
          `INSERT INTO authorization_settings (key, value, updated_at)
           VALUES ('default_pro_enabled', ?1, ?2)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(enabled ? "true" : "false", updatedAt)
        .run();
    },

    /** @param {string} licenseId License ID. @param {string|null} accountId Account ID. @returns {Promise<object>} Result. */
    rebindLicense(licenseId, accountId) {
      return database
        .prepare("UPDATE licenses SET account_id = ?2 WHERE id = ?1 AND source = 'code'")
        .bind(licenseId, accountId)
        .run();
    },

    /** @param {object} entry Audit entry. @returns {Promise<object>} Result. */
    createAuditEntry(entry) {
      return database
        .prepare(
          `INSERT INTO authorization_audit_log
             (id, actor_type, actor_id, action, target_type, target_id, details_json, created_at)
           VALUES (?1, 'admin', ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(
          entry.id,
          entry.actorId,
          entry.action,
          entry.targetType,
          entry.targetId,
          entry.detailsJson,
          entry.createdAt,
        )
        .run();
    },
  };
}
