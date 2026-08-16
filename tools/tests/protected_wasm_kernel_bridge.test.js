"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const batchCore = require("../animation_tuner/public/batch_cutout_core");
const trackingCore = require("../animation_tuner/public/cutout_tracking_core");
const { createBridge } = require("../animation_tuner/public/protected_wasm_kernel_bridge");

const wasmPath = path.resolve(
  __dirname,
  "../../crates/protected_algorithm_core/target/wasm32-unknown-unknown/release/protected_algorithm_core.wasm",
);

/**
 * Creates an initialized bridge using the locally compiled protected artifact.
 * @returns {Promise<object>} Initialized bridge.
 */
async function createInitializedBridge() {
  const bridge = createBridge();
  const bytes = await fs.promises.readFile(wasmPath);
  await bridge.initialize({
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  return bridge;
}

test("WASM bridge preserves global reference replacement bytes", async () => {
  const bridge = await createInitializedBridge();
  const source = Uint8ClampedArray.from([0, 240, 0, 255, 8, 225, 8, 230, 35, 190, 30, 180, 220, 40, 30, 255]);
  const seed = { x: 0, y: 0 };
  const replacement = { r: 0, g: 0, b: 0, a: 0 };
  const options = {
    referenceColor: { r: 0, g: 240, b: 0, a: 255 },
    edgeEnhance: 20,
    blendStrength: 30,
    despillMode: 1,
    despillStrength: 20,
    alphaThresholdHigh: 245,
    alphaThresholdLow: 8,
    protectColors: [{ r: 220, g: 40, b: 30 }],
  };
  const expected = batchCore.applyReferenceColorReplace(source, 2, 2, seed, replacement, 18, options);
  const actual = bridge.applyReferenceColorReplace(source, 2, 2, seed, replacement, 18, options);
  assert.deepEqual([...actual], [...expected]);
});

test("production product entry routes automatic reference cutout through WASM", async () => {
  const bridge = await createInitializedBridge();
  let protectedCalls = 0;
  const batchCorePath = require.resolve("../animation_tuner/public/batch_cutout_core");
  globalThis.ProtectedWasmKernelBridge = {
    ...bridge,
    applyReferenceColorReplace(...args) {
      protectedCalls += 1;
      return bridge.applyReferenceColorReplace(...args);
    },
  };
  delete require.cache[batchCorePath];
  try {
    const productionCore = require(batchCorePath);
    const source = Uint8ClampedArray.from([0, 255, 0, 255, 8, 247, 8, 230, 220, 30, 30, 255]);
    const options = {
      automaticCutout: true,
      backgroundColor: { r: 0, g: 255, b: 0 },
      backgroundColors: [{ r: 0, g: 255, b: 0 }],
      referenceChromaKey: true,
      connected: false,
      tolerance: 12,
      alphaHigh: 250,
      alphaLow: 5,
      despillMode: "general",
      despillStrength: 0,
    };
    const expected = batchCore.applyProductCutout(source, 3, 1, options, []);
    const actual = productionCore.applyProductCutout(source, 3, 1, options, []);
    assert.ok(protectedCalls > 0);
    assert.deepEqual([...actual.data], [...expected.data]);
    assert.deepEqual([...actual.automaticData], [...expected.automaticData]);

    const green = { r: 0, g: 255, b: 0, a: 255 };
    const featheredSource = Uint8ClampedArray.from([
      0, 255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
    ]);
    const featheredOptions = {
      referenceChromaKey: true,
      connected: false,
      backgroundColors: [green],
      tolerance: 0,
      feather: 24,
      alphaLow: 0,
      alphaHigh: 255,
    };
    const softAlpha = productionCore.applyCutout(featheredSource, 5, 1, {
      ...featheredOptions,
      alphaThreshold: 0,
    });
    const hardAlpha = productionCore.applyCutout(featheredSource, 5, 1, {
      ...featheredOptions,
      alphaThreshold: 48,
    });
    assert.deepEqual(
      [...softAlpha.data].filter((_value, offset) => offset % 4 === 3),
      [26, 87, 168, 229, 255],
    );
    assert.deepEqual(
      [...hardAlpha.data].filter((_value, offset) => offset % 4 === 3),
      [0, 87, 168, 229, 255],
    );

    const recoverySource = Uint8ClampedArray.from([
      0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 48, 207, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0,
      0, 255,
    ]);
    const recoveryOptions = {
      referenceChromaKey: true,
      connected: false,
      backgroundColors: [green],
      tolerance: 0,
      blendStrength: 0,
      feather: 0,
      chromaFeather: 0,
      despillStrength: 0,
      alphaLow: 0,
      alphaHigh: 255,
      edgeDespillRadius: 3,
      backgroundRadius: 8,
    };
    const recoveryOff = productionCore.applyCutout(recoverySource, 7, 1, {
      ...recoveryOptions,
      edgeRecoveryStrength: 0,
    });
    const recoveryOn = productionCore.applyCutout(recoverySource, 7, 1, {
      ...recoveryOptions,
      edgeRecoveryStrength: 100,
    });
    assert.notDeepEqual([...recoveryOff.data], [...recoveryOn.data]);

    const radiusSource = Uint8ClampedArray.from([
      ...Array.from({ length: 3 }, () => [0, 255, 0, 255]).flat(),
      ...Array.from({ length: 2 }, () => [48, 207, 0, 255]).flat(),
      ...Array.from({ length: 8 }, () => [255, 0, 0, 255]).flat(),
    ]);
    const radiusOptions = {
      ...recoveryOptions,
      edgeDespillRadius: 6,
      edgeRecoveryStrength: 100,
    };
    const narrowSearch = productionCore.applyCutout(radiusSource, 13, 1, {
      ...radiusOptions,
      backgroundRadius: 1,
    });
    const wideSearch = productionCore.applyCutout(radiusSource, 13, 1, {
      ...radiusOptions,
      backgroundRadius: 16,
    });
    assert.notDeepEqual([...narrowSearch.data], [...wideSearch.data]);

    const modeSource = Uint8ClampedArray.from([
      0, 255, 0, 255, 0, 255, 0, 255, 0, 32, 0, 255, 255, 0, 0, 255,
    ]);
    const modeOptions = {
      referenceChromaKey: true,
      connected: false,
      backgroundColors: [green],
      tolerance: 8,
      edgeBoost: 20,
      feather: 12,
      chromaFeather: 50,
      despillStrength: 100,
      edgeDespillRadius: 3,
    };
    const generalMode = productionCore.applyCutout(modeSource, 4, 1, {
      ...modeOptions,
      despillMode: "general",
    });
    const chromaMode = productionCore.applyCutout(modeSource, 4, 1, {
      ...modeOptions,
      despillMode: "chroma",
    });
    assert.notDeepEqual([...generalMode.data], [...chromaMode.data]);
  } finally {
    delete globalThis.ProtectedWasmKernelBridge;
    delete require.cache[batchCorePath];
  }
});

test("WASM bridge preserves connected reference replacement bytes", async () => {
  const bridge = await createInitializedBridge();
  const source = Uint8ClampedArray.from([0, 255, 0, 255, 5, 245, 5, 240, 240, 20, 20, 255, 0, 250, 0, 255]);
  const seed = { x: 0, y: 0 };
  const replacement = { r: 0, g: 0, b: 0, a: 0 };
  const options = {
    referenceColor: { r: 0, g: 255, b: 0, a: 255 },
    mask: Uint8Array.from([255, 255, 255, 255]),
    edgeRestoreRadius: 0,
  };
  const expected = batchCore.applyReferenceFloodFillDespill(source, 2, 2, seed, replacement, 12, options);
  const actual = bridge.applyReferenceFloodFillDespill(source, 2, 2, seed, replacement, 12, options);
  assert.deepEqual([...actual], [...expected]);
});

test("WASM bridge preserves product protection-color selection", async () => {
  const bridge = await createInitializedBridge();
  const palette = [
    [220, 30, 30],
    [30, 30, 220],
    [150, 90, 35],
    [0, 255, 0],
  ];
  const source = new Uint8ClampedArray(8 * 8 * 4);
  const previewData = new Uint8ClampedArray(source.length);
  for (let pixel = 0; pixel < 64; pixel += 1) {
    const color = palette[pixel % palette.length];
    source.set([...color, 255], pixel * 4);
    previewData.set([...color, pixel % 5 === 0 ? 255 : 128], pixel * 4);
  }
  const rectangle = { x1: 0, y1: 0, x2: 7, y2: 7 };
  const options = {
    backgroundColor: { r: 0, g: 255, b: 0 },
    coverage: 0.9,
    maximumColors: 5,
    previewData,
    existingColors: [{ r: 220, g: 30, b: 30 }],
  };
  const expected = batchCore.selectProtectedColorsInRectangle(source, 8, 8, rectangle, options);
  const actual = bridge.selectProtectionColors(source, 8, 8, rectangle, options);
  assert.deepEqual(actual, expected);
});

test("WASM bridge preserves PCA and layered shape results", async () => {
  const bridge = await createInitializedBridge();
  const mask = Uint8Array.from([0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0]);
  const expectedFrame = trackingCore.computeReferenceLocalFrame(mask, 4, 3, { ux: 0, uy: 1 });
  const actualFrame = bridge.computeLocalFrame(mask, 4, 3, { ux: 0, uy: 1 });
  assert.deepEqual(actualFrame, expectedFrame);

  const seed = { area: 6, pcaMajor: 2, pcaMinor: 1, compactness: 2.1 };
  const expectedShape = trackingCore.checkReferenceShapeMatch(mask, 4, 3, seed);
  const actualShape = bridge.checkShapeMatch(mask, 4, 3, seed);
  assert.deepEqual(actualShape, expectedShape);
});

test("WASM bridge preserves edge restoration bytes", async () => {
  const bridge = await createInitializedBridge();
  const source = Uint8ClampedArray.from([
    200, 20, 20, 255, 150, 70, 20, 220, 100, 120, 20, 180, 20, 200, 20, 255,
  ]);
  const correct = { r: 200, g: 20, b: 20 };
  const contaminated = { r: 20, g: 200, b: 20 };
  const options = { tolerance: 30, edgeRadius: 0, backgroundRadius: 30 };
  const expected = batchCore.applyReferenceEdgeColorRestore(source, 4, 1, correct, contaminated, options);
  const actual = bridge.restoreEdges(source, 4, 1, correct, contaminated, options);
  assert.deepEqual([...actual], [...expected]);
});

test("WASM bridge fails closed before artifact initialization", () => {
  const bridge = createBridge();
  assert.throws(
    () =>
      bridge.applyReferenceColorReplace(
        Uint8ClampedArray.from([0, 0, 0, 255]),
        1,
        1,
        { x: 0, y: 0 },
        { r: 0, g: 0, b: 0, a: 0 },
        0,
        {},
      ),
    /ENGINE_PRODUCTION_DEPENDENCY_MISSING/,
  );
});
