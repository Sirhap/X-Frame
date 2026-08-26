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

test("Lite mutation routes 404 when the project is missing", async () => {
  const port = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const post = (pathname) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port,
          path: pathname,
          method: "POST",
          headers: { "content-type": "application/json" },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
          );
        },
      );
      request.on("error", reject);
      request.end(JSON.stringify({ projectId: "missing-lite-project" }));
    });
  try {
    for (const pathname of ["/api/frame-attachment-image", "/api/replace-frame", "/api/replace-animation"]) {
      const result = await post(pathname);
      assert.equal(result.status, 404, pathname);
      assert.match(result.body, /Lite project not found/);
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("Lite media routes accept bodies over the 2 MB JSON default", async () => {
  const port = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  // Base64 padding larger than the small-JSON limit; a real frame payload has
  // the same shape and must reach route logic instead of dying in readBody.
  const oversizedData = `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}`;
  const post = (pathname, payload) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port,
          path: pathname,
          method: "POST",
          headers: { "content-type": "application/json" },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
          );
        },
      );
      request.on("error", reject);
      request.end(JSON.stringify(payload));
    });
  try {
    for (const pathname of [
      "/api/attack-trail-texture",
      "/api/frame-attachment-image",
      "/api/replace-frame",
    ]) {
      const result = await post(pathname, { projectId: "missing-lite-project", data: oversizedData });
      assert.equal(result.status, 404, pathname);
      assert.match(result.body, /Lite project not found/, pathname);
    }
    const animationResult = await post("/api/replace-animation", {
      projectId: "missing-lite-project",
      frames: [{ path: "a.png" }],
      files: [{ data: oversizedData }],
    });
    assert.equal(animationResult.status, 404);
    assert.match(animationResult.body, /Lite project not found/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
