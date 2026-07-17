"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyCutout,
  applyReferenceColorReplace,
  estimateBackgroundColor,
} = require("../animation_tuner/public/batch_cutout_core.js");

test("automatic background sampling returns a real source color", () => {
  const pixels = Uint8ClampedArray.from([192, 200, 208, 255, 207, 200, 208, 255]);
  const sampled = estimateBackgroundColor(pixels, 2, 1);

  assert.deepEqual({ r: sampled.r, g: sampled.g, b: sampled.b }, { r: 192, g: 200, b: 208 });
  const result = applyReferenceColorReplace(pixels, 2, 1, { x: 0, y: 0 }, { r: 0, g: 0, b: 0, a: 0 }, 1, {
    referenceColor: { ...sampled, a: 255 },
    edgeEnhance: 10,
  });
  assert.deepEqual(
    [...result].filter((_value, offset) => offset % 4 === 3),
    [0, 0],
  );
});

test("connected edge enhancement requires a base-tolerance seed", () => {
  const pixels = Uint8ClampedArray.from([120, 100, 100, 255, 120, 100, 100, 255]);
  const result = applyCutout(pixels, 2, 1, {
    referenceChromaKey: true,
    connected: true,
    backgroundColors: [{ r: 100, g: 100, b: 100 }],
    tolerance: 1,
    edgeBoost: 5,
    feather: 0,
    chromaFeather: 0,
    edgeRecoveryStrength: 0,
    despillStrength: 0,
    alphaLow: 0,
    alphaHigh: 0,
  });

  assert.deepEqual(
    [...result.data].filter((_value, offset) => offset % 4 === 3),
    [255, 255],
  );
});
