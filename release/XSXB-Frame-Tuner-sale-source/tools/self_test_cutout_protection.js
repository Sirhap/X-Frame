"use strict";

const assert = require("node:assert/strict");
const {
  applyReferenceColorReplace,
  applyReferenceFloodFillDespill,
  chamferDistanceToTransparent,
  colorDistance,
  connectedCandidateMask,
  createReferenceProtectionMask,
  estimateBackgroundColor,
  extractProtectedColors,
  perceptualColorDistance,
  referenceProtectionDescriptor,
  referenceProtectionMatches,
  selectProtectedColorsInRectangle,
  selectReferenceProtectedColors,
} = require("./animation_tuner/public/batch_cutout_core");
const { createProductPipeline } = require("./animation_tuner/public/batch_cutout_product_core");
const { createProtectionSelector } = require("./animation_tuner/public/batch_cutout_protection_core");
const {
  createReferenceRecoveryPipeline,
} = require("./animation_tuner/public/batch_cutout_reference_recovery_core");
const {
  createReferenceReplacementKernels,
} = require("./animation_tuner/public/batch_cutout_reference_replace_core");

/**
 * Runs the ordered protection and reference-pipeline assertions.
 * @param {{
 *   directProductPipeline: object,
 *   referenceProductOptions: object
 * }} context Values produced by the product assertion runner.
 * @returns {void}
 */
