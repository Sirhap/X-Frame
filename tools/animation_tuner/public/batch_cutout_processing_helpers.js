(function attachBatchCutoutProcessingHelpers(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutProcessingHelpers = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the quality, diagnostic, cache-invalidation, and color-sampling
   * helpers used by the batch cutout controller. The helpers keep their
   * existing state transitions and delegate host-specific rendering through
   * injected callbacks.
   * @param {object} dependencies Helper dependencies supplied by the host.
   * @returns {object} Processing helper API.
   */
  function createController(dependencies = {}) {
    const {
      state,
      elements,
      cutoutAnalysisExecutor,
      getCurrentAnimation,
      text,
      setStatus,
      selectedItem,
      renderQueue,
      updateQueueCard,
      sessionCore,
      renderPreview,
      previewSourcePoint,
      backgroundController,
      colorUtils,
      recordItemEdit,
      createRepairTrackingMetadata,
      schedulePreview,
      documentRef = root?.document,
      imageDataConstructor = root?.ImageData,
      cryptoRef = root?.crypto,
    } = dependencies;
    if (
      !state ||
      !elements ||
      !cutoutAnalysisExecutor ||
      typeof getCurrentAnimation !== "function" ||
      typeof text !== "function" ||
      typeof setStatus !== "function" ||
      typeof selectedItem !== "function" ||
      typeof renderQueue !== "function" ||
      typeof updateQueueCard !== "function" ||
      !sessionCore ||
      typeof renderPreview !== "function" ||
      typeof previewSourcePoint !== "function" ||
      !backgroundController ||
      !colorUtils ||
      typeof recordItemEdit !== "function" ||
      typeof createRepairTrackingMetadata !== "function" ||
      typeof schedulePreview !== "function"
    ) {
      throw new TypeError("BatchCutoutProcessingHelpers dependencies are required.");
    }
    if (!documentRef || typeof documentRef.createElement !== "function") {
      throw new TypeError("BatchCutoutProcessingHelpers requires a document reference.");
    }
    if (typeof imageDataConstructor !== "function") {
      throw new TypeError("BatchCutoutProcessingHelpers requires an ImageData constructor.");
    }

    /**
     * Re-evaluates frame-to-frame quality after one result changes.
     * @returns {Promise<void>}
     */
    async function refreshQualityAnalysis() {
      const currentAnimation = getCurrentAnimation();
      const metrics = state.items.map((item) => item.qualityMetrics);
      let analysis;
      try {
        analysis = await cutoutAnalysisExecutor.analyzeQuality(metrics, {
          circular: currentAnimation?.loop === true,
        });
      } catch (error) {
        const code = error?.code || error?.message || "ENGINE_EXECUTION_FAILED";
        const mapped =
          code === "ENGINE_MEMORY_EXHAUSTED"
            ? text("engineMemoryExhausted")
            : code === "ENGINE_EXECUTION_FAILED"
              ? text("engineExecutionFailed")
              : code;
        setStatus(mapped, "error");
        return;
      }
      if (
        metrics.length !== state.items.length ||
        metrics.some((metric, index) => metric !== state.items[index].qualityMetrics)
      ) {
        return;
      }
      state.items.forEach((item, index) => {
        item.quality = analysis[index];
      });
      if (state.qualityOnly) {
        renderQueue();
        return;
      }
      state.items.forEach(updateQueueCard);
    }

    /**
     * Returns whether an item currently has a detected quality issue.
     * @param {object} item Queue item.
     * @returns {boolean}
     */
    function hasQualityIssue(item) {
      return Boolean(item?.quality?.codes?.length);
    }

    /**
     * Formats detected issue codes for card titles and announcements.
     * @param {object|null} qualityResult Quality analysis result.
     * @returns {string}
     */
    function qualityLabel(qualityResult) {
      const labels = {
        empty: text("qualityEmpty"),
        area: text("qualityArea"),
        position: text("qualityPosition"),
        "soft-edge": text("qualitySoftEdge"),
        split: text("qualitySplit"),
        holes: text("qualityHoles"),
        clipped: text("qualityClipped"),
        "transparent-rgb": text("qualityTransparentRgb"),
        "background-residue": text("qualityBackgroundResidue"),
      };
      return (qualityResult?.codes || []).map((code) => labels[code] || code).join(" · ");
    }

    /**
     * Builds a cached alpha-mask or difference diagnostic canvas.
     * @param {object} item Selected queue item.
     * @param {"alpha"|"difference"} mode Diagnostic mode.
     * @returns {HTMLCanvasElement|null}
     */
    function createDiagnosticCanvas(item, mode) {
      if (!item?.resultImageData || !item?.sourceImageData) return null;
      if (item.diagnosticCanvases?.[mode]) return item.diagnosticCanvases[mode];
      const { width, height, data: resultData } = item.resultImageData;
      const sourceData = item.sourceImageData.data;
      const output = new Uint8ClampedArray(width * height * 4);
      for (let offset = 0; offset < output.length; offset += 4) {
        const alpha = resultData[offset + 3];
        if (mode === "alpha") {
          output[offset] = alpha;
          output[offset + 1] = alpha;
          output[offset + 2] = alpha;
          output[offset + 3] = 255;
          continue;
        }
        const colorDelta = Math.max(
          Math.abs(sourceData[offset] - resultData[offset]),
          Math.abs(sourceData[offset + 1] - resultData[offset + 1]),
          Math.abs(sourceData[offset + 2] - resultData[offset + 2]),
        );
        if (alpha === 0 && sourceData[offset + 3] > 0) {
          output[offset] = 255;
          output[offset + 1] = 66;
          output[offset + 2] = 45;
        } else if (alpha < 250) {
          output[offset] = 255;
          output[offset + 1] = 208;
          output[offset + 2] = 58;
        } else if (colorDelta > 18) {
          output[offset] = 43;
          output[offset + 1] = 220;
          output[offset + 2] = 196;
        } else {
          const luminance = Math.round(
            sourceData[offset] * 0.2126 + sourceData[offset + 1] * 0.7152 + sourceData[offset + 2] * 0.0722,
          );
          const muted = Math.round(luminance * 0.34 + 20);
          output[offset] = muted;
          output[offset + 1] = muted;
          output[offset + 2] = muted;
        }
        output[offset + 3] = 255;
      }
      const canvas = documentRef.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").putImageData(new imageDataConstructor(output, width, height), 0, 0);
      item.diagnosticCanvases ||= {};
      item.diagnosticCanvases[mode] = canvas;
      return canvas;
    }

    /**
     * Clears one frame's derived processing caches without recomputing sequence quality.
     * @param {object|null} item Queue item.
     * @returns {void}
     */
    function resetItemProcessing(item) {
      sessionCore.resetItemProcessing(item);
    }

    /**
     * Invalidates one frame and refreshes sequence-level quality analysis.
     * @param {object|null} item Queue item.
     * @returns {void}
     */
    function invalidateItem(item) {
      if (!item) return;
      resetItemProcessing(item);
      refreshQualityAnalysis();
    }

    /**
     * Samples a background or protected color from the active preview.
     * @param {PointerEvent} event Canvas pointer event.
     * @returns {void}
     */
    function samplePreviewColor(event) {
      if (
        event.currentTarget === elements.cutoutResult &&
        elements.cutoutResult.dataset.processing === "true"
      ) {
        setStatus(text("processing", { current: 1, total: 1 }), "busy");
        return;
      }
      const item = selectedItem();
      const point = previewSourcePoint(event, event.currentTarget || elements.cutoutResult);
      if (!item || !point) return;
      const x = Math.floor(point.sourceX);
      const y = Math.floor(point.sourceY);
      const samplingResult =
        event.currentTarget === elements.cutoutResult &&
        state.samplingBackgroundColor &&
        item.resultImageData;
      const sourceColor = backgroundController.readPixel(item.sourceImageData, x, y);
      const resultColor = samplingResult ? backgroundController.readPixel(item.resultImageData, x, y) : null;
      const color = resultColor && resultColor.a > 16 ? resultColor : sourceColor;
      if (!color || !sourceColor) return;
      if (state.samplingProtectedColor) {
        const duplicate = item.protectedColors.some(
          (protectedColor) => colorUtils.colorDistance(color.r, color.g, color.b, protectedColor) < 1,
        );
        if (!duplicate) {
          recordItemEdit(item);
          item.protectedColors.push(color);
        }
        invalidateItem(item);
        state.samplingProtectedColor = false;
        setStatus(text("protectedColorAdded", { color: colorUtils.rgbToHex(color) }), "success");
        renderPreview();
        return;
      }
      if (state.samplingBackgroundColor) {
        recordItemEdit(item);
        backgroundController.promoteBackgroundSample(item, color, { x, y });
        const tolerance = Number(elements.cutoutTolerance.value);
        const clearsVisibleResultColor = Boolean(
          samplingResult && color.a > 16 && !backgroundController.colorsEqual(color, sourceColor),
        );
        if (clearsVisibleResultColor) {
          item.repairs.push(
            backgroundController.createVisibleColorClearRepair({
              id: cryptoRef?.randomUUID?.() || `repair_${Date.now()}`,
              color,
              point: { x, y },
              tolerance,
              metadata: createRepairTrackingMetadata(
                item,
                { x, y },
                {
                  includeRegion: true,
                  tolerance,
                  sourceColor: color,
                },
              ),
            }),
          );
          item.undoneRepairs = [];
        }
        state.previewMode = "result";
        elements.cutoutColor.value = colorUtils.rgbToHex(color);
        item.processingActivated = true;
        item.automaticCutoutActivated = true;
        setStatus(
          text(clearsVisibleResultColor ? "backgroundResultCleared" : "backgroundAdded", {
            color: colorUtils.rgbToHex(color),
          }),
          "success",
        );
        schedulePreview({ recordHistory: false });
        return;
      }
      recordItemEdit(item);
      backgroundController.clearBackgroundSamples(item);
      backgroundController.promoteBackgroundSample(item, color, { x, y });
      invalidateItem(item);
      elements.cutoutColor.value = colorUtils.rgbToHex(color);
      item.processingActivated = true;
      item.automaticCutoutActivated = true;
      schedulePreview({ recordHistory: false });
    }

    return {
      refreshQualityAnalysis,
      hasQualityIssue,
      qualityLabel,
      createDiagnosticCanvas,
      resetItemProcessing,
      invalidateItem,
      samplePreviewColor,
    };
  }

  return { createController };
});
