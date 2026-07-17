const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { animationLooksAttack, hitboxEnabledByDefault } = require("./box_estimator");
const {
  applyCutout,
  applyProductCutout,
  applyReferenceChromaKey,
  applyReferenceColorReplace,
  applyReferenceDespillPixel,
  applyReferenceEdgeColorRestore,
  applyReferenceFloodFillDespill,
  chamfer345Distance,
  chamferDistanceToTransparent,
  colorDistance,
  connectedCandidateMask,
  createProtectedRegionMask,
  createReferenceProtectionMask,
  diffuseReferenceCandidateMask,
  diffuseReferenceGlobalCandidateMask,
  estimateBackgroundColor,
  extractProtectedColors,
  hexToRgb,
  isWithinConnectivityTolerance,
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
const { buildZip, crc32, toBytes } = require("./animation_tuner/public/batch_zip");
const {
  createAnimationReplacementPayload,
  createArchiveEntries,
  createOutput,
  uniquePngName,
} = require("./animation_tuner/public/batch_cutout_output_core");
const {
  createExecutor: createCutoutExecutor,
} = require("./animation_tuner/public/batch_cutout_worker_client");
const {
  advanceTrackingState,
  checkReferenceShapeMatch,
  compareShapeDescriptors,
  computeReferenceLocalFrame,
  createShapeCandidates,
  createShapeDescriptor,
  createTrackingState,
  findReferenceNearestColorInRadius,
  mapCanvasBrushStroke,
  mapCanvasRectangle,
  mapBrushStroke,
  mapRectangle,
  predictTrackingCenter,
  sampleMatchingColor,
  selectTrackedCandidate,
} = require("./animation_tuner/public/cutout_tracking_core");
const {
  compareConnectedRegions,
  createLocalAnchor,
  findMatchingTransparentRegion,
  measureConnectedRegion,
  trackLocalAnchor,
} = require("./animation_tuner/public/cutout_local_tracking_core");
const {
  analyzeCutoutQualitySequence,
  createCutoutQualityMetrics,
} = require("./animation_tuner/public/cutout_quality_core");
const {
  analyzeDuplicateFrames,
  analyzeJumpFrames,
  createSignature,
  findDuplicateFrames,
  findJumpFrames,
  findLoopCandidates,
  signatureSimilarity,
} = require("./animation_tuner/public/frame_organizer_core");
const { importAnimation, mirrorBoxes, remapBindings, remapIndexedDictionary } = require("./frame_organizer");
const {
  FRAMEPACKER_KERNELS,
  FRAMEPACKER_KERNEL_PARAMETER_LAYOUTS,
  kernelById,
} = require("./framepacker_reference_manifest");
const { createProjectStore } = require("./project_store");
const { parseBatchArgs } = require("./import_batch");
const { runtimeScript } = require("./godot_runtime");
const { candidateSkillTargets, resolveSkillTarget, syncSkillDirectory, trustedRemote } = require("./updater");

assert.equal(animationLooksAttack("stand_attack"), true);
assert.equal(animationLooksAttack("站立攻击"), true);
assert.equal(animationLooksAttack("格挡反击"), true);
assert.equal(animationLooksAttack("idle"), false);
assert.equal(hitboxEnabledByDefault(0, 3, "attack"), true);
assert.equal(hitboxEnabledByDefault(0, 12, "stand_attack"), false);
assert.equal(hitboxEnabledByDefault(5, 12, "stand_attack"), true);
assert.equal(FRAMEPACKER_KERNELS.length, 14);
assert.equal(kernelById(9).name, "chromaKeyClean");
assert.equal(kernelById(2), null);
assert.equal(FRAMEPACKER_KERNEL_PARAMETER_LAYOUTS[7].protectedColorCount, 0x34);
assert.equal(FRAMEPACKER_KERNEL_PARAMETER_LAYOUTS[13].edgeRestoreMode, 0x20);
assert.equal(FRAMEPACKER_KERNEL_PARAMETER_LAYOUTS[14].outputStatus, 0x18);

const horizontalLocalFrame = computeReferenceLocalFrame(Uint8Array.from([0, 0, 0, 1, 1, 1, 0, 0, 0]), 3, 3);
assert.ok(horizontalLocalFrame);
assert.deepEqual(
  [horizontalLocalFrame.ux, horizontalLocalFrame.uy, horizontalLocalFrame.cx, horizontalLocalFrame.cy],
  [1, 0, 1, 1],
);
assert.equal(horizontalLocalFrame.majorLen, 2);
assert.equal(horizontalLocalFrame.minorLen, 0);
const isotropicLocalFrame = computeReferenceLocalFrame(Uint8Array.from([1, 1, 1, 1]), 2, 2, {
  ux: 0,
  uy: -1,
});
assert.ok(isotropicLocalFrame);
assert.equal(isotropicLocalFrame.isotropic, true);
assert.deepEqual(
  [
    isotropicLocalFrame.ux,
    isotropicLocalFrame.uy,
    isotropicLocalFrame.majorLen,
    isotropicLocalFrame.minorLen,
  ],
  [-0, -1, 1, 1],
);
assert.equal(computeReferenceLocalFrame(Uint8Array.of(1, 1), 2, 1), null);
const nearestColorFixture = Uint8ClampedArray.from([10, 0, 0, 0, 100, 0, 0, 255, 10, 0, 0, 255]);
const nearestColorTie = findReferenceNearestColorInRadius(
  nearestColorFixture,
  3,
  1,
  { r: 0, g: 0, b: 0 },
  { x: 1, y: 0 },
  1,
);
assert.deepEqual(nearestColorTie, {
  x: 0,
  y: 0,
  dist: 10,
  newSeedColor: [10, 0, 0, 0],
});
const nearestColorWithAlpha = findReferenceNearestColorInRadius(
  nearestColorFixture,
  3,
  1,
  { r: 10, g: 0, b: 0, a: 0 },
  { x: 1, y: 0 },
  1,
);
assert.equal(nearestColorWithAlpha.x, 0);
assert.equal(nearestColorWithAlpha.dist, 0);
const referenceShapeMask = Uint8Array.from([
  0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
]);
const referenceShapeNoSeed = checkReferenceShapeMatch(referenceShapeMask, 6, 5, null);
assert.equal(referenceShapeNoSeed.passed, true);
assert.deepEqual(referenceShapeNoSeed.layerPassed, [null, null, null]);
const referenceShapeMatch = checkReferenceShapeMatch(referenceShapeMask, 6, 5, {
  area: 12,
  pcaMajor: 3,
  pcaMinor: 2,
  compactness: 1.3,
});
assert.equal(referenceShapeMatch.passed, true);
assert.deepEqual(referenceShapeMatch.layerPassed, [true, true, null]);
assert.equal(referenceShapeMatch.rSegment, "compact");
const referenceShapeAreaFailure = checkReferenceShapeMatch(referenceShapeMask, 6, 5, {
  area: 40,
  pcaMajor: 3,
  pcaMinor: 2,
});
assert.equal(referenceShapeAreaFailure.passed, false);
assert.deepEqual(referenceShapeAreaFailure.layerPassed, [false, null, null]);

const cutoutPixels = new Uint8ClampedArray([
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 20, 40, 80, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
]);
const estimatedBackground = estimateBackgroundColor(cutoutPixels, 3, 3);
assert.equal(estimatedBackground.hex, "#ffffff");
const referenceDistance = chamfer345Distance(Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0]), 3, 3);
assert.deepEqual([...referenceDistance], [0, 3, 6, 3, 4, 7, 6, 7, 8]);
assert.equal(
  isWithinConnectivityTolerance(Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]), referenceDistance, 3, 3),
  true,
);
const cutoutResult = applyCutout(cutoutPixels, 3, 3, {
  backgroundColor: hexToRgb("#ffffff"),
  tolerance: 4,
  feather: 0,
  connected: true,
});
assert.equal(cutoutResult.data[3], 0);
assert.equal(cutoutResult.data[(1 * 3 + 1) * 4 + 3], 255);
assert.equal(cutoutResult.removedPixels, 8);
const protectedCutout = applyCutout(cutoutPixels, 3, 3, {
  backgroundColor: hexToRgb("#ffffff"),
  tolerance: 4,
  feather: 0,
  connected: true,
  protectedColors: [hexToRgb("#ffffff")],
  protectionTolerance: 1,
});
assert.equal(protectedCutout.data[3], 255);
const thresholdCutout = applyCutout(new Uint8ClampedArray([248, 248, 248, 255]), 1, 1, {
  backgroundColor: hexToRgb("#ffffff"),
  tolerance: 0,
  feather: 20,
  connected: false,
  alphaLow: 200,
});
assert.equal(thresholdCutout.data[3], 0);
const despillCutout = applyCutout(new Uint8ClampedArray([0, 220, 0, 255]), 1, 1, {
  backgroundColor: hexToRgb("#00ff00"),
  tolerance: 0,
  feather: 0,
  connected: false,
  despillStrength: 100,
  despillMode: "general",
});
assert.ok(despillCutout.data[1] < 220);
const referenceProductFixture = Uint8ClampedArray.from([
  0, 255, 0, 255, 0, 250, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 250, 255,
]);
const referenceProductOptions = {
  referenceChromaKey: true,
  connected: false,
  feather: 0,
  chromaFeather: 0,
  edgeRecoveryStrength: 0,
  despillStrength: 0,
  alphaLow: 0,
  alphaHigh: 255,
};
const singleBackgroundProductCutout = applyCutout(referenceProductFixture, 5, 1, {
  ...referenceProductOptions,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  tolerance: 2,
});
const multiBackgroundProductCutout = applyCutout(referenceProductFixture, 5, 1, {
  ...referenceProductOptions,
  backgroundColors: [
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
  ],
  tolerance: 2,
});
assert.deepEqual(
  [...singleBackgroundProductCutout.data].filter((_value, index) => index % 4 === 3),
  [0, 0, 255, 255, 255],
);
assert.deepEqual(
  [...multiBackgroundProductCutout.data].filter((_value, index) => index % 4 === 3),
  [0, 0, 255, 0, 0],
);
const strictReferenceProductCutout = applyCutout(referenceProductFixture, 5, 1, {
  ...referenceProductOptions,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  tolerance: 0,
});
assert.notDeepEqual([...strictReferenceProductCutout.data], [...singleBackgroundProductCutout.data]);
const connectedReferenceProductFixture = Uint8ClampedArray.from([
  0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255,
]);
const connectedReferenceProductCutout = applyCutout(connectedReferenceProductFixture, 3, 1, {
  ...referenceProductOptions,
  connected: true,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  seedPoints: [{ x: 0, y: 0 }],
  tolerance: 0,
});
assert.deepEqual(
  [...connectedReferenceProductCutout.data].filter((_value, index) => index % 4 === 3),
  [0, 255, 255],
);
const edgeBoostFixture = Uint8ClampedArray.from([0, 255, 0, 255, 18, 238, 18, 255, 255, 0, 0, 255]);
const edgeBoostGlobalCutout = applyCutout(edgeBoostFixture, 3, 1, {
  ...referenceProductOptions,
  connected: false,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  tolerance: 0,
  edgeBoost: 20,
});
const edgeBoostConnectedCutout = applyCutout(edgeBoostFixture, 3, 1, {
  ...referenceProductOptions,
  connected: true,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  seedPoints: [{ x: 0, y: 0 }],
  tolerance: 0,
  edgeBoost: 20,
});
assert.deepEqual(
  [...edgeBoostConnectedCutout.data].filter((_value, index) => index % 4 === 3),
  [...edgeBoostGlobalCutout.data].filter((_value, index) => index % 4 === 3),
);

