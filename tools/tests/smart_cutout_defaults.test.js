"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { REGULAR_AUTO_BACKGROUND_PARAMETERS } = require("../animation_tuner/public/smart_cutout_defaults");
const cutoutCore = require("../animation_tuner/public/batch_cutout_core");

/**
 * Paints a flat background with a centered opaque subject block.
 * @param {number} size Square image edge length.
 * @param {[number,number,number]} background Background RGB.
 * @param {[number,number,number]} subject Subject RGB.
 * @returns {Uint8ClampedArray} RGBA pixels.
 */
function paintSubjectOnBackground(size, background, subject) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = x >= size / 4 && x < (size * 3) / 4 && y >= size / 4 && y < (size * 3) / 4;
      const color = inside ? subject : background;
      const offset = (y * size + x) * 4;
      rgba.set([color[0], color[1], color[2], 255], offset);
    }
  }
  return rgba;
}

/**
 * Runs the shared auto profile through the real cutout kernel.
 * @param {Uint8ClampedArray} rgba Source pixels.
 * @param {number} size Square image edge length.
 * @returns {{data:Uint8ClampedArray}} Processed pixels.
 */
function clearBackground(rgba, size) {
  const detected = cutoutCore.estimateBackgroundColor(rgba, size, size);
  const backgroundColor = { r: detected.r, g: detected.g, b: detected.b };
  return cutoutCore.applyCutout(rgba, size, size, {
    ...REGULAR_AUTO_BACKGROUND_PARAMETERS,
    backgroundColor,
    backgroundColors: [{ ...backgroundColor, a: 255 }],
    referenceChromaKey: !REGULAR_AUTO_BACKGROUND_PARAMETERS.perceptual,
    edgeRecoveryTolerance: 0,
    seedPoints: [],
    protectedColors: [],
    automaticCutout: true,
  });
}

// The tolerance slider bottoms out at -1, which is its off position: the
// reference replacement keeps pixels whose distance exceeds the tolerance, so
// -1 keeps every pixel and turns the whole profile into a no-op. Assert the
// erased result rather than the number so the profile cannot silently regress
// into a setting that reports success while leaving frames untouched.
for (const [label, background, subject] of [
  ["white", [255, 255, 255], [90, 110, 160]],
  ["green screen", [0, 177, 64], [220, 60, 60]],
  ["near black", [12, 12, 12], [220, 60, 60]],
]) {
  test(`the shared auto profile erases a flat ${label} background`, () => {
    const size = 32;
    const rgba = paintSubjectOnBackground(size, background, subject);

    const { data } = clearBackground(rgba, size);

    assert.equal(data[3], 0, "the corner background pixel becomes fully transparent");
    assert.equal(data[((size / 2) * size + size / 2) * 4 + 3], 255, "the subject stays opaque");
    let cleared = 0;
    let opaque = 0;
    for (let offset = 3; offset < data.length; offset += 4) {
      if (data[offset] === 0) cleared += 1;
      if (data[offset] === 255) opaque += 1;
    }
    assert.equal(cleared, size * size - (size / 2) * (size / 2), "every background pixel is cleared");
    assert.equal(opaque, (size / 2) * (size / 2), "every subject pixel survives");
  });
}

test("the shared auto profile keeps the workbench slider range", () => {
  assert.ok(
    REGULAR_AUTO_BACKGROUND_PARAMETERS.tolerance >= 0,
    "a negative tolerance matches no pixel and disables the profile",
  );
  assert.ok(REGULAR_AUTO_BACKGROUND_PARAMETERS.tolerance <= 100);
});
