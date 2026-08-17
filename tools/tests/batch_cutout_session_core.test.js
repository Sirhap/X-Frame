"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sessionCore = require("../animation_tuner/public/batch_cutout_session_core.js");
const { applyProductCutout } = require("../animation_tuner/public/batch_cutout_core.js");

test("batch cutout runtime only calls exported session core methods", () => {
  const runtimeSource = fs.readFileSync(
    path.join(__dirname, "../animation_tuner/public/batch_cutout.js"),
    "utf8",
  );
  const invokedMethods = new Set(
    Array.from(runtimeSource.matchAll(/sessionCore\.(\w+)\s*\(/g), (match) => match[1]),
  );

  for (const methodName of invokedMethods) {
    assert.equal(
      typeof sessionCore[methodName],
      "function",
      `BatchCutoutSessionCore.${methodName} must be exported`,
    );
  }
});

/**
 * Creates the minimum DOM adapter required by the session Module.
 * @returns {object} Fake processing controls.
 */
function createControls() {
  const controls = {
    cutoutColor: { value: "#123456", disabled: false },
    cutoutConnected: { checked: false },
    cutoutPerceptual: { checked: true },
    cutoutBlendMode: { value: "blend" },
    cutoutDespillMode: { value: "general" },
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
  targetControls.cutoutTolerance.value = "1";
  let synchronized = 0;

  sessionCore.applyProcessingParameters(targetControls, parameters, {
    syncNumericRange(input, output) {
      output.textContent = input.value;
      synchronized += 1;
    },
  });

  assert.deepEqual(sessionCore.captureProcessingParameters(targetControls), parameters);
  assert.equal(targetControls.cutoutColor.disabled, false);
  const numericParameterCount = Object.values(parameters).filter(Number.isFinite).length;
  assert.equal(synchronized, numericParameterCount);
});

test("negative-one tolerance survives capture, restore, and worker option creation", () => {
  const sourceControls = createControls();
  sourceControls.cutoutTolerance.value = "-1";
  const parameters = sessionCore.captureProcessingParameters(sourceControls);
  const targetControls = createControls();

  sessionCore.applyProcessingParameters(targetControls, parameters);
  const processingOptions = sessionCore.createProcessingOptions(
    {
      automaticCutoutActivated: true,
      processingParameters: sessionCore.captureProcessingParameters(targetControls),
      seedPoints: [],
    },
    {
      backgroundColor: { r: 0, g: 255, b: 0, a: 255 },
      backgroundColors: [{ r: 0, g: 255, b: 0, a: 255 }],
      protectedColors: [],
    },
  );

  assert.equal(parameters.tolerance, -1);
  assert.equal(targetControls.cutoutTolerance.value, "-1");
  assert.equal(processingOptions.tolerance, -1);
});

test("processing parameter normalization clamps persisted and candidate values", () => {
  const fallback = sessionCore.captureProcessingParameters(createControls());
  const parameters = sessionCore.normalizeProcessingParameters(
    {
      backgroundColor: "INVALID",
      tolerance: 900,
      feather: -4,
      alphaLow: 240,
      alphaHigh: 30,
      connected: 1,
      blendMode: "unknown",
    },
    fallback,
  );

  assert.equal(parameters.backgroundColor, fallback.backgroundColor);
  assert.equal(parameters.tolerance, 100);
  assert.equal(parameters.feather, 0);
  assert.equal(parameters.alphaLow, 30);
  assert.equal(parameters.alphaHigh, 240);

  const lowOnly = sessionCore.normalizeProcessingParameters({ alphaLow: 40, alphaHigh: 0 }, fallback);
  assert.equal(lowOnly.alphaLow, 40);
  assert.equal(lowOnly.alphaHigh, 0);
  assert.equal(parameters.connected, true);
  assert.equal(parameters.blendMode, fallback.blendMode);
});

test("createProcessingOptions keeps a disabled alphaHigh instead of swapping the window", () => {
  const fallback = sessionCore.captureProcessingParameters(createControls());
  const parameters = sessionCore.normalizeProcessingParameters({ alphaLow: 40, alphaHigh: 0 }, fallback);
  const options = sessionCore.createProcessingOptions(
    { processingParameters: parameters, seedPoints: [] },
    { backgroundColor: {}, backgroundColors: [], protectedColors: [] },
  );
  assert.equal(options.alphaLow, 40);
  assert.equal(options.alphaHigh, 0);
});

test("blend recovery and edge restoration modes remain independent", () => {
  const controls = createControls();
  controls.cutoutBlendMode.value = "chroma";
  controls.cutoutDespillMode.value = "blend";
  const parameters = sessionCore.captureProcessingParameters(controls);
  const options = sessionCore.createProcessingOptions(
    { processingParameters: parameters, seedPoints: [] },
    { backgroundColor: {}, backgroundColors: [], protectedColors: [] },
  );

  assert.equal(parameters.blendMode, "chroma");
  assert.equal(parameters.despillMode, "blend");
  assert.equal(options.blendMode, "chroma");
  assert.equal(options.despillMode, "blend");
});

test("legacy processing snapshots default only the missing blend mode", () => {
  const controls = createControls();
  sessionCore.applyProcessingParameters(controls, { despillMode: "chroma" });

  assert.equal(controls.cutoutBlendMode.value, "blend");
  assert.equal(controls.cutoutDespillMode.value, "chroma");
});

test("batch recolor preview derives target repairs without committing them", () => {
  const sourceItem = {
    id: "frame-1",
    sourceImageData: { width: 100, height: 50 },
    repairs: [
      {
        id: "recolor-1",
        mode: "recolor",
        scope: "connected",
        x: 25,
        y: 10,
        sourceColor: { r: 40, g: 50, b: 60, a: 255 },
        color: { r: 200, g: 100, b: 50, a: 255 },
        tolerance: 18,
      },
    ],
  };
  const targetItem = {
    id: "frame-2",
    sourceImageData: { width: 200, height: 100 },
    repairs: [{ id: "target-local", mode: "brush" }],
  };
  const state = { items: [sourceItem, targetItem], batchPreviewRepair: null };

  assert.equal(sessionCore.stageBatchRepairPreview(state, sourceItem), true);
  const previewRepairs = sessionCore.previewRepairsForItem(state, targetItem);

  assert.deepEqual(targetItem.repairs, [{ id: "target-local", mode: "brush" }]);
  assert.equal(previewRepairs.length, 2);
  assert.equal(previewRepairs[1].previewOnly, true);
  assert.equal(previewRepairs[1].x, 50);
  assert.equal(previewRepairs[1].y, 20);
  assert.deepEqual(previewRepairs[1].color, { r: 200, g: 100, b: 50, a: 255 });
  assert.equal(sessionCore.clearBatchRepairPreview(state), true);
  assert.deepEqual(sessionCore.previewRepairsForItem(state, targetItem), targetItem.repairs);
});

test("automatic propagation copies manual settings and invalidates every result", () => {
  const parameters = sessionCore.captureProcessingParameters(createControls());
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

test("file-batch synchronization reacquires each frame background color at the mapped seed", () => {
  const sourceItem = {
    sourceImageData: {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 198, 2, 255, 255, 0, 0, 255]),
    },
    processingParameters: { tolerance: 1 },
    backgroundSamples: [{ r: 0, g: 198, b: 2, a: 255 }],
    seedPoints: [{ x: 0, y: 0 }],
    automaticCutoutActivated: true,
    processingActivated: true,
    pendingAutomaticPropagation: true,
    processingRevision: 0,
  };
  const targetItem = {
    sourceImageData: {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([22, 135, 31, 255, 255, 0, 0, 255]),
    },
    backgroundSamples: [],
    seedPoints: [],
    pendingAutomaticPropagation: true,
    processingRevision: 3,
  };

  const result = sessionCore.synchronizeBatchAutomaticProcessing(
    [sourceItem, targetItem],
    sourceItem,
    { tolerance: 5, edgeBoost: 18 },
    { mapSeedPoints: true },
  );

  assert.deepEqual(result, { updated: 2, mappedBackgroundSamples: true });
  assert.deepEqual(targetItem.backgroundSamples, [{ r: 22, g: 135, b: 31, a: 255 }]);
  assert.deepEqual(targetItem.seedPoints, [{ x: 0, y: 0 }]);
  assert.deepEqual(targetItem.processingParameters, { tolerance: 5, edgeBoost: 18 });
  assert.equal(targetItem.automaticCutoutActivated, true);
  assert.equal(targetItem.processingActivated, true);
  assert.equal(targetItem.pendingAutomaticPropagation, false);
  assert.equal(targetItem.processingRevision, 4);
});

test("file-batch synchronization shares parameters without activating an unsampled background", () => {
  const sourceItem = {
    backgroundSamples: [],
    automaticCutoutActivated: false,
    processingRevision: 0,
  };
  const targetItem = { processingRevision: 2, processingActivated: false };

  const result = sessionCore.synchronizeBatchAutomaticProcessing([sourceItem, targetItem], sourceItem, {
    tolerance: 7,
  });

  assert.deepEqual(result, { updated: 2, mappedBackgroundSamples: false });
  assert.deepEqual(targetItem.processingParameters, { tolerance: 7 });
  assert.equal(targetItem.processingActivated, false);
  assert.equal(targetItem.processingRevision, 3);
});

test("single-image automatic propagation maps connected background seeds to every target canvas", () => {
  const sourceItem = {
    sourceImageData: { width: 100, height: 50 },
    processingParameters: { connected: true },
    backgroundSamples: [{ r: 0, g: 255, b: 0, a: 255 }],
    seedPoints: [
      { x: 25, y: 10 },
      { x: 99, y: 49 },
    ],
  };
  const targetItem = {
    sourceImageData: { width: 200, height: 100 },
    processingRevision: 0,
  };

  sessionCore.copyAutomaticProcessingState(targetItem, sourceItem, { mapSeedPoints: true });

  assert.deepEqual(targetItem.seedPoints, [
    { x: 50, y: 20 },
    { x: 198, y: 98 },
  ]);
  assert.notEqual(targetItem.seedPoints[0], sourceItem.seedPoints[0]);
});

test("mapped background seeds clear an enclosed target region that boundary discovery cannot reach", () => {
  const width = 5;
  const height = 5;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const enclosedBackground = x > 0 && x < width - 1 && y > 0 && y < height - 1;
      pixels[offset] = enclosedBackground ? 0 : 255;
      pixels[offset + 1] = enclosedBackground ? 255 : 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 255;
    }
  }
  const options = {
    automaticCutout: true,
    backgroundColor: { r: 0, g: 255, b: 0 },
    backgroundColors: [{ r: 0, g: 255, b: 0 }],
    connected: true,
    referenceChromaKey: true,
    tolerance: 5,
    feather: 0,
    alphaThreshold: 2,
    alphaLow: 0,
    alphaHigh: 255,
    edgeBoost: 0,
    blendStrength: 0,
    despillStrength: 0,
    edgeDespillRadius: 0,
    edgeRecoveryStrength: 0,
    backgroundRadius: 8,
    blurRadius: 0,
    protectedColors: [],
  };

  const withoutSeed = applyProductCutout(pixels, width, height, { ...options, seedPoints: [] }, []);
  const withSeed = applyProductCutout(
    pixels,
    width,
    height,
    { ...options, seedPoints: [{ x: 2, y: 2 }] },
    [],
  );

  assert.equal(withoutSeed.removedPixels, 0);
  assert.equal(withSeed.removedPixels, 9);
});

