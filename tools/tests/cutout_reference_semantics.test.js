"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyCutout,
  applyProductCutout,
  applyReferenceColorReplace,
  estimateBackgroundColor,
} = require("../animation_tuner/public/batch_cutout_core.js");

/** Runs one product recolor repair without automatic background removal. */
function applyRecolorRepair(pixels, width, repair) {
  return applyProductCutout(pixels, width, pixels.length / 4 / width, { automaticCutout: false }, [repair])
    .data;
}

test("product global recolor uses the FramePacker 5.1x RGBA tolerance", () => {
  const pixels = Uint8ClampedArray.from([100, 100, 100, 255, 110, 100, 100, 255, 111, 100, 100, 255]);
  const result = applyRecolorRepair(pixels, 3, {
    mode: "recolor",
    scope: "global",
    x: 0,
    y: 0,
    color: { r: 9, g: 8, b: 7, a: 255 },
    tolerance: 2,
  });

  assert.deepEqual([...result], [9, 8, 7, 255, 9, 8, 7, 255, 111, 100, 100, 255]);
});

test("product connected recolor uses the FramePacker flood-fill kernel", () => {
  const pixels = Uint8ClampedArray.from([
    100, 100, 100, 255, 110, 100, 100, 255, 240, 240, 240, 255, 110, 100, 100, 255,
  ]);
  const result = applyRecolorRepair(pixels, 4, {
    mode: "recolor",
    scope: "connected",
    x: 0,
    y: 0,
    color: { r: 9, g: 8, b: 7, a: 255 },
    tolerance: 2,
  });

  assert.deepEqual([...result], [9, 8, 7, 255, 9, 8, 7, 255, 240, 240, 240, 255, 110, 100, 100, 255]);
});

test("product recolor includes alpha in the FramePacker match distance", () => {
  const pixels = Uint8ClampedArray.from([100, 100, 100, 255, 100, 100, 100, 250, 100, 100, 100, 249]);
  const result = applyRecolorRepair(pixels, 3, {
    mode: "recolor",
    scope: "global",
    x: 0,
    y: 0,
    color: { r: 9, g: 8, b: 7, a: 255 },
    tolerance: 1,
  });

  assert.deepEqual([...result], [9, 8, 7, 255, 9, 8, 7, 255, 100, 100, 100, 249]);
});

test("regular cutout preserves a sampled transparent reference alpha", () => {
  const pixels = Uint8ClampedArray.from([0, 200, 0, 0, 255, 255, 255, 255]);
  const result = applyCutout(pixels, 2, 1, {
    referenceChromaKey: true,
    connected: false,
    backgroundColors: [{ r: 0, g: 200, b: 0, a: 0 }],
    tolerance: 1,
    edgeBoost: 5,
    feather: 0,
    edgeRecoveryStrength: 0,
    despillStrength: 0,
    alphaLow: 0,
    alphaHigh: 0,
  });

  assert.deepEqual([...result.data], [0, 0, 0, 0, 255, 255, 255, 255]);
});

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

test("edge enhancement includes matching pixels outside the base tolerance", () => {
  const pixels = Uint8ClampedArray.from([100, 100, 100, 255, 120, 100, 100, 255]);
  const result = applyCutout(pixels, 2, 1, {
    referenceChromaKey: true,
    connected: false,
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
    [0, 0],
  );
});

test("edge enhancement keeps only candidates 4-connected to a base match", () => {
  const pixels = Uint8ClampedArray.from([
    100, 100, 100, 255, 110, 100, 100, 255, 240, 240, 240, 255, 240, 240, 240, 255, 240, 240, 240, 255, 110,
    100, 100, 255,
  ]);
  const result = applyCutout(pixels, 3, 2, {
    referenceChromaKey: true,
    connected: false,
    backgroundColors: [{ r: 100, g: 100, b: 100 }],
    tolerance: 0,
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
    [0, 0, 255, 255, 255, 255],
  );
});

test("edge enhancement still respects the product operation mask", () => {
  const pixels = Uint8ClampedArray.from([100, 100, 100, 255, 120, 100, 100, 255]);
  const result = applyCutout(pixels, 2, 1, {
    referenceChromaKey: true,
    connected: false,
    backgroundColors: [{ r: 100, g: 100, b: 100 }],
    tolerance: 1,
    edgeBoost: 5,
    selectionMask: Uint8Array.from([255, 0]),
    feather: 0,
    chromaFeather: 0,
    edgeRecoveryStrength: 0,
    despillStrength: 0,
    alphaLow: 0,
    alphaHigh: 0,
  });

  assert.deepEqual(
    [...result.data].filter((_value, offset) => offset % 4 === 3),
    [0, 255],
  );
});

test("edge enhancement does not invent alpha outside the replacement mask", () => {
  const pixels = Uint8ClampedArray.from([
    240, 240, 240, 255, 240, 240, 240, 255, 180, 180, 180, 255, 30, 30, 30, 255,
  ]);
  const result = applyCutout(pixels, 4, 1, {
    referenceChromaKey: true,
    connected: false,
    backgroundColors: [{ r: 240, g: 240, b: 240 }],
    tolerance: 1,
    edgeBoost: 5,
    feather: 0,
    edgeRecoveryStrength: 0,
    despillStrength: 0,
    alphaLow: 0,
    alphaHigh: 255,
  });

  assert.deepEqual([...result.data], [0, 0, 0, 0, 0, 0, 0, 0, 180, 180, 180, 255, 30, 30, 30, 255]);
});

test("zero edge enhancement leaves a background-mixed edge unchanged", () => {
  const pixels = Uint8ClampedArray.from([240, 240, 240, 255, 180, 180, 180, 255, 30, 30, 30, 255]);
  const result = applyCutout(pixels, 3, 1, {
    referenceChromaKey: true,
    connected: false,
    backgroundColors: [{ r: 240, g: 240, b: 240 }],
    tolerance: 1,
    edgeBoost: 0,
    feather: 0,
    edgeRecoveryStrength: 0,
    despillStrength: 0,
    alphaLow: 0,
    alphaHigh: 255,
  });

  assert.deepEqual(
    [...result.data].filter((_value, offset) => offset % 4 === 3),
    [0, 255, 255],
  );
  assert.equal(result.data[4], 180);
});
