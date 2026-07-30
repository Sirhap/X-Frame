(function attachFrameOrganizerActions(root, factory) {
  "use strict";

  const smartCutoutDefaults =
    typeof module === "object" && module.exports
      ? require("./smart_cutout_defaults")
      : root?.XSXBSmartCutoutDefaults;
  const api = factory(root, smartCutoutDefaults);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root, smartCutoutDefaults) => {
  "use strict";

  if (!smartCutoutDefaults?.REGULAR_AUTO_BACKGROUND_PARAMETERS) {
    throw new Error("Shared smart-cutout defaults are required.");
  }
  /** Default automatic-removal profile used by the organizer's batch action. */
  const ORGANIZER_BATCH_CUTOUT_PARAMETERS = smartCutoutDefaults.REGULAR_AUTO_BACKGROUND_PARAMETERS;

  /**
   * Creates the frame-organizer operation controller.
   *
   * The controller keeps the three host-facing workset actions together while
   * receiving all organizer state and rendering callbacks from the entry point.
   * This preserves the existing call order without duplicating organizer logic.
   *
   * @param {{
   *   elements:Record<string,any>,
   *   state:Record<string,any>,
   *   text:(key:string,variables?:Record<string,string|number>)=>string,
   *   hooks?:{browserExportOnly?:boolean,getCurrentAnimation?:()=>object|null,applyPlan?:(items:Array<object>,options?:object)=>Promise<void>,createAnimation?:(metadata:object,items:Array<object>,options?:object)=>Promise<void>,createSessionAnimation?:(metadata:object,items:Array<object>,options?:object)=>Promise<void>,exportAnimation?:(metadata:object,items:Array<object>,options?:object)=>Promise<object|null>,addToProject?:(request:{worksets:object[],sourceTool:string})=>Promise<void>,addAssets?:(items:Array<object>)=>Promise<number>,editCutout?:(workset:object)=>Promise<Array<object>|null>,ensurePremiumActivated?:(featureIds:string[])=>Promise<boolean>},
   *   includedFrames:()=>object[],
   *   imageCanvas:(image:CanvasImageSource)=>HTMLCanvasElement,
   *   renderCounts:()=>void,
   *   renderGrid:()=>void,
   *   restartPreview:()=>void,
   *   loadCurrentAnimation:()=>Promise<void>,
   *   importMetadata:()=>object,
   *   renderLanguage:()=>void,
   *   closeOrganizer?:(options?:object)=>void,
   *   getUiController:()=>object|null,
   *   setStatus:(message:string,tone?:string)=>void,
   *   window?:Window,
   *   windowRef?:Window,
   *   document?:Document,
   *   cssEscape?:(value:string)=>string,
   *   premiumFeatures?:{normalizeFeatureIds?:(featureIds:Iterable<string>)=>string[]}
   * }} dependencies Organizer state and host callbacks.
   * @returns {{editImportCutout:(targetFrame:object)=>Promise<void>,editBatchCutout:()=>Promise<void>,applyPlan:()=>Promise<void>,importIntoSession:()=>Promise<void>,addIncludedFramesToAssets:()=>Promise<void>,addIncludedFramesToProject:()=>Promise<void>,exportIncludedFrames:()=>Promise<void>}}
   */
  function createController(dependencies = {}) {
    const {
      elements,
      state,
      text,
      hooks = {},
      includedFrames,
      imageCanvas,
      renderCounts,
      renderGrid,
      restartPreview,
      loadCurrentAnimation,
      importMetadata,
      renderLanguage,
      closeOrganizer,
      getUiController,
      setStatus,
      premiumFeatures = root?.XSXBPremiumFeatures,
    } = dependencies;
    if (
      !elements ||
      !state ||
      typeof text !== "function" ||
      typeof includedFrames !== "function" ||
      typeof imageCanvas !== "function" ||
      typeof renderCounts !== "function" ||
      typeof renderGrid !== "function" ||
      typeof restartPreview !== "function" ||
      typeof loadCurrentAnimation !== "function" ||
      typeof importMetadata !== "function" ||
      typeof renderLanguage !== "function" ||
      typeof getUiController !== "function" ||
      typeof setStatus !== "function"
    ) {
      throw new TypeError("Frame organizer action dependencies are required.");
    }
    const windowApi = dependencies.window || dependencies.windowRef || root.window;
    if (!windowApi || typeof windowApi.clearTimeout !== "function") {
      throw new Error("A window implementation is required for frame organizer actions.");
    }
    const cssEscape = dependencies.cssEscape || root.CSS?.escape || ((value) => String(value));

    /**
     * Returns the initialized UI controller used by action confirmations and
     * focus management.
     * @returns {object} Organizer UI controller.
     * @throws {Error} When an action is called before UI initialization.
     */
    function uiController() {
      const controller = getUiController();
      if (!controller) throw new Error("Frame organizer UI controller is required.");
      return controller;
    }

    /**
     * Opens the shared cutout workbench and writes processed canvases and parameter state back to frames.
     * @param {{mode:"single"|"batch",sourceFrames:object[],selectedIndex?:number,autoDetectBackground?:boolean,processingParameters?:object,returnFrame?:object|null}} options Workbench behavior.
     * @returns {Promise<void>}
     */
    async function runCutoutWorkset(options) {
      const sourceFrames = Array.from(options.sourceFrames || []);
      if (!sourceFrames.length) {
        setStatus(text("cutoutNeedFrames"), "error");
        return;
      }
      if (typeof hooks.editCutout !== "function") {
        setStatus(text("failed", { message: "Batch cutout is unavailable." }), "error");
        return;
      }
      /**
       * Copies live or final cutout outputs into the organizer workset.
       * @param {Array<object>} outputs Processed workset outputs.
       * @returns {void}
       */
      const applyCutoutOutputs = (outputs) => {
        if (outputs.length !== sourceFrames.length) {
          throw new Error(`Expected ${sourceFrames.length} cutout frames, received ${outputs.length}.`);
        }
        const outputByUid = new Map(
          outputs.filter((output) => output?.frame?.uid).map((output) => [output.frame.uid, output]),
        );
        sourceFrames.forEach((frame, index) => {
          const output = outputByUid.get(frame.uid) || outputs[index];
          if (!output?.canvas) throw new Error(`Missing cutout canvas for frame ${index + 1}.`);
          frame.editedCanvas = imageCanvas(output.canvas);
          frame.imported = true;
          frame.flipped = false;
          frame.signature = null;
          frame.analysisRevision = Number(frame.analysisRevision || 0) + 1;
          frame.thumbnails.edited = "";
          if (output.cutoutState) frame.cutoutState = output.cutoutState;
        });
        for (const featureId of premiumFeatures?.normalizeFeatureIds?.(outputs.premiumFeatures) || []) {
          state.premiumFeatures.add(featureId);
        }
        renderGrid();
      };
      state.busy = true;
      renderCounts();
      windowApi.clearTimeout(state.previewTimer);
      elements.organizerModal.inert = true;
      elements.organizerModal.setAttribute("aria-hidden", "true");
      try {
        const outputs = await hooks.editCutout({
          name: elements.organizerAnimationName.value.trim() || "animation",
          mode: options.mode,
          selectedIndex: Number(options.selectedIndex) || 0,
          autoDetectBackground: Boolean(options.autoDetectBackground),
          processingParameters: options.processingParameters,
          onLiveApply: applyCutoutOutputs,
          items: sourceFrames.map((frame) => ({
            name: frame.name,
            image: frame.editedCanvas,
            frame: { uid: frame.uid },
            cutoutState: frame.cutoutState,
          })),
        });
        if (!outputs) return;
        applyCutoutOutputs(outputs);
        setStatus(text("cutoutReady", { count: outputs.length }), "success");
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
      } finally {
        state.busy = false;
        elements.organizerModal.inert = false;
        elements.organizerModal.removeAttribute("aria-hidden");
        uiController().setEditorInert(true);
        renderGrid();
        restartPreview();
        if (options.returnFrame) {
          elements.organizerGrid
            .querySelector(`[data-frame-uid="${cssEscape(options.returnFrame.uid)}"] .organizerFrameCutout`)
            ?.focus({ preventScroll: true });
        } else {
          elements.organizerBatchCutout?.focus({ preventScroll: true });
        }
      }
    }

    /**
     * Opens one workset frame while retaining the full image set as propagation targets.
     * Stored parameters are supplied with each frame so the controls reflect its last batch result.
     * @param {object} targetFrame Organizer frame to edit.
     * @returns {Promise<void>}
     */
    async function editImportCutout(targetFrame) {
      if (!targetFrame || !state.frames.includes(targetFrame)) {
        setStatus(text("cutoutNeedFrames"), "error");
        return;
      }
      await runCutoutWorkset({
        mode: "single",
        sourceFrames: state.frames,
        selectedIndex: state.frames.indexOf(targetFrame),
        returnFrame: targetFrame,
      });
    }

    /**
     * Opens all included frames with automatic background detection and the organizer batch profile.
     * @returns {Promise<void>}
     */
    async function editBatchCutout() {
      await runCutoutWorkset({
        mode: "batch",
        sourceFrames: includedFrames(),
        autoDetectBackground: true,
        processingParameters: { ...ORGANIZER_BATCH_CUTOUT_PARAMETERS },
      });
    }

    /**
     * Applies the staged frame plan through the host application.
     * @returns {Promise<void>}
     */
    async function applyPlan() {
      const frames = includedFrames();
      let metadata = null;
      try {
        if (state.mode === "import") metadata = importMetadata();
      } catch (error) {
        setStatus(error.message, "error");
        return;
      }
      const controller = uiController();
      const usedPremiumFeatures =
        premiumFeatures?.normalizeFeatureIds?.(Array.from(state.premiumFeatures || [])) ||
        Array.from(state.premiumFeatures || []);
      const sessionImport = hooks.browserExportOnly === true && state.mode === "import";
      const browserExportOnly = hooks.browserExportOnly === true && state.mode === "import" && !sessionImport;
      const confirmation =
        state.mode === "import"
          ? text(browserExportOnly ? "exportConfirm" : "createConfirm", { count: frames.length })
          : text("applyConfirm");
      const details =
        state.mode === "import"
          ? [
              [text("detailProject"), metadata.projectId || metadata.projectLabel],
              [text("detailProfile"), metadata.profileLabel],
              [text("detailAnimation"), metadata.animationName],
              [text("detailFrames"), frames.length],
              [text("detailFps"), metadata.fps],
            ]
          : [
              [text("detailAnimation"), state.animationName],
              [text("detailFrames"), frames.length],
            ];
      if (!frames.length || !(await controller.requestConfirmation(confirmation, details))) return;
      state.busy = true;
      renderCounts();
      try {
        const items = frames.map((frame) => ({
          sourceIndex: frame.sourceIndex,
          sourcePath: frame.sourcePath,
          name: frame.name,
          flipped: frame.flipped,
          data:
            state.mode === "import" || frame.imported || frame.flipped
              ? frame.editedCanvas.toDataURL("image/png")
              : "",
        }));
        if (state.mode === "import") {
          const createAnimation = sessionImport ? hooks.createSessionAnimation : hooks.createAnimation;
          if (typeof createAnimation !== "function") throw new Error("Animation import is unavailable.");
          await createAnimation(metadata, items, { premiumFeatures: usedPremiumFeatures });
          setStatus(text(browserExportOnly ? "exportedZip" : "created", { count: items.length }), "success");
          if (!browserExportOnly) state.mode = "edit";
          renderLanguage();
          if (typeof closeOrganizer === "function") {
            closeOrganizer();
            return;
          }
        } else {
          await hooks.applyPlan?.(items, { premiumFeatures: usedPremiumFeatures });
          setStatus(text("applied", { count: items.length }), "success");
        }
        await loadCurrentAnimation();
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
      } finally {
        state.busy = false;
        renderCounts();
      }
    }

    /**
     * Imports the current browser workset into a transient tuning-session animation group.
     * @returns {Promise<void>}
     */
    async function importIntoSession() {
      await applyPlan();
    }

    /**
     * Adds included processed frames to the active group's reusable asset tray.
     * @returns {Promise<void>}
     */
    async function addIncludedFramesToAssets() {
      const frames = includedFrames();
      if (!frames.length || typeof hooks.addAssets !== "function") return;
      state.busy = true;
      renderCounts();
      try {
        const count = await hooks.addAssets(
          frames.map((frame) => ({
            name: frame.name,
            image: frame.editedCanvas,
          })),
        );
        setStatus(text("assetsAdded", { count }), "success");
        if (count > 0 && typeof closeOrganizer === "function") closeOrganizer();
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
      } finally {
        state.busy = false;
        renderCounts();
      }
    }

    /** Opens the shared project-target dialog for the current ordered workset. */
    async function addIncludedFramesToProject() {
      const frames = includedFrames();
      if (!frames.length || typeof hooks.addToProject !== "function") return;
      let metadata;
      try {
        const animation = hooks.getCurrentAnimation?.() || {};
        metadata =
          state.mode === "import"
            ? importMetadata()
            : {
                animationName: animation.name || state.animationName || "animation",
                profileLabel: animation.profileLabel || animation.profileId || "character",
                profileKind: animation.profileKind || "actor",
                animationType: animation.animationType || "actor",
                fps: Number(animation.fps || 12),
                anchorMode: animation.anchorMode || "canvas_bottom_center",
              };
      } catch (error) {
        setStatus(error.message, "error");
        return;
      }
      state.busy = true;
      renderCounts();
      setStatus(text("addingToProject"), "busy");
      try {
        await hooks.addToProject({
          sourceTool: "organizer",
          worksets: [
            {
              id: `organizer-${Date.now()}`,
              label: metadata.animationName,
              animationName: metadata.animationName,
              profileLabel: metadata.profileLabel,
              profileKind: metadata.profileKind || "actor",
              animationType: metadata.animationType || "actor",
              fps: Number(metadata.fps || 12),
              anchorMode: metadata.anchorMode || "canvas_bottom_center",
              items: frames.map((frame) => ({
                sourceIndex: frame.sourceIndex,
                name: frame.name,
                flipped: frame.flipped,
                data: frame.editedCanvas.toDataURL("image/png"),
              })),
            },
          ],
        });
        setStatus(text("ready"), "idle");
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
      } finally {
        state.busy = false;
        renderCounts();
      }
    }

    /**
     * Downloads the included processed frames as an animation ZIP.
     * @param {{confirmed?:boolean,formats?:{frames?:boolean,spritesheet?:boolean,gif?:boolean,mov?:boolean},signal?:AbortSignal}} [exportOptions] Selected export formats and cancellation signal.
     * @returns {Promise<object|null|undefined>}
     */
    async function exportIncludedFrames(exportOptions = {}) {
      const frames = includedFrames();
      if (!frames.length || typeof hooks.exportAnimation !== "function") return;
      let metadata;
      try {
        const animation = hooks.getCurrentAnimation?.() || {};
        metadata =
          state.mode === "import"
            ? importMetadata()
            : {
                animationName: animation.name || state.animationName || "animation",
                profileLabel: animation.profileLabel || animation.profileId || "",
                animationType: animation.animationType || "actor",
                fps: Number(animation.fps || 12),
                anchorMode: animation.anchorMode || "canvas_bottom_center",
              };
      } catch (error) {
        setStatus(error.message, "error");
        return;
      }
      const controller = uiController();
      const details = [
        [text("detailAnimation"), metadata.animationName],
        [text("detailFrames"), frames.length],
        [text("detailFps"), metadata.fps],
      ];
      if (
        exportOptions.confirmed !== true &&
        !(await controller.requestConfirmation(text("exportConfirm", { count: frames.length }), details))
      ) {
        return;
      }
      const usedPremiumFeatures =
        premiumFeatures?.normalizeFeatureIds?.(Array.from(state.premiumFeatures || [])) ||
        Array.from(state.premiumFeatures || []);
      state.busy = true;
      renderCounts();
      let exportResult = null;
      try {
        const result = await hooks.exportAnimation(
          metadata,
          frames.map((frame) => {
            const item = {
              name: frame.name,
              flipped: frame.flipped,
              data: frame.editedCanvas.toDataURL("image/png"),
            };
            if (
              exportOptions.formats?.spritesheet ||
              exportOptions.formats?.gif ||
              exportOptions.formats?.mov
            ) {
              item.image = frame.editedCanvas;
              item.width = frame.editedCanvas.width;
              item.height = frame.editedCanvas.height;
            }
            return item;
          }),
          {
            formats: exportOptions.formats,
            signal: exportOptions.signal,
            premiumFeatures: usedPremiumFeatures,
            onProgress: (current, total) => setStatus(text("exportingZip", { current, total }), "busy"),
          },
        );
        exportResult = result;
        if (result) setStatus(text("exportedZip", { count: frames.length }), "success");
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
        if (exportOptions.confirmed === true) throw error;
      } finally {
        state.busy = false;
        renderCounts();
      }
      return exportResult;
    }

    return {
      editImportCutout,
      editBatchCutout,
      applyPlan,
      importIntoSession,
      addIncludedFramesToAssets,
      addIncludedFramesToProject,
      exportIncludedFrames,
    };
  }

  return { createController };
});
