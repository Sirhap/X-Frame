"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildOneToOneSequencePlan,
  compareNaturalNames,
  sortSequenceAssets,
} = require("../animation_tuner/public/app_attachment_sequence");

test("attachment sequences use stable natural filename order", () => {
  const assets = [
    { id: "ten", name: "slash_10.png", path: "/ten.png" },
    { id: "two", name: "slash_2.png", path: "/two.png" },
    { id: "one", name: "slash_001.png", path: "/one.png" },
  ];

  assert.ok(compareNaturalNames("slash_2.png", "slash_10.png") < 0);
  assert.deepEqual(
    sortSequenceAssets(assets).map((asset) => asset.id),
    ["one", "two", "ten"],
  );
  assert.deepEqual(
    assets.map((asset) => asset.id),
    ["ten", "two", "one"],
  );
});

test("one-to-one plans sort frames and detect shared canvas coordinates", () => {
  const plan = buildOneToOneSequencePlan({
    assets: [
      { id: "second", name: "slash_0002.png", path: "/2.png", width: 256, height: 256 },
      { id: "first", name: "slash_0001.png", path: "/1.png", width: 256, height: 256 },
    ],
    frameIndexes: [5, 3, 5],
    ownerFrames: Array.from({ length: 6 }, () => ({ width: 256, height: 256 })),
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.canvas.mode, "shared");
  assert.deepEqual(
    plan.entries.map((entry) => [entry.frameIndex, entry.asset.id]),
    [
      [3, "first"],
      [5, "second"],
    ],
  );
  assert.deepEqual(plan.entries[0].transform, {
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    offset: { x: 0, y: 0 },
    rotation: 0,
  });
});

test("one-to-one plans reject unsafe counts and flag canvas review", () => {
  const mismatch = buildOneToOneSequencePlan({
    assets: [{ name: "slash_1.png", path: "/1.png" }],
    frameIndexes: [0, 1],
  });
  assert.deepEqual(
    {
      ok: mismatch.ok,
      code: mismatch.code,
      assetCount: mismatch.assetCount,
      frameCount: mismatch.frameCount,
    },
    { ok: false, code: "count_mismatch", assetCount: 1, frameCount: 2 },
  );

  const review = buildOneToOneSequencePlan({
    assets: [{ name: "slash_1.png", path: "/1.png", width: 64, height: 64 }],
    frameIndexes: [0],
    ownerFrames: [{ width: 256, height: 256 }],
  });
  assert.equal(review.ok, true);
  assert.deepEqual(review.canvas, { shared: 0, mismatch: 1, unknown: 0, mode: "review" });
});
