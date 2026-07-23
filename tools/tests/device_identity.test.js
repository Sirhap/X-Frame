"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const deviceIdentityModule = require("../animation_tuner/public/device_identity.js");

/** @param {string} value Base64url text. @returns {Uint8Array} Decoded bytes. */
function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(Buffer.from(normalized, "base64"));
}

/** @returns {{get:()=>Promise<object|null>,put:(value:object)=>Promise<void>,read:()=>object|null}} Memory storage. */
function createMemoryStorage() {
  let value = null;
  return {
    async get() {
      return value;
    },
    async put(nextValue) {
      value = nextValue;
    },
    read() {
      return value;
    },
  };
}

test("device identity creates a non-extractable P-256 key and renews by signature", async () => {
  const storage = createMemoryStorage();
  const paths = [];
  let publicKey = null;
  let challengeIndex = 0;
  const verifiedFingerprints = [];

  /** @param {string} input Request path. @param {RequestInit} options Fetch options. @returns {Promise<Response>} Mock response. */
  async function fetchImpl(input, options) {
    try {
      const pathname = String(input);
      paths.push(pathname);
      const payload = JSON.parse(String(options?.body || "{}"));
      if (pathname === "/api/activation/challenge") {
        publicKey = await crypto.subtle.importKey(
          "jwk",
          payload.publicKey,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        );
        challengeIndex += 1;
        return Response.json({ challenge: `activation-challenge-${challengeIndex}` });
      }
      if (pathname === "/api/activation/device-challenge") {
        assert.equal(payload.deviceId, "device-test");
        challengeIndex += 1;
        return Response.json({ challenge: `renewal-challenge-${challengeIndex}` });
      }
      if (pathname === "/api/activation/verify") {
        verifiedFingerprints.push(payload.fingerprint);
        const valid = await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          publicKey,
          base64UrlToBytes(payload.signature),
          new TextEncoder().encode(payload.challenge),
        );
        return Response.json(
          valid
            ? { activated: true, deviceId: "device-test", expiresAt: "2026-07-25T00:00:00.000Z" }
            : { activated: false, error: "bad signature" },
          { status: valid ? 200 : 401 },
        );
      }
      return Response.json({ error: "not found" }, { status: 404 });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  }

  const controller = deviceIdentityModule.createController({
    fetchImpl,
    cryptoApi: crypto,
    storage,
    navigatorRef: { platform: "Test browser" },
    fingerprintCollector: async () => ({ platform: "macOS", userAgent: "Test Browser/1.0" }),
  });
  const activation = await controller.activate("XSXB-TRIAL-TEST");
  assert.equal(activation.activated, true);
  assert.equal(storage.read().privateKey.extractable, false);
  assert.deepEqual(storage.read().privateKey.usages, ["sign"]);
  assert.equal(storage.read().publicKey.crv, "P-256");
  assert.equal(storage.read().deviceId, "device-test");

  const renewal = await controller.renew();
  assert.equal(renewal.activated, true);
  assert.deepEqual(paths, [
    "/api/activation/challenge",
    "/api/activation/verify",
    "/api/activation/device-challenge",
    "/api/activation/verify",
  ]);
  assert.deepEqual(verifiedFingerprints, [
    { platform: "macOS", userAgent: "Test Browser/1.0" },
    { platform: "macOS", userAgent: "Test Browser/1.0" },
  ]);
});

test("device identity does not call renewal API before a browser is bound", async () => {
  const storage = createMemoryStorage();
  const controller = deviceIdentityModule.createController({
    fetchImpl: async () => {
      throw new Error("unexpected request");
    },
    cryptoApi: crypto,
    storage,
  });

  assert.equal(await controller.renew(), null);
});

test("device identity starts a code-free trial with fingerprint signals", async () => {
  const storage = createMemoryStorage();
  let publicKey = null;
  let receivedFingerprint = null;
  const controller = deviceIdentityModule.createController({
    cryptoApi: crypto,
    storage,
    navigatorRef: { platform: "Test Mac" },
    fingerprintCollector: async () => ({ platform: "macOS", userAgent: "Test Browser/1.0" }),
    async fetchImpl(pathname, options) {
      const payload = JSON.parse(String(options?.body || "{}"));
      if (pathname === "/api/activation/trial-challenge") {
        receivedFingerprint = payload.fingerprint;
        publicKey = await crypto.subtle.importKey(
          "jwk",
          payload.publicKey,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        );
        return Response.json({ challenge: "trial-challenge" });
      }
      if (pathname === "/api/activation/verify") {
        const valid = await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          publicKey,
          base64UrlToBytes(payload.signature),
          new TextEncoder().encode(payload.challenge),
        );
        return Response.json(
          valid
            ? { activated: true, deviceId: "trial-device", expiresAt: "2026-07-25T00:00:00.000Z" }
            : { error: "bad signature" },
          { status: valid ? 200 : 401 },
        );
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });

  const trial = await controller.startTrial();
  assert.equal(trial.activated, true);
  assert.deepEqual(receivedFingerprint, { platform: "macOS", userAgent: "Test Browser/1.0" });
  assert.equal(storage.read().deviceId, "trial-device");
});
