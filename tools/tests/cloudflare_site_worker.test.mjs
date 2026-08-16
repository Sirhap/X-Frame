import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import worker, { resolveAssetPath } from "../../cloudflare/site/src/index.mjs";
import { signToken } from "../../cloudflare/site/src/activation_crypto.mjs";
import {
  createActivationService,
  hashActivationCode,
  sanitizeActivationResult,
} from "../../cloudflare/site/src/activation.mjs";
import { hashDeviceFingerprint } from "../../cloudflare/site/src/trial_identity.mjs";

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
      source: "code",
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
    trialBrowserBindings: [],
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
      const browserBinding = state.trialBrowserBindings.find((entry) => entry.id === deviceId);
      const trial = browserBinding
        ? state.automaticTrials.find((entry) => entry.claimId === browserBinding.claim_id)
        : state.automaticTrials.find((entry) => entry.device.id === deviceId);
      const primaryDevice = browserBinding ? trial?.device : device;
      if (!primaryDevice) return null;
      const license = trial?.license || state.license;
      return {
        device_id: browserBinding?.id || primaryDevice.id,
        license_id: license.id,
        public_key: browserBinding?.public_key || primaryDevice.public_key,
        public_key_hash: browserBinding?.public_key_hash || primaryDevice.public_key_hash,
        device_revoked_at: browserBinding?.revoked_at || primaryDevice.revoked_at,
        source: license.source,
        plan: license.plan,
        expires_at: license.expires_at,
        license_revoked_at: license.revoked_at,
        trial_claim_id: trial?.claimId,
      };
    },
    async findAutomaticTrialByPublicKeyHash(publicKeyHash) {
      const trial = state.automaticTrials.find((entry) => entry.device.public_key_hash === publicKeyHash);
      if (trial) return repository.findAuthorizationByDeviceId(trial.device.id);
      const browserBinding = state.trialBrowserBindings.find(
        (entry) => entry.public_key_hash === publicKeyHash,
      );
      return browserBinding ? repository.findAuthorizationByDeviceId(browserBinding.id) : null;
    },
    async findAutomaticTrialByFingerprintHash(fingerprintHash) {
      const trial = state.automaticTrials.find((entry) => entry.fingerprintHash === fingerprintHash);
      return trial ? repository.findAuthorizationByDeviceId(trial.device.id) : null;
    },
    async findAutomaticTrialByDeviceSignature(hardwareHash, displayHash) {
      const trial = state.automaticTrials.find(
        (entry) => entry.hardwareHash === hardwareHash && entry.displayHash === displayHash,
      );
      return trial ? repository.findAuthorizationByDeviceId(trial.device.id) : null;
    },
    async updateAutomaticTrialDeviceSignature(deviceId, hardwareHash, displayHash) {
      const browserBinding = state.trialBrowserBindings.find((entry) => entry.id === deviceId);
      const trial = state.automaticTrials.find(
        (entry) =>
          entry.device.id === deviceId || (browserBinding && entry.claimId === browserBinding.claim_id),
      );
      if (!trial) return { meta: { changes: 0 } };
      trial.hardwareHash = hardwareHash;
      trial.displayHash = displayHash;
      return { meta: { changes: 1 } };
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
      const existing = state.devices.find(
        (entry) => entry.license_id === device.licenseId && entry.public_key_hash === device.publicKeyHash,
      );
      if (existing) {
        existing.public_key = device.publicKey;
        existing.fingerprint_hash = device.fingerprintHash;
        existing.device_name = device.deviceName;
        existing.last_ip_hash = device.ipHash;
        existing.last_country = device.country;
        existing.last_seen_at = device.createdAt;
        existing.revoked_at = null;
        return { meta: { changes: 1 } };
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
    async listActiveCodeDevices(licenseId, limit, offset) {
      const devices = state.devices
        .filter((entry) => entry.license_id === licenseId && !entry.revoked_at)
        .sort(
          (left, right) =>
            left.last_seen_at.localeCompare(right.last_seen_at) ||
            left.created_at.localeCompare(right.created_at) ||
            left.id.localeCompare(right.id),
        );
      return devices.slice(offset, offset + limit).map((device) => ({
        id: device.id,
        device_name: device.device_name,
        created_at: device.created_at,
        last_seen_at: device.last_seen_at,
        total_count: devices.length,
      }));
    },
    async replaceCodeDeviceWithinLimit(device, replacementDeviceId, revokedAt) {
      const replaced = state.devices.find(
        (entry) =>
          entry.id === replacementDeviceId &&
          entry.license_id === device.licenseId &&
          entry.public_key_hash !== device.publicKeyHash &&
          !entry.revoked_at,
      );
      if (replaced) replaced.revoked_at = revokedAt;
      try {
        const result = await repository.createCodeDeviceWithinLimit(device);
        if (Number(result?.meta?.changes || 0) < 1 && replaced) replaced.revoked_at = null;
        return [result, { meta: { changes: replaced ? 1 : 0 } }];
      } catch (error) {
        if (replaced) replaced.revoked_at = null;
        throw error;
      }
    },
    async revokeCodeDevice(deviceId, licenseId, revokedAt) {
      const device = state.devices.find(
        (entry) => entry.id === deviceId && entry.license_id === licenseId && !entry.revoked_at,
      );
      if (!device || state.license.source !== "code") return { meta: { changes: 0 } };
      device.revoked_at = revokedAt;
      return { meta: { changes: 1 } };
    },
    async createAutomaticTrial(trial) {
      if (
        state.automaticTrials.some(
          (entry) =>
            entry.fingerprintHash === trial.fingerprintHash ||
            entry.device.public_key_hash === trial.publicKeyHash ||
            (entry.hardwareHash === trial.hardwareHash && entry.displayHash === trial.displayHash),
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
      state.automaticTrials.push({
        claimId: trial.claimId,
        device,
        license,
        fingerprintHash: trial.fingerprintHash,
        hardwareHash: trial.hardwareHash,
        displayHash: trial.displayHash,
      });
      return [{ success: true }];
    },
    async createAutomaticTrialBrowserBinding(binding) {
      if (
        state.trialBrowserBindings.some((entry) => entry.public_key_hash === binding.publicKeyHash) ||
        state.automaticTrials.some((entry) => entry.device.public_key_hash === binding.publicKeyHash)
      ) {
        throw new Error("unique constraint");
      }
      const trial = state.automaticTrials.find((entry) => entry.claimId === binding.claimId);
      const activeBindings = state.trialBrowserBindings.filter(
        (entry) => entry.claim_id === binding.claimId && !entry.revoked_at,
      );
      if (
        !trial ||
        trial.device.revoked_at ||
        trial.license.revoked_at ||
        Date.parse(trial.license.expires_at) <= Date.parse(binding.createdAt) ||
        activeBindings.length >= binding.maxBindings
      ) {
        return { meta: { changes: 0 } };
      }
      state.trialBrowserBindings.push({
        id: binding.id,
        claim_id: binding.claimId,
        public_key: binding.publicKey,
        public_key_hash: binding.publicKeyHash,
        device_name: binding.deviceName,
        first_ip_hash: binding.ipHash,
        last_ip_hash: binding.ipHash,
        first_country: binding.country,
        last_country: binding.country,
        created_at: binding.createdAt,
        last_seen_at: binding.createdAt,
        revoked_at: null,
      });
      return { meta: { changes: 1 } };
    },
    async touchDevice(deviceId, seenAt, ipHash, country) {
      const device = state.devices.find((entry) => entry.id === deviceId);
      const browserBinding = state.trialBrowserBindings.find((entry) => entry.id === deviceId);
      const target = browserBinding || device;
      if (target) {
        target.last_seen_at = seenAt;
        target.last_ip_hash = ipHash;
        target.last_country = country;
      }
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
  assert.equal(resolveAssetPath("/admin/login"), "/admin.html");
  for (const route of [
    "/tools/import",
    "/tools/scatter-slice",
    "/tools/export",
    "/workspace/resources/import",
    "/workspace/resources/cutout",
    "/workspace/resources/scatter",
    "/workspace/animation/transform",
    "/workspace/animation/boxes",
    "/workspace/animation/trails",
    "/workspace/animation/audio",
    "/workspace/animation/attachments",
    "/workspace/delivery/export",
    "/workspace/delivery/godot",
    "/workspace/delivery/codex-pet",
  ]) {
    assert.equal(resolveAssetPath(route), "/workbench.html", route);
  }
  assert.equal(resolveAssetPath("/assets/app.js"), "/assets/app.js");
});

test("administrator page is gated by the server-side workbench session", async () => {
  let assetRequests = 0;
  const env = {
    LICENSE_DB: { prepare() {} },
    XSXB_ACTIVATION_SECRET: activationSecret,
    XSXB_ADMIN_USERNAME: "sirhao",
    ASSETS: {
      async fetch(request) {
        assetRequests += 1;
        assert.equal(new URL(request.url).pathname, "/admin.html");
        return new Response("administrator console", { headers: { "Content-Type": "text/html" } });
      },
    },
  };

  const denied = await worker.fetch(new Request("https://example.com/admin/licenses"), env);
  assert.equal(denied.status, 302);
  assert.equal(denied.headers.get("location"), "https://example.com/admin/login");
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  assert.equal(denied.headers.get("vary"), "Cookie");
  assert.equal(assetRequests, 0);

  const login = await worker.fetch(new Request("https://example.com/admin/login"), env);
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("cache-control"), "private, no-store");
  assert.equal(login.headers.get("vary"), "Cookie");

  const token = await signToken(
    { type: "admin-session", username: "sirhao", exp: Date.now() + 60_000 },
    activationSecret,
    crypto.subtle,
  );
  const allowed = await worker.fetch(
    new Request("https://example.com/admin/licenses", {
      headers: { cookie: `xsxb_admin_workbench=${encodeURIComponent(token)}` },
    }),
    env,
  );
  assert.equal(allowed.status, 200);
  assert.equal(await allowed.text(), "administrator console");

  const directAsset = await worker.fetch(new Request("https://example.com/admin.html"), env);
  assert.equal(directAsset.status, 404);
});

test("administrator page reports a bounded error when static assets are unavailable", async () => {
  const response = await worker.fetch(new Request("https://example.com/admin/login"), {
    LICENSE_DB: { prepare() {} },
    XSXB_ACTIVATION_SECRET: activationSecret,
    XSXB_ADMIN_USERNAME: "sirhao",
    ASSETS: {
      async fetch() {
        throw new Error("asset binding unavailable");
      },
    },
  });

  assert.equal(response.status, 502);
  assert.equal(await response.text(), "Static asset temporarily unavailable");
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

test("worker reports unavailable cloud media encoders without a 404", async () => {
  const response = await worker.fetch(new Request("https://example.com/api/media-export/capabilities"), {});

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    mode: "cloudflare-static",
    ffmpeg: { available: false, version: "" },
  });
});

test("worker redirects the retired local-only watermark deep link", async () => {
  const response = await worker.fetch(new Request("https://example.com/tools/watermark"), {});

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://example.com/?notice=local-watermark#factoryTools");
});

test("worker rejects unrelated state-changing methods", async () => {
  const response = await worker.fetch(new Request("https://example.com/", { method: "POST" }), {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});

test("retired device activation routes are not served by the worker", async () => {
  const statusResponse = await worker.fetch(new Request("https://example.com/api/activation"), {});
  assert.notEqual(statusResponse.status, 200);
  assert.doesNotMatch(await statusResponse.text(), /"configured"\s*:\s*false/u);

  const challengeResponse = await worker.fetch(
    new Request("https://example.com/api/activation/device-challenge", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body: JSON.stringify({ deviceId: "missing" }),
    }),
    {},
  );
  assert.equal(challengeResponse.status, 405);
  assert.equal(challengeResponse.headers.get("allow"), "GET, HEAD");
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

test("a multi-device code replaces only the device explicitly selected by the user", async () => {
  const fixture = await createRepositoryFixture({ max_devices: 2 });
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: fixture.repository, now: () => Date.parse("2026-07-22T00:00:00.000Z") },
  );
  const devices = await Promise.all([createDeviceKey(), createDeviceKey(), createDeviceKey()]);
  const request = activationRequest("/api/activation/challenge");

  const first = await service.activationChallenge(
    {
      code: "XSXB-TRIAL-TEST",
      publicKey: devices[0].publicKey,
      deviceName: "Studio Mac",
    },
    request,
  );
  const repeated = await service.activationChallenge(
    { code: "XSXB-TRIAL-TEST", publicKey: devices[0].publicKey },
    request,
  );
  const second = await service.activationChallenge(
    {
      code: "XSXB-TRIAL-TEST",
      publicKey: devices[1].publicKey,
      deviceName: "Render PC",
    },
    request,
  );

  assert.equal(first.deviceId, repeated.deviceId);
  assert.notEqual(first.deviceId, second.deviceId);
  assert.equal(fixture.state.devices.length, 2);
  let limitError = null;
  try {
    await service.activationChallenge({ code: "XSXB-TRIAL-TEST", publicKey: devices[2].publicKey }, request);
  } catch (error) {
    limitError = error;
  }
  assert.equal(limitError?.status, 409);
  assert.equal(limitError?.code, "DEVICE_LIMIT_REACHED");
  assert.deepEqual(limitError?.details.devices.map((device) => device.name).sort(), [
    "Render PC",
    "Studio Mac",
  ]);

  const third = await service.activationChallenge(
    {
      code: "XSXB-TRIAL-TEST",
      publicKey: devices[2].publicKey,
      deviceName: "Travel Mac",
      replaceDeviceId: first.deviceId,
    },
    request,
  );
  assert.notEqual(third.deviceId, first.deviceId);
  assert.equal(
    fixture.state.devices.find((device) => device.id === first.deviceId)?.revoked_at,
    "2026-07-22T00:00:00.000Z",
  );
  assert.equal(fixture.state.devices.find((device) => device.id === second.deviceId)?.revoked_at, null);
  assert.equal(fixture.state.devices.filter((device) => !device.revoked_at).length, 2);
  await assert.rejects(
    service.deviceChallenge(
      { deviceId: first.deviceId },
      activationRequest("/api/activation/device-challenge"),
    ),
    (error) => error.status === 403,
  );
});

test("a stale replacement selection never unbinds another code device", async () => {
  const fixture = await createRepositoryFixture({ max_devices: 1 });
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: fixture.repository, now: () => Date.parse("2026-07-22T00:00:00.000Z") },
  );
  const firstDevice = await createDeviceKey();
  const secondDevice = await createDeviceKey();
  const request = activationRequest("/api/activation/challenge");
  const first = await service.activationChallenge(
    { code: "XSXB-TRIAL-TEST", publicKey: firstDevice.publicKey },
    request,
  );

  await assert.rejects(
    service.activationChallenge(
      {
        code: "XSXB-TRIAL-TEST",
        publicKey: secondDevice.publicKey,
        replaceDeviceId: "stale-or-foreign-device",
      },
      request,
    ),
    (error) =>
      error.status === 409 &&
      error.code === "DEVICE_LIMIT_REACHED" &&
      error.details.devices[0].id === first.deviceId,
  );
  assert.equal(fixture.state.devices.filter((device) => !device.revoked_at).length, 1);
  assert.equal(fixture.state.devices[0].id, first.deviceId);
});

test("a user can unbind the current code device and later restore its free slot", async () => {
  const now = Date.parse("2026-07-22T00:00:00.000Z");
  const fixture = await createRepositoryFixture({ max_devices: 1 });
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: fixture.repository, now: () => now },
  );
  const device = await createDeviceKey();
  const request = activationRequest("/api/activation/challenge");
  const challenge = await service.activationChallenge(
    { code: "XSXB-TRIAL-TEST", publicKey: device.publicKey },
    request,
  );
  const activation = await service.verifyChallenge(
    {
      challenge: challenge.challenge,
      signature: await signChallenge(device.keyPair.privateKey, challenge.challenge),
    },
    activationRequest("/api/activation/verify"),
  );
  const cookie = service.cookieHeader(activation.token, request);
  const unbound = await service.unbindCurrentDevice(activationRequest("/api/activation/unbind", { cookie }));
  assert.equal(unbound.unbound, true);
  assert.ok(fixture.state.devices[0].revoked_at);
  assert.equal((await service.status(activationRequest("/api/activation", { cookie }))).activated, false);

  const restored = await service.activationChallenge(
    { code: "XSXB-TRIAL-TEST", publicKey: device.publicKey },
    request,
  );
  assert.equal(restored.deviceId, challenge.deviceId);
  assert.equal(fixture.state.devices[0].revoked_at, null);
  assert.equal(fixture.state.devices.length, 1);
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

test("automatic trial starts without a code and reuses its expiry for a new browser key", async () => {
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

  fixture.state.automaticTrials[0].hardwareHash = "legacy-hardware-hash";
  fixture.state.automaticTrials[0].displayHash = "legacy-display-hash";
  const renewalChallenge = await service.deviceChallenge(
    { deviceId: challenge.deviceId },
    activationRequest("/api/activation/device-challenge"),
  );
  const renewal = await service.verifyChallenge(
    {
      challenge: renewalChallenge.challenge,
      signature: await signChallenge(firstDevice.keyPair.privateKey, renewalChallenge.challenge),
      fingerprint: deviceFingerprint(),
    },
    activationRequest("/api/activation/verify"),
  );
  assert.equal(renewal.activated, true);
  assert.notEqual(fixture.state.automaticTrials[0].hardwareHash, "legacy-hardware-hash");
  assert.notEqual(fixture.state.automaticTrials[0].displayHash, "legacy-display-hash");

  const repeated = await service.automaticTrialChallenge(
    { publicKey: firstDevice.publicKey, fingerprint: deviceFingerprint() },
    request,
  );
  assert.equal(repeated.deviceId, challenge.deviceId);

  const replacementKey = await createDeviceKey();
  const inheritedChallenge = await service.automaticTrialChallenge(
    { publicKey: replacementKey.publicKey, fingerprint: deviceFingerprint() },
    request,
  );
  assert.notEqual(inheritedChallenge.deviceId, challenge.deviceId);
  assert.equal(inheritedChallenge.expiresAt, challenge.expiresAt);
  const inheritedActivation = await service.verifyChallenge(
    {
      challenge: inheritedChallenge.challenge,
      signature: await signChallenge(replacementKey.keyPair.privateKey, inheritedChallenge.challenge),
    },
    activationRequest("/api/activation/verify"),
  );
  assert.equal(inheritedActivation.activated, true);
  assert.equal(inheritedActivation.expiresAt, challenge.expiresAt);
  assert.equal(fixture.state.automaticTrials.length, 1);
  assert.equal(fixture.state.trialBrowserBindings.length, 1);
});

test("automatic trial recognizes one physical device across different browsers", async () => {
  const now = Date.parse("2026-07-22T00:00:00.000Z");
  const fixture = await createRepositoryFixture();
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: fixture.repository, now: () => now },
  );
  const chromeFingerprint = deviceFingerprint({
    platform: "macOS",
    userAgent: "Mozilla/5.0 Chrome/140.0.0.0",
    deviceMemory: 16,
    screen: { width: 1728, height: 1117, colorDepth: 30, pixelRatio: 2 },
    userAgentData: {
      architecture: "arm",
      bitness: "64",
      platformVersion: "15.0",
      brands: [{ brand: "Google Chrome", version: "140" }],
    },
    webgl: {
      vendor: "Google Inc. (Apple)",
      renderer: "ANGLE (Apple, Apple M4 Pro, OpenGL 4.1)",
    },
  });
  const safariFingerprint = deviceFingerprint({
    platform: "MacIntel",
    userAgent: "Mozilla/5.0 Version/18.5 Safari/605.1.15",
    deviceMemory: 0,
    userAgentData: {},
    webgl: { vendor: "Apple Inc.", renderer: "Apple M4 Pro" },
  });
  const [chromeHashes, safariHashes] = await Promise.all([
    hashDeviceFingerprint(chromeFingerprint, activationSecret, crypto.subtle),
    hashDeviceFingerprint(safariFingerprint, activationSecret, crypto.subtle),
  ]);
  assert.notEqual(chromeHashes.fingerprintHash, safariHashes.fingerprintHash);
  assert.equal(chromeHashes.hardwareHash, safariHashes.hardwareHash);
  assert.equal(chromeHashes.displayHash, safariHashes.displayHash);

  const chromeDevice = await createDeviceKey();
  const safariDevice = await createDeviceKey();
  const chromeChallenge = await service.automaticTrialChallenge(
    { publicKey: chromeDevice.publicKey, fingerprint: chromeFingerprint },
    activationRequest("/api/activation/trial-challenge"),
  );

  const safariChallenge = await service.automaticTrialChallenge(
    { publicKey: safariDevice.publicKey, fingerprint: safariFingerprint },
    activationRequest("/api/activation/trial-challenge"),
  );
  assert.notEqual(safariChallenge.deviceId, chromeChallenge.deviceId);
  assert.equal(safariChallenge.expiresAt, chromeChallenge.expiresAt);
  const safariActivation = await service.verifyChallenge(
    {
      challenge: safariChallenge.challenge,
      signature: await signChallenge(safariDevice.keyPair.privateKey, safariChallenge.challenge),
      fingerprint: safariFingerprint,
    },
    activationRequest("/api/activation/verify"),
  );
  assert.equal(safariActivation.activated, true);
  assert.equal(safariActivation.expiresAt, chromeChallenge.expiresAt);
  assert.equal(fixture.state.devices.length, 1);
  assert.equal(fixture.state.automaticTrials.length, 1);
  assert.equal(fixture.state.trialBrowserBindings.length, 1);

  fixture.state.automaticTrials[0].device.revoked_at = "2026-07-22T00:01:00.000Z";
  await assert.rejects(
    service.deviceChallenge(
      { deviceId: safariChallenge.deviceId },
      activationRequest("/api/activation/device-challenge"),
    ),
    (error) => error.status === 403,
  );
});

