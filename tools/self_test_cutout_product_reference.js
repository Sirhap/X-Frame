"use strict";

/**
 * Runs reference-chroma, diffusion, edge-restore, and color-replace fixtures.
 * @param {object} dependencies Assertion API and reference cutout helpers.
 * @returns {void}
 */
function runCutoutProductReferenceTests(dependencies) {
  const {
    assert,
    applyReferenceDespillPixel,
    applyReferenceChromaKey,
    applyReferenceEdgeColorRestore,
    applyReferenceFloodFillDespill,
    selectProtectedColorsInRectangle,
    applyReferenceColorReplace,
    perceptualColorDistance,
    connectedCandidateMask,
    diffuseReferenceCandidateMask,
    diffuseReferenceGlobalCandidateMask,
  } = dependencies;
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
    120, 100, 100, 255, 120, 100, 100, 255, 200, 200, 200, 255, 100, 100, 100, 255,
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
    [120, 100, 100, 255, 120, 100, 100, 255, 200, 200, 200, 255, 0, 0, 0, 0],
  );
  const edgeEnhancementExpansionFixture = Uint8ClampedArray.from([100, 100, 100, 255, 120, 100, 100, 255]);
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
    20, 40, 60, 255, 20, 40, 60, 128, 100, 120, 140, 255, 30, 220, 30, 220, 80, 160, 80, 255, 200, 50, 50,
    255,
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
      200, 100, 50, 128, 112, 12, 0, 128, 148, 106, 91, 203, 145, 156, 64, 179, 125, 127, 84, 255, 200, 50,
      50, 255,
    ],
  );
}

module.exports = { runCutoutProductReferenceTests };