test("automatic propagation reacquires a moved background region instead of seeding foreground", () => {
  const width = 7;
  const height = 5;
  const foreground = { r: 180, g: 120, b: 40, a: 255 };
  const background = { r: 255, g: 0, b: 255, a: 255 };
  const createPixels = (backgroundX) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      const x = index % width;
      const y = Math.floor(index / width);
      const color = x === backgroundX && y >= 1 && y <= 3 ? background : foreground;
      data.set([color.r, color.g, color.b, color.a], index * 4);
    }
    return data;
  };
  const processingParameters = {
    connected: true,
    perceptual: false,
    tolerance: 5,
    feather: 0,
    alphaThreshold: 2,
    alphaLow: 0,
    alphaHigh: 255,
    edgeBoost: 0,
    blendStrength: 0,
    despillStrength: 0,
    despillMode: "general",
    edgeDespillRadius: 0,
    edgeRecoveryStrength: 0,
    backgroundRadius: 8,
    blurRadius: 0,
    protectionTolerance: 8,
  };
  const sourceItem = {
    sourceImageData: { width, height, data: createPixels(3) },
    processingParameters,
    backgroundSamples: [background],
    seedPoints: [{ x: 3, y: 2 }],
  };
  const targetItem = {
    sourceImageData: { width, height, data: createPixels(5) },
    processingRevision: 0,
  };

  sessionCore.copyAutomaticProcessingState(targetItem, sourceItem, { mapSeedPoints: true });
  const result = applyProductCutout(
    targetItem.sourceImageData.data,
    width,
    height,
    sessionCore.createProcessingOptions(targetItem, {
      backgroundColor: background,
      backgroundColors: [background],
      protectedColors: [],
    }),
    [],
  );

  assert.deepEqual(targetItem.seedPoints, [{ x: 5, y: 2 }]);
  assert.equal(result.removedPixels, 3);
});

