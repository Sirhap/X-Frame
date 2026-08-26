(function attachFrameOrganizerUi(root, factory) {
  "use strict";

  const sequenceOrder =
    root?.FrameSequenceOrder ||
    (typeof module === "object" && module.exports ? require("./frame_sequence_order") : null);
  const similarityThreshold =
    root?.FrameOrganizerCore?.ORGANIZER_SIMILARITY_THRESHOLD ||
    (typeof module === "object" && module.exports
      ? require("./frame_organizer_core").ORGANIZER_SIMILARITY_THRESHOLD
      : null);
  const api = factory(root, sequenceOrder, similarityThreshold);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerUi = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  (root, defaultSequenceOrder, similarityThreshold) => {
    "use strict";

    /**
     * Captures the organizer mutations that should prompt before leaving.
     * @param {object[]} frames Organizer frames.
     * @returns {string} Stable workset signature.
     */
    function worksetChangeSignature(frames) {
      return Array.from(frames || [])
        .map((frame) =>
          [
            frame.uid,
            Number(frame.assetRevision || 0),
            frame.included === false ? 0 : 1,
            frame.flipped ? 1 : 0,
            String(frame.tag || ""),
            frame.imported ? 1 : 0,
            frame.editedCanvas && frame.editedCanvas !== frame.originalCanvas ? 1 : 0,
          ].join(":"),
        )
        .join("|");
    }

    /**
     * Reports whether leaving would discard organizer work that is not in a project.
     * @param {{videoExtracting?:boolean,mode?:string,frames?:object[],baselineFrameIds?:string[],acceptedWorksetSignature?:string}} state Organizer state.
     * @returns {boolean} True when navigation should confirm.
     */
    /**
     * Reports whether an already-loaded organizer session can be shown again
     * without resetting include flags from the host animation.
     * @param {{mode?:string,animationName?:string,frames?:object[]}} state Organizer state.
     * @param {{name?:string,frames?:object[]}|null|undefined} animation Host animation.
     * @returns {boolean}
     */
    function includedFlagsKey(projectId, animationName) {
      return `xsxb-organizer-included:${String(projectId || "session")}:${String(animationName || "")}`;
    }

    /**
     * Writes include flags so another organizer tab can restore the same workset membership.
     * @param {object[]} frames Organizer frames.
     * @param {string} projectId Active project id.
     * @param {string} animationName Animation name.
     * @param {{setItem?:Function}|null} storage localStorage-like store.
     * @returns {void}
     */
    function persistIncludedFlags(frames, projectId, animationName, storage) {
      if (!storage?.setItem || !animationName) return;
      const items = Array.from(frames || []).map((frame) => ({
        uid: String(frame.uid),
        included: frame.included !== false,
      }));
      if (!items.length) return;
      storage.setItem(includedFlagsKey(projectId, animationName), JSON.stringify(items));
    }

    /**
     * Applies persisted include flags onto the current workset.
     * @param {object[]} frames Organizer frames.
     * @param {string} projectId Active project id.
     * @param {string} animationName Animation name.
     * @param {{getItem?:Function}|null} storage localStorage-like store.
     * @returns {boolean} Whether any frame changed.
     */
    function restoreIncludedFlags(frames, projectId, animationName, storage) {
      if (!storage?.getItem || !animationName) return false;
      try {
        const raw = storage.getItem(includedFlagsKey(projectId, animationName));
        const saved = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(saved) || !saved.length) return false;
        const byUid = new Map(saved.map((item) => [String(item.uid), item.included !== false]));
        let changed = false;
        for (const frame of frames || []) {
          if (!byUid.has(String(frame.uid))) continue;
          const included = byUid.get(String(frame.uid));
          if (frame.included !== included) {
            frame.included = included;
            changed = true;
          }
        }
        return changed;
      } catch {
        return false;
      }
    }

    function canReuseLoadedAnimation(state, animation) {
      if (state?.mode !== "edit") return false;
      const frames = Array.from(state?.frames || []);
      const next = Array.from(animation?.frames || []);
      if (!frames.length || frames.length !== next.length) return false;
      if (String(animation?.name || "") !== String(state?.animationName || "")) return false;
      return frames.every((frame, index) => String(frame.uid) === String(next[index]?.id || ""));
    }

    function hasUnsavedWorksetChanges(state) {
      if (state?.videoExtracting) return true;
      const frames = Array.from(state?.frames || []);
      if (!frames.length) return false;
      const signature = worksetChangeSignature(frames);
      if (state?.acceptedWorksetSignature && signature === state.acceptedWorksetSignature) return false;
      if (state?.mode === "import") return frames.length > 0;
      const baseline = Array.from(state?.baselineFrameIds || []);
      if (frames.length !== baseline.length) return true;
      return frames.some(
        (frame, index) =>
          frame.uid !== baseline[index] ||
          frame.imported ||
          frame.flipped ||
          !frame.included ||
          Boolean(frame.tag) ||
          (frame.editedCanvas && frame.editedCanvas !== frame.originalCanvas),
      );
    }

    const FOCUSABLE_SELECTOR =
      'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])';

    /**
     * Returns whether a control can receive Tab focus.
     * Do not use `offsetParent` or `getClientRects`: fixed overlays report
     * `offsetParent === null`, and a just-opened dialog can have empty rects
     * for one frame — both made the trap see zero buttons so the first Tab left.
     * @param {HTMLElement} element Candidate control.
     * @returns {boolean} Whether the control should be in the Tab cycle.
     */
    function isDisplayedForFocus(element) {
      return Boolean(element) && !element.disabled && !element.hidden;
    }

    /**
     * Lists Tab targets inside a dialog or organizer layer.
     * @param {HTMLElement} container Active layer.
     * @param {HTMLElement[]} [explicit] Known controls to cycle when provided.
     * @returns {HTMLElement[]} Focusable controls.
     */
    function listFocusableElements(container, explicit) {
      if (Array.isArray(explicit) && explicit.length) return explicit.filter(isDisplayedForFocus);
      if (!container?.querySelectorAll) return [];
      return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isDisplayedForFocus);
    }

    /**
     * Keeps Tab inside `container` and reports whether the event was handled.
     * @param {KeyboardEvent} event Keyboard event.
     * @param {HTMLElement} container Active layer.
     * @param {Document} documentRef Document that owns activeElement.
     * @param {HTMLElement[]} [explicit] Known controls to cycle when provided.
     * @returns {boolean} Whether Tab was consumed.
     */
    function cycleTabFocus(event, container, documentRef, explicit) {
      if (event?.key !== "Tab") return false;
      const focusable = listFocusableElements(container, explicit);
      event.preventDefault?.();
      event.stopPropagation?.();
      if (!focusable.length) return true;
      const currentIndex = focusable.indexOf(documentRef?.activeElement);
      if (event.shiftKey) {
        const next = currentIndex <= 0 ? focusable[focusable.length - 1] : focusable[currentIndex - 1];
        next.focus();
        return true;
      }
      const next =
        currentIndex === -1 || currentIndex >= focusable.length - 1
          ? focusable[0]
          : focusable[currentIndex + 1];
      next.focus();
      return true;
    }

    /**
     * Writes the exported organizer range onto the duplicate-threshold slider.
     * @param {{organizerThreshold?:HTMLInputElement,organizerThresholdValue?:HTMLElement}} elements Slider nodes.
     * @param {{min:number,max:number,fallback:number}} [range] Shared range.
     * @returns {void}
     */
    function bindSimilarityThreshold(elements, range = similarityThreshold) {
      if (!elements?.organizerThreshold || !range) return;
      elements.organizerThreshold.min = String(range.min);
      elements.organizerThreshold.max = String(range.max);
      elements.organizerThreshold.value = String(range.fallback);
      if (elements.organizerThresholdValue) {
        elements.organizerThresholdValue.textContent = String(range.fallback);
      }
    }

    /**
     * Clamps the keep-1-of-N interval used by organizer reduce.
     * @param {unknown} rawValue Slider or typed value.
     * @returns {number}
     */
    function normalizeReduceStep(rawValue) {
      return Math.max(2, Math.min(20, Number.parseInt(rawValue, 10) || 2));
    }

    /**
     * Applies keep-1-of-N included flags in place.
     * @param {Array<{included?:boolean,uid?:string}>} frames Workset frames.
     * @param {number} step Keep one included frame out of every `step`.
     * @param {Set<string>|null} [selectedUids] Limit to selected frames when set.
     * @returns {void}
     */
    function applyReduceIncludedFlags(frames, step, selectedUids = null) {
      let cursor = 0;
      frames.forEach((frame) => {
        if (!frame.included || (selectedUids && !selectedUids.has(frame.uid))) return;
        frame.included = cursor % step === 0;
        cursor += 1;
      });
    }

    /**
     * Asks for confirmation, then applies keep-1-of-N included flags.
     * Cancel leaves the workset unchanged.
     * @param {{
     *   frames:Array<{included?:boolean,uid?:string}>,
     *   step:number,
     *   selectedUids?:Set<string>|null,
     *   requestConfirmation:(message:string,details:Array<[string,string|number]>,options:object)=>Promise<boolean>,
     *   text:(key:string,variables?:Record<string,string|number>)=>string
     * }} options Reduce confirmation inputs.
     * @returns {Promise<boolean>} Whether the flags were changed.
     */
    async function confirmReduceIncludedFlags(options) {
      const frames = options?.frames || [];
      const step = normalizeReduceStep(options?.step);
      const selectedUids = options?.selectedUids || null;
      const text = options?.text;
      const requestConfirmation = options?.requestConfirmation;
      if (typeof requestConfirmation !== "function" || typeof text !== "function") {
        throw new TypeError("Reduce confirmation requires requestConfirmation and text.");
      }
      const targetCount = frames.filter(
        (frame) => frame.included && (!selectedUids || selectedUids.has(frame.uid)),
      ).length;
      const accepted = await requestConfirmation(
        text("reduceConfirm", { step }),
        [
          [text("detailFrames"), targetCount],
          [text("reduceEvery"), step],
        ],
        {
          title: text("reduceTitle"),
          confirmLabel: text("reduce"),
          tone: "warning",
        },
      );
      if (!accepted) return false;
      applyReduceIncludedFlags(frames, step, selectedUids);
      return true;
    }

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
      let createProjectIntentActive = false;
      let clipboardPasteBusy = false;
      let confirmInertedSurfaces = [];
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

      /** Reloads the project animation after confirming that staged edits will be discarded. @returns {Promise<void>} */
      async function resetCurrentAnimation() {
        if (hasUnsavedChanges()) {
          const accepted = await requestConfirmation(
            text("resetConfirm", { name: state.animationName || "—", count: state.frames.length }),
            [
              [text("detailAnimation"), state.animationName || "—"],
              [text("detailFrames"), state.frames.length],
            ],
            {
              title: text("resetTitle"),
              confirmLabel: text("reset"),
              tone: "danger",
            },
          );
          if (!accepted) return;
        }
        await loadCurrentAnimation();
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

      /** Restores organizer surfaces that were locked while a confirm dialog was open. @returns {void} */
      function unlockOrganizerForConfirm() {
        confirmInertedSurfaces.forEach((surface) => {
          surface.inert = false;
        });
        confirmInertedSurfaces = [];
      }

      /**
       * Makes sibling organizer chrome unfocusable so Tab cannot leave the confirm dialog.
       * @returns {void}
       */
      function lockOrganizerForConfirm() {
        unlockOrganizerForConfirm();
        const parent = elements.organizerConfirmPanel.parentElement;
        if (!parent?.children) return;
        confirmInertedSurfaces = Array.from(parent.children).filter((child) => {
          if (child === elements.organizerConfirmPanel || child.inert) return false;
          child.inert = true;
          return true;
        });
      }

      /** Closes open organizer disclosure menus so they cannot sit above the dialog. @returns {void} */
      function closeOrganizerMenus() {
        const root = elements.organizerModal;
        if (!root?.querySelectorAll) return;
        root.querySelectorAll("details[open]").forEach((details) => {
          details.open = false;
        });
      }

      /** Resolves and closes the organizer confirmation layer. @param {boolean} accepted Whether accepted. @returns {void} */
      function resolveConfirmation(accepted) {
        if (elements.organizerConfirmPanel.hidden) return;
        elements.organizerConfirmPanel.hidden = true;
        elements.organizerConfirmPanel.querySelector?.(".organizerConfirmCard")?.removeAttribute("data-tone");
        unlockOrganizerForConfirm();
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
       * @param {{title?:string,confirmLabel?:string,cancelLabel?:string,tone?:"warning"|"danger"}} [options] Dialog labels and tone.
       * @returns {Promise<boolean>}
       */
      function requestConfirmation(message, details = [], options = {}) {
        if (state.confirmResolver) resolveConfirmation(false);
        elements.organizerConfirmTitle.textContent = options.title || text("confirmTitle");
        elements.organizerConfirmAccept.textContent = options.confirmLabel || text("confirm");
        if (elements.organizerConfirmCancel) {
          elements.organizerConfirmCancel.textContent = options.cancelLabel || text("cancel");
        }
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
        closeOrganizerMenus();
        lockOrganizerForConfirm();
        elements.organizerConfirmPanel.hidden = false;
        const initialControl =
          options.tone === "danger" ? elements.organizerConfirmCancel : elements.organizerConfirmAccept;
        const focusInitialControl = () => initialControl?.focus?.();
        if (typeof windowApi.setTimeout === "function") windowApi.setTimeout(focusInitialControl, 0);
        else focusInitialControl();
        return new Promise((resolve) => {
          state.confirmResolver = resolve;
        });
      }

      /** Stores a reversible frame deletion snapshot and exposes its undo action. @param {object[]} frames Previous list. @returns {void} */
      function offerDeleteUndo(frames) {
        state.deletedFramesSnapshot = frames;
        elements.organizerUndoDelete.hidden = false;
      }

      /** Returns the confirm actions that must stay in the Tab cycle. @returns {HTMLElement[]} */
      function confirmFocusableElements() {
        return listFocusableElements(elements.organizerConfirmPanel, [
          elements.organizerConfirmCancel,
          elements.organizerConfirmAccept,
        ]);
      }

      /** Keeps keyboard focus inside the active organizer layer. @param {KeyboardEvent} event Keyboard event. @param {HTMLElement} container Active layer. @returns {void} */
      function trapFocus(event, container) {
        const explicit =
          container === elements.organizerConfirmPanel ? confirmFocusableElements() : undefined;
        cycleTabFocus(event, container, documentApi, explicit);
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
        return hasUnsavedWorksetChanges(state);
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
        if (resetValues) createProjectIntentActive = createProjectRequested;
        elements.organizerImportSetup
          ?.closest?.(".organizerWorkbench")
          ?.classList?.toggle("createProjectMode", createProjectIntentActive);
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
          state.animationNameAuto = true;
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
          creationMode: elements.organizerCreationMode?.value || "merge",
          fps: 12,
          animationType: elements.organizerAnimationType.value,
          profileKind: elements.organizerAnimationType.value === "boss" ? "boss" : "actor",
          anchorMode: "canvas_bottom_center",
        };
        if (
          (creatingProject && !metadata.projectLabel) ||
          !metadata.profileLabel ||
          !metadata.animationName
        ) {
          throw new Error(text("importMissingMetadata"));
        }
        return metadata;
      }

      /** Applies localized labels to organizer nodes. @returns {void} */
      function renderLanguage() {
        documentApi.querySelectorAll("[data-organizer-i18n]").forEach((node) => {
          node.textContent = text(node.dataset.organizerI18n);
        });
        documentApi.querySelectorAll("[data-organizer-i18n-aria-label]").forEach((node) => {
          node.setAttribute("aria-label", text(node.dataset.organizerI18nAriaLabel));
        });
        elements.organizerClose.setAttribute("aria-label", text("close"));
        elements.organizerVideoClose.setAttribute("aria-label", text("close"));
        elements.organizerLoopClose.setAttribute("aria-label", text("close"));
        elements.organizerOrderFilename
          ?.closest(".organizerOrderControl")
          ?.setAttribute("aria-label", text("orderBy"));
        if (elements.organizerTitle) {
          elements.organizerTitle.textContent = text(state.mode === "import" ? "importTitle" : "title");
        }
        documentApi.defaultView?.dispatchEvent?.(new Event("xsxb:routechange"));
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
        const groupedSources = new Set((state.frames || []).map((frame) => frame.groupId).filter(Boolean))
          .size;
        const writeCurrent = hooks?.commitImportToCurrent?.() === true && groupedSources <= 1;
        elements.organizerApply.textContent = text(
          state.mode === "import"
            ? writeCurrent
              ? "apply"
              : browserExportOnly
                ? "importSession"
                : "create"
            : "apply",
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

      /** Confirms, then keeps 1 of every N included frames. Cancel is a no-op. @returns {Promise<void>} */
      async function reduceWorkset() {
        const step = normalizeReduceStep(elements.organizerReduceStep.value);
        elements.organizerReduceStep.value = String(step);
        const selected = selectedFrames();
        const selectedUids = selected.length ? new Set(selected.map((frame) => frame.uid)) : null;
        const accepted = await confirmReduceIncludedFlags({
          frames: state.frames,
          step,
          selectedUids,
          requestConfirmation,
          text,
        });
        if (!accepted) return;
        renderGrid();
        restartPreview();
        setStatus(text("reduced", { step, count: includedFrames().length }), "success");
      }

      /** Binds organizer DOM events to injected host callbacks in original order. @returns {void} */
      function bindEvents() {
        bindSimilarityThreshold(elements);
        elements.organizerOpen.addEventListener("click", () =>
          openCurrentAnimation(open).catch((error) =>
            setStatus(text("failed", { message: error.message }), "error"),
          ),
        );
        elements.organizerHome?.addEventListener("click", () => {
          if (elements.organizerModal.hidden) return;
          if (documentApi.body?.classList?.contains("cutoutOpen")) return;
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
        const toolMenus = documentApi.querySelectorAll?.(".organizerToolMenu") || [];
        for (const menu of toolMenus) {
          menu.addEventListener("toggle", () => {
            if (!menu.open) return;
            for (const other of toolMenus) {
              if (other !== menu) other.open = false;
            }
          });
        }
        elements.organizerInvert.addEventListener("click", () => {
          root.FrameOrganizerGrid.invertWorksetMembership(state.frames);
          renderGrid();
          restartPreview();
        });
        elements.organizerInvertSelection.addEventListener("click", () => {
          state.frames.forEach((frame) => {
            frame.selected = !frame.selected;
          });
          state.anchorIndex = -1;
          renderGrid();
        });
        elements.organizerReduce.addEventListener("click", () => {
          reduceWorkset().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
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
        elements.organizerAnimationName.addEventListener("input", () => {
          state.animationNameAuto = !elements.organizerAnimationName.value.trim();
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
        documentApi.addEventListener(
          "keydown",
          (event) => {
            if (elements.organizerConfirmPanel.hidden || event.key !== "Tab") return;
            trapFocus(event, elements.organizerConfirmPanel);
          },
          true,
        );
        documentApi.addEventListener("focusin", (event) => {
          if (elements.organizerConfirmPanel.hidden) return;
          if (elements.organizerConfirmPanel.contains?.(event.target)) return;
          const focusable = confirmFocusableElements();
          (focusable[0] || elements.organizerConfirmCancel)?.focus?.();
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
          resetCurrentAnimation().catch((error) =>
            setStatus(text("failed", { message: error.message }), "error"),
          );
        });
        elements.organizerApply.addEventListener("click", applyPlan);
        elements.organizerCreationMode?.addEventListener("change", () => {
          renderLanguage();
          renderCounts();
        });
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
        elements.organizerToggleImportSetup.addEventListener("click", () => {
          state.showImportSetup = !state.showImportSetup;
          state.lastExpandedPanel = state.showImportSetup
            ? "import"
            : state.lastExpandedPanel === "import"
              ? ""
              : state.lastExpandedPanel;
          renderCounts();
        });
        elements.organizerStatusDismiss.addEventListener("click", () => {
          setStatus(text("ready"), "idle");
          elements.organizerBatchCutout.focus({ preventScroll: true });
        });
        elements.organizerViewOriginal.addEventListener("click", () => {
          state.viewMode = "original";
          elements.organizerViewOriginal.classList.add("active");
          elements.organizerViewEdited.classList.remove("active");
          renderGrid();
          renderPreview();
        });
        elements.organizerViewEdited.addEventListener("click", () => {
          if (elements.organizerViewEdited.disabled) return;
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
              const nextIndex = Math.max(
                0,
                Math.min(state.frames.length - 1, state.previewIndex + direction),
              );
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
          if (event.key !== "Escape" || elements.organizerModal.hidden || elements.organizerModal.inert)
            return;
          if (!elements.organizerConfirmPanel.hidden) resolveConfirmation(false);
          else if (loopFinder.isOpen()) loopFinder.close();
          else if (!elements.organizerVideoPanel.hidden) videoImporter.close();
          else if (state.lastExpandedPanel === "import" && state.showImportSetup && state.frames.length) {
            event.preventDefault();
            state.showImportSetup = false;
            state.lastExpandedPanel = "";
            renderCounts();
            elements.organizerToggleImportSetup.focus({ preventScroll: true });
          } else event.preventDefault();
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

    return {
      applyReduceIncludedFlags,
      bindSimilarityThreshold,
      canReuseLoadedAnimation,
      confirmReduceIncludedFlags,
      persistIncludedFlags,
      restoreIncludedFlags,
      createController,
      cycleTabFocus,
      hasUnsavedWorksetChanges,
      listFocusableElements,
      normalizeReduceStep,
      openCurrentAnimation,
      worksetChangeSignature,
    };
  },
);
