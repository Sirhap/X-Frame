"use strict";

importScripts(
  "batch_cutout_color_core.js",
  "batch_cutout_connectivity_core.js",
  "batch_cutout_product_core.js",
  "batch_cutout_protection_core.js",
  "batch_cutout_reference_recovery_core.js",
  "batch_cutout_reference_replace_core.js",
  "batch_cutout_reference_input.js",
  "batch_cutout_core.js",
  "cutout_quality_core.js",
  "cutout_tracking_geometry_core.js",
  "cutout_tracking_core.js",
);

/**
 * Runs one product cutout request and transfers its pixel buffers back.
 * @param {MessageEvent} event Worker message event.
 * @returns {void}
 */
self.onmessage = (event) => {
  const { id, sourceBuffer, width, height, options, repairs } = event.data || {};
  try {
    const source = new Uint8ClampedArray(sourceBuffer);
    const result = self.BatchCutoutCore.applyProductCutout(
      source,
      Number(width),
      Number(height),
      options || {},
      Array.isArray(repairs) ? repairs : [],
    );
    const shapeCandidates = self.CutoutTrackingCore.createShapeCandidates(
      result.automaticData,
      Number(width),
      Number(height),
    );
    const shapeDescriptor =
      shapeCandidates[0] ||
      self.CutoutTrackingCore.createShapeDescriptor(result.automaticData, Number(width), Number(height));
    const qualityMetrics = self.CutoutQualityCore.createCutoutQualityMetrics(
      result.data,
      Number(width),
      Number(height),
      {
        backgroundColors: options?.backgroundColors,
        backgroundTolerance: Number(options?.tolerance || 0) + Number(options?.feather || 0),
      },
    );
    self.postMessage(
      {
        id,
        ok: true,
        dataBuffer: result.data.buffer,
        automaticBuffer: result.automaticData.buffer,
        removedPixels: result.removedPixels,
        partialPixels: result.partialPixels,
        shapeCandidates,
        shapeDescriptor,
        qualityMetrics,
      },
      [result.data.buffer, result.automaticData.buffer],
    );
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
