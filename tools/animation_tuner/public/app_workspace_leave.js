(function attachXFrameAppWorkspaceLeave(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameAppWorkspaceLeave = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the last-saved tuning snapshot used when leaving the workbench.
   *
   * Autosave can persist dirty in-memory values while the leave-protect dialog
   * is open. Discard must restore the snapshot frozen at dialog open, then write
   * that snapshot back so a later reload cannot see the abandoned edit.
   *
   * @param {{
   *   cloneState?:()=>object|null,
   *   restoreState?:(snapshot:object)=>Promise<void>|void,
   *   abandonUnsaved?:()=>void,
   *   saveAfterIdle?:()=>Promise<void>|void,
   *   bumpEditRevision?:()=>void,
   *   loadConfigFallback?:()=>Promise<void>|void,
   * }} [dependencies] Snapshot and persist adapters.
   * @returns {{
   *   beginLeaveDecision:()=>object|null,
   *   cancelLeaveDecision:()=>void,
   *   captureSavedSnapshot:()=>object|null,
   *   discardChanges:()=>Promise<object|null>,
   *   getLeaveSnapshot:()=>object|null,
   *   getSavedSnapshot:()=>object|null,
   * }} Leave-protect snapshot operations.
   */
  function createController(dependencies = {}) {
    const cloneState = dependencies.cloneState || (() => null);
    const restoreState = dependencies.restoreState || (async () => {});
    const abandonUnsaved = dependencies.abandonUnsaved || (() => {});
    const saveAfterIdle = dependencies.saveAfterIdle || (async () => {});
    const bumpEditRevision = dependencies.bumpEditRevision || (() => {});
    const loadConfigFallback = dependencies.loadConfigFallback || (async () => {});
    let lastSavedSnapshot = null;
    let leaveSnapshot = null;

    /** Stores a defensive copy of the last accepted clean tuning state. */
    function captureSavedSnapshot() {
      lastSavedSnapshot = cloneState();
      return lastSavedSnapshot;
    }

    /** Returns the last accepted clean snapshot. */
    function getSavedSnapshot() {
      return lastSavedSnapshot;
    }

    /** Returns the snapshot frozen when the leave-protect dialog opened. */
    function getLeaveSnapshot() {
      return leaveSnapshot;
    }

    /**
     * Stops pending autosave and freezes the last-saved snapshot for discard.
     * @returns {object|null} Frozen snapshot that discard will restore.
     */
    function beginLeaveDecision() {
      abandonUnsaved();
      leaveSnapshot = lastSavedSnapshot;
      return leaveSnapshot;
    }

    /** Forgets a cancelled leave-protect decision without restoring state. */
    function cancelLeaveDecision() {
      leaveSnapshot = null;
    }

    /**
     * Restores the frozen last-saved snapshot and persists it after any in-flight save.
     * @returns {Promise<object|null>} Restored snapshot, or null when falling back to reload.
     */
    async function discardChanges() {
      abandonUnsaved();
      bumpEditRevision();
      const snapshot = leaveSnapshot || lastSavedSnapshot;
      leaveSnapshot = null;
      if (snapshot) await restoreState(snapshot);
      else await loadConfigFallback();
      await saveAfterIdle();
      return snapshot;
    }

    return Object.freeze({
      beginLeaveDecision,
      cancelLeaveDecision,
      captureSavedSnapshot,
      discardChanges,
      getLeaveSnapshot,
      getSavedSnapshot,
    });
  }

  return Object.freeze({ createController });
});
