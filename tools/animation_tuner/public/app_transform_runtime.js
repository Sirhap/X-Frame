(function attachXsxbTransformRuntime(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBTransformRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Creates runtime scale, anchor, and base-transform helpers.
   * @param {{
   *   getConfig?:()=>object|null,
   *   getCurrentGroup?:()=>object|null,
   *   getSelectedFrame?:()=>number,
   *   getImages?:()=>Array<object>,
   *   getValueStore:(group:object)=>Record<string,unknown>,
   *   getActiveSceneScale?:()=>number,
   *   getOpaqueRectForImage:(image:object)=>{x:number,y:number,width:number,height:number},
   *   cloneScaleVector:(value:unknown,fallback:number)=>{x:number,y:number},
   *   cloneVector:(value:unknown)=>{x:number,y:number},
   * }} dependencies Current app-state accessors and shared geometry helpers.
   * @returns {object} Runtime transform operations.
   */
  function createController(dependencies) {
    const {
      getConfig = () => null,
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      getImages = () => [],
      getValueStore,
      getActiveSceneScale = () => 1,
      getOpaqueRectForImage,
      cloneScaleVector,
      cloneVector,
    } = dependencies;

    /** Returns the canonical visual height used by runtime anchors. @returns {number} Preview height. */
    function playerPreviewVisualHeight() {
      const config = getConfig();
      const canonicalHeight = Number(config?.references?.playerCanonicalIdleHeight);
      if (Number.isFinite(canonicalHeight) && canonicalHeight > 0) return canonicalHeight;
      const idleGroup = config?.groups?.find((group) => !group.tuningTarget && group.name === "idle");
      if (!idleGroup || !idleGroup.frames?.length) return 720;
      const idleTransform = baseTransform(idleGroup);
      return (
        Number(idleGroup.frames[0].height || 720) * Number(idleTransform.scaleY ?? idleTransform.scale ?? 1)
      );
    }

    /** Calculates Huang Xian's opaque-pixel runtime scale. @returns {number} Runtime scale. */
    function huangXianRuntimeBaseScale(
      index = getSelectedFrame(),
      _group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      const img = groupImages[index];
      if (!img) return 1;
      const opaqueRect = getOpaqueRectForImage(img);
      const config = getConfig();
      const targetHeight =
        Number(config?.references?.huangXianTargetHeight) ||
        playerPreviewVisualHeight() * Number(config?.references?.huangXianHeightScale || 1.06);
      return targetHeight / Math.max(opaqueRect.height, 1);
    }

    /** Returns the target-height multiplier for a group. @returns {number} Height multiplier. */
    function targetHeightScaleForGroup(group = getCurrentGroup()) {
      const config = getConfig();
      if (group?.tuningTarget === "soul")
        return Number(group.targetHeightScale || config?.references?.soulHeightScale || 1.08);
      if (group?.tuningTarget === "huang_xian")
        return Number(config?.references?.huangXianHeightScale || group.targetHeightScale || 1.06);
      return Number(group?.targetHeightScale || 1);
    }

    /** Returns an explicit or derived target height for a group. @returns {number} Target height. */
    function targetHeightForGroup(group = getCurrentGroup()) {
      const config = getConfig();
      const explicitTargetHeight = Number(group?.targetHeight || 0);
      if (Number.isFinite(explicitTargetHeight) && explicitTargetHeight > 0) return explicitTargetHeight;
      if (group?.tuningTarget === "soul") {
        return (
          Number(config?.references?.soulTargetHeight) ||
          playerPreviewVisualHeight() * targetHeightScaleForGroup(group)
        );
      }
      if (group?.tuningTarget === "huang_xian") {
        return (
          Number(config?.references?.huangXianTargetHeight) ||
          playerPreviewVisualHeight() * targetHeightScaleForGroup(group)
        );
      }
      return 0;
    }

    /** Checks whether a group uses a target-height foot anchor. @returns {boolean} Anchor flag. */
    function usesTargetHeightFootAnchor(group = getCurrentGroup()) {
      return (
        group?.tuningTarget === "huang_xian" ||
        group?.scaleSemantic === "target_height" ||
        (group?.tuningTarget === "soul" && group?.type !== "vfx" && group?.type !== "prop")
      );
    }

    /** Checks whether a group is bottom-center anchored. @returns {boolean} Anchor flag. */
    function usesCanvasBottomCenterAnchor(group = getCurrentGroup()) {
      return group?.anchorMode === "canvas_bottom_center";
    }

    /** Checks whether a group is left-bottom anchored. @returns {boolean} Anchor flag. */
    function usesCanvasLeftBottomAnchor(group = getCurrentGroup()) {
      return group?.anchorMode === "canvas_left_bottom";
    }

    /** Checks whether a group uses either canvas foot anchor. @returns {boolean} Anchor flag. */
    function usesCanvasFootAnchor(group = getCurrentGroup()) {
      return usesCanvasBottomCenterAnchor(group) || usesCanvasLeftBottomAnchor(group);
    }

    /** Checks whether a group is scene-top-left anchored. @returns {boolean} Anchor flag. */
    function usesSceneTopLeftAnchor(group = getCurrentGroup()) {
      return group?.anchorMode === "scene_top_left";
    }

    /** Checks whether a soul prop uses a canvas foot anchor. @returns {boolean} Anchor flag. */
    function usesPropFootAnchor(group = getCurrentGroup()) {
      return group?.tuningTarget === "soul" && group?.type === "prop" && usesCanvasFootAnchor(group);
    }

    /** Checks whether a regular actor uses a canvas foot anchor. @returns {boolean} Anchor flag. */
    function usesGenericFootAnchor(group = getCurrentGroup()) {
      return (
        usesCanvasFootAnchor(group) &&
        !usesTargetHeightFootAnchor(group) &&
        !usesPropFootAnchor(group) &&
        group?.type !== "vfx" &&
        group?.type !== "scene_prop"
      );
    }

    /** Checks whether runtime positioning should use a foot anchor. @returns {boolean} Anchor flag. */
    function usesRuntimeFootAnchor(group = getCurrentGroup()) {
      return usesTargetHeightFootAnchor(group) || usesPropFootAnchor(group) || usesGenericFootAnchor(group);
    }

    /** Calculates a target-height group's runtime base scale. @returns {number} Runtime scale. */
    function targetHeightRuntimeBaseScale(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      const img = groupImages[index];
      if (!img) return 1;
      const targetHeight = characterBaseScaleForGroup(group) * playerPreviewVisualHeight();
      if (usesCanvasFootAnchor(group)) {
        return targetHeight / Math.max(img.height, 1);
      }
      const opaqueRect = getOpaqueRectForImage(img);
      return targetHeight / Math.max(opaqueRect.height, 1);
    }

    /** Calculates the runtime scale for a soul-attached VFX group. @returns {number} Runtime scale. */
    function soulAttachedVfxRuntimeBaseScale(group = getCurrentGroup()) {
      if (group?.tuningTarget !== "soul" || group?.type !== "vfx") return 1;
      const config = getConfig();
      const ownerName = group.attachTo || String(group.name || "").replace(/_vfx$/, "");
      const ownerGroup = config?.groups?.find(
        (entry) => entry.tuningTarget === "soul" && entry.name === ownerName,
      );
      const ownerHeight = Number(ownerGroup?.frames?.[0]?.height || group.attachedFrameHeight || 1);
      return targetHeightForGroup(ownerGroup || group) / Math.max(ownerHeight, 1);
    }

    /** Returns the character's effective base scale. @returns {number} Character scale. */
    function characterBaseScaleForGroup(group = getCurrentGroup()) {
      const explicitScale = Number(characterTransform(group).scale);
      if (Number.isFinite(explicitScale) && explicitScale > 0) return explicitScale;
      const targetHeight = targetHeightForGroup(group);
      const playerHeight = playerPreviewVisualHeight();
      if (targetHeight > 0 && playerHeight > 0) return targetHeight / playerHeight;
      const scale = Number(group?.runtimeScale ?? 1);
      return Number.isFinite(scale) && scale > 0 ? scale : 1;
    }

    /** Returns the runtime scale for a frame and group. @returns {number} Runtime scale. */
    function runtimeBaseScaleForGroup(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      const characterScale = characterBaseScaleForGroup(group);
      const sceneScale = getActiveSceneScale();
      if (usesTargetHeightFootAnchor(group))
        return targetHeightRuntimeBaseScale(index, group, groupImages) * sceneScale;
      if (usesPropFootAnchor(group) || usesGenericFootAnchor(group)) return characterScale * sceneScale;
      if (group?.tuningTarget === "soul" && group?.type === "vfx")
        return soulAttachedVfxRuntimeBaseScale(group) * sceneScale;
      return soulAttachedVfxRuntimeBaseScale(group) * characterScale * sceneScale;
    }

    /** Returns the character transform from the group's value store. @returns {object} Character transform. */
    function characterTransform(group = getCurrentGroup()) {
      if (!group) {
        return {
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          visual_scale: { x: 1, y: 1 },
          offset: { x: 0, y: 0 },
          rotation: 0,
        };
      }
      const store = getValueStore(group);
      const scale = Number(store[group.characterScale] ?? group.characterBaseScale ?? group.bodyScale ?? 1);
      const scaleVector = cloneScaleVector(
        store[group.characterScaleVector] ?? group.characterBaseScaleVector,
        scale,
      );
      return {
        scale,
        scaleX: scaleVector.x,
        scaleY: scaleVector.y,
        visual_scale: scaleVector,
        offset: cloneVector(store[group.characterOffset] ?? group.characterBaseOffset ?? { x: 0, y: 0 }),
        rotation: Number(store[group.characterRotation] ?? group.characterBaseRotation ?? 0),
      };
    }

    /** Merges a group transform with its character-level transform. @returns {object} Render transform. */
    function renderTransformForGroup(transform, group = getCurrentGroup()) {
      const character = characterTransform(group);
      const characterScale = Number(character.scale || 1);
      const axisX = characterScale !== 0 ? Number(character.scaleX || characterScale) / characterScale : 1;
      const axisY = characterScale !== 0 ? Number(character.scaleY || characterScale) / characterScale : 1;
      return {
        scale: Number(transform.scale ?? 1),
        scaleX: Number(transform.scaleX ?? transform.scale ?? 1) * axisX,
        scaleY: Number(transform.scaleY ?? transform.scale ?? 1) * axisY,
        offset: {
          x: Number(character.offset?.x || 0) + Number(transform.offset?.x || 0),
          y: Number(character.offset?.y || 0) + Number(transform.offset?.y || 0),
        },
        rotation: Number(character.rotation || 0) + Number(transform.rotation || 0),
      };
    }

    /** Returns the horizontal target-height animation anchor. @returns {number} Source-space X. */
    function targetHeightAnimationAnchorX(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      if (Number.isFinite(Number(group?.sourceAnchor?.x))) {
        return Number(group.sourceAnchor.x);
      }
      if (usesCanvasBottomCenterAnchor(group)) {
        const img = groupImages?.[index] || groupImages?.[0];
        return img ? img.width * 0.5 : 0;
      }
      if (usesCanvasLeftBottomAnchor(group)) return 0;
      const anchorImage = group?.huangXianAnchorImage || groupImages?.[0];
      if (!anchorImage) return 0;
      const opaqueRect = getOpaqueRectForImage(anchorImage);
      return opaqueRect.x + opaqueRect.width * 0.5;
    }

    /** Returns the vertical target-height animation anchor. @returns {number} Source-space Y. */
    function targetHeightAnimationAnchorY(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      if (Number.isFinite(Number(group?.sourceAnchor?.y))) {
        return Number(group.sourceAnchor.y);
      }
      const img = groupImages[index];
      if (!img) return 0;
      if (usesCanvasFootAnchor(group)) {
        return img.height;
      }
      const opaqueRect = getOpaqueRectForImage(img);
      return opaqueRect.y + opaqueRect.height;
    }

    /** Returns the base transform from the group's value store. @returns {object} Base transform. */
    function baseTransform(group = getCurrentGroup()) {
      if (!group) {
        return {
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          visual_scale: { x: 1, y: 1 },
          offset: { x: 0, y: 0 },
          rotation: 0,
        };
      }
      const store = getValueStore(group);
      const scale = Number(store[group.scale] ?? group.defaultScale ?? group.baseScale ?? 0.22);
      const scaleVector = cloneScaleVector(
        store[group.scaleVector] ?? group.defaultScaleVector ?? group.baseScaleVector,
        scale,
      );
      return {
        scale,
        scaleX: scaleVector.x,
        scaleY: scaleVector.y,
        visual_scale: scaleVector,
        offset: cloneVector(store[group.offset] ?? group.defaultOffset ?? group.baseOffset ?? { x: 0, y: 0 }),
        rotation: Number(store[group.rotation] ?? group.defaultRotation ?? group.baseRotation ?? 0),
      };
    }

    return {
      playerPreviewVisualHeight,
      huangXianRuntimeBaseScale,
      targetHeightScaleForGroup,
      targetHeightForGroup,
      usesTargetHeightFootAnchor,
      usesCanvasBottomCenterAnchor,
      usesCanvasLeftBottomAnchor,
      usesCanvasFootAnchor,
      usesSceneTopLeftAnchor,
      usesPropFootAnchor,
      usesGenericFootAnchor,
      usesRuntimeFootAnchor,
      targetHeightRuntimeBaseScale,
      soulAttachedVfxRuntimeBaseScale,
      characterBaseScaleForGroup,
      runtimeBaseScaleForGroup,
      characterTransform,
      renderTransformForGroup,
      targetHeightAnimationAnchorX,
      targetHeightAnimationAnchorY,
      baseTransform,
    };
  }

  return { createController };
});
