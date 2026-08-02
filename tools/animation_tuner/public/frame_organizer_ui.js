(function attachFrameOrganizerUi(root, factory) {
  "use strict";

  const sequenceOrder =
    root?.FrameSequenceOrder ||
    (typeof module === "object" && module.exports ? require("./frame_sequence_order") : null);
  const api = factory(root, sequenceOrder);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root, defaultSequenceOrder) => {
  "use strict";

  /**
   * Opens the existing animation workset from the current-animation launcher.
   * @param {()=>Promise<void>} open Existing-animation loader.
   * @returns {Promise<void>} Completed open operation.
   */
  function openCurrentAnimation(open) {
    if (typeof open !== "function") {
      return Promise.reject(new TypeError("Current-animation organizer loader is required."));
    }
    return Promise.resolve().then(open);
  }

  /**
   * Creates the organizer UI/lifecycle interaction controller.
   *
   * The controller deliberately contains only DOM-facing helpers and event
   * wiring. Frame processing remains in the host controller; callbacks are
   * injected so moving this block cannot change operation order or data flow.
   *
   * @param {{
   *   elements:Record<string,any>,
   *   state:Record<string,any>,
   *   text:(key:string,variables?:Record<string,string|number>)=>string,
   *   hooks?:{getImportContext?:()=>object|null},
   *   clamp:(value:number,minimum:number,maximum:number)=>number,
   *   setStatus:(message:string,tone?:string)=>void,
   *   renderCounts:()=>void,
   *   renderGrid:()=>void,
   *   renderPreview:()=>void,
   *   restartPreview:()=>void,
   *   schedulePreviewFrame:()=>void,
   *   selectedFrames:()=>object[],
   *   includedFrames:()=>object[],
   *   open:()=>Promise<void>,
   *   requestClose:(options?:object)=>Promise<boolean>,
   *   close?:()=>void,
   *   flipFrames:()=>void,
   *   analyze:(type:"jump"|"duplicate")=>void,
   *   loadCurrentAnimation:()=>Promise<void>,
   *   applyPlan:()=>Promise<void>,
   *   editBatchCutout:()=>Promise<void>,
   *   importIntoSession:()=>Promise<void>,
   *   addIncludedFramesToAssets:()=>Promise<void>,
   *   addIncludedFramesToProject:()=>Promise<void>,
   *   exportIncludedFrames:()=>Promise<void>,
   *   openExportDialog?:()=>void,
   *   selectFrame:(index:number,event:object)=>void,
   *   imageImporter:{importFiles:(files:File[])=>Promise<void>},
   *   videoImporter:{close:()=>void,loadFile:(file:File)=>Promise<void>,bindEvents:()=>void},
   *   clipboardMedia?:{bindPaste:(options:object)=>()=>void},
   *   loopFinder:{isOpen:()=>boolean,close:()=>void,bindEvents:()=>void},
   *   sequenceOrder?:typeof import("./frame_sequence_order"),
   *   document?:Document,
   *   window?:Window
   * }} dependencies Host callbacks and organizer DOM elements.
   * @returns {{
   *   bindEvents:()=>void,
   *   renderLanguage:()=>void,
   *   renderImportContext:(resetValues?:boolean)=>void,
   *   importMetadata:()=>object,
   *   requestConfirmation:(message:string,details?:Array<[string,string|number]>,options?:object)=>Promise<boolean>,
   *   resolveConfirmation:(accepted:boolean)=>void,
   *   offerDeleteUndo:(frames:object[])=>void,
   *   setEditorInert:(inert:boolean)=>void,
   *   setImportOrderStrategy:(strategy:"filename"|"selection")=>void
   * }} Organizer UI controller.
   */
  function createController(dependencies = {}) {
    const {
      elements,
      state,
      text,
      hooks = {},
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
      addIncludedFramesToProject,
      exportIncludedFrames,
      openExportDialog,
      selectFrame,
      imageImporter,
      videoImporter,
      loopFinder,
    } = dependencies;
    if (!elements || !state || typeof text !== "function") {
      throw new TypeError("Frame organizer UI dependencies are required.");
    }
    const documentApi = dependencies.document || root.document;
    const windowApi = dependencies.window || root.window;
    const clipboardMedia = dependencies.clipboardMedia || root.ClipboardMedia;
    const sequenceOrder = dependencies.sequenceOrder || defaultSequenceOrder;
    let createProjectIntentConsumed = false;
    let clipboardPasteBusy = false;
    if (!sequenceOrder?.restoreImportOrder) throw new Error("FrameSequenceOrder is required.");

    /** Renders segmented ordering controls from the current strategy. @returns {void} */
    function renderImportOrderStrategy() {
      const filenameActive =
        sequenceOrder.normalizeOrderStrategy(state.importOrderStrategy) ===
        sequenceOrder.ORDER_STRATEGIES.FILENAME;
      [
        [elements.organizerOrderFilename, filenameActive],
        [elements.organizerOrderSelection, !filenameActive],
      ].forEach(([button, active]) => {
        if (!button) return;
        button.setAttribute("aria-pressed", String(active));
        button.classList?.toggle("active", active);
      });
    }

    /**
     * Selects how image batches are restored without changing the current manual grid order.
     * @param {"filename"|"selection"} strategy Requested strategy.
     * @returns {void}
     */
    function setImportOrderStrategy(strategy) {
      state.importOrderStrategy = sequenceOrder.normalizeOrderStrategy(strategy);
      renderImportOrderStrategy();
    }

    /** Clears every staged frame after confirmation while retaining one-step undo. @returns {Promise<void>} */
    async function clearWorkset() {
      const snapshot = state.frames.slice();
      if (!snapshot.length) return;
      const accepted = await requestConfirmation(
        text("clearWorksetConfirm", { count: snapshot.length }),
        [[text("detailFrames"), snapshot.length]],
        {
          title: text("clearWorksetTitle"),
          confirmLabel: text("clearWorkset"),
          tone: "danger",
        },
      );
      if (!accepted) return;
      state.frames = [];
      state.nextImportBatchIndex = 0;
      state.anchorIndex = -1;
      state.previewIndex = 0;
      renderGrid();
      restartPreview();
      setStatus(text("worksetCleared", { count: snapshot.length }), "success");
      offerDeleteUndo(snapshot);
    }

    /** Resolves and closes the organizer confirmation layer. @param {boolean} accepted Whether accepted. @returns {void} */
    function resolveConfirmation(accepted) {
      if (elements.organizerConfirmPanel.hidden) return;
      elements.organizerConfirmPanel.hidden = true;
      elements.organizerConfirmPanel.querySelector?.(".organizerConfirmCard")?.removeAttribute("data-tone");
      const resolver = state.confirmResolver;
      state.confirmResolver = null;
      const returnFocus = state.confirmReturnFocus;
      state.confirmReturnFocus = null;
      resolver?.(Boolean(accepted));
      if (returnFocus?.isConnected !== false && typeof returnFocus?.focus === "function") {
        returnFocus.focus();
      }
    }

    /**
     * Opens an application-styled confirmation layer.
     * @param {string} message Confirmation message.
     * @param {Array<[string,string|number]>} details Operation details.
     * @param {{title?:string,confirmLabel?:string,tone?:"warning"|"danger"}} [options] Dialog labels and tone.
     * @returns {Promise<boolean>}
     */
    function requestConfirmation(message, details = [], options = {}) {
      if (state.confirmResolver) resolveConfirmation(false);
      elements.organizerConfirmTitle.textContent = options.title || text("confirmTitle");
      elements.organizerConfirmAccept.textContent = options.confirmLabel || text("confirm");
      elements.organizerConfirmMessage.textContent = message;
      elements.organizerConfirmDetails.replaceChildren();
      details.forEach(([label, value]) => {
        const term = documentApi.createElement("dt");
        const description = documentApi.createElement("dd");
        term.textContent = label;
        description.textContent = String(value);
        elements.organizerConfirmDetails.append(term, description);
      });
      elements.organizerConfirmDetails.hidden = details.length === 0;
      const card = elements.organizerConfirmPanel.querySelector?.(".organizerConfirmCard");
      if (card) card.dataset.tone = options.tone === "danger" ? "danger" : "warning";
      state.confirmReturnFocus = documentApi.activeElement;
      elements.organizerConfirmPanel.hidden = false;
      const initialControl =
        options.tone === "danger" ? elements.organizerConfirmCancel : elements.organizerConfirmAccept;
      initialControl.focus();
      return new Promise((resolve) => {
        state.confirmResolver = resolve;
      });
    }

    /** Stores a reversible frame deletion snapshot and exposes its undo action. @param {object[]} frames Previous list. @returns {void} */
    function offerDeleteUndo(frames) {
      state.deletedFramesSnapshot = frames;
      elements.organizerUndoDelete.hidden = false;
    }

    /** Keeps keyboard focus inside the active organizer layer. @param {KeyboardEvent} event Keyboard event. @param {HTMLElement} container Active layer. @returns {void} */
    function trapFocus(event, container) {
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        container.querySelectorAll(
          'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && documentApi.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentApi.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    /** Makes the main editor inert while the organizer owns interaction. @param {boolean} inert Whether disabled. @returns {void} */
    function setEditorInert(inert) {
      const app = documentApi.querySelector(".app");
      if (app) app.inert = Boolean(inert);
    }

    /**
     * Reports whether the staged workset differs from its loaded baseline.
     * @returns {boolean} True when navigation could discard staged changes.
     */
    function hasUnsavedChanges() {
      if (state.videoExtracting) return true;
      if (state.mode === "import") return state.frames.length > 0;
      if (state.frames.length !== state.baselineFrameIds.length) return true;
      return state.frames.some(
        (frame, index) =>
          frame.uid !== state.baselineFrameIds[index] ||
          frame.imported ||
          frame.flipped ||
          !frame.included ||
          Boolean(frame.tag),
      );
    }

    /** Shows the project-name field only when a new local project is selected. @returns {void} */
    function syncImportProjectField() {
      const creatingProject = elements.organizerProjectSelect.value === "__new__";
      elements.organizerProjectNameField.hidden = !creatingProject;
      elements.organizerProjectName.required = creatingProject;
    }

    /**
     * Reads and consumes the one-shot request to start with a new project.
     * @returns {boolean} Whether the current import should default to a new project.
     */
    function consumeCreateProjectIntent() {
      if (createProjectIntentConsumed) return false;
      const requested = new URLSearchParams(windowApi.location?.search || "").get("createProject") === "1";
      if (!requested) return false;
      createProjectIntentConsumed = true;
      try {
        const url = new URL(windowApi.location.href);
        url.searchParams.delete("createProject");
        windowApi.history.replaceState(windowApi.history.state, "", url);
      } catch (_error) {
        // URL cleanup is best-effort; the current import must still honor the request.
      }
      return true;
    }

    /** Populates import defaults from the host's active project. @param {boolean} resetValues Whether defaults reset. @returns {void} */
    function renderImportContext(resetValues = false) {
      const context = hooks.getImportContext?.() || {};
      const activeProject = context.activeProject || null;
      const handoffState = String(context.godotHandoff?.state || "local_only");
      if (elements.organizerGodotHandoffBadge) {
        const labels = {
          local_only: state.language === "en" ? "local_only" : "仅本地",
          invalid_root: state.language === "en" ? "invalid_root" : "根目录无效",
          sync_required: state.language === "en" ? "sync_required" : "需要同步",
          sync_failed: state.language === "en" ? "sync_failed" : "同步失败",
          synced: state.language === "en" ? "synced" : "已同步",
          gameplay_ready: state.language === "en" ? "gameplay_ready" : "Gameplay 就绪",
        };
        elements.organizerGodotHandoffBadge.textContent = labels[handoffState] || labels.local_only;
        elements.organizerGodotHandoffBadge.dataset.state = handoffState;
      }
      const selectedValue = elements.organizerProjectSelect.value;
      const createProjectRequested = resetValues && consumeCreateProjectIntent();
      elements.organizerProjectSelect.innerHTML = "";
      if (activeProject?.id) {
        const currentOption = documentApi.createElement("option");
        currentOption.value = String(activeProject.id);
        currentOption.textContent = text("importProjectCurrent", {
          name: activeProject.label || activeProject.id,
        });
        elements.organizerProjectSelect.appendChild(currentOption);
      }
      const newOption = documentApi.createElement("option");
      newOption.value = "__new__";
      newOption.textContent = text("importProjectNew");
      elements.organizerProjectSelect.appendChild(newOption);
      const nextProjectValue = resetValues
        ? createProjectRequested
          ? "__new__"
          : activeProject?.id
            ? String(activeProject.id)
            : "__new__"
        : selectedValue;
      elements.organizerProjectSelect.value = Array.from(elements.organizerProjectSelect.options).some(
        (option) => option.value === nextProjectValue,
      )
        ? nextProjectValue
        : activeProject?.id
          ? String(activeProject.id)
          : "__new__";
      if (resetValues) {
        const defaultProfile = Array.isArray(context.profiles) ? context.profiles[0] : null;
        elements.organizerProjectName.value = state.language === "en" ? "Animation Project" : "动画项目";
        elements.organizerProfileName.value = String(
          defaultProfile?.label || defaultProfile?.id || "character",
        );
        elements.organizerAnimationName.value = "idle";
        elements.organizerImportFps.value = "12";
        elements.organizerAnimationType.value =
          String(defaultProfile?.kind || "actor") === "boss" ? "boss" : "actor";
      }
      syncImportProjectField();
    }

    /** Collects and validates metadata for a new animation import. @returns {object} Import metadata. */
    function importMetadata() {
      const creatingProject = elements.organizerProjectSelect.value === "__new__";
      const metadata = {
        projectId: creatingProject ? "" : elements.organizerProjectSelect.value,
        projectLabel: elements.organizerProjectName.value.trim(),
        profileLabel: elements.organizerProfileName.value.trim(),
        animationName: elements.organizerAnimationName.value.trim(),
        fps: clamp(Math.round(elements.organizerImportFps.value), 1, 120),
        animationType: elements.organizerAnimationType.value,
        profileKind: elements.organizerAnimationType.value === "boss" ? "boss" : "actor",
        anchorMode: "canvas_bottom_center",
      };
      if ((creatingProject && !metadata.projectLabel) || !metadata.profileLabel || !metadata.animationName) {
        throw new Error(text("importMissingMetadata"));
      }
      return metadata;
    }

    /** Applies localized labels to organizer nodes. @returns {void} */
    function renderLanguage() {
      documentApi.querySelectorAll("[data-organizer-i18n]").forEach((node) => {
        node.textContent = text(node.dataset.organizerI18n);
      });
      elements.organizerClose.setAttribute("aria-label", text("close"));
      elements.organizerVideoClose.setAttribute("aria-label", text("close"));
      elements.organizerLoopClose.setAttribute("aria-label", text("close"));
      elements.organizerOrderFilename
        ?.closest(".organizerOrderControl")
        ?.setAttribute("aria-label", text("orderBy"));
      elements.organizerTitle.textContent = text(state.mode === "import" ? "importTitle" : "title");
      const browserExportOnly = hooks.browserExportOnly === true && state.mode === "import";
      const importSetupHint = documentApi.querySelector('[data-organizer-i18n="importSetupHint"]');
      if (browserExportOnly && importSetupHint) {
        importSetupHint.textContent = text("browserImportSetupHint");
      }
      elements.organizerSubtitle.textContent = text(
        state.mode === "import"
          ? browserExportOnly
            ? "browserImportSubtitle"
            : "importSubtitle"
          : "subtitle",
      );
      elements.organizerApply.textContent = text(
        state.mode === "import" ? (browserExportOnly ? "importSession" : "create") : "apply",
      );
      elements.organizerGodotPlaceholder.hidden = true;
      elements.organizerGodotPlaceholder.textContent = text("importSession");
      elements.organizerReset.textContent = text(state.mode === "import" ? "clearWorkset" : "reset");
      elements.organizerClearWorkset.hidden = state.mode === "import";
      elements.organizerImportSetup.hidden = state.mode !== "import";
      elements.organizerImportSetup
        .closest(".organizerWorkbench")
        ?.classList.toggle("importMode", state.mode === "import");
      if (state.mode === "import") renderImportContext(false);
      renderImportOrderStrategy();
      renderCounts();
    }

    /** Binds organizer DOM events to injected host callbacks in original order. @returns {void} */
    function bindEvents() {
      elements.organizerOpen.addEventListener("click", () =>
        openCurrentAnimation(open).catch((error) =>
          setStatus(text("failed", { message: error.message }), "error"),
        ),
      );
      elements.organizerCopyLink.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setStatus(text("linkCopied"), "success");
        } catch (_error) {
          setStatus(text("linkCopyFailed"), "error");
        }
      });
      elements.organizerHome.addEventListener("click", () => {
        requestClose().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
      });
      elements.organizerClose.addEventListener("click", () => {
        requestClose().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
      });
      elements.organizerModal.addEventListener("pointerdown", (event) => {
        if (event.target === elements.organizerModal) {
          requestClose().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
        }
      });
      elements.organizerInvert.addEventListener("click", () => {
        state.frames.forEach((frame) => {
          frame.included = !frame.included;
        });
        renderGrid();
        restartPreview();
      });
      elements.organizerReduce.addEventListener("click", () => {
        const step = Math.max(2, Math.min(20, Number.parseInt(elements.organizerReduceStep.value, 10) || 2));
        elements.organizerReduceStep.value = String(step);
        const targets = selectedFrames().length ? new Set(selectedFrames().map((frame) => frame.uid)) : null;
        let cursor = 0;
        state.frames.forEach((frame) => {
          if (!frame.included || (targets && !targets.has(frame.uid))) return;
          frame.included = cursor % step === 0;
          cursor += 1;
        });
        renderGrid();
        restartPreview();
        setStatus(text("reduced", { step, count: includedFrames().length }), "success");
      });
      elements.organizerAutoSort.addEventListener("click", () => {
        state.frames = sequenceOrder.restoreImportOrder(state.frames, state.importOrderStrategy);
        renderGrid();
        restartPreview();
        setStatus(text("sorted"), "success");
      });
      elements.organizerOrderFilename?.addEventListener("click", () => {
        setImportOrderStrategy(sequenceOrder.ORDER_STRATEGIES.FILENAME);
      });
      elements.organizerOrderSelection?.addEventListener("click", () => {
        setImportOrderStrategy(sequenceOrder.ORDER_STRATEGIES.SELECTION);
      });
      elements.organizerFlip.addEventListener("click", flipFrames);
      elements.organizerFileInput.addEventListener("change", () => {
        const files = Array.from(elements.organizerFileInput.files || []);
        elements.organizerFileInput.value = "";
        imageImporter.importFiles(files).catch((error) => {
          setStatus(text("failed", { message: error.message }), "error");
        });
      });
      clipboardMedia?.bindPaste({
        target: documentApi,
        accept: ["image", "video"],
        isActive: () =>
          !elements.organizerModal.hidden &&
          !elements.organizerModal.inert &&
          elements.organizerConfirmPanel.hidden &&
          !clipboardPasteBusy,
        onPaste: async ({ images, videos }) => {
          clipboardPasteBusy = true;
          try {
            if (images.length) await imageImporter.importFiles(images);
            if (videos.length) {
              if (videos.length > 1) setStatus(text("pasteVideoLimit"), "error");
              await videoImporter.loadFile(videos[0]);
            }
          } finally {
            clipboardPasteBusy = false;
          }
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          setStatus(text("failed", { message }), "error");
        },
      });
      elements.organizerDeleteSelected.addEventListener("click", () => {
        const snapshot = state.frames.slice();
        const before = state.frames.length;
        state.frames = state.frames.filter((frame) => !frame.selected);
        renderGrid();
        restartPreview();
        setStatus(text("deleted", { count: before - state.frames.length }), "success");
        offerDeleteUndo(snapshot);
      });
      elements.organizerDeleteExcluded.addEventListener("click", () => {
        const snapshot = state.frames.slice();
        const before = state.frames.length;
        state.frames = state.frames.filter((frame) => frame.included);
        renderGrid();
        restartPreview();
        setStatus(text("deleted", { count: before - state.frames.length }), "success");
        offerDeleteUndo(snapshot);
      });
      elements.organizerClearWorkset.addEventListener("click", () => {
        clearWorkset().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
      });
      elements.organizerUndoDelete.addEventListener("click", () => {
        if (!state.deletedFramesSnapshot) return;
        state.frames = state.deletedFramesSnapshot;
        state.deletedFramesSnapshot = null;
        elements.organizerUndoDelete.hidden = true;
        renderGrid();
        restartPreview();
        setStatus(text("ready"), "success");
      });
      elements.organizerConfirmCancel.addEventListener("click", () => resolveConfirmation(false));
      elements.organizerConfirmAccept.addEventListener("click", () => resolveConfirmation(true));
      elements.organizerConfirmPanel.addEventListener("click", (event) => {
        if (event.target === elements.organizerConfirmPanel) resolveConfirmation(false);
      });
      elements.organizerThreshold.addEventListener("input", () => {
        elements.organizerThresholdValue.textContent = elements.organizerThreshold.value;
      });
      elements.organizerFindJump.addEventListener("click", () => analyze("jump"));
      elements.organizerFindDuplicate.addEventListener("click", () => analyze("duplicate"));
      elements.organizerReset.addEventListener("click", () => {
        if (state.mode === "import") {
          clearWorkset().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
          return;
        }
        loadCurrentAnimation().catch((error) =>
          setStatus(text("failed", { message: error.message }), "error"),
        );
      });
      elements.organizerApply.addEventListener("click", applyPlan);
      elements.organizerGodotPlaceholder.addEventListener("click", importIntoSession);
      elements.organizerAddAssets.addEventListener("click", addIncludedFramesToAssets);
      elements.organizerAddProject?.addEventListener("click", addIncludedFramesToProject);
      elements.organizerExport.addEventListener("click", () =>
        typeof openExportDialog === "function" ? openExportDialog() : exportIncludedFrames(),
      );
      elements.organizerProjectSelect.addEventListener("change", syncImportProjectField);
      elements.organizerSpeed.addEventListener("input", schedulePreviewFrame);
      elements.organizerBatchCutout.addEventListener("click", () => {
        editBatchCutout().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
      });
      elements.organizerViewOriginal.addEventListener("click", () => {
        state.viewMode = "original";
        elements.organizerViewOriginal.classList.add("active");
        elements.organizerViewEdited.classList.remove("active");
        renderGrid();
        renderPreview();
      });
      elements.organizerViewEdited.addEventListener("click", () => {
        state.viewMode = "edited";
        elements.organizerViewEdited.classList.add("active");
        elements.organizerViewOriginal.classList.remove("active");
        renderGrid();
        renderPreview();
      });
      windowApi.addEventListener("keydown", (event) => {
        if (!elements.organizerModal.hidden && !elements.organizerModal.inert && event.key === "Tab") {
          const layer = !elements.organizerConfirmPanel.hidden
            ? elements.organizerConfirmPanel
            : !elements.organizerLoopPanel.hidden
              ? elements.organizerLoopPanel
              : !elements.organizerVideoPanel.hidden
                ? elements.organizerVideoPanel
                : elements.organizerModal;
          trapFocus(event, layer);
          return;
        }
        if (
          !elements.organizerModal.hidden &&
          !elements.organizerModal.inert &&
          elements.organizerConfirmPanel.hidden &&
          elements.organizerLoopPanel.hidden &&
          elements.organizerVideoPanel.hidden
        ) {
          const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName);
          const command = event.metaKey || event.ctrlKey;
          if (!typing && command && event.key.toLowerCase() === "a") {
            event.preventDefault();
            state.frames.forEach((frame) => {
              frame.selected = true;
            });
            state.anchorIndex = 0;
            renderGrid();
            return;
          }
          if (!typing && (event.key === "ArrowLeft" || event.key === "ArrowRight") && state.frames.length) {
            event.preventDefault();
            const direction = event.key === "ArrowLeft" ? -1 : 1;
            const nextIndex = Math.max(0, Math.min(state.frames.length - 1, state.previewIndex + direction));
            selectFrame(nextIndex, event.shiftKey ? { shiftKey: true } : {});
            elements.organizerGrid.children[nextIndex]
              ?.querySelector(".organizerFrameSelect")
              ?.focus({ preventScroll: true });
            elements.organizerGrid.children[nextIndex]?.scrollIntoView({ block: "nearest" });
            return;
          }
          if (!typing && (event.key === "Delete" || event.key === "Backspace") && selectedFrames().length) {
            event.preventDefault();
            elements.organizerDeleteSelected.click();
            return;
          }
        }
        if (event.key !== "Escape" || elements.organizerModal.hidden || elements.organizerModal.inert) return;
        if (!elements.organizerConfirmPanel.hidden) resolveConfirmation(false);
        else if (loopFinder.isOpen()) loopFinder.close();
        else if (!elements.organizerVideoPanel.hidden) videoImporter.close();
        else requestClose().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
      });
      videoImporter.bindEvents();
      loopFinder.bindEvents();
    }

    return {
      bindEvents,
      renderLanguage,
      renderImportContext,
      importMetadata,
      requestConfirmation,
      resolveConfirmation,
      offerDeleteUndo,
      setEditorInert,
      setImportOrderStrategy,
      hasUnsavedChanges,
    };
  }

  return { createController, openCurrentAnimation };
});
