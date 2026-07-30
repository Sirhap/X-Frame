"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createPremiumAuthorizer,
  requiredPremiumFeatures,
} = require("../animation_tuner/server_premium_authorization");

class TestHttpError extends Error {
  /** @param {number} status HTTP status. @param {string} message Error message. */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

test("editing and saving remain available before export activation", () => {
  const authorizer = createPremiumAuthorizer({
    activationService: { isActivated: () => false },
    HttpError: TestHttpError,
  });
  const requestWithoutHeader = { headers: {} };
  assert.doesNotThrow(() =>
    authorizer.assertAuthorized(requestWithoutHeader, "/api/save", {
      frame_audio_bindings: [{ key: "walk:0" }],
    }),
  );
  assert.doesNotThrow(() =>
    authorizer.assertAuthorized(requestWithoutHeader, "/api/save", {
      values: { "profiles.hero.visual_size": 1 },
    }),
  );
});

test("import, processing, and media editing routes remain free before export", () => {
  const authorizer = createPremiumAuthorizer({
    activationService: { isActivated: () => false },
    HttpError: TestHttpError,
  });
  for (const pathname of [
    "/api/replace-animation",
    "/api/replace-frame",
    "/api/frame-audio",
    "/api/frame-attachment-image",
    "/api/attachment-assets",
    "/api/import-animation",
    "/api/reorganize-animation",
  ]) {
    assert.doesNotThrow(() => authorizer.assertAuthorized({ headers: {} }, pathname, {}));
  }
});

test("legacy write authorization reports no export requirements", () => {
  const authorizer = createPremiumAuthorizer({
    activationService: { isActivated: () => true },
    HttpError: TestHttpError,
  });
  assert.deepEqual(
    authorizer.assertAuthorized({ headers: {} }, "/api/save", {
      soul: { frame_box_overrides: { "hero:0": { collisionbox: { enabled: true } } } },
    }),
    [],
  );
  assert.deepEqual(requiredPremiumFeatures("/api/replace-animation", {}), []);
  assert.deepEqual(requiredPremiumFeatures("/api/reorganize-animation", {}), []);
});
