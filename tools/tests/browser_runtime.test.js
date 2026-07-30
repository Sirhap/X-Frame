"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const browserRuntime = require("../animation_tuner/public/browser_runtime.js");
const mediaExportCore = require("../animation_tuner/public/media_export_core.js");

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
      mediaExportCore,
    },
  );

  assert.equal(result.filename, "Walk-East-xsxb.zip");
  assert.equal(result.frameCount, 1);
  assert.equal(capturedEntries[0].name, "frames/frame_0001.png");
  assert.ok(capturedEntries.some((entry) => entry.name === "frames.json"));
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

test("browser runtime rejects organizer ZIP output without a verified permit", async () => {
  await assert.rejects(
    browserRuntime.exportAnimationPackage(
      { animationName: "Idle" },
      [{ data: "data:image/png;base64,AA==" }],
      {
        premiumFeatures: ["organizer.output"],
        batchZip: { buildZip: async () => new Blob() },
      },
    ),
    /verified Pro export permit/,
  );
});

test("browser runtime creates organizer ZIP output after permit verification", async () => {
  const verificationRequests = [];
  const result = await browserRuntime.exportAnimationPackage(
    { animationName: "Idle" },
    [{ data: "data:image/png;base64,AA==" }],
    {
      authorization: { permit: "signed-permit" },
      premiumFeatures: ["organizer.output"],
      async fetchImpl(path, request) {
        verificationRequests.push({ path, body: JSON.parse(request.body) });
        return {
          ok: true,
          async json() {
            return { authorized: true };
          },
        };
      },
      batchZip: { buildZip: async () => new Blob(["zip"]) },
      mediaExportCore,
    },
  );

  assert.equal(result.frameCount, 1);
  assert.deepEqual(verificationRequests, [
    {
      path: "/api/export/verify",
      body: { features: ["organizer.output"], permit: "signed-permit" },
    },
  ]);
});

test("browser runtime builds a sprite-sheet-only package without dangling PNG paths", async () => {
  let capturedEntries = [];
  const drawCalls = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect() {},
      drawImage: (...args) => drawCalls.push(args),
    }),
    toBlob: (callback) => callback(new Blob(["sheet"])),
  };

  await browserRuntime.exportAnimationPackage(
    { animationName: "Idle", fps: 10 },
    [
      {
        name: "idle.png",
        data: "data:image/png;base64,AA==",
        image: { id: "idle" },
        width: 32,
        height: 24,
      },
    ],
    {
      formats: { frames: false, spritesheet: true },
      mediaExportCore,
      urlApi: {},
      document: {
        body: { append() {} },
        createElement: (tagName) => (tagName === "canvas" ? canvas : { click() {}, remove() {} }),
      },
      batchZip: {
        async buildZip(entries) {
          capturedEntries = entries;
          return new Blob(["zip"]);
        },
      },
    },
  );

  assert.ok(!capturedEntries.some((entry) => entry.name.startsWith("frames/")));
  assert.ok(capturedEntries.some((entry) => entry.name === "spritesheets/Idle.png"));
  assert.ok(capturedEntries.some((entry) => entry.name === "spritesheets/atlas.json"));
  const manifest = JSON.parse(capturedEntries.find((entry) => entry.name === "xsxb-animation.json").data);
  assert.equal(manifest.outputs.pngSequence, false);
  assert.equal(manifest.outputs.spriteSheet, true);
  assert.equal("file" in manifest.animation.frames[0], false);
  assert.deepEqual(drawCalls[0], [{ id: "idle" }, 0, 0, 32, 24]);
});