test("automatic trial bounds inherited browser keys without creating another trial", async () => {
  const now = Date.parse("2026-07-22T00:00:00.000Z");
  const fixture = await createRepositoryFixture();
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: fixture.repository, now: () => now },
  );
  const request = activationRequest("/api/activation/trial-challenge");
  const firstChallenge = await service.automaticTrialChallenge(
    { publicKey: (await createDeviceKey()).publicKey, fingerprint: deviceFingerprint() },
    request,
  );

  for (let browserIndex = 0; browserIndex < 8; browserIndex += 1) {
    const inheritedChallenge = await service.automaticTrialChallenge(
      { publicKey: (await createDeviceKey()).publicKey, fingerprint: deviceFingerprint() },
      request,
    );
    assert.equal(inheritedChallenge.expiresAt, firstChallenge.expiresAt);
  }

  await assert.rejects(
    service.automaticTrialChallenge(
      { publicKey: (await createDeviceKey()).publicKey, fingerprint: deviceFingerprint() },
      request,
    ),
    (error) => error.status === 409 && /8-browser limit/u.test(error.message),
  );
  assert.equal(fixture.state.automaticTrials.length, 1);
  assert.equal(fixture.state.trialBrowserBindings.length, 8);
});

test("automatic trial never revives an expired physical-device trial", async () => {
  let now = Date.parse("2026-07-22T00:00:00.000Z");
  const fixture = await createRepositoryFixture();
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: fixture.repository, now: () => now },
  );
  const request = activationRequest("/api/activation/trial-challenge");
  await service.automaticTrialChallenge(
    { publicKey: (await createDeviceKey()).publicKey, fingerprint: deviceFingerprint() },
    request,
  );

  now += 3 * dayMs + 1;
  await assert.rejects(
    service.automaticTrialChallenge(
      { publicKey: (await createDeviceKey()).publicKey, fingerprint: deviceFingerprint() },
      request,
    ),
    (error) => error.status === 402,
  );
  assert.equal(fixture.state.automaticTrials.length, 1);
  assert.equal(fixture.state.trialBrowserBindings.length, 0);
});

test("automatic trial does not merge devices when only one stable signature component matches", async () => {
  const now = Date.parse("2026-07-22T00:00:00.000Z");
  const fixture = await createRepositoryFixture();
  const service = createActivationService(
    { XSXB_ACTIVATION_SECRET: activationSecret },
    { repository: fixture.repository, now: () => now },
  );
  await service.automaticTrialChallenge(
    { publicKey: (await createDeviceKey()).publicKey, fingerprint: deviceFingerprint() },
    activationRequest("/api/activation/trial-challenge"),
  );

  await service.automaticTrialChallenge(
    {
      publicKey: (await createDeviceKey()).publicKey,
      fingerprint: deviceFingerprint({
        screen: { width: 2560, height: 1440, colorDepth: 24, pixelRatio: 2 },
      }),
    },
    activationRequest("/api/activation/trial-challenge"),
  );
  await service.automaticTrialChallenge(
    {
      publicKey: (await createDeviceKey()).publicKey,
      fingerprint: deviceFingerprint({ hardwareConcurrency: 12 }),
    },
    activationRequest("/api/activation/trial-challenge"),
  );

  assert.equal(fixture.state.automaticTrials.length, 3);
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
