(function attachBatchCutoutPresetStore(root, factory) {
  "use strict";

  const sessionCore =
    typeof module === "object" && module.exports
      ? require("./batch_cutout_session_core.js")
      : root.BatchCutoutSessionCore;
  const api = factory(root, sessionCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutPresetStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root, sessionCore) => {
  "use strict";

  const STORAGE_KEY = "xsxb.frameTuner.cutoutPresets.v1";
  const MAX_PRESETS = 30;

  /**
   * Creates a browser-local automatic-parameter preset store.
   * @param {{storage?:Storage|null,createId?:()=>string,now?:()=>string}} options Store dependencies.
   * @returns {{list:()=>object[],save:(value:object)=>object,remove:(id:string)=>boolean}}
   */
  function createStore(options = {}) {
    const storage = options.storage === undefined ? root?.localStorage : options.storage;
    const createId = options.createId || (() => root?.crypto?.randomUUID?.() || `preset_${Date.now()}`);
    const now = options.now || (() => new Date().toISOString());

    /** @returns {object[]} Valid stored entries. */
    function readEntries() {
      if (!storage?.getItem) return [];
      try {
        const documentValue = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
        if (documentValue?.version !== 1 || !Array.isArray(documentValue.presets)) return [];
        return documentValue.presets
          .filter((entry) => entry && typeof entry.id === "string" && typeof entry.name === "string")
          .slice(0, MAX_PRESETS)
          .map((entry) => ({
            id: entry.id,
            name: entry.name.trim().slice(0, 40),
            createdAt: String(entry.createdAt || ""),
            updatedAt: String(entry.updatedAt || ""),
            parameters: sessionCore.normalizeProcessingParameters(entry.parameters),
          }))
          .filter((entry) => entry.name.length > 0);
      } catch (_error) {
        return [];
      }
    }

    /** @param {object[]} presets Entries to persist. @returns {void} */
    function writeEntries(presets) {
      if (!storage?.setItem) throw new Error("Browser preset storage is unavailable.");
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, presets }));
    }

    /** @returns {object[]} Independent newest-first presets. */
    function list() {
      return readEntries().map((entry) => ({ ...entry, parameters: { ...entry.parameters } }));
    }

    /** @param {object} value Preset input. @returns {object} Saved preset. */
    function save(value = {}) {
      const name = String(value.name || "").trim();
      if (name.length < 1 || name.length > 40) {
        throw new RangeError("Preset name must be between 1 and 40 characters.");
      }
      const presets = readEntries();
      const existingIndex = presets.findIndex((entry) => entry.id === value.id);
      const timestamp = now();
      const existing = existingIndex >= 0 ? presets[existingIndex] : null;
      const preset = {
        id: existing?.id || String(createId()),
        name,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
        parameters: sessionCore.normalizeProcessingParameters(value.parameters),
      };
      const next = existingIndex >= 0 ? presets.filter((_, index) => index !== existingIndex) : presets;
      next.unshift(preset);
      writeEntries(next.slice(0, MAX_PRESETS));
      return { ...preset, parameters: { ...preset.parameters } };
    }

    /** @param {string} id Preset identifier. @returns {boolean} Whether a preset was removed. */
    function remove(id) {
      const presets = readEntries();
      const next = presets.filter((entry) => entry.id !== id);
      if (next.length === presets.length) return false;
      writeEntries(next);
      return true;
    }

    return Object.freeze({ list, remove, save });
  }

  return Object.freeze({ createStore, storageKey: STORAGE_KEY });
});
