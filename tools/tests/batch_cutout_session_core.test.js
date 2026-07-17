"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const sessionCore = require("../animation_tuner/public/batch_cutout_session_core.js");

/**
 * Creates the minimum DOM adapter required by the session Module.
 * @returns {object} Fake processing controls.
 */
function createControls() {
  const controls = {
    cutoutAutoColor: { checked: true },
    cutoutColor: { value: "#123456", disabled: true },
    cutoutConnected: { checked: false },
    cutoutPerceptual: { checked: true },
    cutoutDespillMode: { value: "blend" },
  };
  const numericValues = {
    Tolerance: 15,
    Feather: 6,
    AlphaThreshold: 2,
    ChromaFeather: 30,
    EdgeBoost: 25,
    BlendStrength: 0,
    AlphaLow: 8,
    AlphaHigh: 240,
    DespillStrength: 70,
    EdgeDespillRadius: 2,
    EdgeRecoveryStrength: 60,
    BackgroundRadius: 30,
    BlurRadius: 1,
    ProtectionTolerance: 18,
  };
  for (const [name, value] of Object.entries(numericValues)) {
    controls[`cutout${name}`] = { value: String(value) };
    controls[`cutout${name === "AlphaThreshold" ? "Alpha" : name}Value`] = { textContent: "" };
  }
  return controls;
}

test("session parameters round-trip through the DOM adapter", () => {
  const sourceControls = createControls();
  const parameters = sessionCore.captureProcessingParameters(sourceControls);
  const targetControls = createControls();
  targetControls.cutoutAutoColor.checked = false;
  targetControls.cutoutTolerance.value = "1";
  let synchronized = 0;

  sessionCore.applyProcessingParameters(targetControls, parameters, {
    syncNumericRange(input, output) {
      output.textContent = input.value;
      synchronized += 1;
    },
  });

  assert.deepEqual(sessionCore.captureProcessingParameters(targetControls), parameters);
  assert.equal(targetControls.cutoutColor.disabled, true);
  const numericParameterCount = Object.values(parameters).filter(Number.isFinite).length;
  assert.equal(synchronized, numericParameterCount);
});

test("automatic propagation copies manual settings and invalidates every result", () => {
  const parameters = sessionCore.captureProcessingParameters(createControls());
  parameters.autoColor = false;
  const sourceItem = {
    processingParameters: parameters,
    backgroundSamples: [{ r: 12, g: 34, b: 56 }],
    seedPoints: [{ x: 1, y: 1 }],
    pendingAutomaticPropagation: true,
    processingRevision: 2,
    resultCanvas: {},
  };
  const targetItem = {
    processingParameters: { tolerance: 1 },
    backgroundSamples: [],
    seedPoints: [{ x: 9, y: 9 }],
    pendingAutomaticPropagation: false,
    processingRevision: 4,
    resultCanvas: {},
  };

  assert.equal(sessionCore.propagateAutomaticProcessing([sourceItem, targetItem], sourceItem), 2);
  assert.deepEqual(targetItem.processingParameters, parameters);
  assert.notEqual(targetItem.processingParameters, parameters);
  assert.deepEqual(targetItem.backgroundSamples, sourceItem.backgroundSamples);
  assert.notEqual(targetItem.backgroundSamples[0], sourceItem.backgroundSamples[0]);
  assert.deepEqual(targetItem.seedPoints, []);
  assert.equal(targetItem.processingActivated, true);
  assert.equal(targetItem.automaticCutoutActivated, true);
  assert.equal(targetItem.pendingAutomaticPropagation, false);
  assert.equal(targetItem.processingRevision, 5);
  assert.equal(targetItem.resultCanvas, null);
});

test("processing options normalize alpha bounds from the item snapshot", () => {
  const parameters = sessionCore.captureProcessingParameters(createControls());
  parameters.alphaLow = 230;
  parameters.alphaHigh = 10;
  const options = sessionCore.createProcessingOptions(
    {
      processingParameters: parameters,
      automaticCutoutActivated: true,
      seedPoints: [{ x: 2, y: 3 }],
    },
    {
      backgroundColor: { r: 1, g: 2, b: 3 },
      backgroundColors: [{ r: 1, g: 2, b: 3 }],
      protectedColors: [{ r: 4, g: 5, b: 6 }],
    },
  );

  assert.equal(options.alphaLow, 10);
  assert.equal(options.alphaHigh, 230);
  assert.equal(options.automaticCutout, true);
  assert.equal(options.referenceChromaKey, false);
  assert.equal(options.blendStrength, 0);
  assert.deepEqual(options.seedPoints, [{ x: 2, y: 3 }]);
});

test("regular cutout selects the FramePacker-compatible replacement path", () => {
  const parameters = sessionCore.captureProcessingParameters(createControls());
  parameters.perceptual = false;
  parameters.blendStrength = 10;
  const options = sessionCore.createProcessingOptions(
    { processingParameters: parameters },
    { backgroundColor: {}, backgroundColors: [], protectedColors: [] },
  );

  assert.equal(options.referenceChromaKey, true);
  assert.equal(options.perceptual, false);
  assert.equal(options.blendStrength, 10);
});

test("apply-to-all transactions undo and redo every target while preserving source edits", () => {
  const sourceItem = {
    repairs: [{ id: "source-repair", mode: "fill" }],
    undoneRepairs: [],
    processingParameters: { tolerance: 18 },
    processingRevision: 0,
  };
  const targetItem = {
    repairs: [],
    undoneRepairs: [],
    processingParameters: { tolerance: 18 },
    processingRevision: 0,
  };
  const items = [sourceItem, targetItem];
  sessionCore.beginPropagation(items, sourceItem);
  targetItem.repairs.push({ id: "propagated", propagatedFrom: "source-repair" });

  assert.equal(sessionCore.undoPropagation(items, sourceItem), true);
  assert.deepEqual(sourceItem.repairs, [{ id: "source-repair", mode: "fill" }]);
  assert.deepEqual(targetItem.repairs, []);
  assert.equal(sessionCore.redoPropagation(items, sourceItem), true);
  assert.deepEqual(targetItem.repairs, [{ id: "propagated", propagatedFrom: "source-repair" }]);
});
