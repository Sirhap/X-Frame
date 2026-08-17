"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { canServeLiteAsset, server, validateWriteRequest } = require("../frame_tuner_lite/server");

const litePort = Number(process.env.LITE_PORT || 5180);
const liteOrigin = `http://127.0.0.1:${litePort}`;
const liteHost = `127.0.0.1:${litePort}`;
const repoRoot = path.resolve(__dirname, "../..");

test("Lite write guard rejects cross-origin POSTs and allows same-origin or CLI calls", () => {
  assert.throws(
    () =>
      validateWriteRequest({
        headers: { "content-type": "application/json", origin: "https://evil.example" },
      }),
    (error) => error.status === 403 && /Cross-origin API writes are not allowed/.test(error.message),
  );
  assert.throws(
    () => validateWriteRequest({ headers: { origin: liteOrigin } }),
    (error) => error.status === 415,
  );
  assert.doesNotThrow(() =>
    validateWriteRequest({
      headers: { "content-type": "application/json", host: liteHost, origin: liteOrigin },
    }),
  );
  assert.doesNotThrow(() => validateWriteRequest({ headers: { "content-type": "application/json" } }));
  assert.throws(
    () =>
      validateWriteRequest({
        headers: {
          "content-type": "application/json",
          host: "evil.example",
          origin: "http://evil.example",
        },
      }),
    (error) => error.status === 403,
  );
});

test("Lite /asset allowlist matches public presets and rejects other repo media", () => {
  const publicPreset = path.join(
    repoRoot,
    "tools/animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
  );
  const otherRepoPng = path.join(
    repoRoot,
    "tools/tests/e2e/zoom_visual.spec.js-snapshots/cutout-zoom-100-chromium-darwin.png",
  );
  assert.equal(canServeLiteAsset(publicPreset), true);
  assert.equal(canServeLiteAsset(otherRepoPng), false);
  assert.equal(canServeLiteAsset(path.join(repoRoot, "package.json")), false);
});

test("Lite GET /asset serves public media and hides other repo images", async () => {
  const port = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const getAsset = (relPath) =>
    new Promise((resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port,
            path: `/asset?path=${encodeURIComponent(relPath)}`,
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode));
          },
        )
        .on("error", reject);
    });
  try {
    assert.equal(
      await getAsset("tools/animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png"),
      200,
    );
    assert.equal(
      await getAsset("tools/tests/e2e/zoom_visual.spec.js-snapshots/cutout-zoom-100-chromium-darwin.png"),
      404,
    );
    assert.equal(await getAsset("../secret.png"), 404);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
