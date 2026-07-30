"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createOutput } = require("../animation_tuner/public/batch_cutout_output_core");

test("cutout outputs retain an independent parameter snapshot for later single-frame editing", () => {
  const cutoutState = {
    processingParameters: { tolerance: -1, blendStrength: 100, despillStrength: 100 },
    backgroundSamples: [{ r: 12, g: 34, b: 56, a: 255 }],
    seedPoints: [],
  };

  const output = createOutput({
    name: "frame.png",
    data: "data:image/png;base64,frame",
    cutoutState,
  });
  cutoutState.processingParameters.tolerance = 42;
  cutoutState.backgroundSamples[0].r = 255;

  assert.equal(output.cutoutState.processingParameters.tolerance, -1);
  assert.equal(output.cutoutState.backgroundSamples[0].r, 12);
  assert.equal(Object.isFrozen(output), true);
});
