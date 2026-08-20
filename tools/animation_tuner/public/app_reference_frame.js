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
   *   markDirty?:()=>void,
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
      markDirty = () => {},
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
      markDirty();
      renderFilmstrip();
      draw();
    }

    /** Returns a JSON-safe reference-frame descriptor with stable project identity. */
    function serializeReferenceFrame() {
      const referenceFrame = getReferenceFrame();
      const profileId = String(referenceFrame?.group?.profileId || "").trim();
      const animationId = String(referenceFrame?.group?.animationId || "").trim();
      const frameIndex = Number(referenceFrame?.index);
      if (!profileId || !animationId || !Number.isInteger(frameIndex) || frameIndex < 0) return null;
      return {
        profile_id: profileId,
        animation_id: animationId,
        frame_index: frameIndex,
        transform: structuredClone(referenceFrame.transform || {}),
      };
    }

    /**
     * Rebuilds the runtime image snapshot represented by a persisted descriptor.
     * Invalid or stale descriptors are cleared without blocking project loading.
     */
    async function restoreReferenceFrame(descriptor, groups, loadImages) {
      setReferenceFrame(null);
      if (!descriptor || typeof descriptor !== "object" || typeof loadImages !== "function") return false;
      const frameIndex = Number(descriptor.frame_index);
      const group = Array.from(groups || []).find(
        (entry) =>
          entry?.profileId === descriptor.profile_id && entry?.animationId === descriptor.animation_id,
      );
      const frames = Array.isArray(group?.frames) ? group.frames : [];
      if (!group || !Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= frames.length) {
        return false;
      }
      try {
        const referenceImages = await loadImages(frames);
        if (!referenceImages?.[frameIndex]) return false;
        setReferenceFrame({
          group,
          index: frameIndex,
          image: referenceImages[frameIndex],
          images: referenceImages.slice(),
          transform: structuredClone(descriptor.transform || {}),
        });
        return true;
      } catch (_error) {
        setReferenceFrame(null);
        return false;
      }
    }

    /**
     * Clears a deleted reference frame or remaps a surviving one after a
     * same-group deletion. Other groups are left untouched.
     * @param {Iterable<number>} removedIndexes Zero-based indexes that were removed.
     * @param {object|null} [group] Animation that lost frames.
     * @returns {void}
     */
    function forgetDeletedFrames(removedIndexes, group = getCurrentGroup()) {
      const referenceFrame = getReferenceFrame();
      const refIndex = referenceFrameIndex(group);
      if (refIndex == null || !referenceFrame) return;
      const removed = new Set(
        Array.from(removedIndexes || []).filter((index) => Number.isInteger(index) && index >= 0),
      );
      if (!removed.size) return;
      if (removed.has(refIndex)) {
        setReferenceFrame(null);
        markDirty();
        renderFilmstrip();
        draw();
        return;
      }
      const shift = Array.from(removed).filter((index) => index < refIndex).length;
      if (!shift) return;
      setReferenceFrame({ ...referenceFrame, index: refIndex - shift });
      markDirty();
      renderFilmstrip();
      draw();
    }

    return {
      forgetDeletedFrames,
      isReferenceFrame,
      referenceFrameIndex,
      restoreReferenceFrame,
      serializeReferenceFrame,
      setReferenceFrameEnabled,
    };
  }

  return { createController };
});
