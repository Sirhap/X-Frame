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

test("browser runtime builds uniquely named transient tuning groups", () => {
  const group = browserRuntime.createSessionAnimationGroup(
    {
      animationName: "Idle",
      profileLabel: "Hero",
      animationType: "actor",
      fps: 12,
      premiumFeatures: ["cutout.edge-refinement"],
    },
    [{ name: "idle.png", data: "data:image/png;base64,AA==" }],
    [{ animationId: "idle" }],
    "en",
  );

  assert.equal(group.animationId, "idle-2");
  assert.equal(group.profileLabel, "Hero");
  assert.equal(group.speed, 12);
  assert.equal(group.frames[0].path, "data:image/png;base64,AA==");
  assert.deepEqual(group.premiumFeatures, ["cutout.edge-refinement"]);
  assert.match(group.uiId, /^browser-session:actor:idle-2:/);
  assert.throws(
    () => browserRuntime.createSessionAnimationGroup({ animationName: "Bad" }, [{ data: "" }], []),
    /PNG/,
  );
});

test("browser runtime reorganizes one session group and remaps its frame-owned state", () => {
  const group = browserRuntime.createSessionAnimationGroup(
    { animationName: "Idle", profileLabel: "Hero" },
    [
      { name: "one.png", data: "data:image/png;base64,AQ==" },
      { name: "two.png", data: "data:image/png;base64,Ag==" },
    ],
    [],
  );
  const prefix = `${group.runtimeAnimation}:`;
  const result = browserRuntime.reorganizeSessionAnimation(
    group,
    [
      { sourceIndex: 1, name: "two.png", flipped: true, data: "data:image/png;base64,Aw==" },
      { sourceIndex: 0, name: "one.png" },
    ],
    {
      frameVisualOverrides: { [`${prefix}0`]: { x: 10 }, [`${prefix}1`]: { x: 20 } },
      framePlaybackOverrides: { [`${prefix}0`]: { duration: 90 } },
      frameBoxOverrides: { [`${prefix}1`]: { hitbox: { offset: { x: 5 }, rotation: 12 } } },
      frameAudioBindings: {
        "browser-session:player:browser-character:actor:Idle:browser-session:1": {
          key: "browser-session:player:browser-character:actor:Idle:browser-session:1",
          metadata: { animation: group.runtimeAnimation, frame: 1 },
        },
      },
      frameImageAttachments: [
        { key: `${prefix}0`, metadata: { animation: group.runtimeAnimation, frame: 0 } },
      ],
      premiumFeatures: ["organizer.sequence-analysis"],
    },
  );

  assert.equal(group.frames[0].path, "data:image/png;base64,Aw==");
  assert.deepEqual(result.frameVisualOverrides[`${prefix}0`], { x: 20 });
  assert.deepEqual(result.frameVisualOverrides[`${prefix}1`], { x: 10 });
  assert.equal(result.frameBoxOverrides[`${prefix}0`].hitbox.offset.x, -5);
  assert.equal(result.frameBoxOverrides[`${prefix}0`].hitbox.rotation, -12);
  assert.equal(Object.values(result.frameAudioBindings)[0].metadata.frame, 0);
  assert.equal(result.frameImageAttachments[0].metadata.frame, 1);
  assert.deepEqual(group.premiumFeatures, ["organizer.sequence-analysis"]);
});

test("browser runtime replaces current pixels and scopes export state to one group", () => {
  const idle = browserRuntime.createSessionAnimationGroup(
    { animationName: "Idle", profileLabel: "Hero" },
    [{ name: "idle.png", data: "data:image/png;base64,AQ==" }],
    [],
  );
  const run = browserRuntime.createSessionAnimationGroup(
    { animationName: "Run", profileLabel: "Hero" },
    [{ name: "run.png", data: "data:image/png;base64,Ag==" }],
    [idle],
  );
  browserRuntime.replaceSessionAnimationFrames(
    idle,
    [{ data: "data:image/png;base64,Aw==" }],
    ["cutout.edge-refinement"],
  );
  const snapshot = browserRuntime.createSessionExportSnapshot(idle, {
    values: { [idle.scale]: 1.2, [run.scale]: 2 },
    frameVisualOverrides: {
      [`${idle.runtimeAnimation}:0`]: { x: 1 },
      [`${run.runtimeAnimation}:0`]: { x: 2 },
    },
    framePlaybackOverrides: {},
    frameBoxOverrides: {},
    frameAudioBindings: {},
    frameImageAttachments: [],
  });

  assert.equal(idle.frames[0].path, "data:image/png;base64,Aw==");
  assert.deepEqual(idle.premiumFeatures, ["cutout.edge-refinement"]);
  assert.deepEqual(snapshot.values, { [idle.scale]: 1.2 });
  assert.deepEqual(snapshot.frameVisualOverrides, { [`${idle.runtimeAnimation}:0`]: { x: 1 } });
});

test("browser runtime exports tuned animation metadata and attachment assets", async () => {
  let capturedEntries = [];
  const result = await browserRuntime.exportWorkbenchPackage(
    { animationName: "Idle", animationId: "idle", profileLabel: "Hero", fps: 12 },
    [{ name: "idle.png", data: "data:image/png;base64,AA==" }],
    {
      tuning: { values: { scale: 1.2 } },
      premiumFeatures: ["tuner.collision-boxes"],
      attachmentAssets: [{ name: "spark.png", path: "data:image/png;base64,AQ==" }],
    },
    {
      authorization: { permit: "signed-export-permit" },
      batchZip: {
        async buildZip(entries) {
          capturedEntries = entries;
          return new Blob(["zip"]);
        },
      },
      fetchImpl: async () => ({ ok: true, json: async () => ({ authorized: true }) }),
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    },
  );

  const manifest = JSON.parse(capturedEntries.find((entry) => entry.name === "xsxb-animation.json").data);
  assert.equal(result.filename, "Idle-tuned-xsxb.zip");
  assert.equal(
    capturedEntries.some((entry) => entry.name === "attachments/asset_0001.png"),
    true,
  );
  assert.equal(manifest.workbench.tuning.values.scale, 1.2);
  assert.deepEqual(manifest.workbench.premiumFeatures, ["tuner.collision-boxes"]);
});
