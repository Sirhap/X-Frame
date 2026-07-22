import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createAdminService,
  decodeBase32Secret,
  generateTotp,
  handleAdminRequest,
  TOTP_PERIOD_SECONDS,
  verifyTotp,
} from "../../cloudflare/site/src/admin.mjs";

const adminTotpSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const adminUsername = "frame-admin";
const activationSecret = "test-secret-with-at-least-thirty-two-characters";
const fixedNow = Date.parse("2026-07-22T08:00:00.000Z");

/** @returns {{repository:object,state:object}} In-memory administrator repository. */
function createAdminRepositoryFixture() {
  const state = { attempts: new Map(), consumedCounters: new Set(), licenses: [], devices: [] };
  return {
    state,
    repository: {
      async findLoginAttempt(fingerprintHash) {
        return state.attempts.get(fingerprintHash) || null;
      },
      async saveLoginAttempt(attempt) {
        state.attempts.set(attempt.fingerprintHash, {
          failed_count: attempt.failedCount,
          window_started_at: attempt.windowStartedAt,
          blocked_until: attempt.blockedUntil,
        });
        return { success: true };
      },
      async clearLoginAttempt(fingerprintHash) {
        state.attempts.delete(fingerprintHash);
        return { success: true };
      },
      async consumeTotpCounter(counter) {
        if (state.consumedCounters.has(counter)) return false;
        state.consumedCounters.add(counter);
        return true;
      },
      async listLicenses(limit) {
        return state.licenses.slice(-limit).reverse();
      },
      async listLicenseDevices(licenseIds) {
        return state.devices.filter((device) => licenseIds.includes(device.license_id));
      },
      async createLicenses(licenses) {
        if (
          new Set(licenses.map((license) => license.codeHash)).size !== licenses.length ||
          licenses.some((license) => state.licenses.some((entry) => entry.code_hash === license.codeHash))
        ) {
          throw new Error("UNIQUE constraint failed: licenses.code_hash");
        }
        state.licenses.push(
          ...licenses.map((license) => ({
            id: license.id,
            code_hash: license.codeHash,
            code_ciphertext: license.codeCiphertext,
            plan: "standard",
            duration_days: license.durationDays,
            max_devices: license.maxDevices,
            redeem_by: license.redeemBy,
            first_activated_at: null,
            expires_at: license.expiresAt,
            revoked_at: null,
            device_name: null,
            last_seen_at: null,
          })),
        );
        return { success: true };
      },
      async findLicensesByIds(ids) {
        return state.licenses.filter((license) => ids.includes(license.id));
      },
      async updateLicenses(licenses) {
        for (const update of licenses) {
          const stored = state.licenses.find((license) => license.id === update.id);
          Object.assign(stored, {
            duration_days: update.durationDays,
            max_devices: update.maxDevices,
            redeem_by: update.redeemBy,
            expires_at: update.expiresAt,
          });
        }
        return { success: true };
      },
      async setLicensesRevoked(ids, revokedAt) {
        for (const license of state.licenses.filter((entry) => ids.includes(entry.id))) {
          license.revoked_at = revokedAt;
        }
        return { success: true };
      },
      async deleteLicenses(ids) {
        state.licenses = state.licenses.filter((license) => !ids.includes(license.id));
        state.devices = state.devices.filter((device) => !ids.includes(device.license_id));
        return { success: true };
      },
      async findDevicesByIds(ids) {
        return state.devices.filter((device) => ids.includes(device.id));
      },
      async setDevicesRevoked(ids, revokedAt) {
        for (const device of state.devices.filter((entry) => ids.includes(entry.id))) {
          device.revoked_at = revokedAt;
        }
        return { success: true };
      },
      async deleteDevices(ids) {
        state.devices = state.devices.filter((device) => !ids.includes(device.id));
        return { success: true };
      },
    },
  };
}

/** @param {string} pathname API path. @param {object} [options] Request overrides. @returns {Request} Same-origin request. */
function adminRequest(pathname, options = {}) {
  return new Request(`https://example.com${pathname}`, {
    headers: { origin: "https://example.com", "cf-connecting-ip": "203.0.113.20", ...options.headers },
    method: options.method || "GET",
    body: options.body,
  });
}

/** @param {object} repository Repository adapter. @param {number} [now] Current epoch. @returns {object} Configured service. */
function configuredService(repository, now = fixedNow) {
  return createAdminService(
    {
      XSXB_ACTIVATION_SECRET: activationSecret,
      XSXB_ADMIN_TOTP_SECRET: adminTotpSecret,
      XSXB_ADMIN_USERNAME: adminUsername,
    },
    { repository, now: () => now },
  );
}

