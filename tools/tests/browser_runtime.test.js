"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const browserRuntime = require("../animation_tuner/public/browser_runtime.js");

test("browser runtime creates an isolated empty project shell", async () => {
  const response = await browserRuntime.fetchConfig();
  const config = await response.json();
  assert.equal(response.ok, true);
  assert.equal(config.activeProjectId, "browser-session");
  assert.deepEqual(config.groups, []);
  assert.deepEqual(config.scenes, []);
});

test("browser runtime builds a portable animation package", async () => {
  let capturedEntries = [];
  const result = await browserRuntime.exportAnimationPackage(
    {
      animationName: "Walk / East",
      profileLabel: "Hero",
      animationType: "actor",
      fps: 12,
      anchorMode: "canvas_bottom_center",
    },
    [{ name: "walk.png", data: "data:image/png;base64,AA==", flipped: false }],
    {
      batchZip: {
        async buildZip(entries) {
          capturedEntries = entries;
          return new Blob(["zip"]);
        },
      },
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    },
  );

  assert.equal(result.filename, "Walk-East-xsxb.zip");
  assert.equal(result.frameCount, 1);
  assert.equal(capturedEntries[0].name, "frames/frame_0001.png");
  const manifest = JSON.parse(capturedEntries.find((entry) => entry.name === "xsxb-animation.json").data);
  assert.equal(manifest.godotImport.enabled, false);
  assert.equal(manifest.animation.frames[0].file, "frames/frame_0001.png");
});

test("browser runtime rejects frames without processed PNG data", async () => {
  await assert.rejects(
    browserRuntime.exportAnimationPackage({ animationName: "Idle" }, [{ data: "" }], {
      batchZip: { buildZip: async () => new Blob() },
    }),
    /missing processed PNG data/,
  );
});
