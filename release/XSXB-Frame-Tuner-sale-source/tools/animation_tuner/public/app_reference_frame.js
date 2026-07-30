(function attachXsxbReferenceFrame(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBReferenceFrame = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates reference-frame state operations.
   * @param {{
   *   getCurrentGroup?:()=>object|null,
   *   getSelectedFrame?:()=>number,
   *   getImages?:()=>Array<object>,
   *   getReferenceFrame?:()=>object|null,
   *   setReferenceFrame?:(value:object|null)=>void,
   *   frameTransform:(index:number,group:object)=>object,
   *   renderFilmstrip?:()=>void,
   *   draw?:()=>void,
   * }} dependencies Controller dependencies.
   * @returns {object} Reference-frame operations.
   */
  function createController(dependencies) {
    const {
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      getImages = () => [],
      getReferenceFrame = () => null,
      setReferenceFrame = () => {},
      frameTransform,
      renderFilmstrip = () => {},
      draw = () => {},
    } = dependencies;

    /**
     * Returns the active reference frame index for a group.
     * @param {object|null} [group] Animation group.
     * @returns {number|null} Reference frame index.
     */
    function referenceFrameIndex(group = getCurrentGroup()) {
      const referenceFrame = getReferenceFrame();
      if (!referenceFrame || referenceFrame.group?.uiId !== group?.uiId) return null;
      return referenceFrame.index;
    }

    /**
     * Returns whether a frame is the active reference frame.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether the frame is active.
     */
    function isReferenceFrame(index = getSelectedFrame(), group = getCurrentGroup()) {
      return referenceFrameIndex(group) === index;
    }

    /**
     * Enables or disables the reference-frame snapshot.
     * @param {boolean} enabled Whether to enable the reference frame.
     * @returns {void}
     */
    function setReferenceFrameEnabled(enabled) {
      const group = getCurrentGroup();
      if (!group) return;
      if (enabled) {
        const selectedFrame = getSelectedFrame();
        const images = getImages();
        setReferenceFrame({
          group,
          index: selectedFrame,
          image: images[selectedFrame],
          images: images.slice(),
          transform: structuredClone(frameTransform(selectedFrame, group)),
        });
      } else {
        setReferenceFrame(null);
      }
      renderFilmstrip();
      draw();
    }

    return { isReferenceFrame, referenceFrameIndex, setReferenceFrameEnabled };
  }

  return { createController };
});
