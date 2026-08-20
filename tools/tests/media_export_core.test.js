"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createAtlasManifest,
  createGodotSpriteFrames,
  createFramesManifest,
  planSpriteSheets,
  renderSpriteSheetEntries,
  safeStem,
} = require("../animation_tuner/public/media_export_core");

test("sprite-sheet filenames preserve Unicode and neutralize empty path segments", () => {
  assert.equal(safeStem(" Hero / 待机 "), "Hero_待机");
  assert.equal(safeStem(".."), "animation");
});

test("sprite-sheet planning preserves order and top-left source dimensions", () => {
  const plan = planSpriteSheets([
    { name: "a.png", width: 32, height: 16 },
    { name: "b.png", width: 16, height: 24 },
  ]);
  assert.deepEqual({ width: plan.cellWidth, height: plan.cellHeight }, { width: 32, height: 24 });
  assert.deepEqual(
    plan.placements.map(({ index, x, y, width, height }) => ({ index, x, y, width, height })),
    [
      { index: 0, x: 0, y: 0, width: 32, height: 16 },
      { index: 1, x: 32, y: 0, width: 16, height: 24 },
    ],
  );
});

test("sprite-sheet planning automatically paginates within the texture limit", () => {
  const frames = Array.from({ length: 5 }, (_, index) => ({
    name: `${index}.png`,
    width: 64,
    height: 64,
  }));
  const plan = planSpriteSheets(frames, { maxTextureSize: 128 });
  assert.deepEqual(
    plan.pages.map(({ count, width, height }) => ({ count, width, height })),
    [
      { count: 4, width: 128, height: 128 },
      { count: 1, width: 64, height: 64 },
    ],
  );
  assert.deepEqual(
    plan.placements.map((placement) => placement.page),
    [0, 0, 0, 0, 1],
  );
});

test("atlas and frame manifests expose deterministic timing and page filenames", () => {
  const frames = [
    { name: "idle-a.png", width: 32, height: 32, frameId: "idle:a", assetRevision: 2 },
    { name: "idle-b.png", width: 32, height: 32, frameId: "idle:b", assetRevision: 4 },
  ];
  const plan = planSpriteSheets(frames);
  const atlas = createAtlasManifest({ animationName: "Hero Idle", fps: 20 }, plan);
  const manifest = createFramesManifest(
    { animationName: "Hero Idle", fps: 20, exportRecipe: { imageName: "hero" } },
    frames,
  );
  assert.equal(atlas.sheets[0].file, "spritesheets/Hero_Idle.png");
  assert.equal(atlas.frameDurationMs, 50);
  assert.equal(manifest.frames[1].file, "frames/hero2.png");
  assert.equal(manifest.frames[1].frameId, "idle:b");
  assert.equal(manifest.frames[1].assetRevision, 4);
  assert.equal(atlas.frames[1].frameId, "idle:b");
  assert.equal(atlas.frames[1].assetRevision, 4);
  assert.equal(manifest.totalDurationMs, 100);
});

test("fixed sprite-sheet sizes match the selected atlas page and power-of-two option", () => {
  const frames = Array.from({ length: 17 }, () => ({ width: 128, height: 128 }));
  const fixed = planSpriteSheets(frames, { maxTextureSize: 512, fixedPageSize: true });
  assert.equal(fixed.pages.length, 2);
  assert.deepEqual(
    fixed.pages.map(({ width, height }) => [width, height]),
    [
      [512, 512],
      [512, 512],
    ],
  );
  const aligned = planSpriteSheets([{ width: 150, height: 90 }], {
    maxTextureSize: 512,
    powerOfTwo: true,
  });
  assert.deepEqual([aligned.pages[0].width, aligned.pages[0].height], [256, 128]);
});