// FramePacker preserves the fractional effective tolerance produced by edge enhancement.
const referenceEdgeEnhanceFixture = Uint8ClampedArray.from([
  20, 40, 60, 255,
  74, 40, 60, 255,
]);
const referenceEdgeEnhanceCutout = applyCutout(referenceEdgeEnhanceFixture, 2, 1, {
  backgroundColor: { r: 20, g: 40, b: 60 },
  backgroundColors: [{ r: 20, g: 40, b: 60 }],
  tolerance: 1,
  edgeBoost: 10,
  chromaCleanup: 0,
  connected: false,
  referenceChromaKey: true,
});
assert.deepEqual(
  [...referenceEdgeEnhanceCutout.data].filter((_value, index) => index % 4 === 3),
  [0, 0],
);
const referenceEdgeEnhanceWithHiddenCleanup = applyCutout(referenceEdgeEnhanceFixture, 2, 1, {
  backgroundColor: { r: 20, g: 40, b: 60 },
  backgroundColors: [{ r: 20, g: 40, b: 60 }],
  tolerance: 1,
  edgeBoost: 10,
  chromaCleanup: 100,
  connected: false,
  referenceChromaKey: true,
});
assert.deepEqual(referenceEdgeEnhanceWithHiddenCleanup.data, referenceEdgeEnhanceCutout.data);
const referenceRecoveryFixture = Uint8ClampedArray.from([0, 255, 0, 255, 30, 220, 30, 220, 200, 40, 40, 255]);
const weakReferenceRecovery = applyCutout(referenceRecoveryFixture, 3, 1, {
  ...referenceProductOptions,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  tolerance: 0,
  edgeDespillRadius: 2,
  edgeRecoveryStrength: 1,
});
const strongReferenceRecovery = applyCutout(referenceRecoveryFixture, 3, 1, {
  ...referenceProductOptions,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  tolerance: 0,
  edgeDespillRadius: 2,
  edgeRecoveryStrength: 100,
});
assert.notDeepEqual([...weakReferenceRecovery.data], [...strongReferenceRecovery.data]);
const chromaReferenceRecovery = applyCutout(referenceRecoveryFixture, 3, 1, {
  ...referenceProductOptions,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  tolerance: 0,
  edgeDespillRadius: 2,
  edgeRecoveryStrength: 50,
  despillMode: "chroma",
});
const blendReferenceRecovery = applyCutout(referenceRecoveryFixture, 3, 1, {
  ...referenceProductOptions,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  tolerance: 0,
  edgeDespillRadius: 2,
  edgeRecoveryStrength: 50,
  despillMode: "blend",
});
assert.notDeepEqual([...chromaReferenceRecovery.data], [...blendReferenceRecovery.data]);
const protectedEdgeRecoveryFixture = Uint8ClampedArray.from([
  0, 255, 0, 255, 80, 180, 20, 255, 160, 90, 20, 255, 220, 30, 20, 255,
]);
const weakProtectedEdgeRecovery = applyCutout(protectedEdgeRecoveryFixture, 4, 1, {
  ...referenceProductOptions,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  protectedColors: [{ r: 220, g: 30, b: 20 }],
  protectionTolerance: 3,
  tolerance: 0,
  edgeDespillRadius: 2,
  backgroundRadius: 30,
  edgeRecoveryTolerance: 30,
  edgeRecoveryStrength: 1,
});
const strongProtectedEdgeRecovery = applyCutout(protectedEdgeRecoveryFixture, 4, 1, {
  ...referenceProductOptions,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  protectedColors: [{ r: 220, g: 30, b: 20 }],
  protectionTolerance: 3,
  tolerance: 0,
  edgeDespillRadius: 2,
  backgroundRadius: 30,
  edgeRecoveryTolerance: 30,
  edgeRecoveryStrength: 100,
});
assert.notDeepEqual([...weakProtectedEdgeRecovery.data], [...strongProtectedEdgeRecovery.data]);
const protectedReferenceProductCutout = applyCutout(referenceProductFixture, 5, 1, {
  ...referenceProductOptions,
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  protectedColors: [{ r: 0, g: 255, b: 0 }],
  protectionTolerance: 6,
  tolerance: 2,
});
assert.equal(protectedReferenceProductCutout.removedPixels, 0);
const smartRepairFixture = Uint8ClampedArray.from([
  0, 255, 0, 255, 0, 250, 0, 255, 220, 30, 20, 255, 220, 30, 20, 255, 0, 255, 0, 255,
]);
const smartRepairCutout = applyProductCutout(
  smartRepairFixture,
  5,
  1,
  {
    ...referenceProductOptions,
    backgroundColors: [{ r: 0, g: 0, b: 255 }],
    tolerance: 2,
  },
  [
    {
      mode: "smart",
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      backgroundColor: { r: 0, g: 255, b: 0 },
      tolerance: 2,
      feather: 0,
    },
  ],
);
assert.deepEqual(
  [...smartRepairCutout.data].filter((_value, index) => index % 4 === 3),
  [0, 0, 255, 255, 255],
);
const areaRepairFixture = Uint8ClampedArray.from([
  220, 20, 20, 255, 220, 20, 20, 255, 20, 40, 220, 255, 220, 20, 20, 255, 20, 40, 220, 255, 20, 40, 220, 255,
]);
const fillRepairCutout = applyProductCutout(
  areaRepairFixture,
  3,
  2,
  { ...referenceProductOptions, backgroundColor: { r: 255, g: 0, b: 255 }, tolerance: 0, feather: 0 },
  [
    {
      mode: "fill",
      x: 0,
      y: 0,
      sourceColor: { r: 220, g: 20, b: 20, a: 255 },
      color: { r: 20, g: 200, b: 80 },
      tolerance: 0,
      scope: "connected",
    },
  ],
);
assert.deepEqual(
  [...fillRepairCutout.data].filter((_value, index) => index % 4 !== 3),
  [20, 200, 80, 20, 200, 80, 20, 40, 220, 20, 200, 80, 20, 40, 220, 20, 40, 220],
);
const recolorRepairCutout = applyProductCutout(
  areaRepairFixture,
  3,
  2,
  { ...referenceProductOptions, backgroundColor: { r: 255, g: 0, b: 255 }, tolerance: 0, feather: 0 },
  [
    {
      mode: "recolor",
      x: 2,
      y: 0,
      sourceColor: { r: 20, g: 40, b: 220, a: 255 },
      color: { r: 245, g: 190, b: 35 },
      tolerance: 0,
      scope: "global",
    },
  ],
);
assert.deepEqual(
  [...recolorRepairCutout.data].filter((_value, index) => index % 4 !== 3),
  [220, 20, 20, 220, 20, 20, 245, 190, 35, 220, 20, 20, 245, 190, 35, 245, 190, 35],
);
const transparentFillCutout = applyProductCutout(
  areaRepairFixture,
  3,
  2,
  { ...referenceProductOptions, backgroundColor: { r: 255, g: 0, b: 255 }, tolerance: 0, feather: 0 },
  [
    {
      mode: "fill",
      x: 0,
      y: 0,
      sourceColor: { r: 220, g: 20, b: 20, a: 255 },
      color: { r: 0, g: 0, b: 0, a: 0 },
      tolerance: 0,
      scope: "connected",
    },
  ],
);
assert.deepEqual([...transparentFillCutout.data.slice(0, 8)], [0, 0, 0, 0, 0, 0, 0, 0]);
assert.deepEqual([...transparentFillCutout.data.slice(8, 12)], [20, 40, 220, 255]);
const transparentRecolorCutout = applyProductCutout(
  areaRepairFixture,
  3,
  2,
  { ...referenceProductOptions, backgroundColor: { r: 255, g: 0, b: 255 }, tolerance: 0, feather: 0 },
  [
    {
      mode: "recolor",
      x: 2,
      y: 0,
      sourceColor: { r: 20, g: 40, b: 220, a: 255 },
      color: { r: 0, g: 0, b: 0, a: 0 },
      tolerance: 0,
      scope: "global",
    },
  ],
);
assert.deepEqual(
  [...transparentRecolorCutout.data].filter((_value, index) => index % 4 === 3),
  [255, 255, 0, 255, 0, 0],
);
assert.throws(() => createProductPipeline({}), /requires applyCutout/);
const directProductPipeline = createProductPipeline({
  applyCutout,
  clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value || 0))),
  colorDistance,
  createProtectedRegionMask,
  estimateBackgroundColor,
  perceptualColorDistance,
});
const sourceRestorePixels = Uint8ClampedArray.from([0, 0, 0, 0]);
const sourceRestoreOriginal = Uint8ClampedArray.from([248, 248, 236, 255]);
directProductPipeline.applyCutoutRepairs(
  sourceRestoreOriginal,
  sourceRestorePixels,
  1,
  1,
  { backgroundColor: { r: 255, g: 255, b: 255 }, tolerance: 60, feather: 24 },
  [
    {
      mode: "restore-source",
      points: [{ x: 0.5, y: 0.5 }],
      size: 2,
      hardness: 1,
      opacity: 1,
    },
  ],
);
assert.deepEqual([...sourceRestorePixels], [...sourceRestoreOriginal]);
const paintOnlyEraserSource = Uint8ClampedArray.from([42, 84, 126, 255]);
const paintOnlyEraserResult = new Uint8ClampedArray(paintOnlyEraserSource);
directProductPipeline.applyCutoutRepairs(
  paintOnlyEraserSource,
  paintOnlyEraserResult,
  1,
  1,
  { backgroundColor: { r: 255, g: 255, b: 255 }, tolerance: 0, feather: 0 },
  [
    {
      mode: "brush",
      points: [{ x: 0.5, y: 0.5 }],
      size: 2,
      hardness: 1,
      opacity: 1,
      color: { r: 240, g: 20, b: 40 },
    },
    {
      mode: "eraser",
      points: [{ x: 0.5, y: 0.5 }],
      size: 2,
      hardness: 1,
      opacity: 1,
    },
  ],
);
assert.deepEqual([...paintOnlyEraserResult], [...paintOnlyEraserSource]);
const inactiveAutomaticCutout = directProductPipeline.applyProductCutout(
  smartRepairFixture,
  5,
  1,
  {
    ...referenceProductOptions,
    automaticCutout: false,
    backgroundColors: [{ r: 0, g: 255, b: 0 }],
    tolerance: 60,
  },
);
assert.deepEqual([...inactiveAutomaticCutout.data], [...smartRepairFixture]);
assert.deepEqual([...inactiveAutomaticCutout.automaticData], [...smartRepairFixture]);
assert.equal(inactiveAutomaticCutout.removedPixels, 0);
assert.throws(
  () =>
    directProductPipeline.applyCutoutBrushStroke(
      new Uint8ClampedArray(4),
      1,
      1,
      { mode: "restore-source", points: [{ x: 0.5, y: 0.5 }] },
      new Uint8ClampedArray(8),
    ),
  /Source pixels must match/,
);
assert.deepEqual(
  directProductPipeline.applyProductCutout(
    smartRepairFixture,
    5,
    1,
    {
      ...referenceProductOptions,
      backgroundColors: [{ r: 0, g: 0, b: 255 }],
      tolerance: 2,
    },
    [
      {
        mode: "smart",
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 0,
        backgroundColor: { r: 0, g: 255, b: 0 },
        tolerance: 2,
        feather: 0,
      },
    ],
  ),
  smartRepairCutout,
);

