"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createAnimationReplacementPayload,
  createArchiveEntries,
  createOutput,
} = require("../animation_tuner/public/batch_cutout_output_core");

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

test("live organizer outputs retain a canvas without forcing PNG encoding", () => {
  const canvas = { width: 32, height: 32 };
  const output = createOutput({ name: "frame.png", canvas });

  assert.equal(output.canvas, canvas);
  assert.equal(output.data, "");
  assert.throws(() => createArchiveEntries([output], "{}"), /PNG data URL/);
  assert.throws(
    () => createAnimationReplacementPayload("project", [{ path: "frame.png" }], [output]),
    /PNG data URL/,
  );
});
