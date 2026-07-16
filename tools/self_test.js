const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { animationLooksAttack, hitboxEnabledByDefault } = require("./box_estimator");
const {
  applyCutout,
  applyReferenceChromaKey,
  applyReferenceColorReplace,
  applyReferenceDespillPixel,
  applyReferenceEdgeColorRestore,
  applyReferenceFloodFillDespill,
  chamfer345Distance,
  chamferDistanceToTransparent,
  connectedCandidateMask,
  diffuseReferenceCandidateMask,
  diffuseReferenceGlobalCandidateMask,
  estimateBackgroundColor,
  extractProtectedColors,
  hexToRgb,
  isWithinConnectivityTolerance,
  perceptualColorDistance,
  selectReferenceProtectedColors,
} = require("./animation_tuner/public/batch_cutout_core");
const { buildZip, crc32 } = require("./animation_tuner/public/batch_zip");
const {
  advanceTrackingState,
  analyzeCutoutQualitySequence,
  checkReferenceShapeMatch,
  compareShapeDescriptors,
  computeReferenceLocalFrame,
  createCutoutQualityMetrics,
  createShapeCandidates,
  createShapeDescriptor,
  createTrackingState,
  findReferenceNearestColorInRadius,
  mapRectangle,
  predictTrackingCenter,
  sampleMatchingColor,
  selectTrackedCandidate,
} = require("./animation_tuner/public/cutout_tracking_core");
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

