"use strict";

/**
 * Runs the deterministic product cutout fixtures that establish shared pipeline values.
 * @param {object} dependencies Imported product/cutout helpers and assertion API.
 * @returns {{
 *   directProductPipeline: object,
 *   referenceProductOptions: object,
 *   smartRepairFixture: Uint8ClampedArray,
 *   smartRepairCutout: object
 * }} Shared values consumed by the following assertion runners.
 */
function runCutoutProductBasicTests(dependencies) {
  const {
    assert,
    animationLooksAttack,
    hitboxEnabledByDefault,
    FRAMEPACKER_KERNELS,
    FRAMEPACKER_KERNEL_PARAMETER_LAYOUTS,
    kernelById,
    createResultArtifactCache,
    automaticCacheKey,
    replayAutomaticResult,
    computeReferenceLocalFrame,
    findReferenceNearestColorInRadius,
    checkReferenceShapeMatch,
    estimateBackgroundColor,
    chamfer345Distance,
    isWithinConnectivityTolerance,
    applyCutout,
    hexToRgb,
    applyProductCutout,
    applyReferenceColorReplace,
    applyReferenceFloodFillDespill,
    createProductPipeline,
    colorDistance,
    createProtectedRegionMask,
    perceptualColorDistance,
  } = dependencies;
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

  const resultArtifactCache = createResultArtifactCache({ maximumBytes: 32 });
  const cachedPng = "data:image/png;base64,AAAA";
  resultArtifactCache.put("frame-1", "1:1", cachedPng);
  assert.equal(resultArtifactCache.get("frame-1", "1:1"), cachedPng);
  assert.equal(resultArtifactCache.get("frame-1", "1:2"), "");
  assert.equal(resultArtifactCache.bytes(), 0);
  const strictlyBoundedArtifactCache = createResultArtifactCache({ maximumBytes: 4 });
  strictlyBoundedArtifactCache.put("oversized-frame", "1:0", cachedPng);
  strictlyBoundedArtifactCache.put("oversized-frame", "1:1", "data:image/png;base64,AAAAAAAA");
  assert.equal(strictlyBoundedArtifactCache.get("oversized-frame", "1:1"), "");
  assert.equal(strictlyBoundedArtifactCache.bytes(), 0);
  strictlyBoundedArtifactCache.put("frame-1", "1:1", "data:image/png;base64,AAAA");
  strictlyBoundedArtifactCache.put("frame-2", "1:1", "data:image/png;base64,AAAA");
  assert.equal(strictlyBoundedArtifactCache.get("frame-1", "1:1"), "");
  assert.equal(strictlyBoundedArtifactCache.get("frame-2", "1:1"), cachedPng);
  assert.ok(strictlyBoundedArtifactCache.bytes() <= 4);
  assert.equal(automaticCacheKey({ tolerance: 12 }), automaticCacheKey({ tolerance: 12 }));
  const replayedRepair = replayAutomaticResult({
    source: Uint8ClampedArray.from([1, 2, 3, 255]),
    automatic: Uint8ClampedArray.from([1, 2, 3, 0]),
    width: 1,
    height: 1,
    options: {},
    repairs: [],
    applyRepairs() {},
  });
  assert.equal(replayedRepair.removedPixels, 1);

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
  const referenceEdgeEnhanceFixture = Uint8ClampedArray.from([20, 40, 60, 255, 74, 40, 60, 255]);
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
  const referenceRecoveryFixture = Uint8ClampedArray.from([
    0, 255, 0, 255, 30, 220, 30, 220, 200, 40, 40, 255,
  ]);
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
  const scopedColorProtection = applyProductCutout(
    Uint8ClampedArray.from([220, 30, 20, 255, 220, 30, 20, 255]),
    2,
    1,
    {
      ...referenceProductOptions,
      backgroundColors: [{ r: 220, g: 30, b: 20 }],
      tolerance: 0,
      protectionTolerance: 0,
    },
    [
      {
        mode: "protect-color",
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
        colors: [{ r: 220, g: 30, b: 20 }],
      },
    ],
  );
  assert.equal(scopedColorProtection.data[3], 255);
  assert.equal(scopedColorProtection.data[7], 0);
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
    220, 20, 20, 255, 220, 20, 20, 255, 20, 40, 220, 255, 220, 20, 20, 255, 20, 40, 220, 255, 20, 40, 220,
    255,
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
    applyReferenceColorReplace,
    applyReferenceFloodFillDespill,
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
  let smartRepairCalls = 0;
  const cachedSmartRepairPipeline = createProductPipeline({
    applyCutout(source) {
      smartRepairCalls += 1;
      const data = new Uint8ClampedArray(source);
      data[3] = 0;
      return { data, removedPixels: 1, partialPixels: 0 };
    },
    applyReferenceColorReplace,
    applyReferenceFloodFillDespill,
    clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value || 0))),
    colorDistance,
    createProtectedRegionMask,
    estimateBackgroundColor,
    perceptualColorDistance,
  });
  const cachedSmartRepairSource = Uint8ClampedArray.from([10, 245, 10, 255]);
  const cachedSmartRepair = { mode: "smart", x1: 0, y1: 0, x2: 0, y2: 0, tolerance: 20, feather: 0 };
  const cachedSmartRepairOptions = { backgroundColor: { r: 10, g: 245, b: 10 }, tolerance: 20, feather: 0 };
  const firstCachedSmartRepairResult = new Uint8ClampedArray(cachedSmartRepairSource);
  const secondCachedSmartRepairResult = new Uint8ClampedArray(cachedSmartRepairSource);
  cachedSmartRepairPipeline.applyCutoutRepairs(
    cachedSmartRepairSource,
    firstCachedSmartRepairResult,
    1,
    1,
    cachedSmartRepairOptions,
    [cachedSmartRepair],
  );
  cachedSmartRepairPipeline.applyCutoutRepairs(
    cachedSmartRepairSource,
    secondCachedSmartRepairResult,
    1,
    1,
    cachedSmartRepairOptions,
    [cachedSmartRepair],
  );
  assert.equal(smartRepairCalls, 1);
  assert.deepEqual([...secondCachedSmartRepairResult], [...firstCachedSmartRepairResult]);
  cachedSmartRepair.tolerance = 21;
  cachedSmartRepairPipeline.applyCutoutRepairs(
    cachedSmartRepairSource,
    new Uint8ClampedArray(cachedSmartRepairSource),
    1,
    1,
    cachedSmartRepairOptions,
    [cachedSmartRepair],
  );
  assert.equal(smartRepairCalls, 2);
  const inactiveAutomaticCutout = directProductPipeline.applyProductCutout(smartRepairFixture, 5, 1, {
    ...referenceProductOptions,
    automaticCutout: false,
    backgroundColors: [{ r: 0, g: 255, b: 0 }],
    tolerance: 60,
  });
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

  return {
    directProductPipeline,
    referenceProductOptions,
    smartRepairFixture,
    smartRepairCutout,
  };
}

module.exports = { runCutoutProductBasicTests };
