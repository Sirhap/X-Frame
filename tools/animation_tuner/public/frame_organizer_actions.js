(function attachFrameOrganizerActions(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

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
   *   hooks?:{applyPlan?:(items:Array<object>)=>Promise<void>,createAnimation?:(metadata:object,items:Array<object>)=>Promise<void>,addAssets?:(items:Array<object>)=>Promise<number>,editCutout?:(workset:object)=>Promise<Array<object>|null>},
   *   includedFrames:()=>object[],
   *   imageCanvas:(image:CanvasImageSource)=>HTMLCanvasElement,
   *   renderCounts:()=>void,
   *   renderGrid:()=>void,
   *   restartPreview:()=>void,
   *   loadCurrentAnimation:()=>Promise<void>,
   *   importMetadata:()=>object,
   *   renderLanguage:()=>void,
   *   getUiController:()=>object|null,
   *   setStatus:(message:string,tone?:string)=>void,
   *   window?:Window,
   *   windowRef?:Window,
   *   document?:Document,
   *   cssEscape?:(value:string)=>string
   * }} dependencies Organizer state and host callbacks.
   * @returns {{editImportCutout:(targetFrame:object)=>Promise<void>,applyPlan:()=>Promise<void>,addIncludedFramesToAssets:()=>Promise<void>}}
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
      getUiController,
      setStatus,
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
     * Opens one workset frame while retaining the full image set as propagation targets.
     * @param {object} targetFrame Organizer frame to edit.
     * @returns {Promise<void>}
     */
    async function editImportCutout(targetFrame) {
      if (!targetFrame || !state.frames.includes(targetFrame)) {
        setStatus(text("cutoutNeedFrames"), "error");
        return;
      }
      if (typeof hooks.editCutout !== "function") {
        setStatus(text("failed", { message: "Batch cutout is unavailable." }), "error");
        return;
      }
      const sourceFrames = [...state.frames];
      const selectedIndex = sourceFrames.indexOf(targetFrame);
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
        });
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
          mode: "single",
          selectedIndex,
          onLiveApply: applyCutoutOutputs,
          items: sourceFrames.map((frame) => ({
            name: frame.name,
            image: frame.editedCanvas,
            frame: { uid: frame.uid },
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
        const editButton = elements.organizerGrid.querySelector(
          `[data-frame-uid="${cssEscape(targetFrame.uid)}"] .organizerFrameCutout`,
        );
        editButton?.focus({ preventScroll: true });
      }
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
      const confirmation =
        state.mode === "import" ? text("createConfirm", { count: frames.length }) : text("applyConfirm");
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
          await hooks.createAnimation?.(metadata, items);
          state.mode = "edit";
          setStatus(text("created", { count: items.length }), "success");
          renderLanguage();
        } else {
          await hooks.applyPlan?.(items);
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
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
      } finally {
        state.busy = false;
        renderCounts();
      }
    }

    return { editImportCutout, applyPlan, addIncludedFramesToAssets };
  }

  return { createController };
});
