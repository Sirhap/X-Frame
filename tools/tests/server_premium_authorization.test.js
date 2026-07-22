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

test("server derives premium save requirements without trusting the client header", () => {
  const authorizer = createPremiumAuthorizer({
    activationService: { isActivated: () => false },
    HttpError: TestHttpError,
  });
  const requestWithoutHeader = { headers: {} };
  assert.throws(
    () =>
      authorizer.assertAuthorized(requestWithoutHeader, "/api/save", {
        frame_audio_bindings: [{ key: "walk:0" }],
      }),
    (error) => error instanceof TestHttpError && error.status === 402,
  );
  assert.doesNotThrow(() =>
    authorizer.assertAuthorized(requestWithoutHeader, "/api/save", {
      values: { "profiles.hero.visual_size": 1 },
    }),
  );
});

test("animation replacement and dedicated premium media routes always require activation", () => {
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
    assert.throws(
      () => authorizer.assertAuthorized({ headers: {} }, pathname, {}),
      (error) => error.status === 402,
    );
  }
});

test("valid activation authorizes server-derived premium writes", () => {
  const authorizer = createPremiumAuthorizer({
    activationService: { isActivated: () => true },
    HttpError: TestHttpError,
  });
  assert.deepEqual(
    authorizer.assertAuthorized({ headers: {} }, "/api/save", {
      soul: { frame_box_overrides: { "hero:0": { collisionbox: { enabled: true } } } },
    }),
    ["tuner.collision-boxes"],
  );
  assert.deepEqual(requiredPremiumFeatures("/api/replace-animation", {}), ["cutout.output"]);
  assert.deepEqual(requiredPremiumFeatures("/api/reorganize-animation", {}), ["organizer.output"]);
});