test("TOTP implementation matches the RFC SHA-1 counter vector and uses Google-compatible periods", async () => {
  const secret = decodeBase32Secret(adminTotpSecret);
  assert.equal(await generateTotp(secret, 1, crypto.subtle), "287082");
  assert.equal(TOTP_PERIOD_SECONDS, 30);
});

test("TOTP verification accepts only the current 30-second window", async () => {
  const secret = decodeBase32Secret(adminTotpSecret);
  const currentCounter = Math.floor(fixedNow / (TOTP_PERIOD_SECONDS * 1000));
  const previousCode = await generateTotp(secret, currentCounter - 1, crypto.subtle);
  const currentCode = await generateTotp(secret, currentCounter, crypto.subtle);

  assert.equal(await verifyTotp(previousCode, secret, fixedNow, crypto.subtle), null);
  assert.equal(await verifyTotp(currentCode, secret, fixedNow, crypto.subtle), currentCounter);
});

test("administrator username defaults to admin when the optional variable is omitted", async () => {
  const { repository } = createAdminRepositoryFixture();
  const service = createAdminService(
    {
      XSXB_ACTIVATION_SECRET: activationSecret,
      XSXB_ADMIN_TOTP_SECRET: adminTotpSecret,
    },
    { repository, now: () => fixedNow },
  );
  const counter = Math.floor(fixedNow / (TOTP_PERIOD_SECONDS * 1000));
  const code = await generateTotp(decodeBase32Secret(adminTotpSecret), counter, crypto.subtle);

  const login = await service.login({ username: "admin", code }, adminRequest("/api/admin/login"));

  assert.equal(login.username, "admin");
});

test("administrator login creates a short HttpOnly session and rejects code replay", async () => {
  const { repository } = createAdminRepositoryFixture();
  const service = configuredService(repository);
  const counter = Math.floor(fixedNow / (TOTP_PERIOD_SECONDS * 1000));
  const code = await generateTotp(decodeBase32Secret(adminTotpSecret), counter, crypto.subtle);
  const request = adminRequest("/api/admin/login");
  const login = await service.login({ username: adminUsername, code }, request);
  const cookie = service.cookieHeader(login.token, request);

  assert.match(cookie, /^xsxb_admin=/u);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Strict/u);
  assert.match(cookie, /Path=\/api\/admin/u);
  assert.equal(
    (await service.status(adminRequest("/api/admin/session", { headers: { cookie } }))).authenticated,
    true,
  );
  assert.equal(login.username, adminUsername);
  const session = await service.status(adminRequest("/api/admin/session", { headers: { cookie } }));
  assert.equal(session.username, adminUsername);
  await assert.rejects(
    service.login({ username: adminUsername, code }, request),
    (error) => error.status === 409,
  );
});

test("administrator login requires the configured username without revealing which field failed", async () => {
  const { repository, state } = createAdminRepositoryFixture();
  const service = configuredService(repository);
  const counter = Math.floor(fixedNow / (TOTP_PERIOD_SECONDS * 1000));
  const code = await generateTotp(decodeBase32Secret(adminTotpSecret), counter, crypto.subtle);
  const request = adminRequest("/api/admin/login");

  await assert.rejects(
    service.login({ username: "different-admin", code }, request),
    (error) => error.status === 401 && error.message === "The username or verification code is invalid.",
  );
  assert.equal(state.consumedCounters.size, 0);
});

test("administrator login blocks a client after repeated invalid codes", async () => {
  const { repository } = createAdminRepositoryFixture();
  const service = configuredService(repository);
  const counter = Math.floor(fixedNow / (TOTP_PERIOD_SECONDS * 1000));
  const validCode = await generateTotp(decodeBase32Secret(adminTotpSecret), counter, crypto.subtle);
  const invalidCode = validCode === "000000" ? "111111" : "000000";
  const request = adminRequest("/api/admin/login");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      service.login({ username: adminUsername, code: invalidCode }, request),
      (error) => error.status === 401,
    );
  }
  await assert.rejects(
    service.login({ username: adminUsername, code: validCode }, request),
    (error) => error.status === 429,
  );
});

