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
  };
  const repository = {
    async findLicenseByCodeHash(codeHash) {
      return codeHash === state.license.code_hash ? state.license : null;
    },
    async findDeviceByLicenseId(licenseId) {
      return state.device?.license_id === licenseId ? state.device : null;
    },
    async findAuthorizationByDeviceId(deviceId) {
      if (state.device?.id !== deviceId) return null;
      return {
        device_id: state.device.id,
        license_id: state.license.id,
        public_key: state.device.public_key,
        public_key_hash: state.device.public_key_hash,
        device_revoked_at: state.device.revoked_at,
        plan: state.license.plan,
        expires_at: state.license.expires_at,
        license_revoked_at: state.license.revoked_at,
      };
    },
    async activateLicense(_licenseId, activatedAt, expiresAt) {
      state.license.first_activated_at ||= activatedAt;
      state.license.expires_at ||= expiresAt;
      return { success: true };
    },
    async createDevice(device) {
      if (state.device) throw new Error("unique constraint");
      state.device = {
        id: device.id,
        license_id: device.licenseId,
        public_key: device.publicKey,
        public_key_hash: device.publicKeyHash,
        device_name: device.deviceName,
        first_ip_hash: device.ipHash,
        last_ip_hash: device.ipHash,
        first_country: device.country,
        last_country: device.country,
        created_at: device.createdAt,
        last_seen_at: device.createdAt,
        revoked_at: null,
      };
      return { success: true };
    },
    async touchDevice(_deviceId, seenAt, ipHash, country) {
      state.device.last_seen_at = seenAt;
      state.device.last_ip_hash = ipHash;
      state.device.last_country = country;
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
