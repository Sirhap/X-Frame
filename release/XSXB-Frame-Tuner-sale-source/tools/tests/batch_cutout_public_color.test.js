"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const publicColor = require("../animation_tuner/public/batch_cutout_public_color");
const sensitiveColor = require("../animation_tuner/public/batch_cutout_color_core");

test("public UI color helpers preserve the established display contract", () => {
  const colors = [
    { r: 0, g: 0, b: 0 },
    { r: 12, g: 128, b: 255 },
    { r: 255, g: 255, b: 255 },
  ];

  for (const color of colors) {
    assert.equal(publicColor.rgbToHex(color), sensitiveColor.rgbToHex(color));
    assert.deepEqual(publicColor.hexToRgb(publicColor.rgbToHex(color)), color);
    assert.equal(
      publicColor.colorDistance(47, 83, 191, color),
      sensitiveColor.colorDistance(47, 83, 191, color),
    );
  }
  assert.deepEqual(publicColor.hexToRgb("invalid"), { r: 255, g: 255, b: 255 });
});
