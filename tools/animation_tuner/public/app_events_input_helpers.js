(function attachXsxbAppEventsInputHelpers(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppEventsInputHelpers = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the small input and panel helpers used by the workbench event
   * controller. The helper functions only retain the original event
   * controller dependencies; listener registration remains in app_events.js
   * so the original registration order is unchanged.
   *
   * @param {object} [dependencies] Helper dependencies.
   * @returns {{
   *   armInputUndo: (input: HTMLElement, label: string) => void,
   *   syncFrameAxisScaleToUniform: () => void,
   *   syncBaseAxisScaleToUniform: () => void,
   *   setAdjustmentMode: (mode: string) => void,
   *   audioFileFromList: (fileList?: FileList|ArrayLike<File>) => File|null,
   *   initPanelState: () => void,
   * }} Input helper functions.
   */
  function createController(dependencies = {}) {
    const elements = dependencies.elements || {};
    const state = dependencies.state || {};
    const handlers = dependencies.handlers || {};
    const constants = dependencies.constants || {};
    const documentRef = dependencies.documentRef || root.document;
    const storage = dependencies.storage || root.localStorage;
    const els = elements;
    const document = documentRef;
    const localStorage = storage;
    const { ADJUSTMENT_MODE_KEY } = constants;
    const { cloneState, normalizeAdjustmentMode, syncAdjustmentInputs, updateHistoryControls } = handlers;

    /**
     * Arms a text input with one undo snapshot for each focused edit.
     *
     * @param {HTMLElement} input Input element receiving the listeners.
     * @param {string} label Human-readable undo label.
     * @returns {void}
     */
    function armInputUndo(input, label) {
      input.addEventListener("focus", () =>
        state.inputEditSnapshots.set(input, { label, state: cloneState() }),
      );
      input.addEventListener("blur", () => {
        state.inputEditSnapshots.delete(input);
        delete input.dataset.undoUsed;
      });
      input.addEventListener("input", () => {
        if (state.inputEditSnapshots.has(input) && !input.dataset.undoUsed) {
          const snapshot = state.inputEditSnapshots.get(input);
          state.undoStack.push(snapshot);
          if (state.undoStack.length > 80) state.undoStack.shift();
          state.redoStack = [];
          updateHistoryControls();
          input.dataset.undoUsed = "1";
        }
      });
      input.addEventListener("change", () => {
        delete input.dataset.undoUsed;
        state.inputEditSnapshots.delete(input);
      });
    }

    /**
     * Mirrors the uniform frame scale into its axis inputs.
     *
     * @returns {void}
     */
    function syncFrameAxisScaleToUniform() {
      els.frameScaleX.value = els.frameScale.value;
      els.frameScaleY.value = els.frameScale.value;
    }

    /**
     * Mirrors the uniform base scale into its axis inputs.
     *
     * @returns {void}
     */
    function syncBaseAxisScaleToUniform() {
      els.baseScaleX.value = els.baseScale.value;
      els.baseScaleY.value = els.baseScale.value;
    }

    /**
     * Persists and applies the selected adjustment scope.
     *
     * @param {string} mode Requested adjustment scope.
     * @returns {void}
     */
    function setAdjustmentMode(mode) {
      state.adjustmentMode = normalizeAdjustmentMode(mode);
      state.baseEditSnapshot = null;
      state.boxEditSnapshot = null;
      localStorage.setItem(ADJUSTMENT_MODE_KEY, state.adjustmentMode);
      syncAdjustmentInputs();
    }

    /**
     * Selects the first supported audio file from a browser file list.
     *
     * @param {FileList|ArrayLike<File>} [fileList] Candidate files.
     * @returns {File|null} First audio file, if present.
     */
    function audioFileFromList(fileList) {
      const files = Array.from(fileList || []);
      return (
        files.find((file) => {
          if (!file) return false;
          if (String(file.type || "").startsWith("audio/")) return true;
          return /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name || "");
        }) || null
      );
    }

    /**
     * Restores persisted open/closed state for collapsible panels.
     *
     * @returns {void}
     */
    function initPanelState() {
      document.querySelectorAll(".panel[data-panel]").forEach((panel) => {
        const key = `animationTuner.panel.${panel.dataset.panel}`;
        const saved = localStorage.getItem(key);
        if (saved) panel.open = saved === "open";
        panel.addEventListener("toggle", () => {
          localStorage.setItem(key, panel.open ? "open" : "closed");
        });
      });
    }

    return {
      armInputUndo,
      syncFrameAxisScaleToUniform,
      syncBaseAxisScaleToUniform,
      setAdjustmentMode,
      audioFileFromList,
      initPanelState,
    };
  }

  return { createController };
});
