(function attachFrameOrganizer(root) {
  "use strict";

  const textModule = root.FrameOrganizerText;
  const sequenceOrder = root.FrameSequenceOrder;

  /**
   * Creates the frame organizer controller.
   * @param {{
   *   getLanguage?:()=>string,
   *   getCurrentAnimation?:()=>object|null,
   *   getImportContext?:()=>{activeProject?:object|null,profiles?:object[]},
   *   applyPlan?:(items:Array<object>)=>Promise<void>,
   *   createAnimation?:(metadata:object,items:Array<object>)=>Promise<void>,
   *   createSessionAnimation?:(metadata:object,items:Array<object>)=>Promise<void>,
   *   exportAnimation?:(metadata:object,items:Array<object>,options?:object)=>Promise<object|null>,
   *   addToProject?:(request:{worksets:object[],sourceTool:string})=>Promise<void>,
   *   addAssets?:(items:Array<{name:string,image:HTMLCanvasElement}>)=>Promise<number>,
   *   editCutout?:(workset:{name:string,onLiveApply?:(outputs:Array<object>)=>void,items:Array<{name:string,image:HTMLCanvasElement,frame:object}>})=>Promise<Array<{canvas?:HTMLCanvasElement,data?:string,frame?:object}>|null>,
   *   onOpen?:(mode:"edit"|"import")=>void,
   *   onClose?:()=>void,
   *   onStatus?:(message:string)=>void
   * }} hooks Host integration hooks.
   * @returns {{open:(options?:object)=>Promise<void>,openImport:(options?:object)=>Promise<void>,close:(options?:object)=>void,requestClose:(options?:object)=>Promise<boolean>,isOpen:()=>boolean,getMode:()=>"edit"|"import",hasUnsavedChanges:()=>boolean,setLanguage:(language:string)=>void}}
   */
  function createController(hooks = {}) {
    const imagePixelBudget = root.ImagePixelBudget;
    if (!imagePixelBudget) throw new Error("ImagePixelBudget is required.");
    if (!textModule) throw new Error("FrameOrganizerText is required.");
    if (!sequenceOrder) throw new Error("FrameSequenceOrder is required.");
    const protectedRuntimeModule = root.ProtectedAlgorithmRuntime;
    if (!protectedRuntimeModule) throw new Error("ProtectedAlgorithmRuntime is required.");
    const protectedRuntime = protectedRuntimeModule.getDefaultRuntime(root);
    const sequenceAnalysisExecutor = protectedRuntimeModule.createFrameAnalysisExecutor(protectedRuntime);
    const frameAnalysisClient = {
      createExecutor() {
        return protectedRuntimeModule.createFrameAnalysisExecutor(protectedRuntime);
      },
    };
    const loopModule = root.FrameOrganizerLoop;
    if (!loopModule) throw new Error("FrameOrganizerLoop is required.");
    const videoModule = root.FrameOrganizerVideo;
    if (!videoModule) throw new Error("FrameOrganizerVideo is required.");
    const imageImportModule = root.FrameOrganizerImageImport;
    if (!imageImportModule) throw new Error("FrameOrganizerImageImport is required.");
    const gridModule = root.FrameOrganizerGrid;
    if (!gridModule) throw new Error("FrameOrganizerGrid is required.");
    const previewModule = root.FrameOrganizerPreview;
    if (!previewModule) throw new Error("FrameOrganizerPreview is required.");
    const actionModule = root.FrameOrganizerActions;
    if (!actionModule) throw new Error("FrameOrganizerActions is required.");
    const mediaExportDialogModule = root.MediaExportDialog;
    if (!mediaExportDialogModule) throw new Error("MediaExportDialog is required.");
    const batchZip = root.BatchZip;
    if (!batchZip) throw new Error("BatchZip is required.");
    const outputCore = root.BatchCutoutOutputCore;
    if (!outputCore) throw new Error("BatchCutoutOutputCore is required.");
    let sequenceAnalysisContextCache = null;
    const ids = [
      "organizerOpen",
      "organizerModal",
      "organizerCopyLink",
      "organizerHome",
      "organizerClose",
      "organizerTitle",
      "organizerSubtitle",
      "organizerImportSetup",
      "organizerProjectSelect",
      "organizerProjectNameField",
      "organizerProjectName",
      "organizerProfileName",
      "organizerAnimationName",
      "organizerImportFps",
      "organizerAnimationType",
      "organizerInvert",
      "organizerReduce",
      "organizerReduceStep",
      "organizerUndoDelete",
      "organizerViewExportJob",
      "organizerConfirmPanel",
      "organizerConfirmTitle",
      "organizerConfirmMessage",
      "organizerConfirmDetails",
      "organizerConfirmCancel",
      "organizerConfirmAccept",
      "organizerLoopPanel",
      "organizerLoopTitle",
      "organizerLoopClose",
      "organizerLoopParams",
      "organizerLoopPreference",
      "organizerLoopStartAuto",
      "organizerLoopStartCustom",
      "organizerLoopStartRow",
      "organizerLoopStartInput",
      "organizerLoopSearch",
      "organizerLoopSearchLabel",
      "organizerLoopProgressBar",
      "organizerLoopProgressText",
      "organizerLoopResults",
      "organizerLoopEmpty",
      "organizerLoopResultContent",
      "organizerLoopCandidates",
      "organizerLoopCanvas",
      "organizerLoopPrevious",
      "organizerLoopNext",
      "organizerLoopFrameInput",
      "organizerLoopFrameTotal",
      "organizerLoopFrameRange",
      "organizerLoopPlay",
      "organizerLoopSpeed",
      "organizerLoopCancel",
      "organizerLoopRetry",
      "organizerLoopStartSearch",
      "organizerLoopTrim",
      "organizerAutoSort",
      "organizerOrderFilename",
      "organizerOrderSelection",
      "organizerFlip",
      "organizerImport",
      "organizerFileInput",
      "organizerImportVideo",
      "organizerVideoInput",
      "organizerVideoPanel",
      "organizerVideoClose",
      "organizerVideoElement",
      "organizerVideoName",
      "organizerVideoMeta",
      "organizerVideoReselect",
      "organizerVideoStart",
      "organizerVideoEnd",
      "organizerVideoStartRange",
      "organizerVideoEndRange",
      "organizerVideoDuration",
      "organizerVideoFps",
      "organizerVideoFpsNumber",
      "organizerVideoEstimate",
      "organizerVideoStatus",
      "organizerVideoCancel",
      "organizerVideoExtract",
      "organizerDeleteSelected",
      "organizerDeleteExcluded",
      "organizerThreshold",
      "organizerThresholdValue",
      "organizerFindJump",
      "organizerFindDuplicate",
      "organizerFindLoop",
      "organizerAnalysisFeedback",
      "organizerReset",
      "organizerAddAssets",
      "organizerGodotPlaceholder",
      "organizerGodotHandoffBadge",
      "organizerExport",
      "organizerAddProject",
      "organizerApply",
      "organizerGrid",
      "organizerStatus",
      "organizerCount",
      "organizerSelection",
      "organizerPreview",
      "organizerPreviewFrame",
      "organizerSpeed",
      "organizerBatchCutout",
      "organizerViewOriginal",
      "organizerViewEdited",
      "mediaExportDialog",
      "mediaExportClose",
      "mediaExportFrameCount",
      "mediaExportFps",
      "mediaExportCanvas",
      "mediaExportFrames",
      "mediaExportSheet",
      "mediaExportGif",
      "mediaExportMov",
      "mediaExportLocalHint",
      "mediaExportStatus",
      "mediaExportDownloads",
      "mediaExportCancel",
      "mediaExportSubmit",
    ];
    const elements = Object.fromEntries(ids.map((id) => [id, document.querySelector(`#${id}`)]));
    const state = {
      language: hooks.getLanguage?.() === "en" ? "en" : "zh",
      mode: "edit",
      frames: [],
      importOrderStrategy: sequenceOrder.ORDER_STRATEGIES.FILENAME,
      nextImportBatchIndex: 0,
      anchorIndex: -1,
      previewIndex: 0,
      previewTimer: 0,
      viewMode: "edited",
      busy: false,
      sequenceAnalyzing: false,
      animationName: "",
      videoUrl: "",
      videoFileName: "",
      videoDuration: 0,
      videoWidth: 0,
      videoHeight: 0,
      videoExtracting: false,
      returnFocus: null,
      deletedFramesSnapshot: null,
      confirmResolver: null,
      loopStage: "params",
      loopPreference: "auto",
      loopCandidates: [],
      loopCandidateIndex: -1,
      loopPreviewIndex: 0,
      loopTimer: 0,
      loopSearchToken: 0,
      loopCancelled: false,
      loopSourceEntries: [],
      baselineFrameIds: [],
      premiumFeatures: new Set(),
    };
    const IMAGE_PIXEL_LIMITS = Object.freeze({
      maxPixelsPerImage: 16_777_216,
      maxTotalPixels: 64_000_000,
    });
    const text = textModule.createTranslator(() => state.language);

    let organizerActionsController = null;

    /** Dispatches a staged-workset action after its dependencies are ready. */
    function organizerActionCall(name, ...args) {
      if (!organizerActionsController) throw new Error("FrameOrganizerActions is not initialized.");
      return organizerActionsController[name](...args);
    }

    function editImportCutout(...args) {
      return organizerActionCall("editImportCutout", ...args);
    }

    /** Opens the complete organizer workset with the standard automatic batch profile. */
    function editBatchCutout(...args) {
      return organizerActionCall("editBatchCutout", ...args);
    }

    function applyPlan(...args) {
      return organizerActionCall("applyPlan", ...args);
    }

    function importIntoSession(...args) {
      return organizerActionCall("importIntoSession", ...args);
    }

    function addIncludedFramesToAssets(...args) {
      return organizerActionCall("addIncludedFramesToAssets", ...args);
    }

    /** Exports the included workset through the host ZIP boundary. @returns {Promise<void>} */
    function exportIncludedFrames(...args) {
      return organizerActionCall("exportIncludedFrames", ...args);
    }

    const previewController = previewModule.createController({
      elements,
      state,
      text,
      includedFrames,
      clamp,
    });
    const { drawFrameToCanvas, renderPreview, playbackDelay, schedulePreviewFrame, restartPreview } =
      previewController;
    let uiController = null;

    const gridController = gridModule.createController({
      elements,
      state,
      text,
      getCurrentAnimation: () => hooks.getCurrentAnimation?.(),
      canAddAssets: () => typeof hooks.addAssets === "function",
      canExport: () => typeof hooks.exportAnimation === "function",
      browserExportOnly: hooks.browserExportOnly === true,
      editImportCutout,
      renderPreview,
      restartPreview,
      setStatus,
    });
    const { renderCounts, renderGrid, selectFrame, selectIndexes } = gridController;

    const videoImporter = videoModule.createController({
      elements,
      state,
      text,
      formatVideoTime: videoModule.formatVideoTime,
      createFrame,
      renderCounts,
      renderGrid,
      restartPreview,
      setStatus,
    });
    const imageImporter = imageImportModule.createController({
      elements,
      state,
      text,
      imagePixelBudget,
      assertImagePixelBudget,
      createFrame,
      renderCounts,
      renderGrid,
      restartPreview,
      setStatus,
    });
    const loopFinder = loopModule.createController({
      elements,
      state,
      text,
      workerClient: frameAnalysisClient,
      includedFrames,
      frameSignature,
      drawFrameToCanvas,
      selectIndexes,
      playbackDelay,
      renderCounts,
      restartPreview,
      setStatus,
      clamp,
      onPremiumFeatureUsed: (featureId) => state.premiumFeatures.add(featureId),
    });
    /**
     * Validates decoded image memory before allocating organizer canvases.
     * @param {CanvasImageSource} source Browser image or canvas source.
     * @param {number} currentPixels Pixels already retained by the workset.
     * @returns {{width:number,height:number,pixels:number,totalPixels:number}} Accepted metrics.
     * @throws {Error} When the image or workset exceeds its decoded-pixel budget.
     */
    function assertImagePixelBudget(source, currentPixels = 0) {
      const result = imagePixelBudget.evaluate(source, currentPixels, IMAGE_PIXEL_LIMITS);
      if (result.allowed) return result;
      const limit = Math.max(1, Math.floor(result.limit / 1_000_000));
      if (result.reason === "single") {
        throw new Error(text("imagePixelLimit", { width: result.width, height: result.height, limit }));
      }
      if (result.reason === "total") throw new Error(text("batchPixelLimit", { limit }));
      throw new Error(text("importInvalid"));
    }

    /**
     * Keeps a numeric value inside an inclusive range.
     * @param {number} value Candidate value.
     * @param {number} minimum Inclusive minimum.
     * @param {number} maximum Inclusive maximum.
     * @returns {number}
     */
    function clamp(value, minimum, maximum) {
      return Math.max(minimum, Math.min(maximum, Number(value || 0)));
    }

    /**
     * Returns selected frame records.
     * @returns {object[]}
     */
    function selectedFrames() {
      return state.frames.filter((frame) => frame.selected);
    }

    /**
     * Returns frames included in the active workset.
     * @returns {object[]}
     */
    function includedFrames() {
      return state.frames.filter((frame) => frame.included);
    }

    /**
     * Publishes a status message to both organizer and host.
     * @param {string} message Status text.
     * @param {"idle"|"success"|"error"|"busy"} tone Visual tone.
     * @returns {void}
     */
    function setStatus(message, tone = "idle") {
      elements.organizerStatus.textContent = message;
      elements.organizerStatus.dataset.tone = tone;
      hooks.onStatus?.(message);
    }

    /**
     * Converts an image to a reusable source canvas.
     * @param {CanvasImageSource} image Image source.
     * @returns {HTMLCanvasElement}
     */
    function imageCanvas(image) {
      const dimensions = assertImagePixelBudget(image);
      const canvas = document.createElement("canvas");
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    }

    /**
     * Creates one organizer frame record.
     * @param {CanvasImageSource} image Source image.
     * @param {{sourceIndex?:number,originalIndex?:number,sourcePath?:string,name?:string,imported?:boolean,reuseCanvas?:boolean,sourceType?:"manifest"|"image"|"video",importBatchIndex?:number,importSelectionIndex?:number,importFilenameIndex?:number}} options Frame metadata.
     * @returns {object}
     */
    function createFrame(image, options = {}) {
      const originalCanvas =
        options.reuseCanvas && image instanceof HTMLCanvasElement ? image : imageCanvas(image);
      const orderMetadata = sequenceOrder.createFrameOrderMetadata({
        sourceType:
          options.sourceType ||
          (options.imported ? sequenceOrder.SOURCE_TYPES.IMAGE : sequenceOrder.SOURCE_TYPES.MANIFEST),
        batchIndex: options.importBatchIndex,
        selectionIndex: options.importSelectionIndex ?? options.sourceIndex ?? options.originalIndex,
        filenameIndex: options.importFilenameIndex ?? options.sourceIndex ?? options.originalIndex,
      });
      return {
        uid: root.crypto?.randomUUID?.() || `frame_${Date.now()}_${Math.random()}`,
        sourceIndex: Number.isInteger(options.sourceIndex) ? options.sourceIndex : null,
        originalIndex: Number.isInteger(options.originalIndex) ? options.originalIndex : null,
        sourcePath: String(options.sourcePath || ""),
        name: String(options.name || "frame.png"),
        ...orderMetadata,
        originalCanvas,
        editedCanvas: originalCanvas,
        included: true,
        selected: false,
        flipped: false,
        imported: Boolean(options.imported),
        tag: "",
        analysisMatch: "",
        signature: null,
        analysisRevision: 0,
        thumbnails: { original: "", edited: "" },
      };
    }

    /**
     * Returns or creates the reference 256×256 RGBA analysis sample.
     * Canvas performs the same browser-native resampling used by the reference client.
     * @param {object} frame Organizer frame.
     * @returns {{data:Uint8ClampedArray,width:number,height:number}}
     */
    function frameSignature(frame) {
      if (frame.signature) return frame.signature;
      const sampleSize = 256;
      const canvas = document.createElement("canvas");
      canvas.width = sampleSize;
      canvas.height = sampleSize;
      const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
      context.clearRect(0, 0, sampleSize, sampleSize);
      context.drawImage(frame.editedCanvas, 0, 0, sampleSize, sampleSize);
      const imageData = context.getImageData(0, 0, sampleSize, sampleSize);
      frame.signature = { data: imageData.data, width: imageData.width, height: imageData.height };
      return frame.signature;
    }

    /**
     * Builds a revision-aware workset key without hashing 256² samples again.
     * @param {Array<{frame:object,index:number}>} entries Included sequence entries.
     * @returns {string} Ordered workset identity.
     */
    function analysisWorksetCacheKey(entries) {
      return entries.map(({ frame }) => `${frame.uid}:${Number(frame.analysisRevision || 0)}`).join(",");
    }

    /**
     * Returns the current workset's shared duplicate/jump analysis context.
     * Revisions make the context expire after a flip or any image-edit operation.
     * @param {Array<{frame:object,index:number}>} entries Included sequence entries.
     * @returns {{signatures:Array<object>}} Cached signature workset.
     */
    function sequenceAnalysisContext(entries) {
      const key = analysisWorksetCacheKey(entries);
      if (sequenceAnalysisContextCache?.key === key) return sequenceAnalysisContextCache;
      const signatures = entries.map((entry) => frameSignature(entry.frame));
      sequenceAnalysisContextCache = {
        key,
        signatures,
      };
      return sequenceAnalysisContextCache;
    }

    /**
     * Reloads organizer state from the current host animation.
     * @returns {Promise<void>}
     */
    async function loadCurrentAnimation() {
      state.premiumFeatures.clear();
      state.importOrderStrategy = sequenceOrder.ORDER_STRATEGIES.FILENAME;
      state.nextImportBatchIndex = 0;
      const animation = hooks.getCurrentAnimation?.();
      if (!animation?.frames?.length || animation.images?.length !== animation.frames.length) {
        state.frames = [];
        state.baselineFrameIds = [];
        state.animationName = "";
        renderGrid();
        renderPreview();
        setStatus(text("noGroup"), "error");
        return;
      }
      try {
        let retainedPixels = 0;
        animation.images.forEach((image) => {
          retainedPixels = assertImagePixelBudget(image, retainedPixels).totalPixels;
        });
      } catch (error) {
        state.frames = [];
        state.baselineFrameIds = [];
        state.animationName = "";
        renderGrid();
        renderPreview();
        setStatus(error.message, "error");
        return;
      }
      state.frames = animation.frames.map((frame, index) =>
        createFrame(animation.images[index], {
          sourceIndex: index,
          originalIndex: index,
          sourcePath: frame.path,
          name: frame.name,
        }),
      );
      state.baselineFrameIds = state.frames.map((frame) => frame.uid);
      state.animationName = animation.name;
      state.anchorIndex = -1;
      state.previewIndex = 0;
      renderGrid();
      restartPreview();
      setStatus(text("loaded", { name: animation.name, count: state.frames.length }), "success");
    }

    /**
     * Runs jump or duplicate analysis against currently included frames.
     * @param {"jump"|"duplicate"} type Analysis type.
     * @returns {Promise<void>}
     */
    async function analyze(type) {
      if (state.sequenceAnalyzing) return;
      state.premiumFeatures.add("organizer.sequence-analysis");
      const included = state.frames
        .map((frame, index) => ({ frame, index }))
        .filter((entry) => entry.frame.included);
      const { signatures } = sequenceAnalysisContext(included);
      const threshold = Number(elements.organizerThreshold.value);
      const isJumpAnalysis = type === "jump";
      const searchingMessage = text(isJumpAnalysis ? "jumpSearching" : "duplicateSearching");
      state.sequenceAnalyzing = true;
      elements.organizerFindJump.setAttribute("aria-busy", String(isJumpAnalysis));
      elements.organizerFindDuplicate.setAttribute("aria-busy", String(!isJumpAnalysis));
      elements.organizerAnalysisFeedback.textContent = searchingMessage;
      elements.organizerAnalysisFeedback.dataset.tone = "busy";
      setStatus(searchingMessage, "busy");
      renderCounts();
      let result;
      try {
        result = await sequenceAnalysisExecutor.analyze(signatures, { operation: type, threshold });
      } catch (error) {
        const message = error?.code || error?.message || "ENGINE_EXECUTION_FAILED";
        elements.organizerAnalysisFeedback.textContent = message;
        elements.organizerAnalysisFeedback.dataset.tone = "error";
        setStatus(message, "error");
        return;
      } finally {
        state.sequenceAnalyzing = false;
        elements.organizerFindJump.removeAttribute("aria-busy");
        elements.organizerFindDuplicate.removeAttribute("aria-busy");
        renderCounts();
      }
      if (type === "jump") {
        const { matches } = result;
        selectIndexes(
          matches.map((match) => included[match.index].index),
          "jump",
        );
        if (result.autoAdjustedThreshold != null) {
          elements.organizerThreshold.value = String(result.autoAdjustedThreshold);
          elements.organizerThresholdValue.textContent = String(result.autoAdjustedThreshold);
        }
        const adjusted =
          result.autoAdjustedThreshold == null
            ? ""
            : ` · ${text("thresholdAdjusted", { threshold: result.autoAdjustedThreshold })}`;
        const message = matches.length
          ? `${text("foundJump", { count: matches.length })}${adjusted}`
          : text("noJumpFound");
        elements.organizerAnalysisFeedback.textContent = message;
        elements.organizerAnalysisFeedback.dataset.tone = matches.length ? "jump" : "idle";
        setStatus(message, matches.length ? "success" : "idle");
        return;
      }
      const { matches } = result;
      selectIndexes(
        matches.map((match) => included[match.index].index),
        "duplicate",
      );
      if (result.autoAdjustedThreshold != null) {
        elements.organizerThreshold.value = String(result.autoAdjustedThreshold);
        elements.organizerThresholdValue.textContent = String(result.autoAdjustedThreshold);
      }
      const adjusted =
        result.autoAdjustedThreshold == null
          ? ""
          : ` · ${text("thresholdAdjusted", { threshold: result.autoAdjustedThreshold })}`;
      const message = matches.length
        ? `${text("foundDuplicate", { count: matches.length })}${adjusted}`
        : text("noDuplicateFound");
      elements.organizerAnalysisFeedback.textContent = message;
      elements.organizerAnalysisFeedback.dataset.tone = matches.length ? "duplicate" : "idle";
      setStatus(message, matches.length ? "success" : "idle");
    }

    /**
     * Mirrors selected frames or the entire workset when nothing is selected.
     * @returns {void}
     */
    function flipFrames() {
      const targets = selectedFrames().length ? selectedFrames() : includedFrames();
      targets.forEach((frame) => {
        const source = frame.editedCanvas;
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext("2d");
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
        context.drawImage(source, 0, 0);
        frame.editedCanvas = canvas;
        frame.flipped = !frame.flipped;
        frame.signature = null;
        frame.analysisRevision = Number(frame.analysisRevision || 0) + 1;
        frame.thumbnails.edited = "";
      });
      renderGrid();
      renderPreview();
      setStatus(text("flipped", { count: targets.length }), "success");
    }

    organizerActionsController = actionModule.createController({
      state,
      elements,
      hooks,
      text,
      includedFrames,
      imageCanvas,
      renderGrid,
      renderCounts,
      restartPreview,
      setStatus,
      loadCurrentAnimation,
      importMetadata: () => uiController.importMetadata(),
      renderLanguage: () => uiController.renderLanguage(),
      closeOrganizer: (options) => close(options),
      getUiController: () => uiController,
      window,
      document,
      batchZip,
      outputCore,
      cssEscape: (value) => CSS.escape(value),
      premiumFeatures: hooks.premiumFeatures,
    });
    const mediaExportDialog = mediaExportDialogModule.createController({
      elements,
      getLanguage: () => state.language,
      getSummary: () => {
        const frames = includedFrames();
        const animation = hooks.getCurrentAnimation?.() || {};
        const width = Math.max(0, ...frames.map((frame) => Number(frame.editedCanvas?.width) || 0));
        const height = Math.max(0, ...frames.map((frame) => Number(frame.editedCanvas?.height) || 0));
        return {
          frameCount: frames.length,
          fps:
            state.mode === "import"
              ? Number(elements.organizerImportFps.value || 12)
              : Number(animation.fps || 12),
          canvas: width && height ? `${width}×${height}` : "—",
        };
      },
      onExport: (options) => exportIncludedFrames(options),
      fetchImpl: root.fetch,
      onRecoveryChange: (job) => {
        elements.organizerViewExportJob.hidden = !job?.id;
      },
    });
    const hasRecentExportJob = Boolean(root.LocalMediaExportClient?.getLastJobId?.());
    elements.organizerViewExportJob.hidden = !hasRecentExportJob;
    elements.organizerViewExportJob.addEventListener("click", () => mediaExportDialog.open());

    /**
     * Opens the organizer and reloads the current animation.
     * @param {{syncRoute?:boolean}} [options] Route synchronization behavior.
     * @returns {Promise<void>}
     */
    async function open(options = {}) {
      state.returnFocus = document.activeElement;
      state.mode = "edit";
      state.deletedFramesSnapshot = null;
      elements.organizerUndoDelete.hidden = true;
      elements.organizerModal.hidden = false;
      uiController.setEditorInert(true);
      document.body.classList.add("organizerOpen");
      if (options.syncRoute !== false) hooks.onOpen?.("edit");
      uiController.renderLanguage();
      await loadCurrentAnimation();
      elements.organizerFileInput.focus();
    }

    /**
     * Opens a blank organizer workset for creating a new animation.
     * @param {{syncRoute?:boolean}} [options] Route synchronization behavior.
     * @returns {Promise<void>}
     */
    async function openImport(options = {}) {
      state.returnFocus = document.activeElement;
      state.mode = "import";
      state.frames = [];
      state.importOrderStrategy = sequenceOrder.ORDER_STRATEGIES.FILENAME;
      state.nextImportBatchIndex = 0;
      state.animationName = "";
      state.anchorIndex = -1;
      state.previewIndex = 0;
      state.deletedFramesSnapshot = null;
      state.premiumFeatures.clear();
      elements.organizerUndoDelete.hidden = true;
      elements.organizerModal.hidden = false;
      uiController.setEditorInert(true);
      document.body.classList.add("organizerOpen");
      if (options.syncRoute !== false) hooks.onOpen?.("import");
      uiController.renderImportContext(true);
      uiController.renderLanguage();
      renderGrid();
      restartPreview();
      setStatus(text("importReady"));
      elements.organizerProjectSelect.focus();
    }

    /**
     * Closes the organizer.
     * @param {{syncRoute?:boolean}} [options] Route synchronization behavior.
     * @returns {void}
     */
    function close(options = {}) {
      if (state.videoExtracting) return;
      if (loopFinder.isOpen()) loopFinder.close();
      videoImporter.close();
      elements.organizerModal.hidden = true;
      uiController.setEditorInert(false);
      document.body.classList.remove("organizerOpen");
      if (options.syncRoute !== false) hooks.onClose?.();
      window.clearTimeout(state.previewTimer);
      if (state.returnFocus && typeof state.returnFocus.focus === "function") state.returnFocus.focus();
    }

    /**
     * Requests a safe close and confirms before discarding staged workset changes.
     * @param {{syncRoute?:boolean,force?:boolean}} [options] Close behavior.
     * @returns {Promise<boolean>} Whether the organizer closed.
     */
    async function requestClose(options = {}) {
      if (state.busy || state.videoExtracting) return false;
      if (uiController.hasUnsavedChanges() && !options.force) {
        const confirmed = await uiController.requestConfirmation(text("discardConfirm"), [], {
          title: text("discardTitle"),
          confirmLabel: text("discardAccept"),
          tone: "danger",
        });
        if (!confirmed) return false;
      }
      close(options);
      return true;
    }

    uiController = root.FrameOrganizerUi.createController({
      elements,
      state,
      text,
      hooks,
      clamp,
      setStatus,
      renderCounts,
      renderGrid,
      renderPreview,
      restartPreview,
      schedulePreviewFrame,
      selectedFrames,
      includedFrames,
      open,
      requestClose,
      flipFrames,
      analyze,
      loadCurrentAnimation,
      applyPlan,
      editBatchCutout,
      importIntoSession,
      addIncludedFramesToAssets,
      exportIncludedFrames,
      addIncludedFramesToProject: () => organizerActionCall("addIncludedFramesToProject"),
      openExportDialog: () => mediaExportDialog.open(),
      selectFrame,
      imageImporter,
      videoImporter,
      loopFinder,
      sequenceOrder,
    });
    uiController.bindEvents();
    uiController.renderLanguage();
    renderCounts();
    return {
      open,
      openImport,
      close,
      requestClose,
      isOpen: () => !elements.organizerModal.hidden,
      getMode: () => state.mode,
      hasUnsavedChanges: () => uiController.hasUnsavedChanges(),
      setLanguage(nextLanguage) {
        state.language = nextLanguage === "en" ? "en" : "zh";
        uiController.renderLanguage();
      },
    };
  }

  root.FrameOrganizer = { createController };
})(globalThis);
