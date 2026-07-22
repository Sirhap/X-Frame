import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import worker, { resolveAssetPath } from "../../cloudflare/site/src/index.mjs";
import {
  createActivationService,
  hashActivationCode,
  sanitizeActivationResult,
} from "../../cloudflare/site/src/activation.mjs";

const activationSecret = "test-secret-with-at-least-thirty-two-characters";
const dayMs = 86_400_000;

test("static asset headers cache fingerprinted assets without caching HTML or APIs", () => {
  const headersPath = new URL("../../cloudflare/site/_headers", import.meta.url);
  const headers = fs.readFileSync(headersPath, "utf8");

  assert.match(headers, /^\/assets\/\*$/mu);
  assert.match(headers, /^\s+Cache-Control: public, max-age=31556952, immutable$/mu);
  assert.doesNotMatch(headers, /^\/\*$/mu);
  assert.doesNotMatch(headers, /^\/api(?:\/|$)/mu);
});

/** @param {ArrayBuffer|ArrayBufferView} value Bytes. @returns {string} Base64url text. */
function bytesToBase64Url(value) {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(bytes).toString("base64url");
}

/** @param {string} pathname API path. @param {object} [headers] Request headers. @returns {Request} API request. */
function activationRequest(pathname, headers = {}) {
  return new Request(`https://example.com${pathname}`, {
    headers: { origin: "https://example.com", ...headers },
  });
}

/** @param {object} [overrides] License overrides. @returns {Promise<object>} Repository fixture. */
async function createRepositoryFixture(overrides = {}) {
  const state = {
    license: {
      id: "license-test",
      code_hash: await hashActivationCode("XSXB-TRIAL-TEST", crypto.subtle),
      plan: "trial",
      duration_days: 3,
      max_devices: 1,
      redeem_by: null,
      first_activated_at: null,
      expires_at: null,
      revoked_at: null,
      ...overrides,
    },
    device: null,
    devices: [],
    automaticTrials: [],
  };
  const repository = {
    async findLicenseByCodeHash(codeHash) {
      return codeHash === state.license.code_hash ? state.license : null;
    },
    async findDeviceByLicenseAndPublicKeyHash(licenseId, publicKeyHash) {
      return (
        state.devices.find(
          (device) => device.license_id === licenseId && device.public_key_hash === publicKeyHash,
        ) || null
      );
    },
    async findAuthorizationByDeviceId(deviceId) {
      const device = state.devices.find((entry) => entry.id === deviceId);
      if (!device) return null;
      const license =
        device.license_id === state.license.id
          ? state.license
          : state.automaticTrials.find((entry) => entry.license.id === device.license_id)?.license;
      if (!license) return null;
      return {
        device_id: device.id,
        license_id: license.id,
        public_key: device.public_key,
        public_key_hash: device.public_key_hash,
        device_revoked_at: device.revoked_at,
        plan: license.plan,
        expires_at: license.expires_at,
        license_revoked_at: license.revoked_at,
      };
    },
    async findAutomaticTrialByPublicKeyHash(publicKeyHash) {
      const trial = state.automaticTrials.find((entry) => entry.device.public_key_hash === publicKeyHash);
      return trial ? repository.findAuthorizationByDeviceId(trial.device.id) : null;
    },
    async findAutomaticTrialByFingerprintHash(fingerprintHash) {
      const trial = state.automaticTrials.find((entry) => entry.fingerprintHash === fingerprintHash);
      return trial ? repository.findAuthorizationByDeviceId(trial.device.id) : null;
    },
    async activateLicense(_licenseId, activatedAt, expiresAt) {
      state.license.first_activated_at ||= activatedAt;
      state.license.expires_at ||= expiresAt;
      return { success: true };
    },
    async createCodeDeviceWithinLimit(device) {
      const activeCount = state.devices.filter(
        (entry) => entry.license_id === device.licenseId && !entry.revoked_at,
      ).length;
      if (state.license.max_devices !== null && activeCount >= state.license.max_devices) {
        return { meta: { changes: 0 } };
      }
      if (
        state.devices.some(
          (entry) => entry.license_id === device.licenseId && entry.public_key_hash === device.publicKeyHash,
        )
      ) {
        throw new Error("unique constraint");
      }
      const storedDevice = {
        id: device.id,
        license_id: device.licenseId,
        public_key: device.publicKey,
        public_key_hash: device.publicKeyHash,
        fingerprint_hash: device.fingerprintHash,
        device_name: device.deviceName,
        first_ip_hash: device.ipHash,
        last_ip_hash: device.ipHash,
        first_country: device.country,
        last_country: device.country,
        created_at: device.createdAt,
        last_seen_at: device.createdAt,
        revoked_at: null,
      };
      state.devices.push(storedDevice);
      state.device ||= storedDevice;
      return { meta: { changes: 1 } };
    },
    async createAutomaticTrial(trial) {
      if (
        state.automaticTrials.some(
          (entry) =>
            entry.fingerprintHash === trial.fingerprintHash ||
            entry.device.public_key_hash === trial.publicKeyHash,
        )
      ) {
        throw new Error("unique constraint");
      }
      const device = {
        id: trial.deviceId,
        license_id: trial.licenseId,
        public_key: trial.publicKey,
        public_key_hash: trial.publicKeyHash,
        fingerprint_hash: trial.fingerprintHash,
        device_name: trial.deviceName,
        first_ip_hash: trial.ipHash,
        last_ip_hash: trial.ipHash,
        first_country: trial.country,
        last_country: trial.country,
        created_at: trial.createdAt,
        last_seen_at: trial.createdAt,
        revoked_at: null,
      };
      const license = {
        id: trial.licenseId,
        source: "automatic_trial",
        plan: "trial",
        expires_at: trial.expiresAt,
        revoked_at: null,
      };
      state.devices.push(device);
      state.automaticTrials.push({ device, license, fingerprintHash: trial.fingerprintHash });
      return [{ success: true }];
    },
    async touchDevice(deviceId, seenAt, ipHash, country) {
      const device = state.devices.find((entry) => entry.id === deviceId);
      device.last_seen_at = seenAt;
      device.last_ip_hash = ipHash;
      device.last_country = country;
      return { success: true };
    },
  };
  return { repository, state };
}

