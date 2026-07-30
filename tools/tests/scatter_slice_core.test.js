"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  detectScatterSlices,
  normalizeOptions,
  removeColorKey,
  samplePixelHex,
} = require("../animation_tuner/public/scatter_slice_core");

/**
 * Builds a flat RGBA test image.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @param {[number,number,number,number]} color Initial RGBA color.
 * @returns {Uint8ClampedArray} Pixel buffer.
 */
function createImage(width, height, color) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(color, offset);
  return rgba;
}

/**
 * Writes one RGBA pixel into a test image.
 * @param {Uint8ClampedArray} rgba Pixel buffer.
 * @param {number} width Image width.
 * @param {number} x Horizontal coordinate.
 * @param {number} y Vertical coordinate.
 * @param {[number,number,number,number]} color RGBA color.
 * @returns {void}
 */
function setPixel(rgba, width, x, y, color) {
  rgba.set(color, (y * width + x) * 4);
}

test("scatter detector finds and sorts disconnected color-key regions", () => {
  const rgba = createImage(8, 6, [152, 215, 155, 255]);
  for (const [x, y] of [
    [5, 1],
    [6, 1],
    [5, 2],
    [1, 4],
    [2, 4],
  ]) {
    setPixel(rgba, 8, x, y, [20, 30, 40, 255]);
  }

  const result = detectScatterSlices(rgba, 8, 6, {
    colorKey: "#98d79b",
    minPixels: 2,
    threshold: 8,
  });

  assert.equal(result.mode, "colorkey");
  assert.equal(result.foregroundPixels, 5);
  assert.deepEqual(result.boxes, [
    { x: 1, y: 4, w: 2, h: 1, pixels: 2 },
    { x: 5, y: 1, w: 2, h: 2, pixels: 3 },
  ]);
});

test("automatic detection uses alpha and filters small noise", () => {
  const rgba = createImage(5, 5, [0, 0, 0, 0]);
  setPixel(rgba, 5, 1, 1, [255, 255, 255, 255]);
  setPixel(rgba, 5, 1, 2, [255, 255, 255, 255]);
  setPixel(rgba, 5, 4, 4, [255, 255, 255, 255]);

  const result = detectScatterSlices(rgba, 5, 5, { minPixels: 2 });

  assert.equal(result.mode, "alpha");
  assert.deepEqual(result.boxes, [{ x: 1, y: 1, w: 1, h: 2, pixels: 2 }]);
});

test("color sampling clamps coordinates and transparency removal keeps source immutable", () => {
  const rgba = createImage(2, 1, [152, 215, 155, 255]);
  setPixel(rgba, 2, 1, 0, [250, 80, 40, 255]);

  assert.equal(samplePixelHex(rgba, 2, 1, 99, -4), "#fa5028");
  const output = removeColorKey(rgba, "#98d79b", 4);
  assert.equal(output[3], 0);
  assert.equal(output[7], 255);
  assert.equal(rgba[3], 255);
});

test("detector validates dimensions and normalizes untrusted options", () => {
  assert.throws(() => detectScatterSlices(new Uint8ClampedArray(3), 1, 1), /RGBA/);
  assert.deepEqual(normalizeOptions({ mode: "unknown", minPixels: Number.NaN }), {
    mode: "auto",
    colorKey: "#ffffff",
    threshold: 24,
    mergeGap: 0,
    minPixels: 4,
    minSide: 1,
    sortOrder: "row-major",
  });
});