test("browser runtime stops before ZIP creation when export is cancelled", async () => {
  const abortController = new AbortController();
  abortController.abort();
  let zipBuilds = 0;

  await assert.rejects(
    browserRuntime.exportAnimationPackage(
      { animationName: "Idle" },
      [{ data: "data:image/png;base64,AA==" }],
      {
        signal: abortController.signal,
        mediaExportCore,
        batchZip: {
          async buildZip() {
            zipBuilds += 1;
            return new Blob(["zip"]);
          },
        },
      },
    ),
    { name: "AbortError" },
  );

  assert.equal(zipBuilds, 0);
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

test("browser runtime deletes selected session frames and remaps owned bindings and trails", () => {
  const group = browserRuntime.createSessionAnimationGroup(
    { animationName: "Attack", profileLabel: "Hero" },
    [
      { name: "one.png", data: "data:image/png;base64,AQ==" },
      { name: "two.png", data: "data:image/png;base64,Ag==" },
      { name: "three.png", data: "data:image/png;base64,Aw==" },
    ],
    [],
  );
  const prefix = `${group.runtimeAnimation}:`;
  const result = browserRuntime.deleteSessionAnimationFrames(group, [1], {
    frameVisualOverrides: {
      [`${prefix}0`]: { x: 10 },
      [`${prefix}1`]: { x: 20 },
      [`${prefix}2`]: { x: 30 },
    },
    framePlaybackOverrides: { [`${prefix}2`]: { duration: 90 } },
    frameBoxOverrides: { [`${prefix}1`]: { hitbox: {} } },
    frameAudioBindings: {
      [`${prefix}1`]: { path: "removed.wav" },
      [`${prefix}2`]: { path: "kept.wav" },
    },
    frameImageAttachments: [
      { key: `${prefix}0`, metadata: { animation: group.runtimeAnimation, frame: 0 } },
      { key: `${prefix}1`, metadata: { animation: group.runtimeAnimation, frame: 1 } },
    ],
    attackTrails: {
      schemaVersion: 8,
      bindings: {
        [group.runtimeAnimation]: [{ id: "slash", sticks: [{ frame: 0 }, { frame: 1 }, { frame: 2 }] }],
      },
    },
  });

  assert.deepEqual(
    group.frames.map((frame) => frame.name),
    ["one.png", "three.png"],
  );
  assert.deepEqual(result.frameVisualOverrides, {
    [`${prefix}0`]: { x: 10 },
    [`${prefix}1`]: { x: 30 },
  });
  assert.deepEqual(result.framePlaybackOverrides, { [`${prefix}1`]: { duration: 90 } });
  assert.deepEqual(result.frameBoxOverrides, {});
  assert.deepEqual(result.frameAudioBindings, { [`${prefix}1`]: { path: "kept.wav" } });
  assert.equal(result.frameImageAttachments.length, 1);
  assert.deepEqual(
    result.attackTrails.bindings[group.runtimeAnimation][0].sticks.map((stick) => stick.frame),
    [0, 1],
  );
});

test("browser runtime deletes a complete session animation without leaking owned state", () => {
  const attack = browserRuntime.createSessionAnimationGroup(
    { animationName: "Attack", profileId: "hero", profileLabel: "Hero" },
    [{ name: "attack.png", data: "data:image/png;base64,AQ==" }],
    [],
  );
  const idle = browserRuntime.createSessionAnimationGroup(
    { animationName: "Idle", profileId: "npc", profileLabel: "NPC" },
    [{ name: "idle.png", data: "data:image/png;base64,Ag==" }],
    [attack],
  );
  const result = browserRuntime.deleteSessionAnimation(
    {
      groups: [attack, idle],
      profiles: [
        { id: "hero", label: "Hero" },
        { id: "npc", label: "NPC" },
      ],
      attackTrails: {},
    },
    attack,
    {
      values: {
        [attack.scale]: 1.5,
        [attack.characterScale]: 1.2,
        [idle.scale]: 0.8,
        [idle.characterScale]: 0.9,
      },
      frameVisualOverrides: {
        [`${attack.runtimeAnimation}:0`]: { x: 1 },
        [`${idle.runtimeAnimation}:0`]: { x: 2 },
      },
      framePlaybackOverrides: {
        [`${attack.runtimeAnimation}:__group`]: { loop: true },
        [`${idle.runtimeAnimation}:0`]: { duration: 100 },
      },
      frameBoxOverrides: { [`${attack.runtimeAnimation}:0`]: { hitbox: {} } },
      frameAudioBindings: {
        [`${attack.runtimeAnimation}:0`]: { path: "attack.wav" },
        [`${idle.runtimeAnimation}:0`]: { path: "idle.wav" },
      },
      frameImageAttachments: [{ key: `${attack.runtimeAnimation}:0` }, { key: `${idle.runtimeAnimation}:0` }],
      attachmentAssets: [
        { id: "slash", groupKey: attack.runtimeAnimation },
        { id: "aura", groupKey: idle.runtimeAnimation },
      ],
      attackTrails: {
        schemaVersion: 8,
        bindings: {
          [attack.runtimeAnimation]: [{ id: "slash", sticks: [] }],
          [idle.runtimeAnimation]: [{ id: "aura", sticks: [] }],
        },
      },
    },
  );

  assert.deepEqual(result.config.groups, [idle]);
  assert.deepEqual(result.config.profiles, [{ id: "npc", label: "NPC" }]);
  assert.equal(result.nextGroup, idle);
  assert.deepEqual(result.values, {
    [idle.scale]: 0.8,
    [idle.characterScale]: 0.9,
  });
  assert.deepEqual(result.frameVisualOverrides, {
    [`${idle.runtimeAnimation}:0`]: { x: 2 },
  });
  assert.deepEqual(result.framePlaybackOverrides, {
    [`${idle.runtimeAnimation}:0`]: { duration: 100 },
  });
  assert.deepEqual(result.frameBoxOverrides, {});
  assert.deepEqual(result.frameAudioBindings, {
    [`${idle.runtimeAnimation}:0`]: { path: "idle.wav" },
  });
  assert.deepEqual(result.frameImageAttachments, [{ key: `${idle.runtimeAnimation}:0` }]);
  assert.deepEqual(result.attachmentAssets, [{ id: "aura", groupKey: idle.runtimeAnimation }]);
  assert.deepEqual(Object.keys(result.attackTrails.bindings), [idle.runtimeAnimation]);
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
