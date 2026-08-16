import assert from "node:assert/strict";
import test from "node:test";

import { createAdminAccountService } from "../../cloudflare/site/src/admin_account_service.mjs";

/** @returns {{service:object,calls:object}} Service fixture. */
function createFixture() {
  const calls = { audits: [], revokedSessions: [] };
  const repository = {
    async listAccounts(query) {
      return [{ id: "account-1", email: query || "person@example.com" }];
    },
    async defaultProEnabled() {
      return true;
    },
    async updateAccountAuthorization(update) {
      calls.accountUpdate = update;
      return { meta: { changes: 1 } };
    },
    async revokeAccountSessions(accountId) {
      calls.revokedSessions.push(accountId);
    },
    async setDefaultProEnabled(enabled) {
      calls.defaultProEnabled = enabled;
    },
    async findAccountById(accountId) {
      return accountId === "account-1" ? { id: accountId } : null;
    },
    async rebindLicense(licenseId, accountId) {
      calls.binding = { licenseId, accountId };
      return { meta: { changes: 1 } };
    },
    async createAuditEntry(entry) {
      calls.audits.push(entry);
    },
  };
  return {
    calls,
    service: createAdminAccountService(
      {},
      {
        repository,
        now: () => Date.parse("2026-08-10T00:00:00.000Z"),
        cryptoApi: { randomUUID: () => `audit-${calls.audits.length + 1}` },
      },
    ),
  };
}

test("administrator lists accounts and the global Pro default", async () => {
  const { service } = createFixture();
  const result = await service.list("PERSON@EXAMPLE.COM");
  assert.equal(result.defaultProEnabled, true);
  assert.equal(result.accounts[0].email, "person@example.com");
});

test("administrator updates account access and force-revokes sessions", async () => {
  const { service, calls } = createFixture();
  await service.updateAccount({
    accountId: "account-1",
    proOverride: "disabled",
    forceLogout: true,
  });
  assert.equal(calls.accountUpdate.proOverride, "disabled");
  assert.deepEqual(calls.revokedSessions, ["account-1"]);
  assert.equal(calls.audits[0].action, "account.authorization.updated");
});

test("administrator changes global default and audits license rebinding", async () => {
  const { service, calls } = createFixture();
  await service.updateSettings({ defaultProEnabled: false });
  await service.rebindLicense({ licenseId: "license-1", accountId: "account-1" });
  assert.equal(calls.defaultProEnabled, false);
  assert.deepEqual(calls.binding, { licenseId: "license-1", accountId: "account-1" });
  assert.deepEqual(
    calls.audits.map((entry) => entry.action),
    ["settings.default_pro.updated", "license.account.rebound"],
  );
});

test("administrator creates a pending grant for an unverified email instead of creating an account", async () => {
  const pendingCalls = [];
  const pendingService = createAdminAccountService(
    {},
    {
      now: () => Date.parse("2026-08-10T00:00:00.000Z"),
      cryptoApi: { randomUUID: () => "pending-grant-1" },
      repository: {
        async findAccountByEmail() {
          return null;
        },
        async createPendingAdminGrant(grant) {
          pendingCalls.push(grant);
        },
        async createAuditEntry() {},
      },
    },
  );
  const result = await pendingService.createGrant({
    accountEmail: "pending@example.com",
    durationDays: 30,
    note: "campaign",
  });
  assert.equal(result.pending, true);
  assert.equal(result.accountId, null);
  assert.equal(pendingCalls[0].email, "pending@example.com");
});

test("batch grants replay the saved result for the same idempotency key", async () => {
  const saved = new Map();
  const pending = [];
  let sequence = 0;
  const service = createAdminAccountService(
    {},
    {
      now: () => Date.parse("2026-08-10T00:00:00.000Z"),
      cryptoApi: { randomUUID: () => `grant-${++sequence}` },
      repository: {
        async findBatchIdempotency(key) {
          return saved.get(key) || null;
        },
        async saveBatchIdempotency(entry) {
          saved.set(entry.key, { response_json: entry.responseJson, expires_at: entry.expiresAt });
        },
        async findAccountByEmail() {
          return null;
        },
        async createPendingAdminGrant(grant) {
          pending.push(grant);
        },
        async createAuditEntry() {},
      },
    },
  );
  const request = {
    emails: ["one@example.com", "two@example.com"],
    durationDays: 7,
    idempotencyKey: "batch-grant-20260810",
  };
  const first = await service.createGrantBatch(request);
  const replay = await service.createGrantBatch(request);
  assert.deepEqual(replay, first);
  assert.equal(pending.length, 2);
});
