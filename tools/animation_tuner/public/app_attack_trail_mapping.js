(function attachXsxbAttackTrailMapping(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppAttackTrailMapping = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates attack-trail group-local ↔ screen mapping operations.
   * @param {object} [dependencies] Transform and frame accessors.
   * @returns {object} Mapping operations.
   */
  function createController(dependencies = {}) {
    const {
      getCurrentGroup = () => null,
      getImages = () => [],
      getSelectedFrame = () => 0,
      getView = () => ({ zoom: 1 }),
      getDevicePixelRatio = () => 1,
      frameTransform = () => ({ scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
      frameScreenRect = () => null,
      renderTransformForGroup = (transform) => transform,
      runtimeBaseScaleForGroup = () => 1,
      effectiveFlipH = () => false,
    } = dependencies;

    /**
     * Converts attack-trail group-local coordinates into canvas pixels.
     * @param {{x?:number,y?:number}} point Group-local point.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @returns {{x:number,y:number}} Screen coordinate.
     */
    function attackTrailLocalToScreen(point, group = getCurrentGroup(), groupImages = getImages()) {
      const index = getSelectedFrame();
      const sourceTransform = frameTransform(index, group);
      const rect = frameScreenRect(index, group, groupImages, { transform: sourceTransform });
      if (!rect || !group) return { x: 0, y: 0 };
      const transform = renderTransformForGroup(sourceTransform, group);
      const runtimeScale = runtimeBaseScaleForGroup(index, group, groupImages);
      const worldScale = getView().zoom * Number(getDevicePixelRatio() || 1);
      const facing = effectiveFlipH(group) ? -1 : 1;
      const scaleX = runtimeScale * transform.scaleX * worldScale * facing;
      const scaleY = runtimeScale * transform.scaleY * worldScale;
      const rotation = (Number(transform.rotation || 0) * facing * Math.PI) / 180;
      const x = Number(point?.x || 0) * scaleX;
      const y = Number(point?.y || 0) * scaleY;
      return {
        x: rect.originX + x * Math.cos(rotation) - y * Math.sin(rotation),
        y: rect.originY + x * Math.sin(rotation) + y * Math.cos(rotation),
      };
    }

    /**
     * Converts canvas pixels into attack-trail group-local coordinates.
     * @param {{x?:number,y?:number}} point Screen coordinate.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @returns {{x:number,y:number}} Group-local point.
     */
    function attackTrailScreenToLocal(point, group = getCurrentGroup(), groupImages = getImages()) {
      const index = getSelectedFrame();
      const sourceTransform = frameTransform(index, group);
      const rect = frameScreenRect(index, group, groupImages, { transform: sourceTransform });
      if (!rect || !group) return { x: 0, y: 0 };
      const transform = renderTransformForGroup(sourceTransform, group);
      const runtimeScale = runtimeBaseScaleForGroup(index, group, groupImages);
      const worldScale = getView().zoom * Number(getDevicePixelRatio() || 1);
      const facing = effectiveFlipH(group) ? -1 : 1;
      const scaleX = runtimeScale * transform.scaleX * worldScale * facing;
      const scaleY = runtimeScale * transform.scaleY * worldScale;
      const rotation = -(Number(transform.rotation || 0) * facing * Math.PI) / 180;
      const dx = Number(point?.x || 0) - rect.originX;
      const dy = Number(point?.y || 0) - rect.originY;
      return {
        x: (dx * Math.cos(rotation) - dy * Math.sin(rotation)) / (scaleX || 1),
        y: (dx * Math.sin(rotation) + dy * Math.cos(rotation)) / (scaleY || 1),
      };
    }

    return {
      attackTrailLocalToScreen,
      attackTrailScreenToLocal,
    };
  }

  return { createController };
});