/**
 * Builds one deterministic moving-subject frame for the 20-frame product corpus.
 * @param {number} frameIndex Zero-based frame index.
 * @returns {Uint8ClampedArray}
 */
function createProductGoldenFrame(frameIndex) {
  const width = 8;
  const height = 8;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const subjectX = 1 + (frameIndex % 5);
  const subjectY = 2 + (frameIndex % 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const secondaryBackground = x === width - 1 && frameIndex % 2 === 1;
      pixels[offset] = secondaryBackground ? 0 : (x * 2 + frameIndex) % 8;
      pixels[offset + 1] = secondaryBackground ? 0 : 248 + ((x + y + frameIndex) % 8);
      pixels[offset + 2] = secondaryBackground ? 248 : (y * 3 + frameIndex) % 8;
      pixels[offset + 3] = 255;
      if (Math.abs(x - subjectX) <= 1 && Math.abs(y - subjectY) <= 1) {
        pixels[offset] = 180 + ((x * 11 + frameIndex) % 50);
        pixels[offset + 1] = 25 + ((y * 13 + frameIndex) % 45);
        pixels[offset + 2] = 20 + ((x * 7 + y * 5) % 30);
      }
    }
  }
  return pixels;
}

const productGoldenOptions = {
  backgroundColor: { r: 0, g: 252, b: 0 },
  backgroundColors: [
    { r: 0, g: 252, b: 0 },
    { r: 0, g: 0, b: 248 },
  ],
  tolerance: 4,
  feather: 5,
  alphaThreshold: 2,
  connected: false,
  perceptual: true,
  referenceChromaKey: true,
  chromaCleanup: 44,
  chromaFeather: 12,
  edgeBoost: 8,
  alphaLow: 3,
  alphaHigh: 250,
  despillStrength: 35,
  despillMode: "chroma",
  edgeDespillRadius: 2,
  edgeRecoveryStrength: 40,
  edgeRecoveryTolerance: 30,
  backgroundRadius: 10,
  blurRadius: 1,
  protectedColors: [{ r: 210, g: 45, b: 30 }],
  protectionTolerance: 4,
};
const productGoldenBytes = [];
for (let frameIndex = 0; frameIndex < 20; frameIndex += 1) {
  const source = createProductGoldenFrame(frameIndex);
  const repairs = [
    {
      mode: frameIndex % 2 ? "eraser" : "brush",
      points: [
        { x: 2, y: 2 },
        { x: 3 + (frameIndex % 3), y: 4 },
      ],
      size: 2 + (frameIndex % 3),
      hardness: 0.65,
      opacity: 0.4,
      color: { r: 35, g: 120, b: 210 },
    },
    {
      mode: frameIndex % 3 === 0 ? "clear" : frameIndex % 3 === 1 ? "restore" : "smart",
      x1: 0,
      y1: 0,
      x2: 2,
      y2: 2,
      tolerance: 5,
      feather: 2,
      backgroundColor: { r: 0, g: 252, b: 0 },
    },
  ];
  const automatic = applyCutout(source, 8, 8, productGoldenOptions);
  const product = applyProductCutout(source, 8, 8, productGoldenOptions, repairs);
  assert.deepEqual([...product.automaticData], [...automatic.data]);
  assert.equal(product.data.length, 8 * 8 * 4);
  productGoldenBytes.push(...product.data);
}
const productGoldenHash = crypto
  .createHash("sha256")
  .update(Uint8Array.from(productGoldenBytes))
  .digest("hex");
assert.equal(productGoldenHash, "c1b655b63444fc1c679ccd4ade021a17dc62fecf29cb3722b4c88f4e416f6623");
const referenceDespill = Uint8ClampedArray.from([0, 220, 0, 255]);
applyReferenceDespillPixel(referenceDespill, 0, { r: 0, g: 255, b: 0 }, 0.7);
assert.deepEqual([...referenceDespill], [145, 198, 140, 255]);
const unrelatedDespillHue = Uint8ClampedArray.from([220, 30, 30, 255]);
applyReferenceDespillPixel(unrelatedDespillHue, 0, { r: 0, g: 255, b: 0 }, 0.7);
assert.deepEqual([...unrelatedDespillHue], [220, 30, 30, 255]);
const referenceChroma = applyReferenceChromaKey(
  Uint8ClampedArray.from([0, 255, 0, 255, 30, 240, 30, 255, 255, 0, 0, 255]),
  3,
  1,
  {
    backgroundColor: { r: 0, g: 255, b: 0 },
    cleanup: 40,
    feather: 30,
  },
);
assert.deepEqual([...referenceChroma], [0, 0, 0, 0, 30, 240, 30, 40, 255, 0, 0, 255]);
const referenceEdgeRestore = applyReferenceEdgeColorRestore(
  Uint8ClampedArray.from([128, 128, 128, 255, 220, 220, 220, 255, 240, 240, 240, 255]),
  3,
  1,
  { r: 0, g: 0, b: 0 },
  { r: 255, g: 255, b: 255 },
  { tolerance: 30 },
);
assert.deepEqual([...referenceEdgeRestore], [0, 0, 0, 255, 119, 119, 119, 255, 240, 240, 240, 255]);
const maskedEdgeRestore = applyReferenceEdgeColorRestore(
  Uint8ClampedArray.from([128, 128, 128, 255]),
  1,
  1,
  { r: 0, g: 0, b: 0 },
  { r: 255, g: 255, b: 255 },
  { tolerance: 30, mask: Uint8Array.of(0) },
);
assert.deepEqual([...maskedEdgeRestore], [128, 128, 128, 255]);
assert.throws(
  () =>
    applyReferenceEdgeColorRestore(
      Uint8ClampedArray.from([128, 128, 128, 255]),
      1,
      1,
      { r: 100, g: 100, b: 100 },
      { r: 100, g: 100, b: 100 },
    ),
  RangeError,
);
let randomState = 0x6d2b79f5;
/**
 * Returns one deterministic pseudo-random byte for repeatable small-image fixtures.
 * @returns {number}
 */
