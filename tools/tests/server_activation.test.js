"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { createActivationService } = require("../animation_tuner/server_activation");

/** @param {string} code Activation code. @returns {string} Normalized SHA-256. */
function codeHash(code) {
  return crypto.createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

test("activation service validates configured hashes and signed cookies", () => {
  const now = 1_800_000_000_000;
  const service = createActivationService({
    codeHashes: [codeHash("XSXB-PRO-TEST")],
    secret: "test-secret-with-at-least-thirty-two-characters",
    now: () => now,
    ttlSeconds: 3600,
  });

  assert.deepEqual(service.status({ headers: {} }), {
    activated: false,
    configured: true,
    expiresAt: "",
  });
  assert.equal(service.activate("wrong").status, 401);
  const activation = service.activate(" xsxb-pro-test ");
  assert.equal(activation.ok, true);
  const cookie = service.cookieHeader(activation.token, { headers: {}, socket: {} });
  assert.match(cookie, /^xsxb_activation=/);
  assert.match(cookie, /HttpOnly/);
  assert.equal(service.status({ headers: { cookie } }).activated, true);
});

test("malformed activation cookies do not throw", () => {
  const service = createActivationService({
    codeHashes: [codeHash("XSXB-PRO-TEST")],
    secret: "test-secret-with-at-least-thirty-two-characters",
  });
  const request = { headers: { cookie: "xsxb_activation=%E0%A4%A" } };
  assert.doesNotThrow(() => service.status(request));
  assert.equal(service.status(request).activated, false);
});

test("activation service fails closed when code verification is unconfigured", () => {
  for (const options of [
    { secret: "test-secret-with-at-least-thirty-two-characters" },
    { codeHashes: [codeHash("XSXB-PRO-TEST")] },
    { codeHashes: [codeHash("XSXB-PRO-TEST")], secret: "too-short" },
  ]) {
    const service = createActivationService(options);
    assert.equal(service.activate("XSXB-PRO-TEST").status, 503);
    assert.equal(service.status({ headers: {} }).configured, false);
  }
});
