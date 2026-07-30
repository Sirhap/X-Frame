"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const batchCore = require("../animation_tuner/public/batch_cutout_core.js");
const referenceInput = require("../animation_tuner/public/batch_cutout_reference_input.js");

test("batch cutout core keeps reference input helper identities after extraction", () => {
  for (const name of [
    "applyReferenceChromaKey",
    "applyReferenceChromaKeyClean",
    "applyReferenceDespillPixel",
    "estimateBackgroundColor",
  ]) {
    assert.strictEqual(batchCore[name], referenceInput[name]);
  }
});

test("cutout worker loads reference input before the dependent batch core", () => {
  const workerPath = path.join(__dirname, "../animation_tuner/public/batch_cutout_worker.js");
  const workerSource = fs.readFileSync(workerPath, "utf8");
  const referenceInputIndex = workerSource.indexOf('"batch_cutout_reference_input.js"');
  const batchCoreIndex = workerSource.indexOf('"batch_cutout_core.js"');

  assert.notEqual(referenceInputIndex, -1);
  assert.notEqual(batchCoreIndex, -1);
  assert.ok(referenceInputIndex < batchCoreIndex);
});

test("reference input helpers preserve chroma-key and background estimation behavior", () => {
  const source = new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const output = referenceInput.applyReferenceChromaKey(source, 2, 2, {
    backgroundColor: { r: 0, g: 255, b: 0 },
    cleanup: 40,
    feather: 0,
  });
  assert.equal(output[3], 0);
  assert.equal(output[7], 255);
  assert.deepEqual(referenceInput.estimateBackgroundColor(source, 2, 2), {
    r: 0,
    g: 255,
    b: 0,
    hex: "#00ff00",
    sampleCount: 2,
  });
});
