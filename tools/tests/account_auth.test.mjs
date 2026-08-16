import assert from "node:assert/strict";
import test from "node:test";

import {
  createAccountAuthService,
  handleAccountAuthRequest,
  normalizeEmail,
  resolveAccountEntitlement,
} from "../../cloudflare/site/src/account_auth.mjs";
import { signToken } from "../../cloudflare/site/src/activation_crypto.mjs";
import { createEmailSender } from "../../cloudflare/site/src/email_sender.mjs";

test("email normalization preserves provider-specific aliases", () => {
  assert.equal(normalizeEmail("  Name+tag@Example.COM "), "name+tag@example.com");
  assert.throws(() => normalizeEmail("missing-at.example.com"), /有效的邮箱/u);
});

test("account entitlement applies override, license, then global precedence", () => {
  const now = Date.parse("2026-08-10T00:00:00.000Z");
  const account = { id: "account-1", pro_override: "inherit", pro_expires_at: null, revoked_at: null };
  assert.deepEqual(resolveAccountEntitlement(account, [], true, now), {
    proEnabled: true,
    source: "global_default",
    expiresAt: "",
  });
  assert.equal(
    resolveAccountEntitlement(
      account,
      [{ expires_at: "2026-08-11T00:00:00.000Z", revoked_at: null }],
      false,
      now,
    ).source,
    "activation_code",
  );
  assert.equal(
    resolveAccountEntitlement({ ...account, pro_override: "disabled" }, [], true, now).proEnabled,
    false,
  );
  assert.equal(
    resolveAccountEntitlement(
      { ...account, pro_override: "enabled", pro_expires_at: "2026-08-11T00:00:00.000Z" },
      [],
      false,
      now,
    ).proEnabled,
    true,
  );
  assert.deepEqual(resolveAccountEntitlement({ ...account, status: "suspended" }, [], true, now), {
    proEnabled: false,
    source: "account_disabled",
    expiresAt: "",
  });
  assert.equal(resolveAccountEntitlement({ ...account, status: "deleted" }, [], true, now).proEnabled, false);
});

test("password challenge routes set and clear seven-day HttpOnly sessions", async () => {
  const service = {
    async verifyPasswordChallenge() {
      return {
        authenticated: true,
        accountId: "account-1",
        email: "person@example.com",
        proEnabled: true,
        token: "session-token",
      };
    },
    cookieHeader() {
      return "xsxb_account=session-token; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800; Secure";
    },
    async logout() {},
    clearCookieHeader() {
      return "xsxb_account=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure";
    },
  };
  const login = await handleAccountAuthRequest(
    new Request("https://example.test/api/auth/challenge/verify", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.test" },
      body: JSON.stringify({ challengeToken: "opaque-challenge", code: "123456" }),
    }),
    {},
    { service },
  );
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /Max-Age=604800/u);
  assert.doesNotMatch(await login.text(), /session-token/u);

  const logout = await handleAccountAuthRequest(
    new Request("https://example.test/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://example.test" },
    }),
    {},
    { service },
  );
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/u);
});

