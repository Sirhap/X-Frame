(function attachXFrameWorkspaceStore(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameWorkspaceStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const SAVE_STATUS = Object.freeze({
    IDLE: "idle",
    DIRTY: "dirty",
    SAVING: "saving",
    SAVED: "saved",
    ERROR: "error",
    CONFLICT: "conflict",
  });

  /** Creates a small deterministic identifier from project-owned frame data. */
  function stableFrameId(frame, index, namespace = "workspace") {
    if (frame?.id) return String(frame.id);
    const persistentIdentity = frame?.sourcePath || frame?.path || frame?.name;
    const source = `${namespace}:${persistentIdentity || `frame:${index}`}`;
    let hash = 2166136261;
    for (let cursor = 0; cursor < source.length; cursor += 1) {
      hash ^= source.charCodeAt(cursor);
      hash = Math.imul(hash, 16777619);
    }
    return `frame_${(hash >>> 0).toString(36)}`;
  }

  /** Normalizes one persisted or temporary frame into the shared runtime contract. */
  function normalizeFrame(frame, index, namespace = "workspace") {
    const sourcePath = String(frame?.sourcePath || frame?.path || "");
    return {
      ...frame,
      id: stableFrameId(frame, index, namespace),
      sourcePath,
      currentAssetRef: String(frame?.currentAssetRef || frame?.path || sourcePath),
      assetRevision: Math.max(0, Number(frame?.assetRevision) || 0),
      enabled: frame?.enabled !== false && frame?.included !== false,
    };
  }

  /** Returns a serializable clone without retaining mutable references. */
  function clone(value) {
    if (typeof root?.structuredClone === "function") return root.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Creates the application-wide workspace state and save coordinator.
   * @param {{
   *   save?:(snapshot:object)=>Promise<object|void>,
   *   autosave?:boolean,
   *   debounceMs?:number,
   *   setTimeoutImpl?:typeof setTimeout,
   *   clearTimeoutImpl?:typeof clearTimeout,
   *   now?:()=>Date,
   * }} [dependencies] Injectable persistence and clock adapters.
   */
  function createStore(dependencies = {}) {
    const saveSnapshot = dependencies.save || (async () => {});
    const autosaveEnabled = dependencies.autosave !== false;
    const debounceMs = Math.max(0, Number(dependencies.debounceMs ?? 600));
    const setTimeoutImpl = dependencies.setTimeoutImpl || root?.setTimeout?.bind(root) || setTimeout;
    const clearTimeoutImpl = dependencies.clearTimeoutImpl || root?.clearTimeout?.bind(root) || clearTimeout;
    const now = dependencies.now || (() => new Date());
    const listeners = new Set();
    const toolHistory = new Map();
    let saveTimer = 0;
    let savePromise = null;
    let state = {
      projectContext: null,
      frames: [],
      selection: { ids: [], primaryId: null },
      activeToolId: "",
      saveStatus: SAVE_STATUS.IDLE,
      saveError: "",
      revision: 0,
      lastSavedRevision: 0,
      lastSavedAt: "",
    };

    /** Publishes one immutable snapshot to every mounted surface. */
    function emit() {
      const snapshot = getSnapshot();
      for (const listener of listeners) listener(snapshot);
    }

    /** Returns a defensive snapshot suitable for renderers and save adapters. */
    function getSnapshot() {
      return clone(state);
    }

    /** Subscribes a renderer and returns its cleanup callback. */
    function subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Workspace listener must be a function.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    /** Keeps the current selection valid after frame mutations. */
    function normalizeSelection(selection, frames = state.frames) {
      const valid = new Set(frames.map((frame) => frame.id));
      const ids = Array.from(new Set(selection?.ids || [])).filter((id) => valid.has(id));
      const requestedPrimary = selection?.primaryId;
      return {
        ids,
        primaryId: valid.has(requestedPrimary) ? requestedPrimary : ids[0] || null,
      };
    }

    /** Replaces project context and imports persisted frames by stable identity. */
    function setProjectContext(context) {
      const namespace = context?.projectId || context?.id || "workspace";
      const frames = Array.from(context?.frames || []).map((frame, index) =>
        normalizeFrame(frame, index, namespace),
      );
      state = {
        ...state,
        projectContext: context ? { ...context, frames: undefined } : null,
        frames,
        selection: normalizeSelection(context?.selection || {}, frames),
        revision: 0,
        lastSavedRevision: 0,
        saveStatus: SAVE_STATUS.IDLE,
        saveError: "",
      };
      toolHistory.clear();
      if (state.activeToolId) toolHistory.set(state.activeToolId, { undo: [], redo: [] });
      emit();
    }

    /** Updates the shared frame selection without creating an undo entry. */
    function selectFrames(selection) {
      state = { ...state, selection: normalizeSelection(selection) };
      emit();
    }

    /** Resolves one operation into the next frame list. */
    function reduceFrames(frames, operation) {
      switch (operation?.type) {
        case "replace-frames":
          return Array.from(operation.frames || []).map((frame, index) =>
            normalizeFrame(frame, index, state.projectContext?.projectId || "workspace"),
          );
        case "reorder-frames": {
          const byId = new Map(frames.map((frame) => [frame.id, frame]));
          const ordered = Array.from(operation.frameIds || [])
            .map((id) => byId.get(id))
            .filter(Boolean);
          const claimed = new Set(ordered.map((frame) => frame.id));
          return [...ordered, ...frames.filter((frame) => !claimed.has(frame.id))];
        }
        case "update-frame":
          return frames.map((frame) =>
            frame.id === operation.frameId ? normalizeFrame({ ...frame, ...operation.patch }, 0) : frame,
          );
        case "replace-asset":
          return frames.map((frame) =>
            frame.id === operation.frameId
              ? {
                  ...frame,
                  currentAssetRef: String(operation.currentAssetRef || frame.currentAssetRef),
                  assetRevision: frame.assetRevision + 1,
                }
              : frame,
          );
        case "set-enabled": {
          const targets = new Set(operation.frameIds || []);
          return frames.map((frame) =>
            targets.has(frame.id) ? { ...frame, enabled: operation.enabled !== false } : frame,
          );
        }
        case "delete-frames": {
          const targets = new Set(operation.frameIds || []);
          return frames.filter((frame) => !targets.has(frame.id));
        }
        default:
          if (typeof operation?.update === "function") {
            return operation.update(clone(frames)).map((frame, index) => normalizeFrame(frame, index));
          }
          throw new TypeError(`Unsupported workspace operation: ${operation?.type || "unknown"}`);
      }
    }

    /** Commits an atomic frame operation and schedules persistence. */
    function commit(operation) {
      const previous = { frames: clone(state.frames), selection: clone(state.selection) };
      const nextFrames = reduceFrames(state.frames, operation);
      const history = toolHistory.get(state.activeToolId);
      if (history) {
        history.undo.push(previous);
        history.redo.length = 0;
      }
      state = {
        ...state,
        frames: nextFrames,
        selection: normalizeSelection(state.selection, nextFrames),
        revision: state.revision + 1,
        saveStatus: SAVE_STATUS.DIRTY,
        saveError: "",
      };
      emit();
      scheduleSave();
    }

    /** Marks non-frame project data dirty while preserving the current frame collection. */
    function markDirty() {
      state = {
        ...state,
        revision: state.revision + 1,
        saveStatus: SAVE_STATUS.DIRTY,
        saveError: "",
      };
      emit();
      scheduleSave();
    }

    /** Starts an isolated undo/redo history for one tool. */
    function beginToolSession(toolId) {
      const normalized = String(toolId || "");
      state = { ...state, activeToolId: normalized };
      toolHistory.set(normalized, { undo: [], redo: [] });
      emit();
    }

    /** Ends and discards one tool-local history without changing shared data. */
    function endToolSession(toolId = state.activeToolId) {
      toolHistory.delete(String(toolId || ""));
      if (state.activeToolId === toolId) state = { ...state, activeToolId: "" };
      emit();
    }

    /** Restores one tool-local workspace snapshot. */
    function restoreHistory(from, to) {
      const history = toolHistory.get(state.activeToolId);
      const entry = history?.[from]?.pop();
      if (!history || !entry) return false;
      history[to].push({ frames: clone(state.frames), selection: clone(state.selection) });
      state = {
        ...state,
        frames: entry.frames,
        selection: normalizeSelection(entry.selection, entry.frames),
        revision: state.revision + 1,
        saveStatus: SAVE_STATUS.DIRTY,
      };
      emit();
      scheduleSave();
      return true;
    }

    function undo() {
      return restoreHistory("undo", "redo");
    }

    function redo() {
      return restoreHistory("redo", "undo");
    }

    /**
     * Cancels a pending autosave and treats the current revision as acknowledged
     * without writing in-memory dirty values. An already in-flight save still finishes.
     * @returns {void}
     */
    function abandonUnsaved() {
      clearTimeoutImpl(saveTimer);
      saveTimer = 0;
      state = {
        ...state,
        lastSavedRevision: state.revision,
        saveStatus: state.saveStatus === SAVE_STATUS.SAVING ? SAVE_STATUS.SAVING : SAVE_STATUS.IDLE,
        saveError: "",
      };
      emit();
    }

    /** Schedules one delayed project save. */
    function scheduleSave() {
      if (!autosaveEnabled) return;
      clearTimeoutImpl(saveTimer);
      saveTimer = setTimeoutImpl(() => {
        saveTimer = 0;
        flushSave().catch(() => {});
      }, debounceMs);
      saveTimer?.unref?.();
    }

    /** Flushes the latest revision and preserves edits made during an in-flight request. */
    async function flushSave() {
      clearTimeoutImpl(saveTimer);
      saveTimer = 0;
      if (savePromise) {
        await savePromise;
        return flushSave();
      }
      if (state.revision === state.lastSavedRevision) return { status: state.saveStatus };
      const targetRevision = state.revision;
      state = { ...state, saveStatus: SAVE_STATUS.SAVING, saveError: "" };
      emit();
      savePromise = Promise.resolve(saveSnapshot(getSnapshot()))
        .then((result = {}) => {
          const hasNewerChanges = state.revision !== targetRevision;
          state = {
            ...state,
            lastSavedRevision: targetRevision,
            lastSavedAt: now().toISOString(),
            saveStatus: hasNewerChanges ? SAVE_STATUS.DIRTY : SAVE_STATUS.SAVED,
            saveError: "",
          };
          emit();
          if (hasNewerChanges) scheduleSave();
          return result;
        })
        .catch((error) => {
          const conflict = error?.status === 409 || error?.code === "REVISION_CONFLICT";
          state = {
            ...state,
            saveStatus: conflict ? SAVE_STATUS.CONFLICT : SAVE_STATUS.ERROR,
            saveError: String(error?.message || error || "Save failed"),
          };
          emit();
          throw error;
        })
        .finally(() => {
          savePromise = null;
        });
      const result = await savePromise;
      if (state.revision !== state.lastSavedRevision) return flushSave();
      return result;
    }

    return Object.freeze({
      abandonUnsaved,
      beginToolSession,
      commit,
      endToolSession,
      flushSave,
      getSnapshot,
      markDirty,
      redo,
      scheduleSave,
      selectFrames,
      setProjectContext,
      subscribe,
      undo,
    });
  }

  return Object.freeze({ SAVE_STATUS, createStore, normalizeFrame, stableFrameId });
});
