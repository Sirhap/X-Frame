"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
  colorDistance,
  connectedCandidateMask,
  createProtectedRegionMask,
  diffuseReferenceCandidateMask,
  diffuseReferenceGlobalCandidateMask,
  estimateBackgroundColor,
  hexToRgb,
  isWithinConnectivityTolerance,
  perceptualColorDistance,
  selectProtectedColorsInRectangle,
} = require("./animation_tuner/public/batch_cutout_core");
const { createProductPipeline } = require("./animation_tuner/public/batch_cutout_product_core");
const { createResultArtifactCache } = require("./animation_tuner/public/batch_cutout_result_cache_core");
const {
  automaticCacheKey,
  replayAutomaticResult,
} = require("./animation_tuner/public/batch_cutout_repair_replay_core");
const {
  checkReferenceShapeMatch,
  computeReferenceLocalFrame,
  findReferenceNearestColorInRadius,
} = require("./animation_tuner/public/cutout_tracking_core");
const {
  FRAMEPACKER_KERNELS,
  FRAMEPACKER_KERNEL_PARAMETER_LAYOUTS,
  kernelById,
} = require("./framepacker_reference_manifest");
const { runCutoutProductBasicTests } = require("./self_test_cutout_product_basic");
const { runCutoutProductGoldenTests } = require("./self_test_cutout_product_golden");
const { runCutoutProductReferenceTests } = require("./self_test_cutout_product_reference");

/**
 * Runs the ordered product and low-level cutout assertions.
 * @returns {{
 *   directProductPipeline: object,
 *   referenceProductOptions: object,
 *   smartRepairFixture: Uint8ClampedArray,
 *   smartRepairCutout: object
 * }} Shared values consumed by the following assertion runner.
 */
function runCutoutProductSelfTests() {
  const dependencies = {
    assert,
    crypto,
    animationLooksAttack,
    hitboxEnabledByDefault,
    applyCutout,
    applyProductCutout,
    applyReferenceChromaKey,
    applyReferenceColorReplace,
    applyReferenceDespillPixel,
    applyReferenceEdgeColorRestore,
    applyReferenceFloodFillDespill,
    chamfer345Distance,
    colorDistance,
    connectedCandidateMask,
    createProtectedRegionMask,
    diffuseReferenceCandidateMask,
    diffuseReferenceGlobalCandidateMask,
    estimateBackgroundColor,
    hexToRgb,
    isWithinConnectivityTolerance,
    perceptualColorDistance,
    selectProtectedColorsInRectangle,
    createProductPipeline,
    createResultArtifactCache,
    automaticCacheKey,
    replayAutomaticResult,
    checkReferenceShapeMatch,
    computeReferenceLocalFrame,
    findReferenceNearestColorInRadius,
    FRAMEPACKER_KERNELS,
    FRAMEPACKER_KERNEL_PARAMETER_LAYOUTS,
    kernelById,
  };
  const context = runCutoutProductBasicTests(dependencies);
  runCutoutProductGoldenTests(dependencies);
  runCutoutProductReferenceTests(dependencies);
  return context;
}

module.exports = { runCutoutProductSelfTests };
