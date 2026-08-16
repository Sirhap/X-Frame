(function attachXsxbTemporaryWorksetStore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBTemporaryWorksetStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /** Creates a non-persistent workset that deliberately retains Canvas references. */
  function createStore() {
    const listeners = new Set();
    let state = { name: "临时工作集", frames: [], revision: 0, sourceTool: "" };

    /** Returns a shallow snapshot so Canvas resources retain identity across tools. */
    function getSnapshot() {
      return { ...state, frames: state.frames.map((frame) => ({ ...frame })) };
    }

    /** Publishes the current workset to mounted tool surfaces. */
    function emit() {
      const snapshot = getSnapshot();
      listeners.forEach((listener) => listener(snapshot));
    }

    /** Replaces the temporary frame sequence without touching project persistence. */
    function setWorkset(workset = {}) {
      state = {
        name: String(workset.name || state.name || "临时工作集"),
        frames: Array.from(workset.frames || []).map((frame, index) => ({
          ...frame,
          id: String(frame.id || frame.uid || `temporary-frame-${index + 1}`),
          enabled: frame.enabled !== false && frame.included !== false,
        })),
        revision: state.revision + 1,
        sourceTool: String(workset.sourceTool || ""),
      };
      emit();
    }

    /** Applies processed canvases to stable frame identities instead of positional indexes. */
    function applyOutputs(outputs, frameIds) {
      const nextOutputs = Array.from(outputs || []);
      const targetIds = Array.from(frameIds || state.frames.map((frame) => frame.id), String);
      const outputByFrameId = new Map(targetIds.map((frameId, index) => [frameId, nextOutputs[index]]));
      state = {
        ...state,
        frames: state.frames.map((frame) => {
          const output = outputByFrameId.get(frame.id);
          return {
            ...frame,
            image: output?.canvas || output?.image || frame.image,
            assetRevision: Number(frame.assetRevision || 0) + (output ? 1 : 0),
          };
        }),
        revision: state.revision + 1,
        sourceTool: "cutout",
      };
      emit();
    }

    /** Removes the temporary session and releases retained resource references. */
    function clear() {
      state = { name: "临时工作集", frames: [], revision: state.revision + 1, sourceTool: "" };
      emit();
    }

    /** Subscribes to temporary workset changes. */
    function subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Temporary workset listener is required.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return Object.freeze({ applyOutputs, clear, getSnapshot, setWorkset, subscribe });
  }

  return Object.freeze({ createStore });
});
