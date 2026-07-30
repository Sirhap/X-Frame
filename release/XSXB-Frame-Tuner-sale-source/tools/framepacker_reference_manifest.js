"use strict";

/**
 * Public WebAssembly export metadata recovered from the FramePacker client loader.
 * This file contains interface facts only; it does not embed or execute the vendor binary.
 */
const FRAMEPACKER_KERNELS = Object.freeze([
  { id: 0, exportName: "fp_kernel_00", name: "initDriver", parameterBytes: 0x28, category: "runtime" },
  { id: 1, exportName: "fp_kernel_01", name: "findNearestColorInRadius", parameterBytes: 0x14, outputBytes: 0x20, category: "tracking" },
  { id: 3, exportName: "fp_kernel_03", name: "isWithinConnectivityTolerance", category: "mask" },
  { id: 4, exportName: "fp_kernel_04", name: "chamfer345DistanceTransform", category: "distance" },
  { id: 5, exportName: "fp_kernel_05", name: "computeLocalFrame", referenceBytes: 0x48, outputBytes: 0x50, category: "tracking" },
  { id: 6, exportName: "fp_kernel_06", name: "diffuseToCandidateMask", parameterBytes: 0x18, category: "mask" },
  { id: 7, exportName: "fp_kernel_07", name: "colorReplace", parameterBytes: 0x38, category: "pixel" },
  { id: 8, exportName: "fp_kernel_08", name: "edgeColorRestore", parameterBytes: 0x18, category: "pixel" },
  { id: 9, exportName: "fp_kernel_09", name: "chromaKeyClean", parameterBytes: 0x14, category: "pixel" },
  { id: 10, exportName: "fp_kernel_10", name: "diffuseGlobalCandidateMask", parameterBytes: 0x0c, category: "mask" },
  { id: 11, exportName: "fp_kernel_11", name: "checkShapeMatch", referenceBytes: 0x28, outputBytes: 0x68, category: "tracking" },
  { id: 12, exportName: "fp_kernel_12", name: "performanceSample", parameterBytes: 0x28, category: "runtime" },
  { id: 13, exportName: "fp_kernel_13", name: "floodFillDespill", parameterBytes: 0x28, category: "pixel" },
  { id: 14, exportName: "fp_kernel_14", name: "protectRegionSelect", parameterBytes: 0x38, category: "selection" },
]);

/**
 * Byte offsets recovered from the public JavaScript wrappers. Pointer fields
 * are patched by the wrapper immediately before invoking WebAssembly.
 */
const FRAMEPACKER_KERNEL_PARAMETER_LAYOUTS = Object.freeze({
  7: Object.freeze({
    replacementRgba: 0x00,
    referenceRgba: 0x04,
    hasReferenceColor: 0x08,
    seedX: 0x0c,
    seedY: 0x10,
    tolerance: 0x14,
    edgeEnhance: 0x18,
    maskPointer: 0x1c,
    edgeRestoreRadius: 0x20,
    edgeRestoreMode: 0x24,
    despillStrength: 0x28,
    despillReferenceRgb: 0x29,
    blendStrength: 0x2c,
    alphaThresholdHigh: 0x2d,
    alphaThresholdLow: 0x2e,
    despillMode: 0x2f,
    protectedColorsPointer: 0x30,
    protectedColorCount: 0x34,
  }),
  13: Object.freeze({
    replacementRgba: 0x00,
    referenceRgba: 0x04,
    hasReferenceColor: 0x08,
    seedX: 0x0c,
    seedY: 0x10,
    tolerance: 0x14,
    maskPointer: 0x18,
    edgeRestoreRadius: 0x1c,
    edgeRestoreMode: 0x20,
  }),
  14: Object.freeze({
    referenceRgb: 0x00,
    coverageThreshold: 0x04,
    maximumColors: 0x08,
    outputColorsPointer: 0x0c,
    outputColorCount: 0x10,
    outputCoverage: 0x14,
    outputStatus: 0x18,
    existingColorsPointer: 0x1c,
    existingColorCount: 0x20,
    previewImagePointer: 0x24,
    fullPreviewPointer: 0x28,
    fullWidth: 0x2c,
    fullHeight: 0x30,
    fullOriginalPointer: 0x34,
  }),
});

/**
 * Returns the immutable metadata for one numeric kernel id.
 * @param {number} id Numeric kernel identifier.
 * @returns {object|null}
 */
function kernelById(id) {
  return FRAMEPACKER_KERNELS.find((kernel) => kernel.id === Number(id)) || null;
}

module.exports = {
  FRAMEPACKER_KERNELS,
  FRAMEPACKER_KERNEL_PARAMETER_LAYOUTS,
  kernelById,
};