/** @returns {Promise<{keyPair:CryptoKeyPair,publicKey:JsonWebKey}>} P-256 device key. */
async function createDeviceKey() {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  return { keyPair, publicKey: await crypto.subtle.exportKey("jwk", keyPair.publicKey) };
}

/** @param {CryptoKey} privateKey Device private key. @param {string} challenge Signed challenge. @returns {Promise<string>} Signature. */
async function signChallenge(privateKey, challenge) {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(challenge),
  );
  return bytesToBase64Url(signature);
}

/** @param {object} [overrides] Fingerprint overrides. @returns {object} Stable browser fingerprint. */
function deviceFingerprint(overrides = {}) {
  return {
    platform: "macOS",
    userAgent: "Mozilla/5.0 TestBrowser/1.0",
    language: "zh-CN",
    languages: ["zh-CN", "en"],
    timeZone: "Asia/Shanghai",
    hardwareConcurrency: 10,
    deviceMemory: 16,
    maxTouchPoints: 0,
    screen: { width: 1728, height: 1117, colorDepth: 24, pixelRatio: 2 },
    userAgentData: { architecture: "arm", bitness: "64", platformVersion: "15.0" },
    webgl: { vendor: "Apple", renderer: "Apple M-series" },
    ...overrides,
  };
}

test("resolveAssetPath maps public tool routes to the workbench", () => {
  assert.equal(resolveAssetPath("/"), "/index.html");
  assert.equal(resolveAssetPath("/admin/licenses"), "/admin.html");
  assert.equal(resolveAssetPath("/tools/import"), "/workbench.html");
  assert.equal(resolveAssetPath("/assets/app.js"), "/assets/app.js");
});

test("worker delegates mapped routes to Static Assets", async () => {
  let requestedPath = "";
  const response = await worker.fetch(new Request("https://example.com/tools/import"), {
    ASSETS: {
      async fetch(request) {
        requestedPath = new URL(request.url).pathname;
        return new Response("workbench", { headers: { "Content-Type": "text/html" } });
      },
    },
  });

  assert.equal(requestedPath, "/workbench.html");
  assert.equal(await response.text(), "workbench");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
});

