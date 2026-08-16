import { createAccountRepository } from "./account_repository.mjs";
import { resolveLicenseExpiry } from "./license_duration.mjs";

const PRO_OVERRIDES = new Set(["inherit", "enabled", "disabled"]);
const ACCOUNT_STATUSES = new Set(["active", "suspended", "deleted"]);
const PERMANENT_EXPIRY = "9999-12-31T23:59:59.999Z";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u;

/** @param {unknown} value Operator supplied email. @returns {string} Normalized valid email. */
function normalizeGrantEmail(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw Object.assign(new Error("请输入有效的邮箱地址。"), { status: 400 });
  }
  return email;
}

/** @param {unknown} value ISO timestamp. @returns {string|null} Valid ISO timestamp or null. */
function normalizeOptionalExpiry(value) {
  if (value === undefined || value === null || value === "") return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) throw Object.assign(new Error("到期时间无效。"), { status: 400 });
  return new Date(timestamp).toISOString();
}

/**
 * Creates administrator operations for email accounts and account-bound licenses.
 * @param {{LICENSE_DB?:D1Database}} env Worker environment.
 * @param {{repository?:object,cryptoApi?:Crypto,now?:()=>number}} [options] Adapters.
 * @returns {object} Administrator account service.
 */
export function createAdminAccountService(env, options = {}) {
  const repository = options.repository || createAccountRepository(env?.LICENSE_DB);
  const cryptoApi = options.cryptoApi || globalThis.crypto;
  const now = options.now || Date.now;

  /** @param {string} action Action. @param {string} targetType Type. @param {string} targetId ID. @param {object} details Details. @returns {Promise<void>} */
  async function audit(action, targetType, targetId, details) {
    await repository.createAuditEntry({
      id: cryptoApi.randomUUID(),
      actorId: "admin",
      action,
      targetType,
      targetId,
      detailsJson: JSON.stringify(details || {}),
      createdAt: new Date(now()).toISOString(),
    });
  }

  return {
    /** @param {unknown} query Search query. @returns {Promise<object>} Account list and setting. */
    async list(query) {
      const normalizedQuery = String(query || "")
        .trim()
        .toLowerCase()
        .slice(0, 254);
      const [accounts, defaultProEnabled] = await Promise.all([
        repository.listAccounts(normalizedQuery),
        repository.defaultProEnabled(),
      ]);
      return { accounts, defaultProEnabled };
    },

    /** @param {string} accountId Account ID. @returns {Promise<object>} Account detail without device identifiers. */
    async detail(accountId) {
      const account = await repository.findAccountById(String(accountId || "").trim());
      if (!account) throw Object.assign(new Error("账户不存在。"), { status: 404 });
      const [sessionCount, licenses, audit] = await Promise.all([
        repository.countActiveSessions(account.id),
        repository.listAccountLicenseTimeline(account.id),
        repository.listAuditEntriesForAccount(account.id),
      ]);
      return { account, sessionCount, licenses, audit };
    },

    /** @param {{q?:unknown,state?:unknown,expiresBefore?:unknown}} filters Trial filters. @returns {Promise<object>} Trial list. */
    async listTrials(filters = {}) {
      const q = String(filters.q || "")
        .trim()
        .toLowerCase()
        .slice(0, 254);
      const state = ["", "active", "expired", "revoked"].includes(String(filters.state || ""))
        ? String(filters.state || "")
        : "";
      const expiresBefore = normalizeOptionalExpiry(filters.expiresBefore) || "";
      return { trials: await repository.listTrials(q, state, expiresBefore) };
    },

    /** @param {unknown} query Search query. @returns {Promise<object>} Searchable, append-only authorization audit entries. */
    async listAudit(query) {
      const normalizedQuery = String(query || "")
        .trim()
        .toLowerCase()
        .slice(0, 254);
      return { entries: await repository.listAuditEntries(normalizedQuery) };
    },

    /** @returns {Promise<object>} Authorization dashboard metrics. */
    async metrics() {
      return repository.authorizationMetrics();
    },

    /** @param {object} payload Update payload. @returns {Promise<object>} Updated status. */
    async updateAccount(payload) {
      const accountId = String(payload.accountId || "").trim();
      const proOverride = String(payload.proOverride || "");
      if (!accountId || !PRO_OVERRIDES.has(proOverride)) {
        throw Object.assign(new Error("账户授权参数无效。"), { status: 400 });
      }
      const expiresAt = payload.proExpiresAt ? new Date(String(payload.proExpiresAt)).toISOString() : null;
      const revoked = Boolean(payload.revoked);
      const result = await repository.updateAccountAuthorization({
        accountId,
        proOverride,
        proExpiresAt: expiresAt,
        revokedAt: revoked ? new Date(now()).toISOString() : null,
      });
      if (Number(result?.meta?.changes ?? 0) !== 1)
        throw Object.assign(new Error("账户不存在。"), { status: 404 });
      if (revoked || payload.forceLogout)
        await repository.revokeAccountSessions(accountId, new Date(now()).toISOString());
      await audit("account.authorization.updated", "account", accountId, {
        proOverride,
        proExpiresAt: expiresAt,
        revoked,
        forceLogout: Boolean(payload.forceLogout),
      });
      return { updated: true };
    },

    /** @param {object} payload Lifecycle update. @returns {Promise<object>} Updated status. */
    async updateAccountStatus(payload) {
      const accountId = String(payload.accountId || "").trim();
      const status = String(payload.status || "");
      if (!accountId || !ACCOUNT_STATUSES.has(status)) {
        throw Object.assign(new Error("账户状态参数无效。"), { status: 400 });
      }
      const before = await repository.findAccountById(accountId);
      if (!before) throw Object.assign(new Error("账户不存在。"), { status: 404 });
      const changedAt = new Date(now()).toISOString();
      const result = await repository.updateAccountStatus({
        accountId,
        status,
        reason: String(payload.reason || "")
          .trim()
          .slice(0, 500),
        changedAt,
      });
      if (Number(result?.meta?.changes ?? 0) !== 1)
        throw Object.assign(new Error("账户不存在。"), { status: 404 });
      if (status !== "active") await repository.revokeAccountSessions(accountId, changedAt);
      await audit("account.status.updated", "account", accountId, {
        before: { status: before.status || "active" },
        after: { status, reason: status === "suspended" ? payload.reason || "" : "" },
      });
      return { updated: true, status };
    },

    /** @param {string} accountId Account to force-log out. @returns {Promise<object>} Result. */
    async revokeAccountSessions(accountId) {
      const id = String(accountId || "").trim();
      if (!id || !(await repository.findAccountById(id))) {
        throw Object.assign(new Error("账户不存在。"), { status: 404 });
      }
      await repository.revokeAccountSessions(id, new Date(now()).toISOString());
      await audit("account.sessions.revoked", "account", id, { forceLogout: true });
      return { revoked: true };
    },

    /** @param {object} payload Direct email Pro grant. @returns {Promise<object>} Grant summary. */
    async createGrant(payload) {
      const email = normalizeGrantEmail(payload.accountEmail || payload.email);
      const account = await repository.findAccountByEmail(email);
      const permanent = Boolean(payload.permanent);
      const durationDays = Number(payload.durationDays || 0);
      if (!permanent && (!Number.isSafeInteger(durationDays) || durationDays < 1)) {
        throw Object.assign(new Error("授权天数必须是正整数。"), { status: 400 });
      }
      const createdAt = new Date(now()).toISOString();
      const expiresAt = permanent ? PERMANENT_EXPIRY : resolveLicenseExpiry(now(), durationDays, false);
      const id = cryptoApi.randomUUID();
      const grant = {
        id,
        durationDays: permanent ? 1 : durationDays,
        createdAt,
        expiresAt,
        note: String(payload.note || "").slice(0, 500),
      };
      if (account) {
        await repository.createAdminGrant({ ...grant, accountId: account.id });
      } else {
        await repository.createPendingAdminGrant({ ...grant, email });
      }
      await audit("grant.created", account ? "license" : "pending_email_grant", id, {
        accountId: account?.id || null,
        email,
        pending: !account,
        permanent,
        durationDays,
        note: payload.note || "",
      });
      return { id, accountId: account?.id || null, email, expiresAt, pending: !account };
    },

    /** @param {object} payload Batch direct grants. @returns {Promise<object>} Per-email results. */
    async createGrantBatch(payload) {
      const emails = Array.isArray(payload.emails)
        ? [...new Set(payload.emails.map((email) => String(email).trim().toLowerCase()))]
        : [];
      if (!emails.length || emails.length > 200)
        throw Object.assign(new Error("请选择 1 到 200 个邮箱。"), { status: 400 });
      const idempotencyKey = String(payload.idempotencyKey || "");
      if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        throw Object.assign(new Error("批量授权需要有效的幂等键。"), { status: 400 });
      }
      const currentTime = now();
      const existing = await repository.findBatchIdempotency(idempotencyKey);
      if (existing && Date.parse(existing.expires_at) > currentTime) {
        try {
          return JSON.parse(existing.response_json);
        } catch (_error) {
          throw Object.assign(new Error("批量授权记录无效，请使用新的幂等键。"), { status: 409 });
        }
      }
      const results = [];
      for (const accountEmail of emails) {
        try {
          results.push({ accountEmail, ...(await this.createGrant({ ...payload, accountEmail })) });
        } catch (error) {
          results.push({ accountEmail, error: error.message });
        }
      }
      const response = { results };
      await repository.saveBatchIdempotency({
        key: idempotencyKey,
        action: "grant.batch",
        responseJson: JSON.stringify(response),
        createdAt: new Date(currentTime).toISOString(),
        expiresAt: new Date(currentTime + 24 * 60 * 60 * 1000).toISOString(),
      });
      return response;
    },

    /** @param {object} payload Batch account lifecycle update. @returns {Promise<object>} Per-account results. */
    async updateAccountStatusBatch(payload) {
      const accountIds = Array.isArray(payload.accountIds)
        ? [...new Set(payload.accountIds.map((id) => String(id || "").trim()).filter(Boolean))]
        : [];
      if (!accountIds.length || accountIds.length > 200) {
        throw Object.assign(new Error("请选择 1 到 200 个账户。"), { status: 400 });
      }
      const results = [];
      for (const accountId of accountIds) {
        try {
          results.push({ accountId, ...(await this.updateAccountStatus({ ...payload, accountId })) });
        } catch (error) {
          results.push({ accountId, error: error.message });
        }
      }
      return { results };
    },

    /** @param {object} payload Trial or grant revocation. @returns {Promise<object>} Result. */
    async setEmailLicenseRevoked(payload) {
      const licenseId = String(payload.licenseId || "").trim();
      if (!licenseId || typeof payload.revoked !== "boolean")
        throw Object.assign(new Error("授权操作参数无效。"), { status: 400 });
      const before = await repository.findEmailLicenseById(licenseId);
      if (!before) throw Object.assign(new Error("邮箱授权不存在。"), { status: 404 });
      const result = await repository.setEmailLicenseRevoked(
        licenseId,
        payload.revoked ? new Date(now()).toISOString() : null,
      );
      if (Number(result?.meta?.changes ?? 0) !== 1)
        throw Object.assign(new Error("邮箱授权不存在。"), { status: 404 });
      await audit("email_license.revocation.updated", "license", licenseId, {
        before: { revokedAt: before.revoked_at },
        after: { revokedAt: payload.revoked ? "set" : null },
      });
      return { updated: true, revoked: payload.revoked };
    },

    /** @param {object} payload Trial or grant adjustment. @returns {Promise<object>} Result. */
    async updateEmailLicense(payload) {
      const licenseId = String(payload.licenseId || "").trim();
      const expiresAt = normalizeOptionalExpiry(payload.expiresAt);
      const hasNote = Object.hasOwn(payload, "note");
      const note = hasNote ? String(payload.note || "").slice(0, 500) : null;
      if (!licenseId || (!expiresAt && !hasNote)) {
        throw Object.assign(new Error("请提供新的到期时间或运营备注。"), { status: 400 });
      }
      const before = await repository.findEmailLicenseById(licenseId);
      if (!before) throw Object.assign(new Error("邮箱授权不存在。"), { status: 404 });
      const result = await repository.updateEmailLicense(licenseId, expiresAt, note);
      if (Number(result?.meta?.changes ?? 0) !== 1)
        throw Object.assign(new Error("邮箱授权不存在。"), { status: 404 });
      await audit("email_license.updated", "license", licenseId, {
        before: { expiresAt: before.expires_at, note: before.admin_note },
        after: { expiresAt: expiresAt || before.expires_at, note: hasNote ? note : before.admin_note },
      });
      return { updated: true };
    },

    /** @param {object} payload Setting payload. @returns {Promise<object>} Setting. */
    async updateSettings(payload) {
      if (typeof payload.defaultProEnabled !== "boolean") {
        throw Object.assign(new Error("全局 Pro 开关参数无效。"), { status: 400 });
      }
      const updatedAt = new Date(now()).toISOString();
      await repository.setDefaultProEnabled(payload.defaultProEnabled, updatedAt);
      await audit("settings.default_pro.updated", "setting", "default_pro_enabled", {
        enabled: payload.defaultProEnabled,
      });
      return { defaultProEnabled: payload.defaultProEnabled };
    },

    /** @param {object} payload Binding payload. @returns {Promise<object>} Binding result. */
    async rebindLicense(payload) {
      const licenseId = String(payload.licenseId || "").trim();
      let accountId = payload.accountId ? String(payload.accountId).trim() : null;
      if (!licenseId) throw Object.assign(new Error("激活码记录无效。"), { status: 400 });
      if (!accountId && payload.accountEmail) {
        const email = String(payload.accountEmail).trim().toLowerCase();
        const account = await repository.findAccountByEmail(email);
        if (!account) throw Object.assign(new Error("目标邮箱账户不存在。"), { status: 404 });
        accountId = account.id;
      }
      if (accountId && !(await repository.findAccountById(accountId))) {
        throw Object.assign(new Error("目标账户不存在。"), { status: 404 });
      }
      const result = await repository.rebindLicense(licenseId, accountId);
      if (Number(result?.meta?.changes ?? 0) !== 1)
        throw Object.assign(new Error("激活码不存在。"), { status: 404 });
      await audit("license.account.rebound", "license", licenseId, {
        accountId,
        previousAccountId: payload.previousAccountId || null,
      });
      return { updated: true, accountId };
    },
  };
}