const nextRandomByte = () => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return randomState & 255;
};
for (let fixtureIndex = 0; fixtureIndex < 48; fixtureIndex += 1) {
  const width = 1 + (nextRandomByte() % 8);
  const height = 1 + (nextRandomByte() % 8);
  const source = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < source.length; offset += 4) {
    source[offset] = nextRandomByte();
    source[offset + 1] = nextRandomByte();
    source[offset + 2] = nextRandomByte();
    source[offset + 3] = nextRandomByte();
  }
  const original = new Uint8ClampedArray(source);
  const referenceColor = {
    r: source[0],
    g: source[1],
    b: source[2],
    a: source[3],
  };
  const replaced = applyReferenceColorReplace(
    source,
    width,
    height,
    { x: 0, y: 0 },
    { r: 0, g: 0, b: 0, a: 0 },
    nextRandomByte() % 30,
    { referenceColor },
  );
  const flooded = applyReferenceFloodFillDespill(
    source,
    width,
    height,
    { x: 0, y: 0 },
    { r: 0, g: 0, b: 0, a: 0 },
    nextRandomByte() % 30,
    { referenceColor },
  );
  const restored = applyReferenceEdgeColorRestore(
    source,
    width,
    height,
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
    { tolerance: nextRandomByte() % 101 },
  );
  const selection = selectProtectedColorsInRectangle(
    source,
    width,
    height,
    { x1: 0, y1: 0, x2: width - 1, y2: height - 1 },
    { maximumSamples: 64, maximumColors: 8, previewData: replaced },
  );
  assert.equal(replaced.length, source.length);
  assert.equal(flooded.length, source.length);
  assert.equal(restored.length, source.length);
  assert.ok(Array.isArray(selection.colors));
  assert.deepEqual(source, original);
}
assert.ok(perceptualColorDistance(210, 100, 70, { r: 200, g: 90, b: 60 }) < 15);
assert.ok(perceptualColorDistance(30, 180, 40, { r: 200, g: 90, b: 60 }) > 30);
const seedCandidates = new Uint8Array([1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0]);
assert.deepEqual(
  [...connectedCandidateMask(seedCandidates, 5, 3, { seeds: [{ x: 4, y: 0 }] })],
  [0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
);
const referenceDiffusionPixels = new Uint8ClampedArray(5 * 3 * 4);
for (let pixel = 0; pixel < 15; pixel += 1) {
  referenceDiffusionPixels[pixel * 4] = 255;
  referenceDiffusionPixels[pixel * 4 + 3] = 255;
}
for (const pixel of [0, 1, 5, 6, 3, 4, 8, 9]) {
  referenceDiffusionPixels[pixel * 4] = 20;
  referenceDiffusionPixels[pixel * 4 + 1] = 40;
  referenceDiffusionPixels[pixel * 4 + 2] = 60;
}
const referenceConnectedDiffusion = diffuseReferenceCandidateMask(
  referenceDiffusionPixels,
  5,
  3,
  { x: 0, y: 0 },
  { r: 20, g: 40, b: 60 },
  0,
);
assert.deepEqual([...referenceConnectedDiffusion], [255, 255, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
assert.equal(
  diffuseReferenceCandidateMask(
    referenceDiffusionPixels,
    5,
    3,
    { x: 0, y: 0 },
    { r: 20, g: 40, b: 60 },
    0,
    3,
  ),
  null,
);
const referenceGlobalDiffusion = diffuseReferenceGlobalCandidateMask(
  referenceDiffusionPixels,
  5,
  3,
  { r: 20, g: 40, b: 60 },
  0,
);
assert.equal(
  referenceGlobalDiffusion.reduce((sum, value) => sum + (value !== 0), 0),
  8,
);
const referenceFloodFill = applyReferenceFloodFillDespill(
  referenceDiffusionPixels,
  5,
  3,
  { x: 0, y: 0 },
  { r: 0, g: 0, b: 0, a: 0 },
  0,
);
assert.deepEqual([...referenceFloodFill.slice(0, 8)], [0, 0, 0, 0, 0, 0, 0, 0]);
assert.deepEqual([...referenceFloodFill.slice(3 * 4, 4 * 4)], [20, 40, 60, 255]);
const maskedReferenceFloodFill = applyReferenceFloodFillDespill(
  referenceDiffusionPixels,
  5,
  3,
  { x: 0, y: 0 },
  { r: 0, g: 0, b: 0, a: 0 },
  0,
  { mask: Uint8Array.from([255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) },
);
assert.deepEqual([...maskedReferenceFloodFill.slice(0, 8)], [0, 0, 0, 0, 20, 40, 60, 255]);
const edgeRestoreFixture = Uint8ClampedArray.from([
  0, 255, 0, 255, 0, 255, 0, 255, 30, 220, 30, 220, 80, 160, 80, 255, 200, 50, 50, 255,
]);
const restoredReferenceFloodFill = applyReferenceFloodFillDespill(
  edgeRestoreFixture,
  5,
  1,
  { x: 0, y: 0 },
  { r: 0, g: 0, b: 0, a: 0 },
  0,
  { edgeRestoreRadius: 1, edgeRestoreMode: 1 },
);
assert.deepEqual(
  [...restoredReferenceFloodFill],
  [0, 0, 0, 0, 0, 0, 0, 0, 30, 2, 30, 38, 80, 160, 80, 255, 200, 50, 50, 255],
);
/** Public-client byte fixtures for all non-zero-radius edge branches. */
const edgeRestoreExpectedPixels = {
  "1:2": [124, 154, 124, 4, 80, 160, 80, 255, 200, 50, 50, 255],
  "2:1": [30, 2, 30, 38, 80, 24, 80, 211, 200, 50, 50, 255],
  "2:2": [124, 154, 124, 4, 94, 150, 94, 179, 200, 50, 50, 255],
  "3:1": [30, 2, 30, 38, 80, 24, 80, 197, 200, 48, 50, 254],
  "3:2": [124, 154, 124, 4, 99, 147, 99, 154, 194, 53, 53, 255],
};
for (const [fixtureKey, expectedPixels] of Object.entries(edgeRestoreExpectedPixels)) {
  const [edgeRestoreRadius, edgeRestoreMode] = fixtureKey.split(":").map(Number);
  const restored = applyReferenceFloodFillDespill(
    edgeRestoreFixture,
    5,
    1,
    { x: 0, y: 0 },
    { r: 0, g: 0, b: 0, a: 0 },
    0,
    { edgeRestoreRadius, edgeRestoreMode },
  );
  assert.deepEqual([...restored.slice(8)], expectedPixels);
}
const edgeRestoreTwoDimensionalFixture = Uint8ClampedArray.from([
  0, 255, 0, 255, 0, 255, 0, 255, 40, 210, 40, 220, 0, 255, 0, 255, 20, 230, 20, 240, 90, 140, 90, 255, 50,
  190, 50, 210, 120, 100, 120, 255, 220, 30, 40, 255,
]);
assert.deepEqual(
  [
    ...applyReferenceFloodFillDespill(
      edgeRestoreTwoDimensionalFixture,
      3,
      3,
      { x: 0, y: 0 },
      { r: 0, g: 0, b: 0, a: 0 },
      0,
      { edgeRestoreRadius: 3, edgeRestoreMode: 2 },
    ),
  ],
  [
    0, 0, 0, 0, 0, 0, 0, 0, 120, 154, 120, 15, 0, 0, 0, 0, 130, 153, 130, 13, 100, 133, 100, 255, 109, 149,
    109, 27, 117, 102, 117, 255, 215, 32, 42, 255,
  ],
);
const edgeRestoreModeZeroFixture = Uint8ClampedArray.from([
  10, 200, 30, 255, 10, 200, 30, 255, 30, 180, 50, 220, 60, 150, 70, 255, 200, 30, 50, 255,
]);
assert.deepEqual(
  [
    ...applyReferenceFloodFillDespill(
      edgeRestoreModeZeroFixture,
      5,
      1,
      { x: 0, y: 0 },
      { r: 200, g: 10, b: 80, a: 100 },
      5,
      { edgeRestoreRadius: 3, edgeRestoreMode: 0 },
    ),
  ],
  [200, 10, 80, 100, 200, 10, 80, 100, 112, 98, 71, 153, 60, 150, 70, 255, 200, 30, 50, 255],
);
const colorReplaceFixture = Uint8ClampedArray.from([
  20, 40, 60, 255, 20, 40, 60, 255, 255, 0, 0, 255, 20, 40, 60, 255, 25, 45, 65, 255,
]);
assert.deepEqual(
  [...applyReferenceColorReplace(colorReplaceFixture, 5, 1, { x: 0, y: 0 }, { r: 1, g: 2, b: 3, a: 4 }, 2)],
  [1, 2, 3, 4, 1, 2, 3, 4, 255, 0, 0, 255, 1, 2, 3, 4, 1, 2, 3, 4],
);
const edgeEnhancementConnectivityFixture = Uint8ClampedArray.from([
  120, 100, 100, 255,
  120, 100, 100, 255,
  200, 200, 200, 255,
  100, 100, 100, 255,
]);
assert.deepEqual(
  [
    ...applyReferenceColorReplace(
      edgeEnhancementConnectivityFixture,
      4,
      1,
      { x: 3, y: 0 },
      { r: 0, g: 0, b: 0, a: 0 },
      1,
      { referenceColor: { r: 100, g: 100, b: 100, a: 255 }, edgeEnhance: 5 },
    ),
  ],
  [
    120, 100, 100, 255,
    120, 100, 100, 255,
    200, 200, 200, 255,
    0, 0, 0, 0,
  ],
);
const edgeEnhancementExpansionFixture = Uint8ClampedArray.from([
  100, 100, 100, 255,
  120, 100, 100, 255,
]);
assert.deepEqual(
  [
    ...applyReferenceColorReplace(
      edgeEnhancementExpansionFixture,
      2,
      1,
      { x: 0, y: 0 },
      { r: 0, g: 0, b: 0, a: 0 },
      1,
      { referenceColor: { r: 100, g: 100, b: 100, a: 255 }, edgeEnhance: 5 },
    ),
  ],
  [0, 0, 0, 0, 0, 0, 0, 0],
);
const colorReplaceBlendFixture = Uint8ClampedArray.from([
  20, 40, 60, 255, 20, 40, 60, 128, 100, 120, 140, 255,
]);
/** Public-client byte fixtures for modes 0/1/2/3 at representative strengths. */
const colorReplaceBlendExpected = {
  "25:0": [200, 100, 50, 128, 66, 26, 11, 96, 131, 111, 107, 241],
  "25:1": [200, 100, 50, 128, 82, 53, 59, 225, 129, 130, 146, 225],
  "25:2": [200, 100, 50, 128, 71, 36, 33, 96, 131, 116, 119, 234],
  "25:3": [200, 100, 50, 128, 66, 26, 11, 96, 131, 111, 107, 241],
  "50:0": [200, 100, 50, 128, 85, 20, 0, 65, 143, 107, 94, 227],
  "50:1": [200, 100, 50, 128, 119, 66, 57, 195, 158, 143, 154, 195],
  "50:2": [200, 100, 50, 128, 97, 40, 29, 65, 147, 117, 113, 214],
  "75:2": [200, 100, 50, 128, 120, 47, 28, 33, 163, 121, 111, 193],
  "100:2": [200, 100, 50, 128, 142, 55, 26, 1, 180, 126, 113, 173],
};
for (const [fixtureKey, expectedPixels] of Object.entries(colorReplaceBlendExpected)) {
  const [blendStrength, despillMode] = fixtureKey.split(":").map(Number);
  assert.deepEqual(
    [
      ...applyReferenceColorReplace(
        colorReplaceBlendFixture,
        3,
        1,
        { x: 0, y: 0 },
        { r: 200, g: 100, b: 50, a: 128 },
        0,
        { blendStrength, despillMode },
      ),
    ],
    expectedPixels,
  );
}
const colorReplacePipelineFixture = Uint8ClampedArray.from([
  20, 40, 60, 255, 20, 40, 60, 128, 100, 120, 140, 255, 30, 220, 30, 220, 80, 160, 80, 255, 200, 50, 50, 255,
]);
assert.deepEqual(
  [
    ...applyReferenceColorReplace(
      colorReplacePipelineFixture,
      6,
      1,
      { x: 0, y: 0 },
      { r: 200, g: 100, b: 50, a: 128 },
      0,
      {
        alphaThresholdHigh: 200,
        alphaThresholdLow: 20,
        blendStrength: 50,
        despillMode: 2,
        despillRefColor: { r: 0, g: 255, b: 0 },
        despillStrength: 35,
        edgeRestoreMode: 2,
        edgeRestoreRadius: 2,
      },
    ),
  ],
  [
    200, 100, 50, 128, 112, 12, 0, 128, 148, 106, 91, 203, 145, 156, 64, 179, 125, 127, 84, 255, 200, 50, 50,
    255,
  ],
);
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
  20, 40, 60, 255, 20, 40, 60, 128, 100, 120, 140, 255, 30, 220, 30, 220, 80, 160, 80, 255, 200, 50, 50, 255,
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
  createReferenceProtectionMask(protectionFixture, 2, 2, { r: 0, g: 255, b: 0 }, [{ r: 200, g: 20, b: 20 }]),
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

function alphaShape(width, height, startX, startY, endX, endY) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) pixels[(y * width + x) * 4 + 3] = 255;
  }
  return pixels;
}
const sourceShape = createShapeDescriptor(alphaShape(20, 20, 4, 5, 11, 14), 20, 20);
const targetShape = createShapeDescriptor(alphaShape(20, 20, 7, 3, 14, 12), 20, 20);
assert.equal(compareShapeDescriptors(sourceShape, targetShape).accepted, true);
const mappedRectangle = mapRectangle({ x1: 4, y1: 5, x2: 7, y2: 8 }, sourceShape, targetShape);
assert.ok(mappedRectangle.x1 > 6 && mappedRectangle.y1 < 5);
const mappedBrushStroke = mapBrushStroke(
  {
    points: [
      { x: 4, y: 5 },
      { x: 7, y: 8 },
    ],
    size: 6,
  },
  sourceShape,
  targetShape,
);
assert.equal(mappedBrushStroke.points.length, 2);
assert.ok(mappedBrushStroke.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
assert.ok(mappedBrushStroke.points[0].x > 6 && mappedBrushStroke.points[0].y < 5);
assert.ok(mappedBrushStroke.size > 0);
const canvasRectangle = mapCanvasRectangle(
  { x1: 10, y1: 20, x2: 30, y2: 40 },
  { width: 100, height: 100 },
  { width: 200, height: 50 },
);
assert.deepEqual(canvasRectangle, { x1: 20, y1: 10, x2: 60, y2: 20 });
const canvasBrush = mapCanvasBrushStroke(
  { points: [{ x: 25, y: 50 }], size: 10 },
  { width: 100, height: 100 },
  { width: 200, height: 50 },
);
assert.deepEqual(canvasBrush.points, [{ x: 50, y: 25 }]);
assert.equal(canvasBrush.size, 10);
const localSource = new Uint8ClampedArray(80 * 60 * 4);
const localTarget = new Uint8ClampedArray(80 * 60 * 4);
/**
 * Paints a synthetic articulated local feature for anchor-tracking regression coverage.
 * @param {Uint8ClampedArray} pixels Mutable RGBA image.
 * @param {number} centerX Feature center X.
 * @param {number} centerY Feature center Y.
 * @returns {void}
 */
const paintLocalPattern = (pixels, centerX, centerY) => {
  for (let y = -7; y <= 7; y += 1) {
    for (let x = -7; x <= 7; x += 1) {
      if (Math.abs(x) <= 2 && Math.abs(y) <= 2) continue;
      if (Math.hypot(x, y) > 7) continue;
      const offset = ((centerY + y) * 80 + centerX + x) * 4;
      pixels[offset] = x < 0 ? 70 : 145;
      pixels[offset + 1] = y < 0 ? 115 : 180;
      pixels[offset + 2] = 55;
      pixels[offset + 3] = 255;
    }
  }
};
paintLocalPattern(localSource, 20, 32);
paintLocalPattern(localTarget, 47, 21);
const localAnchor = createLocalAnchor(localSource, 80, 60, { x: 20, y: 32 }, { radius: 9 });
const localMatch = trackLocalAnchor(
  localAnchor,
  localTarget,
  80,
  60,
  { x: 34, y: 28 },
  { searchRadius: 30 },
);
assert.equal(localMatch.matched, true);
assert.ok(Math.hypot(localMatch.point.x - 47, localMatch.point.y - 21) <= 1);
const enclosedPixels = new Uint8ClampedArray(20 * 20 * 4);
for (let index = 0; index < 20 * 20; index += 1) enclosedPixels[index * 4 + 3] = 255;
for (let y = 8; y <= 10; y += 1) {
  for (let x = 8; x <= 10; x += 1) enclosedPixels[(y * 20 + x) * 4 + 3] = 0;
}
const enclosedRegion = measureConnectedRegion(
  enclosedPixels,
  20,
  20,
  { x: 9, y: 9 },
  { sourceColor: { r: 0, g: 0, b: 0, a: 0 }, tolerance: 18 },
);
const openRegion = measureConnectedRegion(
  new Uint8ClampedArray(20 * 20 * 4),
  20,
  20,
  { x: 9, y: 9 },
  { sourceColor: { r: 0, g: 0, b: 0, a: 0 }, tolerance: 18, maximumPixels: 100 },
);
assert.equal(enclosedRegion.count, 9);
assert.equal(enclosedRegion.touchesBoundary, false);
assert.equal(compareConnectedRegions(enclosedRegion, openRegion).accepted, false);
assert.equal(compareConnectedRegions(enclosedRegion, { ...enclosedRegion }).accepted, true);
const shiftedHolePixels = new Uint8ClampedArray(30 * 30 * 4);
for (let index = 0; index < 30 * 30; index += 1) shiftedHolePixels[index * 4 + 3] = 255;
for (let y = 12; y <= 15; y += 1) {
  for (let x = 18; x <= 21; x += 1) shiftedHolePixels[(y * 30 + x) * 4 + 3] = 0;
}
const shiftedHoleMatch = findMatchingTransparentRegion(
  shiftedHolePixels,
  30,
  30,
  enclosedRegion,
  { x: 17, y: 14 },
  { searchRadius: 20, tolerance: 18 },
);
assert.ok(shiftedHoleMatch);
assert.equal(shiftedHoleMatch.region.touchesBoundary, false);
assert.ok(shiftedHoleMatch.point.x >= 18 && shiftedHoleMatch.point.x <= 21);
assert.ok(shiftedHoleMatch.point.y >= 12 && shiftedHoleMatch.point.y <= 15);
const candidatePixels = new Uint8ClampedArray(30 * 20 * 4);
for (let y = 4; y <= 13; y += 1) {
  for (let x = 2; x <= 9; x += 1) candidatePixels[(y * 30 + x) * 4 + 3] = 255;
  for (let x = 18; x <= 25; x += 1) candidatePixels[(y * 30 + x) * 4 + 3] = 255;
}
const shapeCandidates = createShapeCandidates(candidatePixels, 30, 20);
assert.equal(shapeCandidates.length, 2);
const trackingState = createTrackingState(sourceShape);
advanceTrackingState(trackingState, targetShape);
advanceTrackingState(trackingState, createShapeDescriptor(alphaShape(20, 20, 9, 3, 16, 12), 20, 20));
assert.ok(predictTrackingCenter(trackingState).x > trackingState.lastSuccessCenter.x);
const trackedCandidate = selectTrackedCandidate(
  sourceShape,
  shapeCandidates,
  createTrackingState(createShapeDescriptor(alphaShape(30, 20, 2, 4, 9, 13), 30, 20)),
);
assert.ok(trackedCandidate);
assert.ok(trackedCandidate.candidate.center.x < 10);
const colorFixture = new Uint8ClampedArray(5 * 5 * 4);
for (let index = 0; index < 25; index += 1) {
  colorFixture[index * 4] = 10;
  colorFixture[index * 4 + 1] = 200;
  colorFixture[index * 4 + 2] = 10;
  colorFixture[index * 4 + 3] = 255;
}
const matchingOffset = (2 * 5 + 3) * 4;
colorFixture[matchingOffset] = 198;
colorFixture[matchingOffset + 1] = 22;
colorFixture[matchingOffset + 2] = 18;
assert.deepEqual(sampleMatchingColor(colorFixture, 5, 5, { r: 200, g: 20, b: 20 }, { x: 2, y: 2 }, 2), {
  r: 198,
  g: 22,
  b: 18,
});
const qualityPixels = alphaShape(10, 10, 2, 3, 7, 8);
qualityPixels[(3 * 10 + 2) * 4 + 3] = 128;
const qualityMetrics = createCutoutQualityMetrics(qualityPixels, 10, 10);
assert.ok(qualityMetrics);
assert.equal(qualityMetrics.visiblePixels, 36);
assert.ok(qualityMetrics.alphaArea > 35 && qualityMetrics.alphaArea < 36);
assert.ok(qualityMetrics.center.x > 4 && qualityMetrics.center.x < 5);
assert.equal(qualityMetrics.bounds.width, 6);
const structuralQualityPixels = alphaShape(12, 12, 2, 2, 9, 9);
for (let y = 4; y <= 7; y += 1) {
  for (let x = 4; x <= 7; x += 1) {
    structuralQualityPixels[(y * 12 + x) * 4 + 3] = 0;
  }
}
for (let y = 3; y <= 7; y += 1) {
  for (let x = 11; x <= 11; x += 1) {
    structuralQualityPixels[(y * 12 + x) * 4 + 3] = 255;
  }
}
const transparentRgbOffset = (2 * 12 + 1) * 4;
structuralQualityPixels[transparentRgbOffset] = 0;
structuralQualityPixels[transparentRgbOffset + 1] = 255;
structuralQualityPixels[transparentRgbOffset + 2] = 0;
const structuralQualityMetrics = createCutoutQualityMetrics(structuralQualityPixels, 12, 12, {
  backgroundColors: [{ r: 0, g: 255, b: 0 }],
  backgroundTolerance: 2,
});
assert.equal(structuralQualityMetrics.componentCount, 2);
assert.ok(structuralQualityMetrics.secondaryComponentRatio > 0.08);
assert.ok(structuralQualityMetrics.holePixels >= 16);
assert.ok(structuralQualityMetrics.clippedEdgeRatio > 0);
assert.ok(structuralQualityMetrics.transparentRgbRatio > 0);
const structuralQualityAnalysis = analyzeCutoutQualitySequence([structuralQualityMetrics], {
  clippedEdgeRatio: 0,
  transparentRgbRatio: 0,
});
assert.deepEqual(structuralQualityAnalysis[0].codes, ["split", "holes", "clipped", "transparent-rgb"]);
const stableQuality = {
  alphaArea: 100,
  center: { x: 20, y: 20 },
  softEdgeRatio: 0.12,
};
const qualityAnalysis = analyzeCutoutQualitySequence([
  stableQuality,
  { alphaArea: 20, center: { x: 40, y: 20 }, softEdgeRatio: 0.8 },
  stableQuality,
  null,
]);
assert.equal(qualityAnalysis[0].severity, "ok");
assert.deepEqual(qualityAnalysis[1].codes, ["area", "position", "soft-edge"]);
assert.equal(qualityAnalysis[1].severity, "critical");
assert.equal(qualityAnalysis[3].severity, "pending");
assert.deepEqual(
  analyzeCutoutQualitySequence([
    stableQuality,
    { alphaArea: 0, center: null, softEdgeRatio: 0 },
    stableQuality,
  ])[1].codes,
  ["empty"],
);
const seamQuality = analyzeCutoutQualitySequence([
  { ...stableQuality, center: { x: 60, y: 20 } },
  stableQuality,
  stableQuality,
  stableQuality,
]);
assert.ok(seamQuality[0].codes.includes("position"));

function signatureFixture(subjectColor) {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let index = 0; index < 8 * 8; index += 1) {
    const offset = index * 4;
    pixels[offset] = 10;
    pixels[offset + 1] = 100;
    pixels[offset + 2] = 40;
    pixels[offset + 3] = 255;
  }
  for (let y = 2; y <= 5; y += 1) {
    for (let x = 2; x <= 5; x += 1) {
      const offset = (y * 8 + x) * 4;
      pixels[offset] = subjectColor[0];
      pixels[offset + 1] = subjectColor[1];
      pixels[offset + 2] = subjectColor[2];
    }
  }
  return createSignature(pixels, 8, 8, 4);
}
const darkSignature = signatureFixture([20, 20, 20]);
const repeatedDarkSignature = signatureFixture([20, 20, 20]);
const lightSignature = signatureFixture([240, 240, 240]);
const colorSignature = signatureFixture([150, 50, 210]);
assert.equal(signatureSimilarity(darkSignature, repeatedDarkSignature), 100);
assert.ok(signatureSimilarity(darkSignature, lightSignature) < 90);
assert.deepEqual(
  findDuplicateFrames([darkSignature, repeatedDarkSignature, lightSignature], 95).map((entry) => entry.index),
  [1],
);
assert.deepEqual(
  findJumpFrames([darkSignature, lightSignature, repeatedDarkSignature], 90).map((entry) => entry.index),
  [1],
);
assert.equal(
  analyzeDuplicateFrames([darkSignature, repeatedDarkSignature, lightSignature], 95).autoAdjustedThreshold,
  null,
);
assert.ok(analyzeJumpFrames([darkSignature, lightSignature, repeatedDarkSignature], 90).matches[0].score > 0);
const loopCandidates = findLoopCandidates(
  [
    darkSignature,
    lightSignature,
    colorSignature,
    darkSignature,
    lightSignature,
    colorSignature,
    darkSignature,
  ],
  { minPeriod: 2, maxPeriod: 4, preference: "auto" },
);
assert.equal(loopCandidates[0].period, 3);
assert.ok(loopCandidates[0].smoothness >= 0 && loopCandidates[0].smoothness <= 1);
const syntheticSignature = (color) => {
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ].forEach(([x, y]) => {
    pixels.set([...color, 255], (y * 4 + x) * 4);
  });
  return createSignature(pixels, 4, 4);
};
const phaseA = syntheticSignature([255, 0, 0]);
const phaseB = syntheticSignature([0, 255, 0]);
const phaseC = syntheticSignature([0, 0, 255]);
const phaseD = syntheticSignature([255, 255, 0]);
const specifiedStartCandidates = findLoopCandidates(
  [phaseA, phaseB, phaseC, phaseA, phaseB, phaseC, phaseA],
  { minPeriod: 2, maxPeriod: 4, startFrame: 3 },
);
assert.ok(specifiedStartCandidates.every((candidate) => candidate.start >= 3));
const nestedLoopSequence = [
  phaseA,
  phaseB,
  phaseC,
  phaseD,
  phaseA,
  phaseB,
  phaseC,
  phaseD,
  phaseA,
  phaseA,
  phaseB,
  phaseC,
  phaseA,
  phaseB,
  phaseC,
  phaseA,
];
assert.equal(
  findLoopCandidates(nestedLoopSequence, {
    minPeriod: 2,
    maxPeriod: 10,
    preference: "auto",
  })[0].period,
  9,
);
assert.equal(
  findLoopCandidates(nestedLoopSequence, {
    minPeriod: 2,
    maxPeriod: 10,
    preference: "long",
  })[0].period,
  9,
);

