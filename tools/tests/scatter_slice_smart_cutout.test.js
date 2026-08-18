"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applySmartCutout,
  createSmartCutoutOptions,
  detectBackgroundColor,
} = require("../animation_tuner/public/scatter_slice_smart_cutout");
const { resolveSmartCutoutParameters } = require("../animation_tuner/public/smart_cutout_defaults");

/**
 * Picks the workbench sliders that differ between plate and chroma smart profiles.
 * @param {object} options Cutout options.
 * @returns {object} Slider snapshot.
 */
function smartSliderSnapshot(options) {
  return {
    tolerance: options.tolerance,
    edgeBoost: options.edgeBoost,
    blendStrength: options.blendStrength,
    despillStrength: options.despillStrength,
  };
}

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

test("smart slice cutout auto-detects background and preserves the subject", () => {
  const width = 5;
  const height = 5;
  const background = [149, 215, 144, 255];
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(background, offset);
  setPixel(rgba, width, 2, 2, [210, 36, 42, 255]);

  const output = applySmartCutout(rgba, width, height);

  assert.ok(output[3] <= 16, "background matches the editor's near-transparent regular output");
  assert.equal(output[0], output[1], "global despill removes the green cast");
  assert.equal(output[1], output[2], "global despill produces a neutral residual color");
  assert.equal(output[(2 * width + 2) * 4 + 3], 255);
  assert.equal(rgba[3], 255, "source pixels remain immutable");
});

test("smart slice cutout uses the requested regular background-clear parameters", () => {
  const backgroundColor = { r: 149, g: 215, b: 144 };
  const options = createSmartCutoutOptions(backgroundColor);
  const resolved = resolveSmartCutoutParameters(backgroundColor);

  assert.deepEqual(options.backgroundColor, backgroundColor);
  assert.equal(options.referenceChromaKey, true);
  assert.deepEqual(smartSliderSnapshot(options), smartSliderSnapshot(resolved));
  assert.equal(options.blendMode, "blend");
  assert.equal(options.despillMode, "general");
  assert.equal(options.connected, false);
  assert.equal(options.feather, 0);
  assert.equal(options.edgeRecoveryStrength, 0);
  assert.equal(options.alphaThreshold, 0);
});

test("white and black plates use the plate smart profile", () => {
  for (const backgroundColor of [
    { r: 255, g: 255, b: 255 },
    { r: 128, g: 128, b: 128 },
    { r: 8, g: 7, b: 9 },
  ]) {
    assert.deepEqual(
      smartSliderSnapshot(createSmartCutoutOptions(backgroundColor)),
      smartSliderSnapshot(resolveSmartCutoutParameters(backgroundColor)),
    );
    assert.equal(createSmartCutoutOptions(backgroundColor).tolerance, 1);
    assert.equal(createSmartCutoutOptions(backgroundColor).blendStrength, 0);
    assert.equal(createSmartCutoutOptions(backgroundColor).despillStrength, 0);
  }
});

test("green and other colors use the chroma smart profile", () => {
  for (const backgroundColor of [
    { r: 0, g: 177, b: 64 },
    { r: 149, g: 215, b: 144 },
    { r: 40, g: 80, b: 200 },
  ]) {
    assert.deepEqual(
      smartSliderSnapshot(createSmartCutoutOptions(backgroundColor)),
      smartSliderSnapshot(resolveSmartCutoutParameters(backgroundColor)),
    );
    assert.equal(createSmartCutoutOptions(backgroundColor).tolerance, -1);
    assert.equal(createSmartCutoutOptions(backgroundColor).edgeBoost, 10);
    assert.equal(createSmartCutoutOptions(backgroundColor).blendStrength, 100);
    assert.equal(createSmartCutoutOptions(backgroundColor).despillStrength, 100);
  }
});

test("smart slice cutout detects one dominant source background instead of trusting one corner", () => {
  const width = 8;
  const height = 8;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([148, 214, 142, 255], offset);
  setPixel(rgba, width, 0, 0, [210, 36, 42, 255]);

  assert.deepEqual(detectBackgroundColor(rgba, width, height), { r: 148, g: 214, b: 142 });
});

test("background detection prefers the image-wide dominant color over a decorative border", () => {
  const width = 40;
  const height = 40;
  const border = [148, 214, 255, 255];
  const background = [40, 160, 140, 255];
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(border, offset);
  for (let y = 4; y < height - 4; y += 1) {
    for (let x = 4; x < width - 4; x += 1) setPixel(rgba, width, x, y, background);
  }

  assert.deepEqual(detectBackgroundColor(rgba, width, height), { r: 40, g: 160, b: 140 });
});

test("regular background clear removes enclosed background regions instead of preserving them", () => {
  const width = 7;
  const height = 7;
  const background = [149, 215, 144, 255];
  const subject = [210, 36, 42, 255];
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(background, offset);
  for (let y = 2; y <= 4; y += 1) {
    for (let x = 2; x <= 4; x += 1) {
      if (x !== 3 || y !== 3) setPixel(rgba, width, x, y, subject);
    }
  }

  const output = applySmartCutout(rgba, width, height);

  assert.ok(output[(3 * width + 3) * 4 + 3] <= 16, "enclosed background becomes near-transparent");
  assert.equal(output[(2 * width + 2) * 4 + 3], 255, "surrounding subject stays opaque");
});

test("smart slice cutout keys a black plate including enclosed black pixels", () => {
  const width = 7;
  const height = 7;
  const background = [8, 7, 9, 255];
  const subject = [236, 126, 24, 255];
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(background, offset);
  for (let y = 2; y <= 4; y += 1) {
    for (let x = 2; x <= 4; x += 1) setPixel(rgba, width, x, y, subject);
  }
  setPixel(rgba, width, 3, 3, background);

  const output = applySmartCutout(rgba, width, height);

  assert.equal(output[3], 0, "black background becomes transparent");
  assert.equal(output[(2 * width + 2) * 4 + 3], 255, "colored subject pixels stay opaque");
  assert.equal(output[(3 * width + 3) * 4 + 3], 0, "enclosed black plate pixels are keyed");
});

test("smart slice cutout validates dimensions before processing", () => {
  assert.throws(() => applySmartCutout(new Uint8ClampedArray(4), 0, 1), /正整数/);
  assert.throws(() => applySmartCutout(new Uint8ClampedArray(4), 2, 2), /长度/);
});
