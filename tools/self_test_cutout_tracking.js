"use strict";

const assert = require("node:assert/strict");
const {
  advanceTrackingState,
  compareShapeDescriptors,
  createShapeCandidates,
  createShapeDescriptor,
  createTrackingState,
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

/**
 * Runs the ordered tracking, local-repair, and quality assertions.
 * @returns {void}
 */
function runCutoutTrackingSelfTests() {
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
}

module.exports = { runCutoutTrackingSelfTests };