test("unified password route lets the backend select an administrator TOTP challenge", async () => {
  let submittedCredentials = null;
  const response = await handleAccountAuthRequest(
    new Request("https://example.test/api/auth/password/start", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.test" },
      body: JSON.stringify({ identifier: "sirhao", password: "administrator-password" }),
    }),
    { XSXB_ADMIN_USERNAME: "sirhao" },
    {
      service: {},
      adminService: {
        async startLogin(credentials) {
          submittedCredentials = credentials;
          return { challengeType: "admin_totp", challengeToken: "signed-challenge" };
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(submittedCredentials, {
    username: "sirhao",
    password: "administrator-password",
  });
  assert.equal((await response.json()).challengeType, "admin_totp");
});

test("administrator workbench session grants Pro without consuming the regular account session", async () => {
  const now = Date.parse("2026-08-10T00:00:00.000Z");
  const secret = "test-secret-with-at-least-thirty-two-characters";
  const token = await signToken(
    { type: "admin-session", username: "frame-admin", exp: now + 4 * 60 * 60 * 1000 },
    secret,
    crypto.subtle,
  );
  let revokedRegularSession = false;
  const service = createAccountAuthService(
    { XSXB_ACTIVATION_SECRET: secret, XSXB_ADMIN_USERNAME: "frame-admin" },
    {
      now: () => now,
      emailSender: { configured: true },
      repository: {
        async revokeSession() {
          revokedRegularSession = true;
        },
      },
    },
  );
  const request = new Request("https://example.test/api/auth/session", {
    headers: {
      cookie: `xsxb_admin_workbench=${encodeURIComponent(token)}; xsxb_account=regular-token`,
    },
  });

  const status = await service.status(request);
  assert.equal(status.authenticated, true);
  assert.equal(status.administrator, true);
  assert.equal(status.proEnabled, true);
  assert.equal(status.source, "administrator");
  assert.equal(status.accountId, "administrator:frame-admin");

  const logout = await service.logout(request);
  assert.deepEqual(logout, { administrator: true });
  assert.equal(revokedRegularSession, false);
  assert.match(service.clearAdminWorkbenchCookieHeader(request), /^xsxb_admin_workbench=/u);
});

test("password login OTP uses the same send budget as requestCode", async () => {
  const sends = [];
  const repository = {
    async findAccountByEmail() {
      return null;
    },
    async findLatestVerificationCode() {
      return { created_at: "2026-08-10T00:00:00.000Z" };
    },
    async findLatestAuthChallenge() {
      return { created_at: "2026-08-10T00:00:00.000Z" };
    },
    async countRecentCodesForEmail() {
      return 0;
    },
    async countRecentCodesForIp() {
      return 0;
    },
    async countRecentAuthChallengesForEmail() {
      return 0;
    },
    async countRecentAuthChallengesForIp() {
      return 0;
    },
    async createAuthChallenge() {
      throw new Error("should not create a challenge while rate limited");
    },
  };
  const service = createAccountAuthService(
    { XSXB_ACTIVATION_SECRET: "x".repeat(32) },
    {
      repository,
      now: () => Date.parse("2026-08-10T00:00:30.000Z"),
      emailSender: {
        configured: true,
        async sendVerificationCode() {
          sends.push("sent");
        },
      },
    },
  );
  await assert.rejects(
    () => service.startPasswordLogin("person@example.com", "password", new Request("https://example.test/")),
    (error) => error.status === 429 && /过于频繁/u.test(error.message),
  );
  assert.equal(sends.length, 0);
});

test("Resend sender submits bounded verification email content", async () => {
  const calls = [];
  const sender = createEmailSender(
    { RESEND_API_KEY: "secret", XSXB_EMAIL_FROM: "XSXB <login@example.com>" },
    {
      async fetchImpl(url, init) {
        calls.push({ url, init });
        return new Response("{}", { status: 200 });
      },
    },
  );
  await sender.sendVerificationCode("person@example.com", "123456");
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to, ["person@example.com"]);
  assert.match(body.text, /123456/u);
});

test("activation codes bind to the authenticated account without device limits", async () => {
  const currentTime = Date.parse("2026-08-10T00:00:00.000Z");
  const account = {
    id: "account-1",
    email: "person@example.com",
    pro_override: "inherit",
    pro_expires_at: null,
    revoked_at: null,
  };
  const repository = {
    async findSessionByTokenHash() {
      return {
        ...account,
        session_id: "session-1",
        session_expires_at: "2026-08-17T00:00:00.000Z",
        session_revoked_at: null,
      };
    },
    async touchSession() {},
    async listAccountLicenses() {
      return [];
    },
    async defaultProEnabled() {
      return true;
    },
    async findLicenseByCodeHash() {
      return {
        id: "license-1",
        account_id: null,
        duration_days: 30,
        first_activated_at: null,
        expires_at: null,
        revoked_at: null,
        redeem_by: null,
      };
    },
    async bindLicenseToAccount(binding) {
      assert.equal(binding.accountId, "account-1");
      return { meta: { changes: 1 } };
    },
    async findAccountById() {
      return account;
    },
  };
  const service = createAccountAuthService(
    { XSXB_ACTIVATION_SECRET: "x".repeat(32) },
    { repository, now: () => currentTime, emailSender: { configured: true } },
  );
  const result = await service.redeem(
    "XSXB-PRO-CODE",
    new Request("https://example.test/api/entitlements/redeem", {
      headers: { cookie: "xsxb_account=session-token" },
    }),
  );
  assert.equal(result.authenticated, true);
});