test("authenticated administrator batch creates standard licenses without storing plaintext", async () => {
  const { repository, state } = createAdminRepositoryFixture();
  const service = configuredService(repository);
  const counter = Math.floor(fixedNow / (TOTP_PERIOD_SECONDS * 1000));
  const code = await generateTotp(decodeBase32Secret(adminTotpSecret), counter, crypto.subtle);
  const loginRequest = adminRequest("/api/admin/login");
  const login = await service.login({ username: adminUsername, code }, loginRequest);
  const cookie = service.cookieHeader(login.token, loginRequest);
  const authenticatedRequest = adminRequest("/api/admin/licenses", { headers: { cookie } });
  const result = await service.createLicenses(
    {
      codes: [" xsxb-admin-test-01 ", "xsxb-admin-test-02"],
      durationDays: 90,
      maxDevices: 5,
    },
    authenticatedRequest,
  );

  assert.deepEqual(result.codes, ["XSXB-ADMIN-TEST-01", "XSXB-ADMIN-TEST-02"]);
  assert.equal(result.license.durationDays, 90);
  assert.equal(result.license.maxDevices, 5);
  assert.equal(result.license.status, "unused");
  assert.equal(result.license.plan, undefined);
  assert.equal(state.licenses.length, 2);
  assert.notEqual(state.licenses[0].code_hash, result.code);
  assert.notEqual(state.licenses[0].code_ciphertext, result.code);
  assert.match(state.licenses[0].code_ciphertext, /^v1\./u);
  assert.equal(Object.values(state.licenses[0]).includes(result.code), false);
  assert.equal(state.licenses[0].plan, "standard");
  assert.equal(state.licenses[0].max_devices, 5);
  assert.equal(state.licenses[0].redeem_by, "9999-12-31T23:59:59.999Z");
  const listedLicenses = await service.listLicenses(authenticatedRequest);
  assert.equal(listedLicenses[0].plan, undefined);
  assert.equal(listedLicenses[0].code, "XSXB-ADMIN-TEST-02");
  assert.equal(listedLicenses[0].codeAvailable, true);
  await assert.rejects(
    service.createLicenses({ code: result.code, durationDays: 90 }, authenticatedRequest),
    (error) => error.status === 409,
  );

  const permanent = await service.createLicenses(
    { code: "XSXB-ADMIN-PERMANENT", durationDays: 3, permanent: true },
    authenticatedRequest,
  );
  assert.equal(permanent.license.permanent, true);
  assert.equal(permanent.license.expiresAt, "9999-12-31T23:59:59.999Z");

  state.licenses[0].code_ciphertext = "v1.invalid.invalid";
  const corrupted = (await service.listLicenses(authenticatedRequest)).find(
    (license) => license.id === state.licenses[0].id,
  );
  assert.equal(corrupted.code, "");
  assert.equal(corrupted.codeAvailable, false);
});

test("administrator batch updates active expiry, revokes, restores, and deletes licenses", async () => {
  const { repository, state } = createAdminRepositoryFixture();
  const service = configuredService(repository);
  const counter = Math.floor(fixedNow / (TOTP_PERIOD_SECONDS * 1000));
  const code = await generateTotp(decodeBase32Secret(adminTotpSecret), counter, crypto.subtle);
  const loginRequest = adminRequest("/api/admin/login");
  const login = await service.login({ username: adminUsername, code }, loginRequest);
  const cookie = service.cookieHeader(login.token, loginRequest);
  const request = adminRequest("/api/admin/licenses", { headers: { cookie } });
  const created = await service.createLicenses(
    { codes: ["XSXB-BATCH-CRUD-01", "XSXB-BATCH-CRUD-02"], durationDays: 3 },
    request,
  );
  state.licenses[0].first_activated_at = "2026-07-20T08:00:00.000Z";
  state.devices.push({
    id: "device-admin-test-01",
    license_id: state.licenses[0].id,
    device_name: "Test Mac",
    first_country: "CN",
    last_country: "CN",
    created_at: "2026-07-20T08:00:00.000Z",
    last_seen_at: "2026-07-22T08:00:00.000Z",
    revoked_at: null,
  });

  const updated = await service.updateLicenses(
    {
      ids: created.licenses.map((license) => license.id),
      durationDays: 10,
      maxDevices: 3,
      redeemBy: "2027-01-01T00:00:00.000Z",
    },
    request,
  );
  assert.equal(updated.count, 2);
  assert.equal(state.licenses[0].expires_at, "2026-07-30T08:00:00.000Z");
  assert.equal(state.licenses[0].max_devices, 3);
  assert.equal(state.licenses[1].expires_at, null);

  const permanent = await service.updateLicenses(
    { ids: created.licenses.map((license) => license.id), permanent: true },
    request,
  );
  assert.equal(
    permanent.licenses.every((license) => license.permanent),
    true,
  );
  assert.equal(state.licenses[0].expires_at, "9999-12-31T23:59:59.999Z");
  assert.equal(state.licenses[1].expires_at, "9999-12-31T23:59:59.999Z");

  await service.updateLicenses(
    { ids: [created.licenses[0].id], durationDays: 10, permanent: false },
    request,
  );
  assert.equal(state.licenses[0].expires_at, "2026-07-30T08:00:00.000Z");

  await service.setLicensesRevoked({ ids: [created.licenses[0].id], revoked: true }, request);
  assert.equal(state.licenses[0].revoked_at, "2026-07-22T08:00:00.000Z");
  await service.setLicensesRevoked({ ids: [created.licenses[0].id], revoked: false }, request);
  assert.equal(state.licenses[0].revoked_at, null);

  const deleted = await service.deleteLicenses({ ids: [created.licenses[1].id] }, request);
  assert.equal(deleted.count, 1);
  assert.equal(state.licenses.length, 1);
});

