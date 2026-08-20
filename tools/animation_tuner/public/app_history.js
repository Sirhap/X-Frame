(function attachXsxbHistory(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates undo/redo stack management around the existing editor snapshots.
   * @param {{
   *   elements?:{undo?:object,undoTop?:object,redoTop?:object},
   *   getUndoStack?:()=>Array<object>,
   *   setUndoStack?:(value:Array<object>)=>void,
   *   getRedoStack?:()=>Array<object>,
   *   setRedoStack?:(value:Array<object>)=>void,
   *   getSnapshot:()=>object,
   *   restoreSnapshot:(state:object)=>Promise<void>|void,
   *   commitPending?:()=>void,
   *   markDirty?:()=>void,
   *   status?:(message:string)=>void,
   *   translate?:(key:string,variables?:object)=>string,
   *   maxDepth?:number,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   updateHistoryControls:()=>void,
   *   pushUndo:(label?:string)=>void,
   *   undo:()=>void,
   *   redo:()=>void,
   * }} History operations.
   */
  function createController(dependencies) {
    const {
      elements = {},
      getUndoStack = () => [],
      setUndoStack = () => {},
      getRedoStack = () => [],
      setRedoStack = () => {},
      getSnapshot,
      restoreSnapshot,
      commitPending = () => {},
      markDirty = () => {},
      status = () => {},
      translate = (key) => key,
      maxDepth = 80,
    } = dependencies;

    /**
     * Synchronizes undo and redo button disabled states.
     * @returns {void}
     */
    function updateHistoryControls() {
      const undoStack = getUndoStack();
      const redoStack = getRedoStack();
      for (const button of [elements.undo, elements.undoTop]) {
        if (button) button.disabled = !undoStack.length;
      }
      if (elements.redoTop) elements.redoTop.disabled = !redoStack.length;
    }

    /**
     * Adds a snapshot to the undo stack and clears redo history.
     * @param {string} [label="edit"] Human-readable edit label.
     * @returns {void}
     */
    let pending = Promise.resolve();

    function enqueueHistory(task) {
      pending = pending.catch(() => undefined).then(task);
      return pending;
    }

    function pushUndo(label = "edit") {
      commitPending();
      const undoStack = getUndoStack();
      undoStack.push({ label, state: getSnapshot() });
      if (undoStack.length > maxDepth) undoStack.shift();
      setRedoStack([]);
      updateHistoryControls();
      status(translate("undoReady", { label }));
    }

    /**
     * Restores the most recent undo snapshot.
     * @returns {Promise<void>}
     */
    function undo() {
      return enqueueHistory(async () => {
        commitPending();
        const undoStack = getUndoStack();
        const item = undoStack.pop();
        if (!item) {
          status(translate("undoNothing"));
          updateHistoryControls();
          return;
        }
        const redoStack = getRedoStack();
        redoStack.push({ label: item.label, state: getSnapshot() });
        if (redoStack.length > maxDepth) redoStack.shift();
        updateHistoryControls();
        try {
          await restoreSnapshot(item.state);
          markDirty();
          updateHistoryControls();
          status(translate("undone", { label: item.label }));
        } catch (error) {
          status(translate("loadFailed", { message: error.message }));
        }
      });
    }

    /**
     * Restores the most recent redo snapshot.
     * @returns {Promise<void>}
     */
    function redo() {
      return enqueueHistory(async () => {
        commitPending();
        const redoStack = getRedoStack();
        const item = redoStack.pop();
        if (!item) {
          status(translate("redoNothing"));
          updateHistoryControls();
          return;
        }
        const undoStack = getUndoStack();
        undoStack.push({ label: item.label, state: getSnapshot() });
        if (undoStack.length > maxDepth) undoStack.shift();
        updateHistoryControls();
        try {
          await restoreSnapshot(item.state);
          markDirty();
          updateHistoryControls();
          status(translate("redone", { label: item.label }));
        } catch (error) {
          status(translate("loadFailed", { message: error.message }));
        }
      });
    }

    return { pushUndo, redo, undo, updateHistoryControls };
  }

  return { createController };
});