test("worker rejects unrelated state-changing methods", async () => {
  const response = await worker.fetch(new Request("https://example.com/", { method: "POST" }), {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});

test("activation API and all challenge routes fail closed without D1 or a secret", async () => {
  const statusResponse = await worker.fetch(new Request("https://example.com/api/activation"), {});
  assert.deepEqual(await statusResponse.json(), { activated: false, configured: false, expiresAt: "" });

  const challengeResponse = await worker.fetch(
    new Request("https://example.com/api/activation/device-challenge", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body: JSON.stringify({ deviceId: "missing" }),
    }),
    {},
  );
  assert.equal(challengeResponse.status, 503);
  assert.equal(challengeResponse.headers.get("cache-control"), "no-store");
});

test("activation JSON never exposes the HttpOnly session token", () => {
  assert.deepEqual(
    sanitizeActivationResult({ activated: true, deviceId: "device-test", token: "sensitive" }),
    { activated: true, deviceId: "device-test" },
  );
});

test("three-day trial binds one P-256 device and restores a signed-cookie session", async () => {
  const activatedAt = Date.parse("2026-07-22T00:00:00.000Z");
  let now = activatedAt;
  const { repository, state } = await createRepositoryFixture();
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository, now: () => now },
  );
  const { keyPair, publicKey } = await createDeviceKey();
  const request = activationRequest("/api/activation/challenge", {
    "cf-connecting-ip": "203.0.113.8",
    "cf-ipcountry": "CN",
  });
  const challenge = await service.activationChallenge(
    { code: " xsxb-trial-test ", publicKey, deviceName: "Test browser" },
    request,
  );
  assert.equal(Date.parse(challenge.expiresAt), activatedAt + 3 * dayMs);
  assert.equal(state.device.first_country, "CN");
  assert.notEqual(state.device.first_ip_hash, "203.0.113.8");
  assert.doesNotMatch(state.device.first_ip_hash, /203\.0\.113\.8/u);

  const activation = await service.verifyChallenge(
    {
      challenge: challenge.challenge,
      signature: await signChallenge(keyPair.privateKey, challenge.challenge),
    },
    request,
  );
  const cookie = service.cookieHeader(activation.token, request);
  assert.equal(activation.activated, true);
  assert.match(cookie, /^xsxb_activation=/u);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Strict/u);
  assert.match(cookie, /Secure/u);
  assert.equal((await service.status(activationRequest("/api/activation", { cookie }))).activated, true);

  now += dayMs + 1;
  assert.equal((await service.status(activationRequest("/api/activation", { cookie }))).activated, false);
  const renewal = await service.deviceChallenge(
    { deviceId: activation.deviceId },
    activationRequest("/api/activation/device-challenge"),
  );
  const renewed = await service.verifyChallenge(
    {
      challenge: renewal.challenge,
      signature: await signChallenge(keyPair.privateKey, renewal.challenge),
    },
    activationRequest("/api/activation/verify"),
  );
  assert.equal(renewed.activated, true);
});

test("a trial rejects another browser and forged device signatures", async () => {
  const { repository } = await createRepositoryFixture();
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository, now: () => Date.parse("2026-07-22T00:00:00.000Z") },
  );
  const firstDevice = await createDeviceKey();
  const secondDevice = await createDeviceKey();
  const request = activationRequest("/api/activation/challenge");
  const challenge = await service.activationChallenge(
    { code: "XSXB-TRIAL-TEST", publicKey: firstDevice.publicKey },
    request,
  );
  await assert.rejects(
    service.verifyChallenge(
      {
        challenge: challenge.challenge,
        signature: await signChallenge(secondDevice.keyPair.privateKey, challenge.challenge),
      },
      activationRequest("/api/activation/verify"),
    ),
    /signature is invalid/u,
  );
  await assert.rejects(
    service.activationChallenge({ code: "XSXB-TRIAL-TEST", publicKey: secondDevice.publicKey }, request),
    (error) => error.status === 409,
  );
});

test("a multi-device activation code occupies distinct slots and reuses an existing device", async () => {
  const fixture = await createRepositoryFixture({ max_devices: 2 });
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: fixture.repository, now: () => Date.parse("2026-07-22T00:00:00.000Z") },
  );
  const devices = await Promise.all([createDeviceKey(), createDeviceKey(), createDeviceKey()]);
  const request = activationRequest("/api/activation/challenge");

  const first = await service.activationChallenge(
    { code: "XSXB-TRIAL-TEST", publicKey: devices[0].publicKey },
    request,
  );
  const repeated = await service.activationChallenge(
    { code: "XSXB-TRIAL-TEST", publicKey: devices[0].publicKey },
    request,
  );
  const second = await service.activationChallenge(
    { code: "XSXB-TRIAL-TEST", publicKey: devices[1].publicKey },
    request,
  );

  assert.equal(first.deviceId, repeated.deviceId);
  assert.notEqual(first.deviceId, second.deviceId);
  assert.equal(fixture.state.devices.length, 2);
  await assert.rejects(
    service.activationChallenge({ code: "XSXB-TRIAL-TEST", publicKey: devices[2].publicKey }, request),
    (error) => error.status === 409 && /device limit/u.test(error.message),
  );
});