const indexedSource = {
  "hero/run:0": { offset: { x: 1 } },
  "hero/run:1": { offset: { x: 2 } },
  "hero/run:__group": { fps: 12 },
  "hero/idle:0": { offset: { x: 3 } },
};
const remappedIndexed = remapIndexedDictionary(indexedSource, "hero/run:", [
  { sourceIndex: 1 },
  { sourceIndex: 0 },
]);
assert.equal(remappedIndexed["hero/run:0"].offset.x, 2);
assert.equal(remappedIndexed["hero/run:1"].offset.x, 1);
assert.equal(remappedIndexed["hero/run:__group"].fps, 12);
assert.equal(remappedIndexed["hero/idle:0"].offset.x, 3);
assert.equal(mirrorBoxes({ hitbox: { offset: { x: 8, y: 2 }, rotation: 15 } }).hitbox.offset.x, -8);
const remappedAudio = remapBindings(
  [
    {
      key: "demo:player:hero:animation:hero/run:source:1",
      metadata: { profileId: "hero", animation: "hero/run", frame: 1, displayFrame: 1 },
      path: "res://hit.wav",
    },
  ],
  "hero/run",
  [{ sourceIndex: 1 }],
);
assert.equal(remappedAudio[0].metadata.frame, 0);
assert.match(remappedAudio[0].key, /:0$/);

const importTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-import-animation-test-"));
try {
  const importStore = createProjectStore(importTestRoot);
  const importRegistry = importStore.addProject({ label: "Browser Import" });
  const importProject = importStore.resolveProject(importRegistry, importRegistry.activeProjectId);
  const pixelPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3j2GJwAAAABJRU5ErkJggg==";
  const imported = importAnimation({
    root: importTestRoot,
    projectStore: importStore,
    project: importProject,
    profileId: "hero",
    profileLabel: "Hero",
    animationId: "idle",
    animationName: "Idle",
    fps: 12,
    items: [{ data: pixelPng, name: "idle.png" }],
  });
  assert.equal(imported.frameCount, 1);
  assert.equal(imported.manifest.profiles[0].animations[0].id, "idle");
  assert.equal(fs.existsSync(path.join(imported.targetDir, "frame_0001.png")), true);
  assert.throws(
    () =>
      importAnimation({
        root: importTestRoot,
        projectStore: importStore,
        project: importProject,
        profileId: "hero",
        animationId: "idle",
        items: [{ data: pixelPng }],
      }),
    /already exists/,
  );
} finally {
  fs.rmSync(importTestRoot, { recursive: true, force: true });
}

const corruptJsonTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-corrupt-json-test-"));
try {
  const corruptStore = createProjectStore(corruptJsonTestRoot);
  const corruptPath = path.join(corruptJsonTestRoot, "broken.json");
  fs.writeFileSync(corruptPath, '{"broken":', "utf8");
  assert.throws(() => corruptStore.readJson(corruptPath, {}), /Invalid JSON/);
  const backups = fs
    .readdirSync(corruptJsonTestRoot)
    .filter((name) => name.startsWith("broken.json.corrupt-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(corruptJsonTestRoot, backups[0]), "utf8"), '{"broken":');
} finally {
  fs.rmSync(corruptJsonTestRoot, { recursive: true, force: true });
}

const parsed = parseBatchArgs([
  "--project-root",
  "C:\\game",
  "--project",
  "demo",
  "--profile",
  "hero",
  "--fps",
  "12",
  "--replace",
  "--animation",
  "idle",
  "--source",
  "C:\\frames\\idle",
  "--animation",
  "站立攻击",
  "--source",
  "C:\\frames\\attack",
  "--fps",
  "18",
]);
assert.equal(parsed.globals.project, "demo");
assert.equal(parsed.globals.profile, "hero");
assert.equal(parsed.globals.replace, true);
assert.equal(parsed.entries.length, 2);
assert.equal(parsed.entries[0].animation, "idle");
assert.equal(parsed.entries[1].fps, "18");

const source = runtimeScript("demo");
assert.match(source, /frame_audio_bindings\.json/);
assert.match(source, /frame_image_attachments\.json/);
assert.match(source, /func animation_duration\(/);
assert.match(source, /func scene_scale\(/);
assert.match(source, /_character_scale\(\) \* scene_scale\(\)/);
assert.match(source, /size\.x\) \* sprite_scale_x/);
assert.match(source, /size\.y\) \* sprite_scale_y/);
assert.match(source, /func restart_frame_animation\(/);

assert.equal(trustedRemote("https://github.com/sparklecatta-lang/XSXB-Frame-Tuner.git"), true);
assert.equal(trustedRemote("git@github.com:sparklecatta-lang/XSXB-Frame-Tuner.git"), true);
assert.equal(trustedRemote("https://github.com/example/XSXB-Frame-Tuner.git"), false);
assert.equal(trustedRemote("https://evilgithub.com/sparklecatta-lang/XSXB-Frame-Tuner.git"), false);
const candidates = candidateSkillTargets({ USERPROFILE: "C:\\Users\\demo" }, "C:\\Users\\fallback");
assert.equal(candidates[0], path.resolve("C:\\Users\\demo", ".codex", "skills", "xsxb-frame-tuner"));
const customCandidates = candidateSkillTargets(
  { CODEX_HOME: "D:\\Codex", USERPROFILE: "C:\\Users\\demo" },
  "C:\\Users\\fallback",
);
assert.equal(customCandidates[0], path.resolve("D:\\Codex", "skills", "xsxb-frame-tuner"));
assert.equal(
  resolveSkillTarget({ CODEX_HOME: "D:\\Codex", USERPROFILE: "C:\\Users\\demo" }),
  customCandidates[0],
);

const updateTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-updater-test-"));
try {
  const skillSource = path.join(updateTestRoot, "source");
  const skillTarget = path.join(updateTestRoot, "target", "xsxb-frame-tuner");
  fs.mkdirSync(skillSource, { recursive: true });
  fs.mkdirSync(skillTarget, { recursive: true });
  fs.writeFileSync(path.join(skillSource, "SKILL.md"), "new skill\n", "utf8");
  fs.writeFileSync(path.join(skillSource, "reference.md"), "new reference\n", "utf8");
  fs.writeFileSync(path.join(skillTarget, "SKILL.md"), "old skill\n", "utf8");
  fs.writeFileSync(path.join(skillTarget, "stale.md"), "stale\n", "utf8");
  const synced = syncSkillDirectory(skillSource, skillTarget);
  assert.equal(synced.changed, true);
  assert.equal(fs.readFileSync(path.join(skillTarget, "SKILL.md"), "utf8"), "new skill\n");
  assert.equal(fs.existsSync(path.join(skillTarget, "reference.md")), true);
  assert.equal(fs.existsSync(path.join(skillTarget, "stale.md")), false);
} finally {
  fs.rmSync(updateTestRoot, { recursive: true, force: true });
}

assert.equal(crc32(new TextEncoder().encode("abc")), 0x352441c2);
const goldenPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3j2GJwAAAABJRU5ErkJggg==";
const goldenOutputNames = new Map();
const goldenOutputs = Array.from({ length: 20 }, (_unused, index) =>
  createOutput({
    name: uniquePngName(index < 2 ? "frame.png" : `frame_${index + 1}.png`, goldenOutputNames),
    frame: { path: `frames/frame_${String(index + 1).padStart(4, "0")}.png` },
    data: goldenPngDataUrl,
    canvas: { corpusIndex: index },
  }),
);
assert.equal(goldenOutputs[0].name, "frame.png");
assert.equal(goldenOutputs[1].name, "frame_2.png");
assert.equal(Object.isFrozen(goldenOutputs[0]), true);
const collidingOutputNames = new Map();
assert.equal(uniquePngName("frame.png", collidingOutputNames), "frame.png");
assert.equal(uniquePngName("frame.png", collidingOutputNames), "frame_2.png");
assert.equal(uniquePngName("frame_2.png", collidingOutputNames), "frame_2_2.png");
assert.equal(uniquePngName("frame.png", collidingOutputNames), "frame_3.png");
const goldenManifestJson = JSON.stringify({ schemaVersion: 1, frames: goldenOutputs.length });
const goldenArchiveEntries = createArchiveEntries(goldenOutputs, goldenManifestJson);
const goldenReplacementPayload = createAnimationReplacementPayload(
  "golden-project",
  goldenOutputs.map((output) => output.frame),
  goldenOutputs,
);
assert.equal(goldenArchiveEntries.length, 21);
assert.equal(goldenReplacementPayload.files.length, 20);
for (let index = 0; index < goldenOutputs.length; index += 1) {
  assert.equal(goldenArchiveEntries[index].data, goldenOutputs[index].data);
  assert.equal(goldenReplacementPayload.files[index].data, goldenOutputs[index].data);
  assert.equal(goldenReplacementPayload.frames[index].path, goldenOutputs[index].frame.path);
}
assert.throws(
  () => createAnimationReplacementPayload("golden-project", [{ path: "one.png" }], []),
  /Expected 1 processed frames, received 0/,
);

/**
 * Verifies that the local HTTP server rejects unsafe or oversized writes.
 * @returns {Promise<void>}
 */
async function runServerBoundaryTests() {
  const port = 20000 + (process.pid % 20000);
  const child = spawn(process.execPath, ["tools/animation_tuner/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Test server startup timed out.")), 5000);
      const onData = (chunk) => {
        if (!String(chunk).includes("XSXB Frame Tuner running")) return;
        clearTimeout(timer);
        resolve();
      };
      child.stdout.on("data", onData);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Test server exited early with code ${code}.`));
      });
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const wrongOrigin = await fetch(`${baseUrl}/api/projects/active`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
      },
      body: "{}",
    });
    assert.equal(wrongOrigin.status, 403);
    const wrongType = await fetch(`${baseUrl}/api/projects/active`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    assert.equal(wrongType.status, 415);
    const oversized = await fetch(`${baseUrl}/api/projects/active`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024 + 1024) }),
    });
    assert.equal(oversized.status, 413);
    const oversizedMediaStatus = await new Promise((resolve, reject) => {
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/replace-animation",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(96 * 1024 * 1024 + 1),
          },
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        },
      );
      request.once("error", reject);
      request.end();
    });
    assert.equal(oversizedMediaStatus, 413);
  } finally {
    child.kill("SIGTERM");
  }
}

/**
 * Verifies ordered 20-frame replacement and rollback in an isolated workspace.
 * @returns {Promise<void>}
 */
async function runAnimationReplacementIntegrationTests() {
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-replace-animation-test-"));
  const port = 40000 + (process.pid % 10000);
  const store = createProjectStore(isolatedRoot);
  const godotRoot = path.join(isolatedRoot, "godot-project");
  fs.mkdirSync(godotRoot, { recursive: true });
  const registry = store.addProject({
    id: "golden-replacement",
    label: "Golden Replacement",
    projectRoot: godotRoot,
  });
  const project = store.resolveProject(registry, registry.activeProjectId);
  const workspaceDir = store.projectWorkspaceDir(project);
  const frameDir = path.join(workspaceDir, "frames");
  fs.mkdirSync(frameDir, { recursive: true });
  const basePng = Buffer.from(goldenPngDataUrl.split(",")[1], "base64");
  const frames = [];
  const originals = [];
  const replacements = [];
  for (let index = 0; index < 20; index += 1) {
    const fileName = `frame_${String(index + 1).padStart(4, "0")}.png`;
    const fullPath = path.join(frameDir, fileName);
    const original = Buffer.concat([basePng, Buffer.from(`original-${index}`)]);
    const replacement = Buffer.concat([basePng, Buffer.from(`replacement-${index}`)]);
    fs.writeFileSync(fullPath, original);
    frames.push({ path: path.relative(isolatedRoot, fullPath).replaceAll("\\", "/") });
    originals.push(original);
    replacements.push(replacement);
  }
  const child = spawn(process.execPath, ["tools/animation_tuner/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      XSXB_ROOT: isolatedRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Replacement test server startup timed out.")), 5000);
      child.stdout.on("data", (chunk) => {
        if (!String(chunk).includes("XSXB Frame Tuner running")) return;
        clearTimeout(timer);
        resolve();
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Replacement test server exited early with code ${code}.`));
      });
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const invalidFiles = replacements.map((bytes) => ({
      data: `data:image/png;base64,${bytes.toString("base64")}`,
    }));
    invalidFiles[10] = { data: "data:image/png;base64,bm90LXBuZw==" };
    const failedResponse = await fetch(`${baseUrl}/api/replace-animation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        frames,
        files: invalidFiles,
      }),
    });
    assert.equal(failedResponse.status, 500);
    for (let index = 0; index < frames.length; index += 1) {
      assert.deepEqual(fs.readFileSync(path.join(isolatedRoot, frames[index].path)), originals[index]);
    }
    const godotSyncBlocker = path.join(godotRoot, "xsxb_frame_tuner");
    fs.writeFileSync(godotSyncBlocker, "block Godot sync directory creation", "utf8");
    const syncFailureResponse = await fetch(`${baseUrl}/api/replace-animation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        frames,
        files: replacements.map((bytes) => ({
          data: `data:image/png;base64,${bytes.toString("base64")}`,
        })),
      }),
    });
    assert.equal(syncFailureResponse.status, 500);
    for (let index = 0; index < frames.length; index += 1) {
      assert.deepEqual(fs.readFileSync(path.join(isolatedRoot, frames[index].path)), originals[index]);
    }
    fs.rmSync(godotSyncBlocker, { force: true });
    const validResponse = await fetch(`${baseUrl}/api/replace-animation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        frames,
        files: replacements.map((bytes) => ({
          data: `data:image/png;base64,${bytes.toString("base64")}`,
        })),
      }),
    });
    assert.equal(validResponse.status, 200);
    const responseBody = await validResponse.json();
    assert.equal(responseBody.frames.length, 20);
    for (let index = 0; index < frames.length; index += 1) {
      assert.deepEqual(fs.readFileSync(path.join(isolatedRoot, frames[index].path)), replacements[index]);
      assert.equal(responseBody.frames[index].path, frames[index].path);
      assert.equal(responseBody.frames[index].width, 1);
      assert.equal(responseBody.frames[index].height, 1);
    }
    const duplicateResponse = await fetch(`${baseUrl}/api/replace-animation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        frames: [frames[0], frames[0]],
        files: replacements.slice(0, 2).map((bytes) => ({
          data: `data:image/png;base64,${bytes.toString("base64")}`,
        })),
      }),
    });
    assert.equal(duplicateResponse.status, 500);
  } finally {
    child.kill("SIGTERM");
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

buildZip(
  [
    { name: "frame_0001.png", data: new Uint8Array([1, 2, 3, 4]) },
    { name: "中文.png", data: new Uint8Array([5, 6, 7]) },
    { name: "cutout-manifest.json", data: '{"frames":2}' },
  ],
  { compress: false },
)
  .then(async (archive) => {
    const fallbackExecutor = createCutoutExecutor({
      WorkerConstructor: null,
      syncProcess(source) {
        return {
          data: new Uint8ClampedArray(source),
          automaticData: new Uint8ClampedArray(source),
          removedPixels: 0,
          partialPixels: 0,
        };
      },
    });
    const fallbackSource = Uint8ClampedArray.from([20, 40, 60, 255]);
    const fallbackResult = await fallbackExecutor.process(fallbackSource, 1, 1, {}, []);
    assert.deepEqual(fallbackResult.data, fallbackSource);
    assert.deepEqual(fallbackSource, Uint8ClampedArray.from([20, 40, 60, 255]));
    const cancellableExecutor = createCutoutExecutor({
      WorkerConstructor: null,
      syncProcess: () => new Promise(() => {}),
    });
    const cancelledTask = cancellableExecutor.process(fallbackSource, 1, 1, {}, []);
    cancellableExecutor.cancelAll();
    await assert.rejects(cancelledTask, (error) => error?.name === "AbortError");
    const bytes = new Uint8Array(await archive.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(0, true), 0x04034b50);
    assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
    assert.equal(view.getUint16(bytes.length - 12, true), 3);
    const goldenArchive = await buildZip(goldenArchiveEntries, { compress: false });
    const goldenArchiveBytes = new Uint8Array(await goldenArchive.arrayBuffer());
    const goldenArchiveView = new DataView(
      goldenArchiveBytes.buffer,
      goldenArchiveBytes.byteOffset,
      goldenArchiveBytes.byteLength,
    );
    let localOffset = 0;
    for (let index = 0; index < goldenArchiveEntries.length; index += 1) {
      assert.equal(goldenArchiveView.getUint32(localOffset, true), 0x04034b50);
      const storedSize = goldenArchiveView.getUint32(localOffset + 18, true);
      const nameLength = goldenArchiveView.getUint16(localOffset + 26, true);
      const extraLength = goldenArchiveView.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + nameLength + extraLength;
      const storedBytes = goldenArchiveBytes.slice(dataOffset, dataOffset + storedSize);
      const expectedBytes = await toBytes(goldenArchiveEntries[index].data);
      assert.deepEqual([...storedBytes], [...expectedBytes]);
      localOffset = dataOffset + storedSize;
    }
    await runServerBoundaryTests();
    await runAnimationReplacementIntegrationTests();
    console.log("XSXB self-tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
