"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

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
  const backgroundEstimatorIndex = workerSource.indexOf('"batch_cutout_background_estimator.js"');
  const referenceInputIndex = workerSource.indexOf('"batch_cutout_reference_input.js"');
  const batchCoreIndex = workerSource.indexOf('"batch_cutout_core.js"');

  assert.notEqual(backgroundEstimatorIndex, -1);
  assert.notEqual(referenceInputIndex, -1);
  assert.notEqual(batchCoreIndex, -1);
  assert.ok(backgroundEstimatorIndex < referenceInputIndex);
  assert.ok(referenceInputIndex < batchCoreIndex);
});

test("cutout worker pixels-only mode omits editor-only tracking and quality analysis", async () => {
  const workerPath = path.join(__dirname, "../animation_tuner/public/batch_cutout_worker.js");
  const workerSource = fs.readFileSync(workerPath, "utf8");
  const calls = { tracking: 0, quality: 0 };
  let response = null;
  const self = {
    BatchCutoutCore: {
      applyProductCutout(source) {
        return {
          data: new Uint8ClampedArray(source),
          automaticData: new Uint8ClampedArray(source),
          removedPixels: 0,
          partialPixels: 0,
        };
      },
    },
    CutoutTrackingCore: {
      createShapeCandidates() {
        calls.tracking += 1;
        return [];
      },
      createShapeDescriptor() {
        calls.tracking += 1;
        return null;
      },
    },
    CutoutQualityCore: {
      createCutoutQualityMetrics() {
        calls.quality += 1;
        return {};
      },
    },
    postMessage(message) {
      response = message;
    },
  };
  vm.runInNewContext(workerSource, {
    self,
    importScripts() {},
    Uint8Array,
    Uint8ClampedArray,
  });
  const source = Uint8ClampedArray.from([255, 255, 255, 255]);

  await self.onmessage({
    data: {
      id: 1,
      operation: "product-cutout",
      sourceBuffer: source.buffer,
      width: 1,
      height: 1,
      options: {},
      repairs: [],
      protocolVersion: 1,
      analysisMode: "pixels-only",
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.shapeCandidates, null);
  assert.equal(response.qualityMetrics, null);
  assert.deepEqual(calls, { tracking: 0, quality: 0 });
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
