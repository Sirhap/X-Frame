(function attachXFrameAppEventsInputHelpers(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameAppEventsInputHelpers = api;
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
   *   readPreference: (key: string) => string|null,
   *   writePreference: (key: string, value: string) => boolean,
   * }} Input helper functions.
   */
  function createController(dependencies = {}) {
    const elements = dependencies.elements || {};
    const state = dependencies.state || {};
    const handlers = dependencies.handlers || {};
    const constants = dependencies.constants || {};
    const documentRef = dependencies.documentRef || root.document;
    let storage = dependencies.storage;
    if (!storage) {
      try {
        storage = root.localStorage;
      } catch (_error) {
        storage = null;
      }
    }
    const els = elements;
    const document = documentRef;
    const localStorage = storage;
    const { ADJUSTMENT_MODE_KEY } = constants;
    const { cloneState, normalizeAdjustmentMode, syncAdjustmentInputs, updateHistoryControls } = handlers;

    /**
     * Reads an optional UI preference without making storage availability fatal.
     *
     * @param {string} key Preference key.
     * @returns {string|null} Stored value, when storage is available.
     */
    function readPreference(key) {
      try {
        return localStorage?.getItem?.(key) ?? null;
      } catch (_error) {
        return null;
      }
    }

    /**
     * Persists a UI preference on a best-effort basis.
     *
     * @param {string} key Preference key.
     * @param {string} value Preference value.
     * @returns {boolean} Whether the value was persisted.
     */
    function writePreference(key, value) {
      try {
        localStorage?.setItem?.(key, value);
        return Boolean(localStorage?.setItem);
      } catch (_error) {
        return false;
      }
    }

    /**
     * Arms a text input with one undo snapshot for each focused edit.
     *
     * @param {HTMLElement} input Input element receiving the listeners.
     * @param {string} label Human-readable undo label.
     * @returns {void}
     */
    function armInputUndo(input, label) {
      /** Pushes the focus-time snapshot once for a committed field edit. */
      function commitArmedInputUndo() {
        if (!state.inputEditSnapshots.has(input) || input.dataset.undoUsed) return;
        const snapshot = state.inputEditSnapshots.get(input);
        state.undoStack.push(snapshot);
        if (state.undoStack.length > 80) state.undoStack.shift();
        state.redoStack = [];
        updateHistoryControls();
        input.dataset.undoUsed = "1";
      }

      input.addEventListener("focus", () =>
        state.inputEditSnapshots.set(input, { label, state: cloneState() }),
      );
      input.addEventListener("blur", () => {
        state.inputEditSnapshots.delete(input);
        delete input.dataset.undoUsed;
      });
      input.addEventListener("input", () => {
        commitArmedInputUndo();
      });
      input.addEventListener("change", () => {
        commitArmedInputUndo();
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
      syncAdjustmentInputs();
      writePreference(ADJUSTMENT_MODE_KEY, state.adjustmentMode);
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
        const saved = readPreference(key);
        if (saved) panel.open = saved === "open";
        panel.addEventListener("toggle", () => {
          writePreference(key, panel.open ? "open" : "closed");
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
      readPreference,
      writePreference,
    };
  }

  return { createController };
});