test("an unlimited activation code accepts custom text and any number of devices", async () => {
  const customCode = "自定义 激活码 / 夏季✨";
  const fixture = await createRepositoryFixture({
    code_hash: await hashActivationCode(customCode, crypto.subtle),
    duration_days: 12_000,
    max_devices: null,
  });
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: fixture.repository, now: () => Date.parse("2026-07-22T00:00:00.000Z") },
  );
  const devices = await Promise.all(Array.from({ length: 6 }, () => createDeviceKey()));
  for (const device of devices) {
    const challenge = await service.activationChallenge(
      { code: customCode, publicKey: device.publicKey },
      activationRequest("/api/activation/challenge"),
    );
    assert.ok(challenge.deviceId);
  }

  assert.equal(fixture.state.devices.length, 6);
  assert.equal(Date.parse(fixture.state.license.expires_at), Date.parse("2059-05-30T00:00:00.000Z"));
});

test("automatic trial starts without a code and blocks a new key with the same fingerprint", async () => {
  const now = Date.parse("2026-07-22T00:00:00.000Z");
  const fixture = await createRepositoryFixture();
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: fixture.repository, now: () => now },
  );
  const firstDevice = await createDeviceKey();
  const request = activationRequest("/api/activation/trial-challenge", {
    "cf-connecting-ip": "203.0.113.9",
    "cf-ipcountry": "CN",
  });
  const challenge = await service.automaticTrialChallenge(
    {
      publicKey: firstDevice.publicKey,
      fingerprint: deviceFingerprint(),
      deviceName: "Test Mac",
    },
    request,
  );
  assert.equal(Date.parse(challenge.expiresAt), now + 3 * dayMs);
  assert.equal(fixture.state.automaticTrials.length, 1);

  const repeated = await service.automaticTrialChallenge(
    { publicKey: firstDevice.publicKey, fingerprint: deviceFingerprint() },
    request,
  );
  assert.equal(repeated.deviceId, challenge.deviceId);

  const replacementKey = await createDeviceKey();
  await assert.rejects(
    service.automaticTrialChallenge(
      { publicKey: replacementKey.publicKey, fingerprint: deviceFingerprint() },
      request,
    ),
    (error) => error.status === 409 && /already been claimed/u.test(error.message),
  );
});

test("license duration, fixed expiry, and unused-code redemption deadline are configurable", async () => {
  const now = Date.parse("2026-07-22T00:00:00.000Z");
  const fixedExpiry = new Date(now + 12 * 60 * 60 * 1000).toISOString();
  const fixed = await createRepositoryFixture({ duration_days: 30, expires_at: fixedExpiry });
  const fixedService = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: fixed.repository, now: () => now },
  );
  const device = await createDeviceKey();
  const challenge = await fixedService.activationChallenge(
    { code: "XSXB-TRIAL-TEST", publicKey: device.publicKey },
    activationRequest("/api/activation/challenge"),
  );
  assert.equal(challenge.expiresAt, fixedExpiry);

  const permanentExpiry = "9999-12-31T23:59:59.999Z";
  const permanent = await createRepositoryFixture({ expires_at: permanentExpiry });
  const permanentService = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: permanent.repository, now: () => now },
  );
  const permanentChallenge = await permanentService.activationChallenge(
    { code: "XSXB-TRIAL-TEST", publicKey: (await createDeviceKey()).publicKey },
    activationRequest("/api/activation/challenge"),
  );
  assert.equal(permanentChallenge.expiresAt, permanentExpiry);

  const expiredCode = await createRepositoryFixture({ redeem_by: new Date(now - 1).toISOString() });
  const expiredService = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: expiredCode.repository, now: () => now },
  );
  await assert.rejects(
    expiredService.activationChallenge(
      { code: "XSXB-TRIAL-TEST", publicKey: (await createDeviceKey()).publicKey },
      activationRequest("/api/activation/challenge"),
    ),
    (error) => error.status === 410,
  );
});
