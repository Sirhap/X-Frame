"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { estimateBackgroundColor } = require("../animation_tuner/public/batch_cutout_background_estimator");

/**
 * Writes one RGBA pixel into a flat image buffer.
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

test("/tools/cutout auto-background keys chroma behind 4px white chrome", () => {
  const width = 64;
  const height = 64;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([255, 255, 255, 255], offset);
  for (let y = 4; y < height - 4; y += 1) {
    for (let x = 4; x < width - 4; x += 1) setPixel(rgba, width, x, y, [0, 177, 64, 255]);
  }
  const detected = estimateBackgroundColor(rgba, width, height);
  assert.equal(detected.r, 0);
  assert.equal(detected.g, 177);
  assert.equal(detected.b, 64);
  assert.equal(detected.hex, "#00b140");
  assert.notEqual(detected.hex, "#ffffff", "white chrome around a green screen must not be the key color");
});

test("/tools/cutout auto-background keys white under a large subject", () => {
  const width = 64;
  const height = 64;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([255, 255, 255, 255], offset);
  for (let y = 8; y < height - 8; y += 1) {
    for (let x = 8; x < width - 8; x += 1) setPixel(rgba, width, x, y, [210, 36, 42, 255]);
  }
  const detected = estimateBackgroundColor(rgba, width, height);
  assert.equal(detected.r, 255);
  assert.equal(detected.g, 255);
  assert.equal(detected.b, 255);
  assert.equal(detected.hex, "#ffffff");
});

test("/tools/cutout auto-background keys the white plate not the red body on a leftover studio plate", () => {
  const width = 256;
  const height = 256;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        setPixel(rgba, width, x, y, [0, 0, 0, 0]);
      } else if (x <= 2 || y <= 2 || x >= width - 3 || y >= height - 3) {
        setPixel(rgba, width, x, y, [255, 255, 255, 255]);
      } else {
        setPixel(rgba, width, x, y, [210, 36, 42, 255]);
      }
    }
  }
  const detected = estimateBackgroundColor(rgba, width, height);
  assert.notEqual(detected.hex, "#d2242a", "thick perimeter must not key the red body");
  assert.ok(
    detected.r > 200 && detected.g > 200 && detected.b > 200,
    `leftover studio plate must key white/near-white, got ${detected.hex}`,
  );
});
