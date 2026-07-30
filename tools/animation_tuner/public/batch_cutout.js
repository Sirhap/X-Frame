(function attachBatchCutout(root) {
  "use strict";

  const textModule = root.BatchCutoutText;
  if (!textModule) throw new Error("BatchCutoutText is required.");
  const { TEXT } = textModule;
  const runtimeSetup = root.BatchCutoutRuntimeSetup;
  if (!runtimeSetup) throw new Error("BatchCutoutRuntimeSetup is required.");
  const { mapSettledWithConcurrency } = runtimeSetup;

  /**
   * Creates a complete batch-cutout controller.
   * @param {object} hooks Integration hooks supplied by the host application.
   * @returns {object} Batch-cutout controller API.
   */
  function createController(hooks = {}) {
    const imagePixelBudget = root.ImagePixelBudget;
    if (!imagePixelBudget) throw new Error("ImagePixelBudget is required.");
    const colorUtils = root.BatchCutoutPublicColor;
    if (!colorUtils) throw new Error("BatchCutoutPublicColor is required.");
    const batchZip = root.BatchZip;
    if (!batchZip) throw new Error("BatchZip is required.");
    const outputCore = root.BatchCutoutOutputCore;
    if (!outputCore) throw new Error("BatchCutoutOutputCore is required.");
    const sessionCore = root.BatchCutoutSessionCore;
    if (!sessionCore) throw new Error("BatchCutoutSessionCore is required.");
    const resultCacheCore = root.BatchCutoutResultCacheCore;
    if (!resultCacheCore) throw new Error("BatchCutoutResultCacheCore is required.");
    const repairReplayCore = root.BatchCutoutRepairReplayCore;
    if (!repairReplayCore) throw new Error("BatchCutoutRepairReplayCore is required.");
    const backgroundController = root.BatchCutoutBackgroundController;
    if (!backgroundController) throw new Error("BatchCutoutBackgroundController is required.");
    /** Public pixel estimator used by organizer-owned automatic worksets. */
    const cutoutCore = root.BatchCutoutCore;
    if (!cutoutCore?.estimateBackgroundColor) throw new Error("BatchCutoutCore is required.");
    const protectedRuntimeModule = root.ProtectedAlgorithmRuntime;
    if (!protectedRuntimeModule) throw new Error("ProtectedAlgorithmRuntime is required.");
    const protectedRuntime = protectedRuntimeModule.getDefaultRuntime(root);
    const cutoutExecutor = protectedRuntimeModule.createProductExecutor(protectedRuntime);
    const selectionRepairExecutor = protectedRuntimeModule.createSelectionRepairExecutor(protectedRuntime);
    const cutoutAnalysisExecutor = protectedRuntimeModule.createCutoutAnalysisExecutor(protectedRuntime);
    const resultArtifacts = resultCacheCore.createResultArtifactCache();
    const elements = runtimeSetup.collectElements(document);
    const state = runtimeSetup.createInitialState(hooks.getLanguage?.());
    if (elements.cutoutSidebarBatchPanel && elements.cutoutBatchTray) {
      elements.cutoutSidebarBatchPanel.append(elements.cutoutBatchTray);
    }
    /** @type {HTMLElement|null} Persistent batch actions shared by both sidebar panels. */
    const sidebarActions = document.querySelector(".cutoutBatchWorkspaceActions");
    if (elements.cutoutSidebar && sidebarActions) elements.cutoutSidebar.append(sidebarActions);
    let settingsController = null;
    /** @param {string} method Settings method name. @param {...any} args Method arguments. @returns {any} Settings result. */
    function settingsCall(method, ...args) {
      if (!settingsController) throw new Error("BatchCutoutSettings is not initialized.");
      return settingsController[method](...args);
    }
    /** @returns {object} Validated image pixel metrics. */
    function assertImagePixelBudget(...args) {
      return settingsCall("assertImagePixelBudget", ...args);
    }
    /** @returns {void} Synchronizes a numeric range and its output. */
    function syncNumericRange(...args) {
      return settingsCall("syncNumericRange", ...args);
    }
    /** @returns {HTMLInputElement} Binds a numeric range input. */
    function bindNumericRange(...args) {
      return settingsCall("bindNumericRange", ...args);
    }
    /** @returns {void} Applies an advanced preset. */
    function applyAdvancedPreset(...args) {
      return settingsCall("applyAdvancedPreset", ...args);
    }
    /** @returns {void} Publishes a status message. */
    function setStatus(...args) {
      return settingsCall("setStatus", ...args);
    }
    /** @returns {void} Renders status and control state. */
    function renderStatus(...args) {
      return settingsCall("renderStatus", ...args);
    }
    /** @returns {void} Selects the active repair mode. */
    function setRepairMode(...args) {
      return settingsCall("setRepairMode", ...args);
    }
    /** @returns {"light"|"dark"|"white"} Selected preview background. */
    function setPreviewBackground(...args) {
      return settingsCall("setPreviewBackground", ...args);
    }
    /** @returns {{r:number,g:number,b:number,a?:number}} Selected area color. */
    function selectedAreaColor(...args) {
      return settingsCall("selectedAreaColor", ...args);
    }
    /** @returns {void} Toggles transparent area color mode. */
    function setAreaColorTransparent(...args) {
      return settingsCall("setAreaColorTransparent", ...args);
    }
    /** @returns {boolean} Whether the latest area repair was updated. */
    function updateLatestAreaRepair(...args) {
      return settingsCall("updateLatestAreaRepair", ...args);
    }
    /** @returns {boolean} Whether the latest protection repair was updated. */
    function updateLatestProtectionRepair(...args) {
      return settingsCall("updateLatestProtectionRepair", ...args);
    }
    const MAX_IMAGE_FILE_BYTES = runtimeSetup.maxImageFileBytes;
    const IMAGE_PIXEL_LIMITS = runtimeSetup.createImagePixelLimits();
    const advancedSummary = document.querySelector("#cutoutAdvancedSummary");
    const advancedPresetButtons = Array.from(document.querySelectorAll("[data-cutout-preset]"));
    const advancedPresets = runtimeSetup.createAdvancedPresets();
    let processingHelpersController = null;
    /** @param {string} method Helper method name. @param {...any} args Helper arguments. @returns {any} Helper result. */
    function processingHelperCall(method, ...args) {
      if (!processingHelpersController) {
        throw new Error("BatchCutoutProcessingHelpers is not initialized.");
      }
      return processingHelpersController[method](...args);
    }
    /** @returns {Promise<void>} Refreshes sequence-level quality analysis. */
    function refreshQualityAnalysis(...args) {
      return processingHelperCall("refreshQualityAnalysis", ...args);
    }
    /** @param {object} item Queue item. @returns {boolean} Whether quality issues exist. */
    function hasQualityIssue(item) {
      return processingHelperCall("hasQualityIssue", item);
    }
    /** @param {object|null} qualityResult Quality analysis result. @returns {string} Localized issue label. */
    function qualityLabel(qualityResult) {
      return processingHelperCall("qualityLabel", qualityResult);
    }
    /** @param {object} item Selected queue item. @param {string} mode Diagnostic mode. @returns {HTMLCanvasElement|null} Diagnostic canvas. */
    function createDiagnosticCanvas(item, mode) {
      return processingHelperCall("createDiagnosticCanvas", item, mode);
    }
    /** @param {object|null} item Queue item. @returns {void} Clears processing caches. */
    function resetItemProcessing(item) {
      return processingHelperCall("resetItemProcessing", item);
    }
    /** @param {object|null} item Queue item. @returns {void} Invalidates one item. */
    function invalidateItem(item) {
      return processingHelperCall("invalidateItem", item);
    }
    /** @param {PointerEvent} event Canvas pointer event. @returns {void} Samples a preview color. */
    function samplePreviewColor(event) {
      return processingHelperCall("samplePreviewColor", event);
    }
    let previewTimer = 0;
    let previewRenderer = null;
    /** @param {...any} args Preview renderer arguments. @returns {Promise<void>} */
    function renderPreview(...args) {
      return previewRenderer?.renderPreview(...args) || Promise.resolve();
    }
    const previewModule = root.BatchCutoutPreview;
    if (!previewModule) throw new Error("BatchCutoutPreview is required.");
    const { drawPreviewCanvas, renderPreviewZoom, setPreviewScale, previewCanvasPoint, previewSourcePoint } =
      previewModule.createController({ elements, state, renderPreview });
    elements.cutoutRepairTools.dataset.repairMode = state.repairMode;

    /**
     * Translates a UI key.
     * @param {string} key Translation key.
     * @param {Record<string,string|number>} variables Interpolation values.
     * @returns {string}
     */
    function text(key, variables = {}) {
      const template = TEXT[state.language]?.[key] || TEXT.zh[key] || key;
      return String(template).replace(/\{(\w+)\}/g, (_match, name) => variables[name] ?? "");
    }
    /**
     * Captures the automatic-cutout controls as a serializable per-image snapshot.
     * Local repair controls are intentionally excluded because they belong to each repair record.
     * @returns {object} Normalized processing parameters.
     */
    function captureProcessingParameters() {
      return sessionCore.captureProcessingParameters(elements);
    }
    /**
     * Restores one image's automatic-cutout snapshot into the shared controls.
     * Assigning properties does not emit input events, so image navigation cannot reprocess frames.
     * @param {object|null|undefined} parameters Stored processing parameters.
     * @returns {void}
     */
    function applyProcessingParametersToControls(parameters) {
      sessionCore.applyProcessingParameters(elements, parameters, {
        syncNumericRange,
        onApplied: renderAdvancedMode,
      });
    }
    const imageControllerModule = root.BatchCutoutImageController;
    if (!imageControllerModule) throw new Error("BatchCutoutImageController is required.");
    const imageController = imageControllerModule.createController({
      state,
      elements,
      colorUtils,
      sessionCore,
      imagePixelBudget,
      imagePixelLimits: IMAGE_PIXEL_LIMITS,
      captureProcessingParameters: (...args) => captureProcessingParameters(...args),
      assertImagePixelBudget: (...args) => assertImagePixelBudget(...args),
      text: (...args) => text(...args),
    });
    const {
      imagePixels,
      loadFileImage,
      createThumbnailUrl,
      createItem,
      selectedItem,
      recordItemEdit,
      selectedBackgroundColor,
      selectedBackgroundColors,
      protectedColorEntries,
      effectiveProtectedColors,
      resolveProtectedColorInput,
      processingOptions,
    } = imageController;
    /**
     * Draws the active repair rectangle over the result preview.
     * @returns {void}
     */
    function drawRepairOverlay() {
      if (state.previewMode !== "result" || !state.repairDrag) return;
      if (["automatic", "brush", "eraser", "restore-source", "fill", "recolor"].includes(state.repairMode))
        return;
      const context = elements.cutoutResult.getContext("2d");
      const { startX, startY, currentX, currentY } = state.repairDrag;
      context.save();
      context.fillStyle = "rgba(255, 212, 61, .18)";
      context.strokeStyle = "#ffd43d";
      context.lineWidth = 3;
      context.setLineDash([8, 5]);
      context.fillRect(startX, startY, currentX - startX, currentY - startY);
      context.strokeRect(startX, startY, currentX - startX, currentY - startY);
      context.restore();
    }

    const protectionPreviewModule = root.BatchCutoutProtectionPreview;
    if (!protectionPreviewModule) {
      throw new Error("BatchCutoutProtectionPreview is required.");
    }
    const protectionPreviewController = protectionPreviewModule.createController({
      colorUtils,
      selectionRepairExecutor,
      state,
      elements,
      text,
      selectedItem,
      selectedBackgroundColors,
    });
    const {
      normalizeProtectionRectangle,
      createSelectionMask,
      encodeSubjectMask,
      detectNativeSubject,
      createColorProtectionPreview,
      syncProtectionPreview,
      drawProtectionPreview,
      renderProtectionPreviewInfo,
    } = protectionPreviewController;
    /**
     * Selects the main preview representation.
     * @param {"result"|"original"|"alpha"|"difference"} mode Preview mode.
     * @returns {void}
     */
    function setPreviewMode(mode) {
      state.previewMode = mode;
      state.repairDrag = null;
      renderPreview();
    }

    /** @param {{recordHistory?:boolean}} [options] Preview history behavior. @returns {void} */
    function schedulePreview(options = {}) {
      cutoutExecutor.cancelAll();
      state.previewRevision += 1;
      state.thumbnailJob += 1;
      const currentParameters = captureProcessingParameters();
      if (state.sessionMode === "single") {
        const item = selectedItem();
        if (item) {
          if (options.recordHistory !== false) recordItemEdit(item);
          item.processingParameters = currentParameters;
          item.pendingAutomaticPropagation = true;
          invalidateItem(item);
        }
      } else {
        state.thumbnailRevision += 1;
        for (const item of state.items) {
          if (options.recordHistory !== false) recordItemEdit(item);
        }
        const sourceItem = selectedItem();
        if (sourceItem) {
          sessionCore.synchronizeBatchAutomaticProcessing(state.items, sourceItem, currentParameters, {
            mapSeedPoints: true,
          });
        } else {
          for (const item of state.items) {
            item.processingParameters = { ...currentParameters };
            resetItemProcessing(item);
          }
        }
        refreshQualityAnalysis();
      }
      const revision = state.previewRevision;
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => {
        if (revision === state.previewRevision) {
          renderQueue();
          renderPreview();
          scheduleBatchThumbnails();
        }
      }, 40);
    }

    const navigationModule = root.BatchCutoutNavigation;
    if (!navigationModule) throw new Error("BatchCutoutNavigation is required.");
    const navigationController = navigationModule.createController({
      state,
      elements,
      selectedItem,
      hasQualityIssue,
      applyProcessingParametersToControls,
      setRepairMode,
      renderSessionMode: (...args) => renderSessionMode(...args),
      setStatus,
      text,
      renderQueue: (...args) => renderQueue(...args),
      renderPreview,
      renderStatus,
      updateQueueCard: (...args) => updateQueueCard(...args),
      processItem: (...args) => processItem(...args),
      windowRef: window,
    });
    const {
      selectBatchIndex,
      selectNextQualityIssue,
      stopBatchPlayback,
      toggleBatchPlayback,
      scheduleBatchThumbnails,
    } = navigationController;

    /**
     * Refreshes every frame with the latest recolor without committing target repairs.
     * @param {object|null} [sourceItem] Frame that owns the latest recolor.
     * @returns {boolean} Whether batch preview state changed.
     */
    function previewLatestRepairAcrossBatch(sourceItem = selectedItem()) {
      const previouslyActive = Boolean(state.batchPreviewRepair);
      const active = sessionCore.stageBatchRepairPreview(state, sourceItem);
      if (!active && !previouslyActive) return false;
      state.batchPreviewRevision += 1;
      state.thumbnailRevision += 1;
      elements.cutoutModal.dataset.batchPreview = String(active);
      elements.cutoutRepairBatch.classList.toggle("previewPending", active);
      elements.cutoutRepairBatch.setAttribute("aria-pressed", String(active));
      for (const item of state.items) {
        if (item !== sourceItem) resetItemProcessing(item);
      }
      renderQueue();
      scheduleBatchThumbnails();
      return true;
    }

    const queueModule = root.BatchCutoutQueue;
    if (!queueModule) throw new Error("BatchCutoutQueue is required.");
    const queueController = queueModule.createController({
      state,
      elements,
      text,
      hasQualityIssue,
      qualityLabel,
      selectedItem,
      selectBatchIndex,
      renderPreview,
      renderStatus,
      refreshQualityAnalysis,
      stopBatchPlayback,
      scheduleBatchThumbnails,
    });
    const { updateQueueCard, renderQueue } = queueController;
    const processingHelpersModule = root.BatchCutoutProcessingHelpers;
    if (!processingHelpersModule) {
      throw new Error("BatchCutoutProcessingHelpers is required.");
    }
    processingHelpersController = processingHelpersModule.createController({
      state,
      elements,
      cutoutAnalysisExecutor,
      getCurrentAnimation: () => hooks.getCurrentAnimation?.(),
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
      documentRef: document,
      imageDataConstructor: ImageData,
      cryptoRef: globalThis.crypto,
    });
    const uiControllerModule = globalThis.BatchCutoutUiController;
    if (!uiControllerModule) throw new Error("BatchCutoutUiController is required.");
    const uiController = uiControllerModule.createController({
      elements,
      state,
      text,
      selectedItem,
      renderQueue,
      renderStatus,
      renderProtectionPreviewInfo,
      renderPreview,
      setPreviewScale,
      previewCanvasPoint,
      documentRef: document,
      windowRef: window,
      advancedSummary,
      advancedPresetButtons,
      advancedPresets,
      htmlElementConstructor: HTMLElement,
    });
    const {
      setPreviewProcessing,
      trapModalFocus,
      isEditableTarget,
      setEditorInert,
      renderLanguage,
      renderSessionMode,
      renderPreviewMode,
      resolveConfirmation,
      requestConfirmation,
      renderAdvancedMode,
      beginPreviewPan,
      zoomPreviewAtPointer,
      movePreviewPan,
      endPreviewPan,
      scrollBatchActionsByWheel,
      scrollBatchActionsByKeyboard,
    } = uiController;
    const settingsModule = globalThis.BatchCutoutSettings;
    if (!settingsModule) throw new Error("BatchCutoutSettings is required.");
    settingsController = settingsModule.createController({
      state,
      elements,
      hooks,
      imagePixelBudget,
      imagePixelLimits: IMAGE_PIXEL_LIMITS,
      text,
      selectedItem,
      hasQualityIssue,
      selectedBackgroundColor,
      colorUtils,
      recordItemEdit,
      invalidateItem,
      renderPreview,
      schedulePreview,
      renderAdvancedMode,
      advancedSummary,
      advancedPresetButtons,
      advancedPresets,
      previewLatestRepairAcrossBatch,
    });
    const processControllerModule = globalThis.BatchCutoutProcessController;
    if (!processControllerModule) {
      throw new Error("BatchCutoutProcessController is required.");
    }
    const processController = processControllerModule.createController({
      state,
      elements,
      text,
      setStatus,
      renderStatus,
      renderSessionMode,
      renderQueue,
      renderPreview,
      scheduleBatchThumbnails,
      stopBatchPlayback,
      mapSettledWithConcurrency,
      loadFileImage,
      imagePixelBudget,
      assertImagePixelBudget,
      createItem,
      processingOptions,
      repairReplayCore,
      cutoutExecutor,
      createThumbnailUrl,
      refreshQualityAnalysis,
      resultArtifacts,
      outputCore,
      batchZip,
      updateQueueCard,
      selectedItem,
      previewRepairsForItem: (item) => sessionCore.previewRepairsForItem(state, item),
      requestConfirmation,
      close: (...args) => close(...args),
      host: hooks,
      documentRef: document,
      windowRef: window,
      urlRef: URL,
      imageDataConstructor: ImageData,
      domExceptionConstructor: DOMException,
      maxImageFileBytes: MAX_IMAGE_FILE_BYTES,
      premiumFeatures: hooks.premiumFeatures,
      ensurePremiumActivated: hooks.ensurePremiumActivated,
    });
    const { loadFiles, loadCurrentGroup, processItem, processAll, downloadAll, applyCurrentGroup } =
      processController;
    const previewRendererModule = root.BatchCutoutPreviewRenderer;
    if (!previewRendererModule) throw new Error("BatchCutoutPreviewRenderer is required.");
    previewRenderer = previewRendererModule.createController({
      state,
      elements,
      text,
      selectedItem,
      selectedBackgroundColor,
      protectedColorEntries,
      recordItemEdit,
      invalidateItem,
      setStatus,
      schedulePreview: (...args) => schedulePreview(...args),
      processItem,
      drawPreviewCanvas,
      renderPreviewMode,
      renderPreviewZoom,
      setPreviewProcessing,
      drawRepairOverlay,
      syncProtectionPreview,
      drawProtectionPreview,
      renderProtectionPreviewInfo,
      renderStatus,
      updateQueueCard,
      createDiagnosticCanvas,
      colorUtils,
      backgroundController,
      documentRef: document,
    });
    const { renderProtectedColors, renderBackgroundSamples } = previewRenderer;

    const gestureControllerModule = globalThis.BatchCutoutGestureController;
    if (!gestureControllerModule) {
      throw new Error("BatchCutoutGestureController is required.");
    }
    const gestureController = gestureControllerModule.createController({
      state,
      elements,
      selectedItem,
      previewSourcePoint,
      drawRepairOverlay,
      drawProtectionPreview,
      windowRef: window,
      documentRef: document,
    });
    const {
      resultPointerPoint,
      captureRepairGestureCanvas,
      scheduleRepairGestureFrame,
      updateRepairGesture,
      cancelRepairGestureFrame,
    } = gestureController;

    /**
     * Creates a deferred tracking marker. Pixel-heavy context is captured by the
     * protected runtime only when cross-frame propagation is requested.
     * @param {object} item Active queue item.
     * @param {{x:number,y:number}} point Repair anchor point.
     * @param {{includeRegion?:boolean,tolerance?:number,sourceColor?:object}} [options] Capture options.
     * @returns {{localAnchor:null}} Deferred tracking marker.
     */
    function createRepairTrackingMetadata(_item, _point, _options = {}) {
      return { localAnchor: null };
    }

    const repairControllerModule = globalThis.BatchCutoutRepairController;
    if (!repairControllerModule) {
      throw new Error("BatchCutoutRepairController is required.");
    }
    const repairController = repairControllerModule.createController({
      state,
      elements,
      colorUtils,
      selectionRepairExecutor,
      createSelectionMask,
      encodeSubjectMask,
      detectNativeSubject,
      text,
      processItem,
      selectedItem,
      selectedBackgroundColor,
      selectedBackgroundColors,
      effectiveProtectedColors,
      createColorProtectionPreview,
      recordItemEdit,
      invalidateItem,
      setStatus,
      renderPreview,
      captureProcessingParameters,
      sessionCore,
      refreshQualityAnalysis,
      scheduleBatchThumbnails,
      applyCurrentGroup,
      cutoutAnalysisExecutor,
    });
    const { applyProtectionSelection, propagateLatestRepair } = repairController;

    const sessionControllerModule = globalThis.BatchCutoutSessionController;
    if (!sessionControllerModule) {
      throw new Error("BatchCutoutSessionController is required.");
    }
    const sessionController = sessionControllerModule.createController({
      state,
      elements,
      text,
      documentRef: document,
      host: hooks,
      setRepairMode,
      setEditorInert,
      renderLanguage,
      renderPreview,
      scheduleBatchThumbnails,
      stopBatchPlayback,
      cancelRepairGestureFrame,
      resolveConfirmation,
      resultArtifacts,
      assertImagePixelBudget,
      createItem,
      applyProcessingParametersToControls,
      selectedItem,
      renderQueue,
      setStatus,
      requestConfirmation,
      estimateBackgroundColor: cutoutCore.estimateBackgroundColor,
      backgroundController,
    });
    const { clear, deleteSelectedItems, open, openWorkset, close, requestClose, hasWorksetChanges } =
      sessionController;

    const eventsModule = globalThis.BatchCutoutEvents;
    if (!eventsModule) throw new Error("BatchCutoutEvents is required.");
    const eventController = eventsModule.createController({
      elements,
      state,
      windowRef: window,
      documentRef: document,
      navigatorRef: navigator,
      requestAnimationFrame,
      advancedPresetButtons,
      open,
      setStatus,
      text,
      requestClose,
      loadFiles,
      loadCurrentGroup,
      clear,
      downloadAll,
      applyCurrentGroup,
      selectBatchIndex,
      toggleBatchPlayback,
      setPreviewMode,
      setPreviewBackground,
      renderStatus,
      selectedItem,
      hasQualityIssue,
      renderQueue,
      renderPreview,
      scheduleBatchThumbnails,
      selectNextQualityIssue,
      deleteSelectedItems,
      invalidateItem,
      cutoutExecutor,
      beginPreviewPan,
      samplePreviewColor,
      resultPointerPoint,
      captureRepairGestureCanvas,
      scheduleRepairGestureFrame,
      updateRepairGesture,
      cancelRepairGestureFrame,
      recordItemEdit,
      createRepairTrackingMetadata,
      selectedAreaColor,
      applyProtectionSelection,
      selectedBackgroundColor,
      resolveProtectedColorInput,
      setPreviewScale,
      zoomPreviewAtPointer,
      movePreviewPan,
      endPreviewPan,
      setRepairMode,
      setAreaColorTransparent,
      updateLatestAreaRepair,
      updateLatestProtectionRepair,
      bindNumericRange,
      renderBackgroundSamples,
      renderProtectedColors,
      backgroundController,
      colorUtils,
      sessionCore,
      applyProcessingParametersToControls,
      refreshQualityAnalysis,
      propagateLatestRepair,
      previewLatestRepairAcrossBatch,
      applyAdvancedPreset,
      trapModalFocus,
      isEditableTarget,
      renderAdvancedMode,
      scrollBatchActionsByWheel,
      scrollBatchActionsByKeyboard,
      resolveConfirmation,
      schedulePreview,
    });
    eventController.bind();
    renderLanguage();
    renderAdvancedMode();
    setPreviewBackground(state.previewBackground);
    setRepairMode("automatic");
    renderPreview();
    return {
      open,
      openWorkset,
      close,
      requestClose,
      isOpen: () => !elements.cutoutModal.hidden,
      hasUnsavedChanges: () =>
        state.busy || (state.sourceKind === "workset" ? hasWorksetChanges() : state.items.length > 0),
      setLanguage(nextLanguage) {
        state.language = nextLanguage === "en" ? "en" : "zh";
        renderLanguage();
      },
    };
  }

  root.BatchCutout = { createController };
})(globalThis);
