(function attachBatchCutoutRuntimeSetup(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutRuntimeSetup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const ELEMENT_IDS = Object.freeze([
    "cutoutOpen",
    "cutoutModal",
    "cutoutTitle",
    "cutoutCopyLink",
    "cutoutHome",
    "cutoutClose",
    "cutoutDropzone",
    "cutoutSidebar",
    "cutoutSidebarParametersTab",
    "cutoutSidebarBatchTab",
    "cutoutSidebarCollapse",
    "cutoutSidebarParametersPanel",
    "cutoutSidebarBatchPanel",
    "cutoutCandidatePanel",
    "cutoutCandidateGenerate",
    "cutoutCandidateExit",
    "cutoutCandidateReview",
    "cutoutCandidateStatus",
    "cutoutCandidateReasons",
    "cutoutCandidateDifferences",
    "cutoutCandidateViewA",
    "cutoutCandidateViewSplit",
    "cutoutCandidateViewB",
    "cutoutCandidateSplitRange",
    "cutoutCandidateScope",
    "cutoutCandidateApply",
    "cutoutCandidatePresetName",
    "cutoutCandidatePresetSelect",
    "cutoutCandidatePresetSave",
    "cutoutCandidatePresetLoad",
    "cutoutCandidatePresetDelete",
    "cutoutCandidateDivider",
    "cutoutFileInput",
    "cutoutAddFiles",
    "cutoutLoadGroup",
    "cutoutClear",
    "cutoutNewBatch",
    "cutoutColor",
    "cutoutTolerance",
    "cutoutToleranceValue",
    "cutoutFeather",
    "cutoutFeatherValue",
    "cutoutChromaFeather",
    "cutoutChromaFeatherValue",
    "cutoutAlphaThreshold",
    "cutoutAlphaValue",
    "cutoutConnected",
    "cutoutOriginal",
    "cutoutResult",
    "cutoutQueue",
    "cutoutStatus",
    "cutoutDownload",
    "cutoutAddProject",
    "cutoutApplyGroup",
    "cutoutCounter",
    "cutoutSample",
    "cutoutRepairAutomatic",
    "cutoutRepairAutomaticQuick",
    "cutoutRepairClear",
    "cutoutRepairBrush",
    "cutoutRepairEraser",
    "cutoutRepairSource",
    "cutoutBrushSize",
    "cutoutBrushSizeValue",
    "cutoutBrushHardness",
    "cutoutBrushHardnessValue",
    "cutoutBrushOpacity",
    "cutoutBrushOpacityValue",
    "cutoutBrushColor",
    "cutoutRepairRecolor",
    "cutoutAreaColor",
    "cutoutAreaTransparent",
    "cutoutAreaTransparentQuick",
    "cutoutAreaTolerance",
    "cutoutAreaToleranceValue",
    "cutoutAreaScope",
    "cutoutAreaHint",
    "cutoutSelectionToolLabel",
    "cutoutSelectionHint",
    "cutoutProtectionControls",
    "cutoutProtectionType",
    "cutoutProtectionRangeOptions",
    "cutoutProtectionColorOptions",
    "cutoutProtectionColors",
    "cutoutProtectionColorStatus",
    "cutoutProtectionColorPicker",
    "cutoutProtectionColorHex",
    "cutoutProtectionColorAdd",
    "cutoutProtectionColorClear",
    "cutoutProtectionBoundary",
    "cutoutProtectionBoundaryValue",
    "cutoutProtectionPadding",
    "cutoutProtectionPaddingValue",
    "cutoutProtectionPreview",
    "cutoutProtectionSubject",
    "cutoutProtectionSubjectCanvas",
    "cutoutProtectionPreviewStatus",
    "cutoutSettings",
    "cutoutSettingsEmpty",
    "cutoutAutomaticSettings",
    "cutoutLocalSettings",
    "cutoutActiveToolTitle",
    "cutoutActiveToolHint",
    "cutoutRepairRestore",
    "cutoutRepairUndo",
    "cutoutRepairRedo",
    "cutoutRepairReset",
    "cutoutEdgeBoost",
    "cutoutEdgeBoostValue",
    "cutoutBlendStrength",
    "cutoutBlendStrengthValue",
    "cutoutBlendMode",
    "cutoutDespillStrength",
    "cutoutDespillStrengthValue",
    "cutoutDespillMode",
    "cutoutEdgeDespillRadius",
    "cutoutEdgeDespillRadiusValue",
    "cutoutAlphaLow",
    "cutoutAlphaLowValue",
    "cutoutAlphaHigh",
    "cutoutAlphaHighValue",
    "cutoutProtectionTolerance",
    "cutoutProtectionToleranceValue",
    "cutoutProtectSample",
    "cutoutProtectClear",
    "cutoutProtectedColors",
    "cutoutBackgroundClear",
    "cutoutBackgroundColors",
    "cutoutBackgroundHint",
    "cutoutPerceptual",
    "cutoutEdgeRecoveryStrength",
    "cutoutEdgeRecoveryStrengthValue",
    "cutoutBackgroundRadius",
    "cutoutBackgroundRadiusValue",
    "cutoutBlurRadius",
    "cutoutBlurRadiusValue",
    "cutoutRepairProtect",
    "cutoutRepairBatch",
    "cutoutZoomOut",
    "cutoutZoom",
    "cutoutZoomValue",
    "cutoutZoomIn",
    "cutoutZoomFit",
    "cutoutZoomActual",
    "cutoutFrameNavigation",
    "cutoutPrevious",
    "cutoutNext",
    "cutoutFramePrefix",
    "cutoutFrameNumber",
    "cutoutFrameSlider",
    "cutoutPreviewPlay",
    "cutoutBatchTray",
    "cutoutBatchSummary",
    "cutoutShowResult",
    "cutoutShowOriginal",
    "cutoutBatchTrayToggle",
    "cutoutBatchTrayActions",
    "cutoutViewResult",
    "cutoutViewOriginal",
    "cutoutViewAlpha",
    "cutoutViewDifference",
    "cutoutBackgroundLight",
    "cutoutBackgroundDark",
    "cutoutBackgroundWhite",
    "cutoutViewCaption",
    "cutoutRepairTools",
    "cutoutQualityOnly",
    "cutoutQualityCount",
    "cutoutNextIssue",
    "cutoutIncludeAll",
    "cutoutExcludeAll",
    "cutoutConfirmPanel",
    "cutoutConfirmTitle",
    "cutoutConfirmMessage",
    "cutoutConfirmDetails",
    "cutoutConfirmCancel",
    "cutoutConfirmApply",
    "cutoutSelectAll",
    "cutoutInvertSelection",
    "cutoutExcludeSelected",
    "cutoutDeleteSelected",
    "cutoutRetryFailed",
    "cutoutCancelProcess",
  ]);

  /**
   * Settles async work with bounded concurrency while preserving input order.
   * @template T,U
   * @param {T[]} inputs Input values.
   * @param {(value:T,index:number)=>Promise<U>} mapper Async mapper.
   * @param {number} [concurrency] Maximum active operations.
   * @returns {Promise<PromiseSettledResult<U>[]>} Ordered settled results.
   */
  async function mapSettledWithConcurrency(inputs, mapper, concurrency = 6) {
    const values = Array.from(inputs || []);
    const results = new Array(values.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = { status: "fulfilled", value: await mapper(values[index], index) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, () => worker()),
    );
    return results;
  }

  /**
   * Resolves the batch-cutout controls from a document.
   * @param {Document} documentRef Document containing the cutout controls.
   * @returns {Record<string, Element|null>} Named controls.
   */
  function collectElements(documentRef) {
    if (!documentRef || typeof documentRef.querySelector !== "function") {
      throw new TypeError("Batch cutout runtime setup requires a document.");
    }
    return Object.fromEntries(ELEMENT_IDS.map((id) => [id, documentRef.querySelector(`#${id}`)]));
  }

  /**
   * Creates the mutable per-session state used by the batch controller.
   * @param {string} language Preferred UI language.
   * @returns {object} Fresh controller state.
   */
  function createInitialState(language) {
    return {
      language: language === "en" ? "en" : "zh",
      items: [],
      selectedIndex: 0,
      previewRevision: 0,
      previewRenderToken: 0,
      busy: false,
      sourceKind: "",
      sessionMode: "batch",
      settingsMode: "automatic",
      repairMode: "automatic",
      areaColorTransparent: false,
      repairDrag: null,
      repairRenderFrame: 0,
      repairGestureCanvas: null,
      keyboardRepairPoint: null,
      samplingProtectedColor: false,
      samplingBackgroundColor: false,
      protectionPreview: null,
      previewScale: null,
      previewFitScale: null,
      previewPanX: 0,
      previewPanY: 0,
      previewPanDrag: null,
      previewSpacePan: false,
      returnFocus: null,
      previewMode: "result",
      previewBackground: "light",
      batchPreviewRepair: null,
      batchPreviewRevision: 0,
      thumbnailMode: "result",
      thumbnailRevision: 0,
      thumbnailJob: 0,
      playing: false,
      playbackTimer: 0,
      confirmationResolver: null,
      selectedIds: new Set(),
      queueWindowStart: 0,
      queueRenderFrame: 0,
      selectionAnchorIndex: 0,
      draggedItemId: "",
      cancelRequested: false,
      worksetResolver: null,
      worksetName: "",
      suspendedBatchSession: null,
      batchTrayCollapsed: true,
      qualityOnly: false,
      comparison: {
        status: "idle",
        sourceItemId: "",
        sourceRevision: -1,
        generation: 0,
        variants: null,
        displayMode: "split",
        activeVariant: "b",
        splitRatio: 0.5,
        draggingDivider: false,
      },
    };
  }

  /** @returns {object} Per-image pixel limits. */
  function createImagePixelLimits() {
    return Object.freeze({
      maxPixelsPerImage: 16_777_216,
      maxTotalPixels: 64_000_000,
    });
  }

  /** @returns {object} Advanced processing presets. */
  function createAdvancedPresets() {
    return {
      conservative: { alphaLow: 0, alphaHigh: 255, alphaThreshold: 0, protectionTolerance: 12 },
      balanced: { alphaLow: 0, alphaHigh: 255, alphaThreshold: 2, protectionTolerance: 8 },
      hard: { alphaLow: 24, alphaHigh: 220, alphaThreshold: 10, protectionTolerance: 4 },
    };
  }

  return {
    collectElements,
    createAdvancedPresets,
    createImagePixelLimits,
    createInitialState,
    mapSettledWithConcurrency,
    maxImageFileBytes: 48 * 1024 * 1024,
  };
});