function runCutoutProtectionSelfTests(context) {
  const { directProductPipeline, referenceProductOptions } = context;
  const distanceFixture = new Uint8ClampedArray([0, 0, 0, 0, 20, 20, 20, 255, 20, 20, 20, 255]);
  assert.deepEqual([...chamferDistanceToTransparent(distanceFixture, 3, 1)], [0, 3, 6]);
  const protectionFixture = new Uint8ClampedArray([
    200, 20, 20, 255, 202, 22, 20, 255, 20, 200, 20, 255, 22, 202, 20, 255,
  ]);
  const protectionDependencies = {
    rgbToReferenceYcbcr(red, green, blue) {
      return {
        y: red * 0.299 + green * 0.587 + blue * 0.114,
        cb: red * -0.168736 + green * -0.331264 + blue * 0.5 + 128,
        cr: red * 0.5 + green * -0.418688 + blue * -0.081312 + 128,
      };
    },
    srgbToLinear(channel) {
      const normalized = Math.max(0, Math.min(255, Number(channel || 0))) / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    },
  };
  for (const dependencyName of Object.keys(protectionDependencies)) {
    const incompleteDependencies = { ...protectionDependencies };
    delete incompleteDependencies[dependencyName];
    assert.throws(
      () => createProtectionSelector(incompleteDependencies),
      new RegExp(`requires ${dependencyName}\\(\\)`),
    );
  }
  const directProtectionSelector = createProtectionSelector(protectionDependencies);
  const protectedRegionFixture = new Uint8ClampedArray(5 * 5 * 4);
  for (let index = 0; index < 25; index += 1) {
    protectedRegionFixture.set([0, 255, 0, 255], index * 4);
  }
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 3; x += 1) {
      protectedRegionFixture.set([220, 30, 20, 255], (y * 5 + x) * 4);
    }
  }
  const protectedRegionPreview = new Uint8ClampedArray(protectedRegionFixture);
  for (let index = 0; index < 25; index += 1) protectedRegionPreview[index * 4 + 3] = 0;
  protectedRegionPreview[(2 * 5 + 2) * 4 + 3] = 255;
  const protectedRegion = directProtectionSelector.createProtectedRegionMask(
    protectedRegionFixture,
    protectedRegionPreview,
    5,
    5,
    { x1: 0, y1: 0, x2: 4, y2: 4 },
    { backgroundColors: [{ r: 0, g: 255, b: 0 }], boundaryStrength: 55, padding: 0 },
  );
  assert.equal(protectedRegion.count, 9);
  assert.deepEqual(protectedRegion.bounds, { x1: 1, y1: 1, x2: 3, y2: 3 });
  assert.equal(protectedRegion.coverage, 36);
  const sceneSubjectFixture = new Uint8ClampedArray(9 * 9 * 4);
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      sceneSubjectFixture.set([24 + x, 30 + y, 42 + ((x + y) % 3), 255], (y * 9 + x) * 4);
    }
  }
  for (let y = 3; y <= 5; y += 1) {
    for (let x = 3; x <= 5; x += 1) {
      sceneSubjectFixture.set([220, 40, 30, 255], (y * 9 + x) * 4);
    }
  }
  sceneSubjectFixture.set([255, 255, 255, 255], (4 * 9 + 4) * 4);
  const sceneSubjectPreview = new Uint8ClampedArray(sceneSubjectFixture);
  const sceneSubject = directProtectionSelector.createProtectedRegionMask(
    sceneSubjectFixture,
    sceneSubjectPreview,
    9,
    9,
    { x1: 0, y1: 0, x2: 8, y2: 8 },
    { backgroundColors: [{ r: 255, g: 255, b: 255 }], boundaryStrength: 55, padding: 0 },
  );
  assert.equal(sceneSubject.count, 9);
  assert.equal(sceneSubject.mask[4 * 9 + 4], 1);
  assert.deepEqual(sceneSubject.bounds, { x1: 3, y1: 3, x2: 5, y2: 5 });
  const protectedRangeRepairResult = new Uint8ClampedArray(protectedRegionFixture.length);
  directProductPipeline.applyCutoutRepairs(
    protectedRegionFixture,
    protectedRangeRepairResult,
    5,
    5,
    { backgroundColors: [{ r: 0, g: 255, b: 0 }] },
    [
      {
        mode: "protect-range",
        x1: 0,
        y1: 0,
        x2: 4,
        y2: 4,
        boundaryStrength: 55,
        padding: 0,
      },
    ],
  );
  assert.equal(protectedRangeRepairResult[(2 * 5 + 2) * 4 + 3], 255);
  assert.equal(protectedRangeRepairResult[3], 0);
  const protectionExpansionFixture = new Uint8ClampedArray(7 * 4);
  for (let index = 0; index < 7; index += 1) {
    protectionExpansionFixture.set([0, 255, 0, 255], index * 4);
  }
  for (let x = 2; x <= 4; x += 1) {
    protectionExpansionFixture.set([220, 30, 20, 255], x * 4);
  }
  const protectionExpansionPreview = new Uint8ClampedArray(protectionExpansionFixture);
  for (let index = 0; index < 7; index += 1) protectionExpansionPreview[index * 4 + 3] = 0;
  protectionExpansionPreview[3 * 4 + 3] = 255;
  const expandedProtection = directProtectionSelector.createProtectedRegionMask(
    protectionExpansionFixture,
    protectionExpansionPreview,
    7,
    1,
    { x1: 3, y1: 0, x2: 3, y2: 0 },
    { backgroundColors: [{ r: 0, g: 255, b: 0 }], boundaryStrength: 55, padding: 2 },
  );
  assert.equal(expandedProtection.count, 3);
  assert.deepEqual(expandedProtection.bounds, { x1: 2, y1: 0, x2: 4, y2: 0 });
  assert.equal(expandedProtection.coverage, 100);
  const disconnectedProtectionFixture = new Uint8ClampedArray(7 * 4);
  for (let index = 0; index < 7; index += 1) {
    disconnectedProtectionFixture.set([0, 255, 0, 255], index * 4);
  }
  disconnectedProtectionFixture.set([220, 30, 20, 255], 1 * 4);
  disconnectedProtectionFixture.set([220, 30, 20, 255], 5 * 4);
  const disconnectedProtectionPreview = new Uint8ClampedArray(disconnectedProtectionFixture);
  for (let index = 0; index < 7; index += 1) disconnectedProtectionPreview[index * 4 + 3] = 0;
  disconnectedProtectionPreview[1 * 4 + 3] = 255;
  disconnectedProtectionPreview[5 * 4 + 3] = 255;
  const disconnectedProtection = directProtectionSelector.createProtectedRegionMask(
    disconnectedProtectionFixture,
    disconnectedProtectionPreview,
    7,
    1,
    { x1: -10, y1: -10, x2: 20, y2: 10 },
    { backgroundColors: [{ r: 0, g: 255, b: 0 }], boundaryStrength: 55, padding: 0 },
  );
  assert.equal(disconnectedProtection.count, 2);
  assert.equal(disconnectedProtection.mask[1], 1);
  assert.equal(disconnectedProtection.mask[5], 1);
  const fallbackProtectionFixture = new Uint8ClampedArray(9 * 4);
  for (let index = 0; index < 9; index += 1) {
    fallbackProtectionFixture.set([0, 255, 0, 255], index * 4);
  }
  for (let x = 1; x <= 3; x += 1) {
    fallbackProtectionFixture.set([220, 30, 20, 255], x * 4);
  }
  fallbackProtectionFixture.set([30, 40, 220, 255], 7 * 4);
  const fallbackProtection = directProtectionSelector.createProtectedRegionMask(
    fallbackProtectionFixture,
    null,
    9,
    1,
    { x1: 0, y1: 0, x2: 8, y2: 0 },
    { backgroundColors: [{ r: 0, g: 255, b: 0 }], boundaryStrength: 55, padding: 0 },
  );
  assert.equal(fallbackProtection.count, 3);
  assert.equal(fallbackProtection.mask[2], 1);
  assert.equal(fallbackProtection.mask[7], 0);
  const singlePixelProtection = directProtectionSelector.createProtectedRegionMask(
    Uint8ClampedArray.from([220, 30, 20, 255]),
    Uint8ClampedArray.from([220, 30, 20, 0]),
    1,
    1,
    { x1: 0, y1: 0, x2: 0, y2: 0 },
    { backgroundColors: [{ r: 0, g: 255, b: 0 }], boundaryStrength: 55, padding: 0 },
  );
  assert.equal(singlePixelProtection.count, 1);
  const transparentProtectionSource = Uint8ClampedArray.from([220, 30, 20, 0]);
  const transparentProtection = directProtectionSelector.createProtectedRegionMask(
    transparentProtectionSource,
    Uint8ClampedArray.from([220, 30, 20, 255]),
    1,
    1,
    { x1: 0, y1: 0, x2: 0, y2: 0 },
    { backgroundColors: [{ r: 0, g: 255, b: 0 }], boundaryStrength: 55, padding: 0 },
  );
  assert.equal(transparentProtection.count, 0);
  const protectedColorRecordFixture = Uint8ClampedArray.from([0, 255, 0, 255, 10, 245, 10, 255]);
  const protectedColorRecordResult = directProductPipeline.applyProductCutout(
    protectedColorRecordFixture,
    2,
    1,
    {
      ...referenceProductOptions,
      backgroundColors: [{ r: 0, g: 255, b: 0 }],
      protectedColors: [],
      protectionTolerance: 2,
      tolerance: 18,
      feather: 0,
      connected: false,
      referenceChromaKey: false,
      chromaCleanup: 0,
      chromaFeather: 0,
      edgeBoost: 0,
      alphaLow: 0,
      alphaHigh: 255,
      despillStrength: 0,
      edgeDespillRadius: 0,
      edgeRecoveryStrength: 0,
      backgroundRadius: 0,
      blurRadius: 0,
    },
    [
      {
        mode: "protect-color",
        x1: 1,
        y1: 0,
        x2: 1,
        y2: 0,
        colors: [{ r: 10, g: 245, b: 10 }],
      },
    ],
  );
  assert.deepEqual(
    [...protectedColorRecordResult.data].filter((_value, index) => index % 4 === 3),
    [0, 255],
  );
  let observedProtectionPreviewAlpha = -1;
  const stableProtectionPreviewPipeline = createProductPipeline({
    applyCutout: () => ({
      data: Uint8ClampedArray.from([10, 245, 10, 0]),
      removedPixels: 1,
      partialPixels: 0,
    }),
    applyReferenceColorReplace,
    applyReferenceFloodFillDespill,
    clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value || 0))),
    colorDistance,
    createProtectedRegionMask: (_source, preview) => {
      observedProtectionPreviewAlpha = preview[3];
      return { mask: Uint8Array.of(0), count: 0, bounds: null, coverage: 0 };
    },
    estimateBackgroundColor,
    perceptualColorDistance,
  });
  const stableProtectionPreviewResult = stableProtectionPreviewPipeline.applyProductCutout(
    Uint8ClampedArray.from([10, 245, 10, 255]),
    1,
    1,
    {},
    [
      {
        mode: "brush",
        points: [{ x: 0.5, y: 0.5 }],
        size: 1,
        hardness: 1,
        opacity: 1,
        color: { r: 10, g: 245, b: 10 },
      },
      { mode: "protect-range", x1: 0, y1: 0, x2: 0, y2: 0, padding: 0 },
    ],
  );
  assert.equal(observedProtectionPreviewAlpha, 0);
  assert.equal(stableProtectionPreviewResult.data[3], 255);
  const referenceRecoveryDependencies = {
    clamp(value, minimum, maximum) {
      return Math.max(minimum, Math.min(maximum, Number(value || 0)));
    },
    referenceSrgbToLinear(channel) {
      const normalized = Math.max(0, Math.min(255, Number(channel || 0))) / 255;
      const linear = normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      return Math.fround(linear);
    },
    referenceLinearToSrgb(channel) {
      if (channel <= 0) return 0;
      if (channel >= 1) return 255;
      const encoded = channel <= 0.003131 ? channel * 12.92 : channel ** (1 / 2.4) * 1.055 - 0.055;
      return Math.max(0, Math.min(255, Math.trunc(encoded * 255 + 0.5)));
    },
    rgbToReferenceYcbcr: protectionDependencies.rgbToReferenceYcbcr,
    referenceYcbcrToRgb(y, cb, cr) {
      const centeredCb = cb - 128;
      const centeredCr = cr - 128;
      return {
        r: Math.max(0, Math.min(255, Math.round(y + centeredCr * 1.402))),
        g: Math.max(0, Math.min(255, Math.round(y - centeredCb * 0.344136 - centeredCr * 0.714136))),
        b: Math.max(0, Math.min(255, Math.round(y + centeredCb * 1.772))),
      };
    },
    createReferenceProtectionMask: directProtectionSelector.createReferenceProtectionMask,
  };
  for (const dependencyName of Object.keys(referenceRecoveryDependencies)) {
    const incompleteDependencies = { ...referenceRecoveryDependencies };
    delete incompleteDependencies[dependencyName];
    assert.throws(
      () => createReferenceRecoveryPipeline(incompleteDependencies),
      new RegExp(`dependency "${dependencyName}" must be a function`),
    );
  }
  assert.throws(() => createReferenceReplacementKernels(), /dependencies are required/);
  assert.throws(
    () =>
      createReferenceReplacementKernels({
        applyReferenceReplacementPipeline() {},
      }),
    /connectedCandidateMask dependency must be a function/,
  );
  assert.throws(
    () =>
      createReferenceReplacementKernels({
        connectedCandidateMask() {},
      }),
    /applyReferenceReplacementPipeline dependency must be a function/,
  );
  const directReferenceRecoveryPipeline = createReferenceRecoveryPipeline(referenceRecoveryDependencies);
  const directReferenceReplacementKernels = createReferenceReplacementKernels({
    connectedCandidateMask,
    applyReferenceReplacementPipeline: directReferenceRecoveryPipeline.applyReferenceReplacementPipeline,
  });
  const directReferenceFixture = Uint8ClampedArray.from([
    20, 40, 60, 255, 20, 40, 60, 128, 100, 120, 140, 255, 30, 220, 30, 220, 80, 160, 80, 255, 200, 50, 50,
    255,
  ]);
  const directReferenceOptions = {
    alphaThresholdHigh: 200,
    alphaThresholdLow: 20,
    blendStrength: 50,
    despillMode: 2,
    despillRefColor: { r: 0, g: 255, b: 0 },
    despillStrength: 35,
    edgeRestoreMode: 2,
    edgeRestoreRadius: 2,
  };
  assert.deepEqual(
    directReferenceReplacementKernels.applyReferenceColorReplace(
      directReferenceFixture,
      6,
      1,
      { x: 0, y: 0 },
      { r: 200, g: 100, b: 50, a: 128 },
      0,
      directReferenceOptions,
    ),
    applyReferenceColorReplace(
      directReferenceFixture,
      6,
      1,
      { x: 0, y: 0 },
      { r: 200, g: 100, b: 50, a: 128 },
      0,
      directReferenceOptions,
    ),
  );
  assert.deepEqual(
    directReferenceReplacementKernels.applyReferenceFloodFillDespill(
      directReferenceFixture,
      6,
      1,
      { x: 0, y: 0 },
      { r: 0, g: 0, b: 0, a: 0 },
      0,
      { edgeRestoreRadius: 2, edgeRestoreMode: 2 },
    ),
    applyReferenceFloodFillDespill(
      directReferenceFixture,
      6,
      1,
      { x: 0, y: 0 },
      { r: 0, g: 0, b: 0, a: 0 },
      0,
      { edgeRestoreRadius: 2, edgeRestoreMode: 2 },
    ),
  );
  const directBackgroundDescriptor = directProtectionSelector.referenceProtectionDescriptor(0, 255, 0);
  const directCandidateDescriptor = directProtectionSelector.referenceProtectionDescriptor(200, 20, 20);
  assert.deepEqual(directCandidateDescriptor, referenceProtectionDescriptor(200, 20, 20));
  assert.equal(
    directProtectionSelector.referenceProtectionMatches(
      directBackgroundDescriptor,
      directCandidateDescriptor,
      202,
      22,
      20,
    ),
    referenceProtectionMatches(
      referenceProtectionDescriptor(0, 255, 0),
      referenceProtectionDescriptor(200, 20, 20),
      202,
      22,
      20,
    ),
  );
  assert.deepEqual(
    directProtectionSelector.createReferenceProtectionMask(protectionFixture, 2, 2, { r: 0, g: 255, b: 0 }, [
      { r: 200, g: 20, b: 20 },
    ]),
    createReferenceProtectionMask(protectionFixture, 2, 2, { r: 0, g: 255, b: 0 }, [
      { r: 200, g: 20, b: 20 },
    ]),
  );
  const clusteredProtection = selectReferenceProtectedColors(
    protectionFixture,
    2,
    2,
    { r: 0, g: 255, b: 0 },
    { maximumColors: 4, coverageThreshold: 95 },
  );
  assert.deepEqual(clusteredProtection.colors, [{ r: 200, g: 20, b: 20, count: 2 }]);
  assert.equal(clusteredProtection.coverage, 50);
  assert.equal(clusteredProtection.status, 2);
  assert.deepEqual(
    directProtectionSelector.selectReferenceProtectedColors(
      protectionFixture,
      2,
      2,
      { r: 0, g: 255, b: 0 },
      { maximumColors: 4, coverageThreshold: 95 },
    ),
    clusteredProtection,
  );
  const existingProtection = selectReferenceProtectedColors(
    protectionFixture,
    2,
    2,
    { r: 0, g: 255, b: 0 },
    {
      maximumColors: 4,
      coverageThreshold: 95,
      existingColors: [{ r: 200, g: 20, b: 20 }],
    },
  );
  assert.equal(existingProtection.count, 0);
  assert.equal(existingProtection.coverage, 50);
  assert.equal(existingProtection.status, 2);
  const directionalProtectionFixture = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const group = (x * 37 + y * 19) % 6;
      const color =
        group === 0
          ? [0, 255, 0]
          : group === 1
            ? [200 + x, 30 + y, 20]
            : group === 2
              ? [20, 80 + x * 10, 210 - y * 5]
              : group === 3
                ? [120 + y * 5, 90 + x * 3, 30]
                : group === 4
                  ? [40, 40, 40]
                  : [230, 220, 80];
      const offset = (y * 8 + x) * 4;
      directionalProtectionFixture.set([...color, 255], offset);
    }
  }
  const directionalProtection = selectReferenceProtectedColors(
    directionalProtectionFixture,
    8,
    8,
    { r: 0, g: 255, b: 0 },
    { maximumColors: 8, coverageThreshold: 95 },
  );
  assert.deepEqual(
    directionalProtection.colors.map((color) => [color.r, color.g, color.b]),
    [
      [205, 32, 20],
      [20, 140, 200],
      [145, 102, 30],
      [230, 220, 80],
      [40, 40, 40],
    ],
  );
  assert.equal(directionalProtection.coverage, 82);
  assert.equal(directionalProtection.status, 2);
  const foregroundOnlyProtection = extractProtectedColors(
    new Uint8ClampedArray([200, 100, 70, 255, 200, 100, 70, 255, 30, 170, 50, 255, 30, 170, 50, 255]),
    2,
    2,
    { x1: 0, y1: 0, x2: 1, y2: 1 },
    {
      maximumColors: 4,
      coverage: 1,
      excludeColors: [{ r: 200, g: 100, b: 70 }],
      excludeTolerance: 2,
    },
  );
  assert.equal(foregroundOnlyProtection.length, 1);
  assert.deepEqual(
    [foregroundOnlyProtection[0].r, foregroundOnlyProtection[0].g, foregroundOnlyProtection[0].b],
    [30, 170, 50],
  );
  const protectedRectanglePreview = new Uint8ClampedArray([
    200, 100, 70, 0, 200, 100, 70, 255, 30, 170, 50, 128, 30, 170, 50, 128,
  ]);
  const protectedRectangleSelection = selectProtectedColorsInRectangle(
    new Uint8ClampedArray([200, 100, 70, 255, 200, 100, 70, 255, 30, 170, 50, 255, 30, 170, 50, 255]),
    2,
    2,
    { x1: 0, y1: 0, x2: 1, y2: 1 },
    {
      maximumColors: 4,
      coverage: 1,
      excludeColors: [{ r: 0, g: 255, b: 0 }],
      previewData: protectedRectanglePreview,
      existingColors: [{ r: 30, g: 170, b: 50 }],
    },
  );
  assert.equal(protectedRectangleSelection.sampleCount, 2);
  assert.equal(protectedRectangleSelection.count, 0);
  assert.deepEqual(
    directProtectionSelector.selectProtectedColorsInRectangle(
      new Uint8ClampedArray([200, 100, 70, 255, 200, 100, 70, 255, 30, 170, 50, 255, 30, 170, 50, 255]),
      2,
      2,
      { x1: 0, y1: 0, x2: 1, y2: 1 },
      {
        maximumColors: 4,
        coverage: 1,
        excludeColors: [{ r: 0, g: 255, b: 0 }],
        previewData: protectedRectanglePreview,
        existingColors: [{ r: 30, g: 170, b: 50 }],
      },
    ),
    protectedRectangleSelection,
  );
  assert.deepEqual(
    directProtectionSelector.extractProtectedColors(
      new Uint8ClampedArray([200, 100, 70, 255, 200, 100, 70, 255, 30, 170, 50, 255, 30, 170, 50, 255]),
      2,
      2,
      { x1: 0, y1: 0, x2: 1, y2: 1 },
      {
        maximumColors: 4,
        coverage: 1,
        excludeColors: [{ r: 200, g: 100, b: 70 }],
        excludeTolerance: 2,
      },
    ),
    foregroundOnlyProtection,
  );
}

module.exports = { runCutoutProtectionSelfTests };
