"use strict";

importScripts(
  "protected_artifact_loader.js",
  "protected_wasm_kernel_bridge.js",
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
  "cutout_local_tracking_core.js",
  "protected_algorithm_runtime.js",
);

let protectedCoreInitialization = null;

/**
 * Initializes the production WASM core once after verifying its manifest hash.
 * Development Workers have no injected configuration and retain the readable JS adapter.
 * @returns {Promise<void>} Initialization completion.
 */
function ensureProtectedCore() {
  const configuration = self.__XSXB_PROTECTED_CORE_CONFIG__;
  if (!configuration) return Promise.resolve();
  if (!protectedCoreInitialization) {
    protectedCoreInitialization = Promise.resolve().then(async () => {
      const loader = self.ProtectedArtifactLoader.createLoader(configuration.loader);
      await self.ProtectedWasmKernelBridge.initialize({
        loader,
        loadOptions: {
          mode: configuration.mode,
          version: configuration.version,
        },
      });
    });
  }
  return protectedCoreInitialization;
}

/**
 * Runs one product cutout request and transfers its pixel buffers back.
 * @param {MessageEvent} event Worker message event.
 * @returns {void}
 */
self.onmessage = async (event) => {
  const {
    id,
    operation,
    sourceBuffer,
    width,
    height,
    options,
    repairs,
    protocolVersion,
    selectionMaskBuffer,
    selectionParameters,
    analysisParameters,
    analysisOriginalBuffer,
    previewBuffer,
  } = event.data || {};
  try {
    await ensureProtectedCore();
    if (protocolVersion !== 1) throw new Error("ENGINE_VERSION_MISMATCH");
    const source = new Uint8ClampedArray(sourceBuffer);
    const normalizedWidth = Number(width);
    const normalizedHeight = Number(height);
    if (operation === "quality-analysis") {
      const request = analysisParameters || {};
      const result = self.CutoutQualityCore.analyzeCutoutQualitySequence(
        Array.isArray(request.metrics) ? request.metrics : [],
        request.parameters || {},
      );
      self.postMessage({ id, ok: true, result });
      return;
    }
    if (operation === "repair-tracking") {
      const trackingParameters = {
        ...(analysisParameters || {}),
        ...(analysisOriginalBuffer ? { originalData: new Uint8ClampedArray(analysisOriginalBuffer) } : {}),
      };
      const result = self.ProtectedAlgorithmRuntime.analyzeDevelopmentRepairTracking(
        { tracking: self.CutoutTrackingCore, localTracking: self.CutoutLocalTrackingCore },
        { data: source, width: normalizedWidth, height: normalizedHeight },
        trackingParameters,
      );
      self.postMessage({ id, ok: true, result });
      return;
    }
    if (operation === "selection-repair") {
      const selectionMask = new Uint8Array(selectionMaskBuffer);
      if (selectionMask.length !== normalizedWidth * normalizedHeight) {
        throw new Error("ENGINE_INVALID_REQUEST");
      }
      const parameters = selectionParameters || {};
      const rectangle = parameters.rectangle;
      const previewData = previewBuffer ? new Uint8ClampedArray(previewBuffer) : null;
      if (parameters.mode === "protect-range") {
        const selectionResult = self.BatchCutoutCore.createProtectedRegionMask(
          source,
          previewData,
          normalizedWidth,
          normalizedHeight,
          rectangle,
          parameters.options || {},
        );
        const { mask, ...result } = selectionResult;
        self.postMessage({ id, ok: true, result, maskBuffer: mask.buffer }, [mask.buffer]);
        return;
      }
      if (parameters.mode === "protect-color") {
        const colorSource = new Uint8ClampedArray(source);
        for (let index = 0; index < selectionMask.length; index += 1) {
          if (!selectionMask[index]) colorSource[index * 4 + 3] = 0;
        }
        const selectionOptions = { ...(parameters.options || {}), previewData };
        const result = self.ProtectedWasmKernelBridge.isReady()
          ? self.ProtectedWasmKernelBridge.selectProtectionColors(
              colorSource,
              normalizedWidth,
              normalizedHeight,
              rectangle,
              selectionOptions,
            )
          : self.BatchCutoutCore.selectProtectedColorsInRectangle(
              colorSource,
              normalizedWidth,
              normalizedHeight,
              rectangle,
              selectionOptions,
            );
        self.postMessage({ id, ok: true, result });
        return;
      }
      throw new Error("ENGINE_UNSUPPORTED_OPERATION");
    }
    if (operation !== "product-cutout") throw new Error("ENGINE_UNSUPPORTED_OPERATION");
    const result = self.BatchCutoutCore.applyProductCutout(
      source,
      normalizedWidth,
      normalizedHeight,
      options || {},
      Array.isArray(repairs) ? repairs : [],
    );
    const shapeCandidates = self.CutoutTrackingCore.createShapeCandidates(
      result.automaticData,
      normalizedWidth,
      normalizedHeight,
    );
    const shapeDescriptor =
      shapeCandidates[0] ||
      self.CutoutTrackingCore.createShapeDescriptor(result.automaticData, normalizedWidth, normalizedHeight);
    const qualityMetrics = self.CutoutQualityCore.createCutoutQualityMetrics(
      result.data,
      normalizedWidth,
      normalizedHeight,
      {
        backgroundColors: options?.backgroundColors,
        backgroundTolerance: Math.max(0, Number(options?.tolerance || 0) + Number(options?.feather || 0)),
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
