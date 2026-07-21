(function attachBatchCutoutUiController(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutUiController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the small UI-state controller shared by the batch cutout modal.
   * The controller only forwards existing DOM/state behavior; processing and
   * image algorithms remain owned by the main batch controller and its cores.
   * @param {object} dependencies Modal, preview, and rendering dependencies.
   * @returns {object} UI controller methods.
   */
  function createController(dependencies = {}) {
    const {
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
      documentRef = root?.document,
      windowRef = root?.window || root,
      advancedSummary,
      advancedPresetButtons = [],
      advancedPresets = {},
      htmlElementConstructor = root?.HTMLElement,
    } = dependencies;
    if (!elements || !state || typeof text !== "function" || typeof selectedItem !== "function") {
      throw new TypeError("BatchCutoutUiController dependencies are required.");
    }
    const documentApi = documentRef;
    const windowApi = windowRef;

    /**
     * Marks the result canvas while its source pixels are being rebuilt.
     * @param {boolean} busy Whether the preview is waiting for processing.
     * @returns {void}
     */
    function setPreviewProcessing(busy) {
      elements.cutoutResult.dataset.processing = String(Boolean(busy));
      elements.cutoutResult.setAttribute("aria-busy", String(Boolean(busy)));
    }

    /**
     * Keeps keyboard focus inside the cutout workbench.
     * @param {KeyboardEvent} event Keyboard event.
     * @returns {void}
     */
    function trapModalFocus(event) {
      if (event.key !== "Tab") return;
      const layer = !elements.cutoutConfirmPanel.hidden ? elements.cutoutConfirmPanel : elements.cutoutModal;
      const focusable = Array.from(
        layer.querySelectorAll(
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

    /**
     * Returns whether native text undo should own a keyboard shortcut.
     * @param {EventTarget|null} target Keyboard event target.
     * @returns {boolean}
     */
    function isEditableTarget(target) {
      const isElement = !htmlElementConstructor || target instanceof htmlElementConstructor;
      return Boolean(
        target &&
          isElement &&
          (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)),
      );
    }

    /**
     * Toggles background editor interaction while the modal is open.
     * @param {boolean} inert Whether the editor should be inert.
     * @returns {void}
     */
    function setEditorInert(inert) {
      const app = documentApi.querySelector(".app");
      if (app) app.inert = Boolean(inert);
    }

    /**
     * Updates modal labels for the selected language.
     * @returns {void}
     */
    function renderLanguage() {
      documentApi.querySelectorAll("[data-cutout-i18n]").forEach((node) => {
        node.textContent = text(node.dataset.cutoutI18n);
      });
      documentApi.querySelectorAll("[data-cutout-i18n-title]").forEach((node) => {
        node.title = text(node.dataset.cutoutI18nTitle);
      });
      documentApi.querySelectorAll(".cutoutParameterNumber").forEach((input) => {
        const label = input.closest("label")?.querySelector("span")?.textContent?.trim();
        if (label) input.setAttribute("aria-label", label);
      });
      elements.cutoutOpen.title = text("open");
      elements.cutoutClose.setAttribute("aria-label", text("close"));
      elements.cutoutPrevious.setAttribute("aria-label", text("framePrefix") + " −1");
      elements.cutoutNext.setAttribute("aria-label", text("framePrefix") + " +1");
      renderSessionMode();
      elements.cutoutAddFiles.textContent = state.items.length ? text("appendFiles") : text("addFiles");
      renderQueue();
      renderPreviewMode();
      renderProtectionPreviewInfo();
      renderStatus();
    }

    /**
     * Applies labels and visibility hooks for a batch or isolated single-image session.
     * Keeping this state explicit prevents the organizer's pencil action from
     * inheriting batch-only affordances.
     * @returns {void}
     */
    function renderSessionMode() {
      const single = state.sessionMode === "single";
      const activeItem = selectedItem();
      elements.cutoutModal.classList.toggle("singleEditSession", single);
      elements.cutoutTitle.textContent = text(single ? "singleTitle" : "title");
      elements.cutoutFramePrefix.textContent = text(single ? "singleFramePrefix" : "framePrefix");
      elements.cutoutPrevious.textContent = single ? "《" : "◀";
      elements.cutoutNext.textContent = single ? "》" : "▶";
      const previousLabel = single ? text("previousImage") : `${text("framePrefix")} −1`;
      const nextLabel = single ? text("nextImage") : `${text("framePrefix")} +1`;
      elements.cutoutPrevious.setAttribute("aria-label", previousLabel);
      elements.cutoutNext.setAttribute("aria-label", nextLabel);
      elements.cutoutPrevious
        .closest(".cutoutFrameNavigation")
        ?.setAttribute("aria-label", text(single ? "singleNavigation" : "batchNavigation"));
      elements.cutoutPrevious.title = single ? `${previousLabel}（←）` : previousLabel;
      elements.cutoutNext.title = single ? `${nextLabel}（→）` : nextLabel;
      elements.cutoutApplyGroup.textContent = text(
        single ? "applySingle" : state.sourceKind === "workset" ? "applyWorkset" : "applyGroup",
      );
      elements.cutoutApplyGroup.title = elements.cutoutApplyGroup.textContent;
      elements.cutoutRepairBatch.textContent = text(single ? "repairBatchSingle" : "repairBatch");
      elements.cutoutModal.querySelectorAll("[data-cutout-tool]").forEach((button) => {
        const active =
          (!single || activeItem?.processingActivated) && button.dataset.cutoutTool === state.repairMode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      if (single && !elements.cutoutModal.hidden) {
        documentApi.title = `${text("singleTitle")} · XSXB Frame Tuner`;
      }
    }

    /**
     * Renders the selected preview representation controls.
     * @returns {void}
     */
    function renderPreviewMode() {
      const modeButtons = [
        [elements.cutoutViewResult, "result"],
        [elements.cutoutViewOriginal, "original"],
        [elements.cutoutViewAlpha, "alpha"],
        [elements.cutoutViewDifference, "difference"],
      ];
      modeButtons.forEach(([button, mode]) => {
        const active = state.previewMode === mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      const captionKeys = {
        result: "viewResultCaption",
        original: "viewOriginalCaption",
        alpha: "viewAlphaCaption",
        difference: "viewDifferenceCaption",
      };
      elements.cutoutViewCaption.textContent = text(captionKeys[state.previewMode]);
      elements.cutoutRepairTools.dataset.previewMode = state.previewMode;
      elements.cutoutResult.classList.toggle("diagnostic", state.previewMode !== "result");
    }

    /**
     * Resolves and closes the in-app destructive-action confirmation.
     * @param {boolean} accepted Whether the user accepted the action.
     * @returns {void}
     */
    function resolveConfirmation(accepted) {
      if (elements.cutoutConfirmPanel.hidden) return;
      elements.cutoutConfirmPanel.hidden = true;
      elements.cutoutConfirmPanel.querySelector?.(".cutoutConfirmCard")?.removeAttribute("data-tone");
      const resolve = state.confirmationResolver;
      state.confirmationResolver = null;
      const returnFocus = state.confirmationReturnFocus;
      state.confirmationReturnFocus = null;
      resolve?.(Boolean(accepted));
      if (returnFocus?.isConnected !== false && typeof returnFocus?.focus === "function") {
        returnFocus.focus();
      }
    }

    /**
     * Opens an application-styled confirmation dialog.
     * @param {string} message Confirmation message.
     * @param {Array<[string,string|number]>} details Summary rows.
     * @param {{title?:string,confirmLabel?:string,tone?:"warning"|"danger"}} [options] Dialog labels and tone.
     * @returns {Promise<boolean>}
     */
    function requestConfirmation(message, details = [], options = {}) {
      if (state.confirmationResolver) resolveConfirmation(false);
      elements.cutoutConfirmTitle.textContent = options.title || text("applyTitle");
      elements.cutoutConfirmApply.textContent = options.confirmLabel || text("confirmApply");
      elements.cutoutConfirmMessage.textContent = message;
      elements.cutoutConfirmDetails.innerHTML = "";
      for (const [label, value] of details) {
        const term = documentApi.createElement("dt");
        const description = documentApi.createElement("dd");
        term.textContent = label;
        description.textContent = String(value);
        elements.cutoutConfirmDetails.append(term, description);
      }
      elements.cutoutConfirmDetails.hidden = details.length === 0;
      const card = elements.cutoutConfirmPanel.querySelector?.(".cutoutConfirmCard");
      if (card) card.dataset.tone = options.tone === "danger" ? "danger" : "warning";
      state.confirmationReturnFocus = documentApi.activeElement;
      elements.cutoutConfirmPanel.hidden = false;
      windowApi.setTimeout(() => {
        const initialControl =
          options.tone === "danger" ? elements.cutoutConfirmCancel : elements.cutoutConfirmApply;
        initialControl.focus();
      }, 0);
      return new Promise((resolve) => {
        state.confirmationResolver = resolve;
      });
    }

    /**
     * Updates the advanced-mode summary and highlights an exact preset match.
     * @returns {void}
     */
    function renderAdvancedMode() {
      const values = {
        alphaLow: Number(elements.cutoutAlphaLow.value),
        alphaHigh: Number(elements.cutoutAlphaHigh.value),
        alphaThreshold: Number(elements.cutoutAlphaThreshold.value),
        protectionTolerance: Number(elements.cutoutProtectionTolerance.value),
      };
      advancedSummary.textContent = `${values.alphaLow} — ${values.alphaHigh} / T ${values.alphaThreshold}`;
      advancedPresetButtons.forEach((button) => {
        const preset = advancedPresets[button.dataset.cutoutPreset];
        const matches = preset && Object.entries(preset).every(([key, value]) => values[key] === value);
        button.classList.toggle("active", Boolean(matches));
      });
    }

    /**
     * Returns whether a pointer event should start preview panning.
     * @param {PointerEvent} event Pointer event.
     * @returns {boolean}
     */
    function shouldPanPreview(event) {
      return event.button === 1 || (event.button === 0 && state.previewSpacePan);
    }

    /**
     * Starts shared preview panning.
     * @param {PointerEvent} event Pointer event.
     * @param {HTMLCanvasElement} target Preview canvas.
     * @returns {boolean}
     */
    function beginPreviewPan(event, target) {
      if (!shouldPanPreview(event)) return false;
      event.preventDefault();
      target.setPointerCapture(event.pointerId);
      state.previewPanDrag = {
        pointerId: event.pointerId,
        target,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      elements.cutoutModal.classList.add("isPreviewPanning");
      return true;
    }

    /**
     * Zooms a preview around the mouse pointer.
     * @param {WheelEvent} event Wheel event.
     * @param {HTMLCanvasElement} target Preview canvas.
     * @returns {void}
     */
    function zoomPreviewAtPointer(event, target) {
      if (!target._cutoutView || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const currentScale = target._cutoutView.scale;
      setPreviewScale(currentScale * direction, target, previewCanvasPoint(event, target));
    }

    /**
     * Moves the shared preview viewport during a pan gesture.
     * @param {PointerEvent} event Pointer event.
     * @returns {void}
     */
    function movePreviewPan(event) {
      const drag = state.previewPanDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const rect = drag.target.getBoundingClientRect();
      state.previewPanX += ((event.clientX - drag.clientX) / rect.width) * drag.target.width;
      state.previewPanY += ((event.clientY - drag.clientY) / rect.height) * drag.target.height;
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      renderPreview();
    }

    /**
     * Finishes a shared preview pan gesture.
     * @param {PointerEvent} event Pointer event.
     * @returns {void}
     */
    function endPreviewPan(event) {
      if (!state.previewPanDrag || state.previewPanDrag.pointerId !== event.pointerId) return;
      state.previewPanDrag = null;
      elements.cutoutModal.classList.remove("isPreviewPanning");
    }

    /**
     * Converts a vertical mouse-wheel gesture into horizontal toolbar scrolling.
     * Native horizontal trackpad gestures continue to use their horizontal delta.
     * @param {WheelEvent} event Wheel event from the batch action toolbar.
     * @returns {void}
     */
    function scrollBatchActionsByWheel(event) {
      if (
        event.ctrlKey ||
        elements.cutoutBatchTrayActions.scrollWidth <= elements.cutoutBatchTrayActions.clientWidth
      )
        return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const maxScrollLeft =
        elements.cutoutBatchTrayActions.scrollWidth - elements.cutoutBatchTrayActions.clientWidth;
      const nextScrollLeft = Math.max(
        0,
        Math.min(maxScrollLeft, elements.cutoutBatchTrayActions.scrollLeft + delta),
      );
      if (nextScrollLeft === elements.cutoutBatchTrayActions.scrollLeft) return;
      event.preventDefault();
      elements.cutoutBatchTrayActions.scrollLeft = nextScrollLeft;
    }

    /**
     * Provides keyboard scrolling while the batch action toolbar itself is focused.
     * @param {KeyboardEvent} event Keyboard event from the batch action toolbar.
     * @returns {void}
     */
    function scrollBatchActionsByKeyboard(event) {
      if (event.target !== elements.cutoutBatchTrayActions) return;
      const maxScrollLeft =
        elements.cutoutBatchTrayActions.scrollWidth - elements.cutoutBatchTrayActions.clientWidth;
      const scrollStep = Math.max(80, Math.round(elements.cutoutBatchTrayActions.clientWidth * 0.65));
      const nextScrollLeftByKey = {
        ArrowLeft: elements.cutoutBatchTrayActions.scrollLeft - scrollStep,
        ArrowRight: elements.cutoutBatchTrayActions.scrollLeft + scrollStep,
        Home: 0,
        End: maxScrollLeft,
      };
      if (!(event.key in nextScrollLeftByKey)) return;
      event.preventDefault();
      elements.cutoutBatchTrayActions.scrollTo({
        left: Math.max(0, Math.min(maxScrollLeft, nextScrollLeftByKey[event.key])),
        behavior: "smooth",
      });
    }

    return {
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
      shouldPanPreview,
      beginPreviewPan,
      zoomPreviewAtPointer,
      movePreviewPan,
      endPreviewPan,
      scrollBatchActionsByWheel,
      scrollBatchActionsByKeyboard,
    };
  }

  return { createController };
});
