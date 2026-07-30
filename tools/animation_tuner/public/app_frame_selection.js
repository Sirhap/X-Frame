(function attachXsxbFrameSelection(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBFrameSelection = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates frame index and multi-selection operations.
   * @param {{
   *   getCurrentGroup?:()=>object|null,
   *   getSelectedFrame?:()=>number,
   *   setSelectedFrame?:(value:number)=>void,
   *   getSelectedFrames?:()=>Set<number>,
   *   setSelectedFrames?:(value:Set<number>)=>void,
   *   getSelectionAnchorFrame?:()=>number,
   *   setSelectionAnchorFrame?:(value:number)=>void,
   *   onPrimaryFrameChanged?:(value:number)=>void,
   * }} dependencies Controller dependencies.
   * @returns {object} Frame selection operations.
   */
  function createController(dependencies) {
    const {
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      setSelectedFrame = () => {},
      getSelectedFrames = () => new Set(),
      setSelectedFrames = () => {},
      getSelectionAnchorFrame = () => 0,
      setSelectionAnchorFrame = () => {},
      onPrimaryFrameChanged = () => {},
    } = dependencies;

    /**
     * Clamps a frame index to a group's available frame range.
     * @param {number} index Candidate frame index.
     * @param {object|null} [group] Animation group.
     * @returns {number} Clamped frame index.
     */
    function clampFrameIndex(index, group = getCurrentGroup()) {
      const maxFrame = Math.max((group?.frames?.length || 1) - 1, 0);
      return Math.min(Math.max(Number(index) || 0, 0), maxFrame);
    }

    /**
     * Replaces the current selection with one frame.
     * @param {number} index Target frame index.
     * @param {object|null} [group] Animation group.
     * @returns {void}
     */
    function setSingleFrameSelection(index, group = getCurrentGroup()) {
      const selectedFrame = clampFrameIndex(index, group);
      setSelectedFrame(selectedFrame);
      onPrimaryFrameChanged(selectedFrame);
      setSelectedFrames(new Set([selectedFrame]));
      setSelectionAnchorFrame(selectedFrame);
    }

    /**
     * Sets a multi-frame selection while keeping a primary frame.
     * @param {Array<number>} indexes Candidate frame indexes.
     * @param {number} [primaryIndex] Primary frame index.
     * @param {object|null} [group] Animation group.
     * @returns {void}
     */
    function setFrameSelection(indexes, primaryIndex = getSelectedFrame(), group = getCurrentGroup()) {
      const maxFrame = Math.max((group?.frames?.length || 1) - 1, 0);
      const next = new Set();
      for (const index of indexes || []) {
        const frameIndex = clampFrameIndex(index, group);
        if (frameIndex >= 0 && frameIndex <= maxFrame) next.add(frameIndex);
      }
      const selectedFrame = clampFrameIndex(primaryIndex, group);
      setSelectedFrame(selectedFrame);
      onPrimaryFrameChanged(selectedFrame);
      next.add(selectedFrame);
      setSelectedFrames(next);
      setSelectionAnchorFrame(clampFrameIndex(getSelectionAnchorFrame(), group));
    }

    /**
     * Returns selected frame indexes in stable ascending order.
     * @param {object|null} [group] Animation group.
     * @returns {Array<number>} Selected frame indexes.
     */
    function selectedFrameIndexes(group = getCurrentGroup()) {
      if (!getSelectedFrames().size) setSingleFrameSelection(getSelectedFrame(), group);
      return Array.from(getSelectedFrames())
        .map((index) => clampFrameIndex(index, group))
        .filter((index, position, array) => array.indexOf(index) === position)
        .sort((a, b) => a - b);
    }

    /**
     * Returns the number of selected frames.
     * @param {object|null} [group] Animation group.
     * @returns {number} Selection count.
     */
    function selectedFrameCount(group = getCurrentGroup()) {
      return selectedFrameIndexes(group).length;
    }

    return {
      clampFrameIndex,
      selectedFrameCount,
      selectedFrameIndexes,
      setFrameSelection,
      setSingleFrameSelection,
    };
  }

  return { createController };
});
