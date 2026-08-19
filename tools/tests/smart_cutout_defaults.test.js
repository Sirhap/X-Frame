"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BLACK_PLATE_OVERRIDES,
  CHROMA_SMART_OVERRIDES,
  PLATE_SMART_OVERRIDES,
  REGULAR_AUTO_BACKGROUND_PARAMETERS,
  adjustParametersForBackgroundColor,
  classifySmartBackground,
  overlaySmartCutoutParameters,
  referenceChromaKeyFor,
  resolveSmartCutoutParameters,
} = require("../animation_tuner/public/smart_cutout_defaults");
const { createSmartCutoutOptions } = require("../animation_tuner/public/scatter_slice_smart_cutout");
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
    ...createSmartCutoutOptions(backgroundColor),
    backgroundColors: [{ ...backgroundColor, a: 255 }],
    seedPoints: [],
    protectedColors: [],
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
    const plate =
      classifySmartBackground({ r: background[0], g: background[1], b: background[2] }) === "plate";

    assert.ok(data[3] <= (plate ? 0 : 16), "the corner background pixel becomes transparent");
    assert.equal(data[((size / 2) * size + size / 2) * 4 + 3], 255, "the subject stays opaque");
    let cleared = 0;
    let opaque = 0;
    for (let offset = 3; offset < data.length; offset += 4) {
      if (data[offset] <= (plate ? 0 : 16)) cleared += 1;
      if (data[offset] === 255) opaque += 1;
    }
    assert.equal(cleared, size * size - (size / 2) * (size / 2), "every background pixel is cleared");
    assert.equal(opaque, (size / 2) * (size / 2), "every subject pixel survives");
  });
}

test("the workbench idle profile stays in the slider range", () => {
  assert.ok(REGULAR_AUTO_BACKGROUND_PARAMETERS.tolerance >= 0);
  assert.ok(REGULAR_AUTO_BACKGROUND_PARAMETERS.tolerance <= 100);
  assert.equal(REGULAR_AUTO_BACKGROUND_PARAMETERS.blendStrength, 0);
  assert.equal(REGULAR_AUTO_BACKGROUND_PARAMETERS.despillStrength, 0);
});

test("plate and chroma smart overlays stay on the exported tables", () => {
  assert.equal(classifySmartBackground({ r: 255, g: 255, b: 255 }), "plate");
  assert.equal(classifySmartBackground({ r: 8, g: 8, b: 8 }), "plate");
  assert.equal(classifySmartBackground({ r: 0, g: 177, b: 64 }), "chroma");
  assert.equal(classifySmartBackground({ r: 128, g: 128, b: 128 }), "plate");
  assert.equal(classifySmartBackground({ r: 40, g: 80, b: 200 }), "chroma");
  assert.equal(
    resolveSmartCutoutParameters({ r: 255, g: 255, b: 255 }).tolerance,
    PLATE_SMART_OVERRIDES.tolerance,
  );
  assert.equal(
    resolveSmartCutoutParameters({ r: 0, g: 177, b: 64 }).tolerance,
    CHROMA_SMART_OVERRIDES.tolerance,
  );
  assert.equal(
    resolveSmartCutoutParameters({ r: 0, g: 177, b: 64 }).blendStrength,
    CHROMA_SMART_OVERRIDES.blendStrength,
  );
});

test("workset sliders win over the detected smart overlay", () => {
  const merged = overlaySmartCutoutParameters(CHROMA_SMART_OVERRIDES, { r: 255, g: 255, b: 255 });
  assert.equal(merged.blendStrength, CHROMA_SMART_OVERRIDES.blendStrength);
  assert.equal(merged.tolerance, CHROMA_SMART_OVERRIDES.tolerance);
});

test("black plates keep reference chroma key off even when perceptual is false", () => {
  assert.equal(referenceChromaKeyFor({ r: 8, g: 7, b: 9 }, false), false);
  assert.equal(referenceChromaKeyFor({ r: 0, g: 177, b: 64 }, false), true);
  assert.equal(referenceChromaKeyFor({ r: 8, g: 7, b: 9 }, true), false);
});

test("a #000000 plate with compression noise still clears the background", () => {
  const size = 32;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = x >= size / 4 && x < (size * 3) / 4 && y >= size / 4 && y < (size * 3) / 4;
      const noise = (x + y) % 17;
      const color = inside ? [220, 60, 60] : [noise, noise, noise];
      rgba.set([color[0], color[1], color[2], 255], (y * size + x) * 4);
    }
  }
  const parameters = resolveSmartCutoutParameters("#000000");
  assert.equal(parameters.tolerance, BLACK_PLATE_OVERRIDES.tolerance);
  assert.ok(parameters.tolerance > PLATE_SMART_OVERRIDES.tolerance);
  const { data } = cutoutCore.applyCutout(rgba, size, size, {
    ...createSmartCutoutOptions({ r: 0, g: 0, b: 0 }),
    backgroundColors: [{ r: 0, g: 0, b: 0, a: 255 }],
    seedPoints: [],
    protectedColors: [],
  });
  assert.ok(data[3] === 0, "the noisy black corner becomes transparent");
  assert.equal(data[((size / 2) * size + size / 2) * 4 + 3], 255, "the subject stays opaque");
  let cleared = 0;
  let opaque = 0;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] === 0) cleared += 1;
    if (data[offset] === 255) opaque += 1;
  }
  assert.equal(cleared, size * size - (size / 2) * (size / 2));
  assert.equal(opaque, (size / 2) * (size / 2));
});

test("picking #000000 raises the idle plate tolerance without clobbering a manual crank", () => {
  const idle = adjustParametersForBackgroundColor(
    { ...REGULAR_AUTO_BACKGROUND_PARAMETERS, tolerance: PLATE_SMART_OVERRIDES.tolerance },
    "#000000",
  );
  assert.equal(idle.tolerance, BLACK_PLATE_OVERRIDES.tolerance);
  const manual = adjustParametersForBackgroundColor(
    { ...REGULAR_AUTO_BACKGROUND_PARAMETERS, tolerance: 40 },
    "#000000",
  );
  assert.equal(manual.tolerance, 40);
});