const horizontalLocalFrame = computeReferenceLocalFrame(
  Uint8Array.from([
    0, 0, 0,
    1, 1, 1,
    0, 0, 0,
  ]),
  3,
  3,
);
assert.ok(horizontalLocalFrame);
assert.deepEqual(
  [horizontalLocalFrame.ux, horizontalLocalFrame.uy, horizontalLocalFrame.cx, horizontalLocalFrame.cy],
  [1, 0, 1, 1],
);
assert.equal(horizontalLocalFrame.majorLen, 2);
assert.equal(horizontalLocalFrame.minorLen, 0);
const isotropicLocalFrame = computeReferenceLocalFrame(
  Uint8Array.from([
    1, 1,
    1, 1,
  ]),
  2,
  2,
  { ux: 0, uy: -1 },
);
assert.ok(isotropicLocalFrame);
assert.equal(isotropicLocalFrame.isotropic, true);
assert.deepEqual(
  [isotropicLocalFrame.ux, isotropicLocalFrame.uy, isotropicLocalFrame.majorLen, isotropicLocalFrame.minorLen],
  [-0, -1, 1, 1],
);
assert.equal(computeReferenceLocalFrame(Uint8Array.of(1, 1), 2, 1), null);
const nearestColorFixture = Uint8ClampedArray.from([
  10, 0, 0, 0,
  100, 0, 0, 255,
  10, 0, 0, 255,
]);
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
  0, 0, 0, 0, 0, 0,
  0, 1, 1, 1, 1, 0,
  0, 1, 1, 1, 1, 0,
  0, 1, 1, 1, 1, 0,
  0, 0, 0, 0, 0, 0,
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
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 20, 40, 80, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
]);
const estimatedBackground = estimateBackgroundColor(cutoutPixels, 3, 3);
assert.equal(estimatedBackground.hex, "#ffffff");
const referenceDistance = chamfer345Distance(Uint8Array.from([
  1, 0, 0,
  0, 0, 0,
  0, 0, 0,
]), 3, 3);
assert.deepEqual([...referenceDistance], [0, 3, 6, 3, 4, 7, 6, 7, 8]);
assert.equal(isWithinConnectivityTolerance(Uint8Array.from([
  0, 0, 0,
  0, 1, 0,
  0, 0, 0,
]), referenceDistance, 3, 3), true);
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
const referenceDespill = Uint8ClampedArray.from([0, 220, 0, 255]);
applyReferenceDespillPixel(referenceDespill, 0, { r: 0, g: 255, b: 0 }, 0.7);
assert.deepEqual([...referenceDespill], [145, 198, 140, 255]);
const unrelatedDespillHue = Uint8ClampedArray.from([220, 30, 30, 255]);
applyReferenceDespillPixel(unrelatedDespillHue, 0, { r: 0, g: 255, b: 0 }, 0.7);
assert.deepEqual([...unrelatedDespillHue], [220, 30, 30, 255]);
const referenceChroma = applyReferenceChromaKey(
  Uint8ClampedArray.from([
    0, 255, 0, 255,
    30, 240, 30, 255,
    255, 0, 0, 255,
  ]),
  3,
  1,
  {
    backgroundColor: { r: 0, g: 255, b: 0 },
    cleanup: 40,
    feather: 30,
  },
);
assert.deepEqual([...referenceChroma], [
  0, 0, 0, 0,
  30, 240, 30, 40,
  255, 0, 0, 255,
]);
const referenceEdgeRestore = applyReferenceEdgeColorRestore(
  Uint8ClampedArray.from([
    128, 128, 128, 255,
    220, 220, 220, 255,
    240, 240, 240, 255,
  ]),
  3,
  1,
  { r: 0, g: 0, b: 0 },
  { r: 255, g: 255, b: 255 },
  { tolerance: 30 },
);
assert.deepEqual([...referenceEdgeRestore], [
  0, 0, 0, 255,
  119, 119, 119, 255,
  240, 240, 240, 255,
]);
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
  () => applyReferenceEdgeColorRestore(
    Uint8ClampedArray.from([128, 128, 128, 255]),
    1,
    1,
    { r: 100, g: 100, b: 100 },
    { r: 100, g: 100, b: 100 },
  ),
  RangeError,
);
assert.ok(perceptualColorDistance(210, 100, 70, { r: 200, g: 90, b: 60 }) < 15);
assert.ok(perceptualColorDistance(30, 180, 40, { r: 200, g: 90, b: 60 }) > 30);
const seedCandidates = new Uint8Array([
  1, 1, 0, 1, 1,
  1, 1, 0, 1, 1,
  0, 0, 0, 0, 0,
]);
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
assert.deepEqual([...referenceConnectedDiffusion], [
  255, 255, 0, 0, 0,
  255, 255, 0, 0, 0,
  0, 0, 0, 0, 0,
]);
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
assert.equal(referenceGlobalDiffusion.reduce((sum, value) => sum + (value !== 0), 0), 8);
const referenceFloodFill = applyReferenceFloodFillDespill(
  referenceDiffusionPixels,
  5,
  3,
  { x: 0, y: 0 },
  { r: 0, g: 0, b: 0, a: 0 },
  0,
);
assert.deepEqual([...referenceFloodFill.slice(0, 8)], [
  0, 0, 0, 0,
  0, 0, 0, 0,
]);
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
assert.deepEqual([...maskedReferenceFloodFill.slice(0, 8)], [
  0, 0, 0, 0,
  20, 40, 60, 255,
]);
const edgeRestoreFixture = Uint8ClampedArray.from([
  0, 255, 0, 255,
  0, 255, 0, 255,
  30, 220, 30, 220,
  80, 160, 80, 255,
  200, 50, 50, 255,
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
assert.deepEqual([...restoredReferenceFloodFill], [
  0, 0, 0, 0,
  0, 0, 0, 0,
  30, 2, 30, 38,
  80, 160, 80, 255,
  200, 50, 50, 255,
]);
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
  0, 255, 0, 255, 0, 255, 0, 255, 40, 210, 40, 220,
  0, 255, 0, 255, 20, 230, 20, 240, 90, 140, 90, 255,
  50, 190, 50, 210, 120, 100, 120, 255, 220, 30, 40, 255,
]);
assert.deepEqual(
  [...applyReferenceFloodFillDespill(
    edgeRestoreTwoDimensionalFixture,
    3,
    3,
    { x: 0, y: 0 },
    { r: 0, g: 0, b: 0, a: 0 },
    0,
    { edgeRestoreRadius: 3, edgeRestoreMode: 2 },
  )],
  [
    0, 0, 0, 0, 0, 0, 0, 0, 120, 154, 120, 15,
    0, 0, 0, 0, 130, 153, 130, 13, 100, 133, 100, 255,
    109, 149, 109, 27, 117, 102, 117, 255, 215, 32, 42, 255,
  ],
);
const edgeRestoreModeZeroFixture = Uint8ClampedArray.from([
  10, 200, 30, 255,
  10, 200, 30, 255,
  30, 180, 50, 220,
  60, 150, 70, 255,
  200, 30, 50, 255,
]);
assert.deepEqual(
  [...applyReferenceFloodFillDespill(
    edgeRestoreModeZeroFixture,
    5,
    1,
    { x: 0, y: 0 },
    { r: 200, g: 10, b: 80, a: 100 },
    5,
    { edgeRestoreRadius: 3, edgeRestoreMode: 0 },
  )],
  [
    200, 10, 80, 100,
    200, 10, 80, 100,
    112, 98, 71, 153,
    60, 150, 70, 255,
    200, 30, 50, 255,
  ],
);
const colorReplaceFixture = Uint8ClampedArray.from([
  20, 40, 60, 255,
  20, 40, 60, 255,
  255, 0, 0, 255,
  20, 40, 60, 255,
  25, 45, 65, 255,
]);
assert.deepEqual(
  [...applyReferenceColorReplace(
    colorReplaceFixture,
    5,
    1,
    { x: 0, y: 0 },
    { r: 1, g: 2, b: 3, a: 4 },
    2,
  )],
  [
    1, 2, 3, 4,
    1, 2, 3, 4,
    255, 0, 0, 255,
    1, 2, 3, 4,
    1, 2, 3, 4,
  ],
);
const colorReplaceBlendFixture = Uint8ClampedArray.from([
  20, 40, 60, 255,
  20, 40, 60, 128,
  100, 120, 140, 255,
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
    [...applyReferenceColorReplace(
      colorReplaceBlendFixture,
      3,
      1,
      { x: 0, y: 0 },
      { r: 200, g: 100, b: 50, a: 128 },
      0,
      { blendStrength, despillMode },
    )],
    expectedPixels,
  );
}
const colorReplacePipelineFixture = Uint8ClampedArray.from([
  20, 40, 60, 255, 20, 40, 60, 128, 100, 120, 140, 255,
  30, 220, 30, 220, 80, 160, 80, 255, 200, 50, 50, 255,
]);
assert.deepEqual(
  [...applyReferenceColorReplace(
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
  )],
  [
    200, 100, 50, 128,
    112, 12, 0, 128,
    148, 106, 91, 203,
    145, 156, 64, 179,
    125, 127, 84, 255,
    200, 50, 50, 255,
  ],
);
const distanceFixture = new Uint8ClampedArray([
  0, 0, 0, 0, 20, 20, 20, 255, 20, 20, 20, 255,
]);
assert.deepEqual([...chamferDistanceToTransparent(distanceFixture, 3, 1)], [0, 3, 6]);
const protectionFixture = new Uint8ClampedArray([
  200, 20, 20, 255, 202, 22, 20, 255,
  20, 200, 20, 255, 22, 202, 20, 255,
]);
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
    const color = group === 0
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
  new Uint8ClampedArray([
    200, 100, 70, 255, 200, 100, 70, 255,
    30, 170, 50, 255, 30, 170, 50, 255,
  ]),
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
const candidatePixels = new Uint8ClampedArray(30 * 20 * 4);
for (let y = 4; y <= 13; y += 1) {
  for (let x = 2; x <= 9; x += 1) candidatePixels[(y * 30 + x) * 4 + 3] = 255;
  for (let x = 18; x <= 25; x += 1) candidatePixels[(y * 30 + x) * 4 + 3] = 255;
}
const shapeCandidates = createShapeCandidates(candidatePixels, 30, 20);
assert.equal(shapeCandidates.length, 2);
const trackingState = createTrackingState(sourceShape);
advanceTrackingState(trackingState, targetShape);
advanceTrackingState(
  trackingState,
  createShapeDescriptor(alphaShape(20, 20, 9, 3, 16, 12), 20, 20),
);
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
assert.deepEqual(
  sampleMatchingColor(colorFixture, 5, 5, { r: 200, g: 20, b: 20 }, { x: 2, y: 2 }, 2),
  { r: 198, g: 22, b: 18 },
);
const qualityPixels = alphaShape(10, 10, 2, 3, 7, 8);
qualityPixels[(3 * 10 + 2) * 4 + 3] = 128;
const qualityMetrics = createCutoutQualityMetrics(qualityPixels, 10, 10);
assert.ok(qualityMetrics);
assert.equal(qualityMetrics.visiblePixels, 36);
assert.ok(qualityMetrics.alphaArea > 35 && qualityMetrics.alphaArea < 36);
assert.ok(qualityMetrics.center.x > 4 && qualityMetrics.center.x < 5);
assert.equal(qualityMetrics.bounds.width, 6);
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
assert.deepEqual(findDuplicateFrames([darkSignature, repeatedDarkSignature, lightSignature], 95).map((entry) => entry.index), [1]);
assert.deepEqual(findJumpFrames([darkSignature, lightSignature, repeatedDarkSignature], 90).map((entry) => entry.index), [1]);
assert.equal(analyzeDuplicateFrames([darkSignature, repeatedDarkSignature, lightSignature], 95).autoAdjustedThreshold, null);
assert.ok(analyzeJumpFrames([darkSignature, lightSignature, repeatedDarkSignature], 90).matches[0].score > 0);
const loopCandidates = findLoopCandidates([
  darkSignature,
  lightSignature,
  colorSignature,
  darkSignature,
  lightSignature,
  colorSignature,
  darkSignature,
], { minPeriod: 2, maxPeriod: 4, preference: "auto" });
assert.equal(loopCandidates[0].period, 3);
assert.ok(loopCandidates[0].smoothness >= 0 && loopCandidates[0].smoothness <= 1);
const syntheticSignature = (color) => {
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  [[1, 1], [2, 1], [1, 2], [2, 2]].forEach(([x, y]) => {
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
  phaseA, phaseB, phaseC, phaseD,
  phaseA, phaseB, phaseC, phaseD,
  phaseA, phaseA, phaseB, phaseC,
  phaseA, phaseB, phaseC, phaseA,
];
assert.equal(findLoopCandidates(nestedLoopSequence, {
  minPeriod: 2,
  maxPeriod: 10,
  preference: "auto",
})[0].period, 9);
assert.equal(findLoopCandidates(nestedLoopSequence, {
  minPeriod: 2,
  maxPeriod: 10,
  preference: "long",
})[0].period, 9);

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
const remappedAudio = remapBindings([{
  key: "demo:player:hero:animation:hero/run:source:1",
  metadata: { profileId: "hero", animation: "hero/run", frame: 1, displayFrame: 1 },
  path: "res://hit.wav",
}], "hero/run", [{ sourceIndex: 1 }]);
assert.equal(remappedAudio[0].metadata.frame, 0);
assert.match(remappedAudio[0].key, /:0$/);

const importTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-import-animation-test-"));
try {
  const importStore = createProjectStore(importTestRoot);
  const importRegistry = importStore.addProject({ label: "Browser Import" });
  const importProject = importStore.resolveProject(importRegistry, importRegistry.activeProjectId);
  const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3j2GJwAAAABJRU5ErkJggg==";
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
  assert.throws(() => importAnimation({
    root: importTestRoot,
    projectStore: importStore,
    project: importProject,
    profileId: "hero",
    animationId: "idle",
    items: [{ data: pixelPng }],
  }), /already exists/);
} finally {
  fs.rmSync(importTestRoot, { recursive: true, force: true });
}

const corruptJsonTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-corrupt-json-test-"));
try {
  const corruptStore = createProjectStore(corruptJsonTestRoot);
  const corruptPath = path.join(corruptJsonTestRoot, "broken.json");
  fs.writeFileSync(corruptPath, "{\"broken\":", "utf8");
  assert.throws(
    () => corruptStore.readJson(corruptPath, {}),
    /Invalid JSON/,
  );
  const backups = fs.readdirSync(corruptJsonTestRoot)
    .filter((name) => name.startsWith("broken.json.corrupt-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(corruptJsonTestRoot, backups[0]), "utf8"), "{\"broken\":");
} finally {
  fs.rmSync(corruptJsonTestRoot, { recursive: true, force: true });
}

const parsed = parseBatchArgs([
  "--project-root", "C:\\game",
  "--project", "demo",
  "--profile", "hero",
  "--fps", "12",
  "--replace",
  "--animation", "idle",
  "--source", "C:\\frames\\idle",
  "--animation", "站立攻击",
  "--source", "C:\\frames\\attack",
  "--fps", "18",
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
const customCandidates = candidateSkillTargets({ CODEX_HOME: "D:\\Codex", USERPROFILE: "C:\\Users\\demo" }, "C:\\Users\\fallback");
assert.equal(customCandidates[0], path.resolve("D:\\Codex", "skills", "xsxb-frame-tuner"));
assert.equal(resolveSkillTarget({ CODEX_HOME: "D:\\Codex", USERPROFILE: "C:\\Users\\demo" }), customCandidates[0]);

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
      body: JSON.stringify({ padding: "x".repeat((2 * 1024 * 1024) + 1024) }),
    });
    assert.equal(oversized.status, 413);
  } finally {
    child.kill("SIGTERM");
  }
}

buildZip([
  { name: "frame_0001.png", data: new Uint8Array([1, 2, 3, 4]) },
  { name: "中文.png", data: new Uint8Array([5, 6, 7]) },
  { name: "cutout-manifest.json", data: "{\"frames\":2}" },
], { compress: false }).then(async (archive) => {
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), 3);
  await runServerBoundaryTests();
  console.log("XSXB self-tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