test("sprite-sheet recipe options preserve gap, per-frame durations, and Godot paths", () => {
  const frames = [
    { name: "a.png", width: 16, height: 16, durationMs: 80 },
    { name: "b.png", width: 16, height: 16, durationMs: 120 },
  ];
  const plan = planSpriteSheets(frames, { columns: 1, gap: 4, maxTextureSize: 64 });
  const manifest = createFramesManifest(
    { animationName: "idle", fps: 12, exportRecipe: { anchor: "bottom-center" } },
    frames,
  );
  assert.equal(plan.pages[0].height, 36);
  assert.equal(manifest.totalDurationMs, 200);
  assert.match(createGodotSpriteFrames({ animationName: "idle" }, plan), /path="idle\.png"/);
});

test("EXP-006 fitted atlas page follows the selected output size, not leftover 2048", () => {
  const frames = Array.from({ length: 12 }, (_, index) => ({
    name: `jump_${index}.png`,
    width: 128,
    height: 128,
  }));
  const plan = planSpriteSheets(frames, { outputWidth: 128, outputHeight: 128 });
  assert.equal(plan.pages.length, 1);
  assert.deepEqual({ width: plan.pages[0].width, height: plan.pages[0].height }, { width: 128, height: 128 });
  assert.equal(plan.placements.length, 12);
  assert.ok(
    plan.placements.every((placement) => placement.page === 0),
    "12 frames at a 128 output pill must stay on one page",
  );
  assert.notEqual(plan.pages[0].width, 2048);

  const large = planSpriteSheets(frames, { outputWidth: 512, outputHeight: 512 });
  assert.deepEqual(
    { width: large.pages[0].width, height: large.pages[0].height },
    { width: 512, height: 512 },
  );
});

test("sprite-sheet planning rejects a frame larger than the safe canvas", () => {
  assert.throws(() => planSpriteSheets([{ width: 9000, height: 20 }]), /exceeds the 8192px/);
});

test("sprite-sheet planning rejects non-positive dimensions and cannot exceed the 8192px limit", () => {
  assert.throws(() => planSpriteSheets([{ width: 32, height: 0 }]), /dimensions are invalid/);
  const plan = planSpriteSheets([{ width: 32, height: 32 }], { maxTextureSize: 16_384 });
  assert.equal(plan.maxTextureSize, 8192);
});

test("sprite-sheet rendering clears pages and keeps each source at its top-left placement", async () => {
  const frames = [
    { image: { id: "first" }, name: "first.png", width: 32, height: 16 },
    { image: { id: "second" }, name: "second.png", width: 16, height: 24 },
  ];
  const plan = planSpriteSheets(frames, { maxTextureSize: 64 });
  const calls = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect: (...args) => calls.push(["clear", ...args]),
      drawImage: (...args) => calls.push(["draw", ...args]),
    }),
    toBlob: (callback) => callback(new Blob(["png"], { type: "image/png" })),
  };

  const entries = await renderSpriteSheetEntries(frames, plan, {
    document: { createElement: () => canvas },
    metadata: { animationName: "Hero" },
  });

  assert.equal(entries[0].name, "spritesheets/Hero.png");
  assert.deepEqual(calls[0], ["clear", 0, 0, 64, 24]);
  assert.deepEqual(calls[1], ["draw", frames[0].image, 0, 0, 32, 16]);
  assert.deepEqual(calls[2], ["draw", frames[1].image, 32, 0, 16, 24]);
});

test("sprite-sheet rendering discards an encoded page when cancellation arrives", async () => {
  const abortController = new AbortController();
  const frames = [{ image: {}, width: 16, height: 16 }];
  const plan = planSpriteSheets(frames);
  const canvas = {
    getContext: () => ({ clearRect() {}, drawImage() {} }),
    toBlob(callback) {
      abortController.abort();
      callback(new Blob(["png"]));
    },
  };

  await assert.rejects(
    renderSpriteSheetEntries(frames, plan, {
      document: { createElement: () => canvas },
      signal: abortController.signal,
    }),
    { name: "AbortError" },
  );
});
