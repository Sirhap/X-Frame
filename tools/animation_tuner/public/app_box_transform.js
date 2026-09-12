(function attachXFrameBoxTransform(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameBoxTransform = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates box transform conversion and adjustment operations.
   * @param {{
   *   getCurrentGroup?:()=>object|null,
   *   getSelectedFrame?:()=>number,
   *   getConfig?:()=>object|null,
   *   getAdjustmentMode?:()=>string,
   *   getImages?:()=>Array<object>,
   *   getBoxEditSnapshot?:()=>object|null,
   *   frameTransform:(index:number,group:object)=>object,
   *   baseTransform:(group:object)=>object,
   *   characterTransform:(group:object)=>object,
   *   renderTransformForGroup:(transform:object,group:object)=>object,
   *   runtimeBaseScaleForGroup:(index:number,group:object,images?:Array<object>)=>number,
   *   combatBoxFacingForGroup:(group:object)=>number,
   *   getBoxOverrideStore:(group:object)=>Record<string,object>,
   *   createBoxEditSnapshot:(mode:string)=>object,
   *   transformHasDelta:(before:object,after:object)=>boolean,
   *   transformBoxByDelta:(boxName:string,box:object,before:object,after:object)=>object,
   *   rotateVector:(value:{x:number,y:number},radians:number)=>{x:number,y:number},
   *   markDirty?:()=>void,
   * }} dependencies Controller dependencies.
   * @returns {object} Box transform operations.
   */
  function createController(dependencies) {
    const {
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      getConfig = () => null,
      getAdjustmentMode = () => "group",
      getImages = () => [],
      getBoxEditSnapshot = () => null,
      frameTransform,
      baseTransform,
      characterTransform,
      renderTransformForGroup,
      runtimeBaseScaleForGroup,
      combatBoxFacingForGroup,
      getBoxOverrideStore,
      createBoxEditSnapshot,
      transformHasDelta,
      transformBoxByDelta,
      rotateVector,
      markDirty = () => {},
    } = dependencies;

    /**
     * Returns the runtime transform used by a combat box.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @returns {object} Runtime box transform.
     */
    function boxAutoTransform(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      const facing = combatBoxFacingForGroup(group);
      const transform = renderTransformForGroup(frameTransform(index, group), group);
      const runtimeBaseScale = Math.max(0.0001, runtimeBaseScaleForGroup(index, group, groupImages));
      return {
        facing,
        scaleX: runtimeBaseScale * Number(transform.scaleX ?? transform.scale ?? 1) * facing,
        scaleY: runtimeBaseScale * Number(transform.scaleY ?? transform.scale ?? 1),
        offset: {
          x: Number(transform.offset?.x || 0) * runtimeBaseScale * facing,
          y: Number(transform.offset?.y || 0) * runtimeBaseScale,
        },
        rotation: (Number(transform.rotation || 0) * facing * Math.PI) / 180,
      };
    }

    /**
     * Returns the transform represented by an adjustment mode.
     * @param {string} [mode] Adjustment mode.
     * @param {object|null} [group] Animation group.
     * @param {number} [index] Frame index.
     * @returns {object} Selected transform.
     */
    function transformForAdjustmentMode(
      mode = getAdjustmentMode(),
      group = getCurrentGroup(),
      index = getSelectedFrame(),
    ) {
      if (mode === "character") return characterTransform(group);
      if (mode === "frame") return frameTransform(index, group);
      return baseTransform(group);
    }

    /**
     * Converts a transform into the coordinate space used by box entries.
     * @param {string} mode Adjustment mode.
     * @param {object} transform Source transform.
     * @param {object|null} [group] Animation group.
     * @returns {object} Box-space transform.
     */
    function boxSpaceTransformForAdjustment(mode, transform, group = getCurrentGroup()) {
      const character = characterTransform(group);
      const characterUniform = Math.max(
        0.0001,
        Number((mode === "character" ? transform?.scale : character.scale) || 1),
      );
      return {
        scale: Number(transform?.scale ?? 1),
        scaleX: Number(transform?.scaleX ?? transform?.scale ?? 1),
        scaleY: Number(transform?.scaleY ?? transform?.scale ?? 1),
        offset: {
          x: Number(transform?.offset?.x || 0) * characterUniform,
          y: Number(transform?.offset?.y || 0) * characterUniform,
        },
        rotation: Number(transform?.rotation || 0),
      };
    }

    /**
     * Applies a transform delta to every captured box entry in scope.
     * @param {string} mode Adjustment mode.
     * @param {object} nextTransform Requested transform.
     * @returns {boolean} Whether any box changed.
     */
    function applyBoxTransformDelta(mode, nextTransform) {
      const currentSnapshot = getBoxEditSnapshot();
      const snapshot = currentSnapshot?.mode === mode ? currentSnapshot : createBoxEditSnapshot(mode);
      let changed = false;
      for (const groupUiId of snapshot.groupUiIds || []) {
        const group = (getConfig()?.groups || []).find((entry) => entry.uiId === groupUiId);
        if (!group) continue;
        const store = getBoxOverrideStore(group);
        const groupSnapshot = snapshot.boxes[groupUiId] || {};
        const nextBoxTransform = boxSpaceTransformForAdjustment(mode, nextTransform, group);
        for (const [key, record] of Object.entries(groupSnapshot)) {
          const previousTransform =
            mode === "frame"
              ? snapshot.frameTransforms[groupUiId]?.[String(record.index)] || snapshot.transforms[groupUiId]
              : snapshot.transforms[groupUiId];
          if (!transformHasDelta(previousTransform, nextBoxTransform)) continue;
          const nextEntry = structuredClone(store[key] || {});
          for (const [boxName, box] of Object.entries(record.boxes || {})) {
            nextEntry[boxName] = transformBoxByDelta(boxName, box, previousTransform, nextBoxTransform);
          }
          store[key] = nextEntry;
          changed = true;
        }
      }
      if (changed) markDirty();
      return changed;
    }

    /**
     * Converts a screen-space movement into box offset coordinates.
     * @param {{x:number,y:number}} delta Screen-space movement.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {{x:number,y:number}} Box offset delta.
     */
    function boxOffsetDeltaFromScreenDelta(delta, index = getSelectedFrame(), group = getCurrentGroup()) {
      const auto = boxAutoTransform(index, group);
      const unrotated = rotateVector(delta, -auto.rotation);
      return {
        x: unrotated.x / auto.scaleX,
        y: unrotated.y / auto.scaleY,
      };
    }

    /**
     * Converts a screen-space resize movement into box-local coordinates.
     * @param {{x:number,y:number}} delta Screen-space movement.
     * @param {number} [boxRotation] Box rotation in degrees.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {{x:number,y:number}} Box resize delta.
     */
    function boxResizeDeltaFromScreenDelta(
      delta,
      boxRotation = 0,
      index = getSelectedFrame(),
      group = getCurrentGroup(),
    ) {
      const offsetDelta = boxOffsetDeltaFromScreenDelta(delta, index, group);
      return rotateVector(offsetDelta, -(Number(boxRotation || 0) * Math.PI) / 180);
    }

    return {
      applyBoxTransformDelta,
      boxAutoTransform,
      boxOffsetDeltaFromScreenDelta,
      boxResizeDeltaFromScreenDelta,
      boxSpaceTransformForAdjustment,
      transformForAdjustmentMode,
    };
  }

  return { createController };
});