test("automatic propagation samples each target frame background color", () => {
  const sourceBackground = { r: 214, g: 43, b: 207, a: 255 };
  const targetBackground = { r: 220, g: 48, b: 211, a: 255 };
  const sourceItem = {
    sourceImageData: {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([
        sourceBackground.r,
        sourceBackground.g,
        sourceBackground.b,
        sourceBackground.a,
        80,
        60,
        40,
        255,
      ]),
    },
    processingParameters: { tolerance: 1, edgeBoost: 0 },
    backgroundSamples: [sourceBackground],
    seedPoints: [{ x: 0, y: 0 }],
  };
  const targetItem = {
    sourceImageData: {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([
        targetBackground.r,
        targetBackground.g,
        targetBackground.b,
        targetBackground.a,
        80,
        60,
        40,
        255,
      ]),
    },
    processingRevision: 0,
  };

  sessionCore.copyAutomaticProcessingState(targetItem, sourceItem, { mapSeedPoints: true });

  assert.deepEqual(targetItem.seedPoints, [{ x: 0, y: 0 }]);
  assert.deepEqual(targetItem.backgroundSamples, [targetBackground]);
  assert.notEqual(targetItem.backgroundSamples[0], targetBackground);
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

test("apply-to-all remains newer than parameter edits recorded before the transaction", () => {
  const sourceItem = {
    repairs: [],
    undoneRepairs: [],
    editUndo: [{ processingParameters: { tolerance: 1 } }],
    editRedo: [],
    processingParameters: { tolerance: 37 },
    processingRevision: 0,
    publishedCanvas: "published-after-source",
  };
  const targetItem = {
    repairs: [],
    undoneRepairs: [],
    processingParameters: { tolerance: 1 },
    processingRevision: 0,
    publishedCanvas: "published-after-target",
  };
  const items = [sourceItem, targetItem];
  sessionCore.beginPropagation(items, sourceItem, {
    publishedCanvases: ["published-before-source", "published-before-target"],
  });
  targetItem.processingParameters = { tolerance: 37 };

  assert.deepEqual(sessionCore.undoEdit(items, sourceItem), {
    changed: true,
    live: true,
    publishedCanvases: ["published-before-source", "published-before-target"],
  });
  assert.deepEqual(sourceItem.processingParameters, { tolerance: 37 });
  assert.deepEqual(targetItem.processingParameters, { tolerance: 1 });
  assert.equal(sourceItem.editUndo.length, 1);

  sourceItem.publishedCanvas = "published-before-source";
  targetItem.publishedCanvas = "published-before-target";
  assert.deepEqual(sessionCore.redoEdit(items, sourceItem), {
    changed: true,
    live: true,
    publishedCanvases: ["published-after-source", "published-after-target"],
  });
  assert.deepEqual(targetItem.processingParameters, { tolerance: 37 });
});

test("parameter edits recorded after apply-to-all undo before the batch transaction", () => {
  const sourceItem = {
    repairs: [],
    undoneRepairs: [],
    editUndo: [],
    editRedo: [],
    processingParameters: { tolerance: 18 },
    processingRevision: 0,
  };
  const targetItem = {
    repairs: [],
    undoneRepairs: [],
    processingParameters: { tolerance: 1 },
    processingRevision: 0,
  };
  const items = [sourceItem, targetItem];
  sessionCore.beginPropagation(items, sourceItem);
  targetItem.processingParameters = { tolerance: 18 };
  sessionCore.recordItemEdit(sourceItem);
  sourceItem.processingParameters = { tolerance: 24 };

  assert.deepEqual(sessionCore.undoEdit(items, sourceItem), { changed: true, live: false });
  assert.deepEqual(sourceItem.processingParameters, { tolerance: 18 });
  assert.deepEqual(targetItem.processingParameters, { tolerance: 18 });
  assert.deepEqual(sessionCore.undoEdit(items, sourceItem), { changed: true, live: true });
  assert.deepEqual(targetItem.processingParameters, { tolerance: 1 });
});

test("item edit history restores parameters, samples, flags, and repairs together", () => {
  const item = {
    repairs: [],
    undoneRepairs: [],
    protectedColors: [],
    backgroundSamples: [{ r: 255, g: 0, b: 255, a: 255 }],
    seedPoints: [{ x: 2, y: 3 }],
    processingParameters: { tolerance: 1, edgeBoost: 5 },
    processingActivated: true,
    automaticCutoutActivated: true,
    pendingAutomaticPropagation: false,
    processingRevision: 0,
  };

  sessionCore.recordItemEdit(item);
  item.processingParameters = { tolerance: 12, edgeBoost: 20 };
  item.backgroundSamples = [{ r: 0, g: 255, b: 0, a: 255 }];
  item.repairs.push({ id: "clear-1", mode: "clear" });

  assert.equal(sessionCore.undoEdit([item], item).changed, true);
  assert.deepEqual(item.processingParameters, { tolerance: 1, edgeBoost: 5 });
  assert.deepEqual(item.backgroundSamples, [{ r: 255, g: 0, b: 255, a: 255 }]);
  assert.deepEqual(item.repairs, []);

  assert.equal(sessionCore.redoEdit([item], item).changed, true);
  assert.deepEqual(item.processingParameters, { tolerance: 12, edgeBoost: 20 });
  assert.deepEqual(item.backgroundSamples, [{ r: 0, g: 255, b: 0, a: 255 }]);
  assert.deepEqual(item.repairs, [{ id: "clear-1", mode: "clear" }]);
});
