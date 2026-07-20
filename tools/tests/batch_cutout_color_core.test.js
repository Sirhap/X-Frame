"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const colorCore = require("../animation_tuner/public/batch_cutout_color_core.js");
const batchCore = require("../animation_tuner/public/batch_cutout_core.js");

test("batch cutout core keeps the public color helper identities after extraction", () => {
  for (const name of [
    "colorDistance",
    "hexToRgb",
    "perceptualColorDistance",
    "rgbToHex",
    "rgbToOklab",
    "rgbToYcbcr",
  ]) {
    assert.strictEqual(batchCore[name], colorCore[name]);
  }
});

test("batch color helpers retain deterministic conversion results", () => {
  assert.equal(colorCore.rgbToHex({ r: 12, g: 128, b: 255 }), "#0c80ff");
  assert.deepEqual(colorCore.hexToRgb("#0c80ff"), { r: 12, g: 128, b: 255 });
  assert.equal(colorCore.colorDistance(12, 128, 255, { r: 12, g: 128, b: 255 }), 0);
});