test("administrator lists, revokes, restores, and resets individual devices", async () => {
  const { repository, state } = createAdminRepositoryFixture();
  const service = configuredService(repository);
  const counter = Math.floor(fixedNow / (TOTP_PERIOD_SECONDS * 1000));
  const code = await generateTotp(decodeBase32Secret(adminTotpSecret), counter, crypto.subtle);
  const loginRequest = adminRequest("/api/admin/login");
  const login = await service.login({ username: adminUsername, code }, loginRequest);
  const cookie = service.cookieHeader(login.token, loginRequest);
  const request = adminRequest("/api/admin/licenses", { headers: { cookie } });
  const created = await service.createLicenses(
    { code: "XSXB-DEVICE-ADMIN", durationDays: 30, maxDevices: 3 },
    request,
  );
  state.devices.push({
    id: "device-admin-list-01",
    license_id: created.license.id,
    device_name: "MacBook Pro",
    first_country: "CN",
    last_country: "CN",
    created_at: "2026-07-21T08:00:00.000Z",
    last_seen_at: "2026-07-22T08:00:00.000Z",
    revoked_at: null,
  });

  const listed = await service.listLicenses(request);
  assert.equal(listed[0].activeDeviceCount, 1);
  assert.equal(listed[0].devices[0].name, "MacBook Pro");

  await service.setDevicesRevoked({ ids: ["device-admin-list-01"], revoked: true }, request);
  assert.notEqual(state.devices[0].revoked_at, null);
  await service.setDevicesRevoked({ ids: ["device-admin-list-01"], revoked: false }, request);
  assert.equal(state.devices[0].revoked_at, null);
  await service.deleteDevices({ ids: ["device-admin-list-01"] }, request);
  assert.equal(state.devices.length, 0);
});

test("administrator API fails closed and rejects cross-origin login", async () => {
  const unconfigured = await handleAdminRequest(adminRequest("/api/admin/session"), {});
  assert.deepEqual(await unconfigured.json(), {
    authenticated: false,
    configured: false,
    periodSeconds: 30,
    sessionExpiresAt: "",
    username: "",
  });

  const { repository } = createAdminRepositoryFixture();
  const response = await handleAdminRequest(
    adminRequest("/api/admin/login", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ username: adminUsername, code: "000000" }),
    }),
    {
      LICENSE_DB: { prepare() {} },
      XSXB_ACTIVATION_SECRET: activationSecret,
      XSXB_ADMIN_TOTP_SECRET: adminTotpSecret,
      XSXB_ADMIN_USERNAME: adminUsername,
    },
  );
  assert.equal(response.status, 403);
});

test("administrator control links to a dedicated non-modal management page", () => {
  const landing = fs.readFileSync(new URL("../animation_tuner/public/landing.html", import.meta.url), "utf8");
  const admin = fs.readFileSync(new URL("../animation_tuner/public/admin.html", import.meta.url), "utf8");
  const workbench = fs.readFileSync(new URL("../animation_tuner/public/index.html", import.meta.url), "utf8");
  const buildScript = fs.readFileSync(new URL("../cloudflare/build_site.js", import.meta.url), "utf8");

  assert.match(landing, /id="adminOpenButton"[^>]+href="\/admin\/licenses"/u);
  assert.doesNotMatch(landing, /<dialog/u);
  assert.doesNotMatch(landing, /landing-admin\.js/u);
  assert.match(admin, /id="adminBatchCount"/u);
  assert.match(admin, /id="adminMaxDevices"/u);
  assert.match(admin, /id="adminBulkMaxDevices"/u);
  assert.match(admin, /value="9999-12-31T23:59"/u);
  assert.match(admin, /id="adminCopySelectedButton"/u);
  assert.match(admin, /id="adminCopyAllButton"/u);
  assert.match(admin, /id="adminPermanentDurationButton"/u);
  assert.match(admin, /id="adminBulkPermanentButton"/u);
  assert.match(admin, /<main id="adminConsole" class="admin-console"/u);
  assert.doesNotMatch(admin, /<dialog/u);
  assert.doesNotMatch(admin, /admin-dialog/u);
  assert.doesNotMatch(admin, /id="adminPlan"/u);
  assert.doesNotMatch(admin, /id="adminExpiresAt"/u);
  assert.doesNotMatch(workbench, /id="adminOpenButton"/u);
  assert.match(buildScript, /admin\.html/u);
  assert.match(buildScript, /landing-admin\.js/u);
  assert.match(buildScript, /assets\/landing/u);
  assert.match(buildScript, /fs\.cpSync\(landingAssetsSource/u);
});
