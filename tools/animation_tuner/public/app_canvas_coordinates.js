(function attachXFrameCanvasCoordinates(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameCanvasCoordinates = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates canvas coordinate and floor-alignment operations.
   * @param {{
   *   getCurrentGroup?:()=>object|null,
   *   getSelectedFrame?:()=>number,
   *   getImages?:()=>Array<object>,
   *   getView?:()=>{x:number,y:number,zoom:number},
   *   getDevicePixelRatio?:()=>number,
   *   getConfig?:()=>object|null,
   *   runtimeBaseScaleForGroup:(index:number,group:object,images?:Array<object>)=>number,
   * }} dependencies Controller dependencies.
   * @returns {object} Canvas coordinate operations.
   */
  function createController(dependencies) {
    const {
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      getImages = () => [],
      getView = () => ({ x: 0, y: 0, zoom: 1 }),
      getDevicePixelRatio = () => 1,
      getConfig = () => null,
      runtimeBaseScaleForGroup,
    } = dependencies;

    /**
     * Returns the screen scale for a group coordinate.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @returns {number} Screen pixels per runtime unit.
     */
    function coordinateScreenScale(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      const view = getView();
      const worldScale = view.zoom * getDevicePixelRatio();
      if (!group) return Math.max(0.0001, worldScale);
      return Math.max(0.0001, runtimeBaseScaleForGroup(index, group, groupImages) * worldScale);
    }

    /**
     * Returns the screen origin for a group's coordinate system.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @param {boolean} [alignFloor] Whether to align to the active floor.
     * @returns {{x:number,y:number}} Screen origin.
     */
    function coordinateOrigin(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
      alignFloor = false,
    ) {
      return groupOriginScreen(index, group, groupImages, alignFloor);
    }

    /**
     * Converts a runtime coordinate into screen pixels.
     * @param {{x?:number,y?:number}} point Runtime coordinate.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @param {boolean} [alignFloor] Whether to align to the active floor.
     * @returns {{x:number,y:number}} Screen coordinate.
     */
    function coordinateToScreen(
      point,
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
      alignFloor = false,
    ) {
      const origin = coordinateOrigin(index, group, groupImages, alignFloor);
      const scale = coordinateScreenScale(index, group, groupImages);
      return {
        x: origin.x + Number(point?.x || 0) * scale,
        y: origin.y + Number(point?.y || 0) * scale,
      };
    }

    /**
     * Converts screen pixels into a runtime coordinate.
     * @param {{x?:number,y?:number}} point Screen coordinate.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @param {boolean} [alignFloor] Whether to align to the active floor.
     * @returns {{x:number,y:number}} Runtime coordinate.
     */
    function screenToCoordinate(
      point,
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
      alignFloor = false,
    ) {
      const origin = coordinateOrigin(index, group, groupImages, alignFloor);
      const scale = coordinateScreenScale(index, group, groupImages);
      return {
        x: (Number(point?.x || 0) - origin.x) / scale,
        y: (Number(point?.y || 0) - origin.y) / scale,
      };
    }

    /**
     * Chooses a readable coordinate-grid interval.
     * @param {number} screenScale Screen pixels per runtime unit.
     * @returns {number} Grid interval in runtime units.
     */
    function coordinateGridStep(screenScale) {
      const targetPixels = 96 * getDevicePixelRatio();
      const raw = Math.max(1, targetPixels / Math.max(screenScale, 0.0001));
      const base = 10 ** Math.floor(Math.log10(raw));
      for (const multiplier of [1, 2, 5, 10]) {
        const step = base * multiplier;
        if (step >= raw) return step;
      }
      return base * 10;
    }

    /**
     * Returns the display label for the active floor reference.
     * @param {object|null} [group] Animation group.
     * @returns {string} Floor label.
     */
    function floorReferenceLabel(group = getCurrentGroup()) {
      if (group?.tuningTarget === "soul") return "Soul runtime floor";
      return "Floor top";
    }

    /**
     * Returns the configured floor-top offset for a group.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @returns {number} Floor offset in runtime units.
     */
    function floorTopReferenceOffset(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      void index;
      void groupImages;
      if (!group) return 0;
      const references = getConfig()?.references || {};
      if (group.tuningTarget === "soul") return 0;
      if (group.tuningTarget === "huang_xian") return Number(references.playerFloorTopOffsetY || 0);
      if (group.tuningTarget === "boss" || group.tuningTarget === "act2_statue_boss") {
        return Number(references.bossFloorTopOffsetY || 0);
      }
      if (group.type === "character") return Number(references.playerFloorTopOffsetY || 0);
      return Number(references.playerFloorTopOffsetY || 0);
    }

    /**
     * Returns the floor alignment delta between a frame and the active frame.
     * @param {number} index Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @returns {number} Floor alignment delta.
     */
    function floorAlignmentDelta(index, group = getCurrentGroup(), groupImages = getImages()) {
      return (
        floorTopReferenceOffset(getSelectedFrame(), getCurrentGroup(), getImages()) -
        floorTopReferenceOffset(index, group, groupImages)
      );
    }

    /**
     * Returns the screen origin after optional floor alignment.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @param {boolean} [alignFloor] Whether to align to the active floor.
     * @returns {{x:number,y:number}} Screen origin.
     */
    function groupOriginScreen(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
      alignFloor = false,
    ) {
      const view = getView();
      const floorDelta = alignFloor ? floorAlignmentDelta(index, group, groupImages) : 0;
      return {
        x: view.x,
        y: view.y + floorDelta * view.zoom * getDevicePixelRatio(),
      };
    }

    return {
      coordinateGridStep,
      coordinateOrigin,
      coordinateScreenScale,
      coordinateToScreen,
      floorAlignmentDelta,
      floorReferenceLabel,
      floorTopReferenceOffset,
      groupOriginScreen,
      screenToCoordinate,
    };
  }

  return { createController };
});
