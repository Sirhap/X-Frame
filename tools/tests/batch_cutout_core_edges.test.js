"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyCutout,
  applyReferenceEdgeColorRestore,
} = require("../animation_tuner/public/batch_cutout_core");

test("cutout core returns a stable empty result for zero-sized input", () => {
  const source = new Uint8ClampedArray();

  assert.deepEqual(applyCutout(source, 0, 0), {
    data: source,
    removedPixels: 0,
    partialPixels: 0,
  });
  assert.deepEqual(
    applyReferenceEdgeColorRestore(source, 0, 0, { r: 10, g: 20, b: 30 }, { r: 40, g: 50, b: 60 }),
    source,
  );
});

test("cutout core rejects unsafe dimensions and mismatched RGBA buffers", () => {
  assert.throws(() => applyCutout(new Uint8ClampedArray(4), -1, 1), /dimensions/i);
  assert.throws(() => applyCutout(new Uint8ClampedArray(4), 1.5, 1), /dimensions/i);
  assert.throws(() => applyCutout(new Uint8ClampedArray(3), 1, 1), /RGBA length/i);
  assert.throws(() => applyCutout(new Uint8ClampedArray(), 4097, 4096), /pixel memory limit/i);
});

test("edge processing preserves a fully transparent pixel", () => {
  const source = Uint8ClampedArray.from([40, 80, 120, 0]);
  const result = applyCutout(source, 1, 1, {
    backgroundColors: [{ r: 0, g: 255, b: 0 }],
    blurRadius: 6,
    connected: false,
    edgeRecoveryStrength: 100,
  });

  assert.deepEqual([...result.data], [...source]);
  assert.equal(result.removedPixels, 0);
  assert.equal(result.partialPixels, 0);
});
