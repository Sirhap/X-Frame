(function attachXsxbBoxModel(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBBoxModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates frame-box resolution, permissions, and scope operations.
   * @param {{
   *   boxNames:Array<string>,
   *   getCurrentGroup?:()=>object|null,
   *   getConfig?:()=>object|null,
   *   getSelectedFrame?:()=>number,
   *   getSelectedBox?:()=>string,
   *   setSelectedBox?:(value:string)=>void,
   *   getSelectedBoxes?:()=>Set<string>,
   *   getBoxOnlyMode?:()=>boolean,
   *   setBoxOnlyMode?:(value:boolean)=>void,
   *   getAdjustmentMode?:()=>string,
   *   getImages?:()=>Array<object>,
   *   getBoxOverrideStore:(group:object)=>Record<string,object>,
   *   getFrameBoxKey:(index:number,group:object)=>string,
   *   defaultHitbox:(index:number,group:object,images?:Array<object>)=>object,
   *   defaultCollisionBox:(index:number,group:object,images?:Array<object>)=>object,
   *   defaultHurtbox:(index:number,group:object,images?:Array<object>)=>object,
   *   isCollisionBox:(boxName:string)=>boolean,
   *   normalizeFrameBox:(boxName:string,box:object)=>object,
   *   cloneVector:(value:object,fallback?:object)=>{x:number,y:number},
   *   isAttackAnimationGroup:(group:object)=>boolean,
   *   selectedFrameIndexes:(group:object)=>Array<number>,
   *   normalizeBoxSelectionForGroup?:(group:object)=>boolean,
   *   saveBoxViewPrefs?:()=>void,
   * }} dependencies Controller dependencies.
   * @returns {object} Frame-box operations.
   */
  function createController(dependencies) {
    const {
      boxNames,
      getCurrentGroup = () => null,
      getConfig = () => null,
      getSelectedFrame = () => 0,
      getSelectedBox = () => "",
      setSelectedBox = () => {},
      getSelectedBoxes = () => new Set(),
      getBoxOnlyMode = () => false,
      setBoxOnlyMode = () => {},
      getAdjustmentMode = () => "group",
      getImages = () => [],
      getBoxOverrideStore,
      getFrameBoxKey,
      defaultHitbox,
      defaultCollisionBox,
      defaultHurtbox,
      isCollisionBox,
      normalizeFrameBox,
      cloneVector,
      isAttackAnimationGroup,
      selectedFrameIndexes,
      normalizeBoxSelectionForGroup = () => false,
      saveBoxViewPrefs = () => {},
    } = dependencies;

    /**
     * Returns persisted overrides for one frame.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {object} Box override record.
     */
    function boxOverride(index = getSelectedFrame(), group = getCurrentGroup()) {
      return getBoxOverrideStore(group)[getFrameBoxKey(index, group)] || {};
    }

    /**
     * Resolves a box from its default and persisted values.
     * @param {string} boxName Box name.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images. Defaults to the
     * live workbench image list so restore-auto still sees the displayed body.
     * Passing `[]` keeps the metadata-only stub used to detect a missing image.
     * @returns {object} Normalized frame box.
     */
    function frameBox(
      boxName,
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      const base =
        boxName === "hitbox"
          ? defaultHitbox(index, group, groupImages)
          : isCollisionBox(boxName)
            ? defaultCollisionBox(index, group, groupImages)
            : defaultHurtbox(index, group, groupImages);
      const override = boxOverride(index, group)[boxName] || {};
      return normalizeFrameBox(boxName, {
        offset: cloneVector(override.offset ?? base.offset),
        size: cloneVector(override.size ?? base.size),
        rotation: Number(override.rotation ?? base.rotation ?? 0),
        enabled: override.enabled ?? base.enabled,
      });
    }

    /**
     * Returns whether a group can expose editable boxes.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether box editing is allowed.
     */
    function canEditBoxes(group = getCurrentGroup()) {
      if (group?.tuningTarget === "soul" && group?.type === "actor") return true;
      const type = String(group?.type || "").toLowerCase();
      if (!group || group?.tuningTarget === "boss") return false;
      return ["actor", "character", "player", "enemy", "npc"].includes(type);
    }

    /**
     * Returns whether one box type can be edited for a group.
     * @param {string} boxName Box name.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether the box type is editable.
     */
    function canEditBox(boxName, group = getCurrentGroup()) {
      if (!canEditBoxes(group)) return false;
      if (boxName === "collisionbox") return true;
      if (boxName === "hurtbox") return true;
      if (boxName === "hitbox") return isAttackAnimationGroup(group);
      return false;
    }

    /**
     * Chooses the first editable box for a group.
     * @param {object|null} [group] Animation group.
     * @returns {string} Default box name.
     */
    function defaultSelectedBoxForGroup(group = getCurrentGroup()) {
      if (!canEditBoxes(group)) return "";
      if (canEditBox("hitbox", group)) return "hitbox";
      if (canEditBox("hurtbox", group)) return "hurtbox";
      if (canEditBox("collisionbox", group)) return "collisionbox";
      return "";
    }

    /**
     * Synchronizes box selection state with the active group.
     * @param {object|null} [group] Animation group.
     * @returns {void}
     */
    function syncBoxSelectionForGroup(group = getCurrentGroup()) {
      if (!canEditBoxes(group)) {
        if (getBoxOnlyMode()) setBoxOnlyMode(false);
        getSelectedBoxes().clear();
        setSelectedBox("");
        saveBoxViewPrefs();
        return;
      }
      normalizeBoxSelectionForGroup(group);
      saveBoxViewPrefs();
    }

    /**
     * Returns whether a box should be shown on a frame.
     * @param {string} boxName Box name.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether the box exists visually.
     */
    function boxExistsOnFrame(boxName, index = getSelectedFrame(), group = getCurrentGroup()) {
      if (!canEditBox(boxName, group)) return false;
      const override = boxOverride(index, group)[boxName];
      const box = frameBox(boxName, index, group);
      if (boxName === "hurtbox") {
        return (
          box.enabled !== false ||
          Boolean(override) ||
          getSelectedBoxes().has("hurtbox") ||
          shouldPreviewPairedBox(boxName, group)
        );
      }
      if (boxName === "collisionbox") {
        return box.enabled !== false || Boolean(override) || getSelectedBoxes().has("collisionbox");
      }
      return (
        box.enabled === true ||
        Boolean(override) ||
        getSelectedBoxes().has("hitbox") ||
        shouldPreviewPairedBox(boxName, group)
      );
    }

    /**
     * Returns whether a paired Soul combat box should be previewed.
     * @param {string} boxName Box name.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether the paired box is previewed.
     */
    function shouldPreviewPairedBox(boxName, group = getCurrentGroup()) {
      if (group?.tuningTarget !== "soul") return false;
      if (boxName === "hurtbox") return getSelectedBox() === "hitbox";
      if (boxName === "hitbox") return getSelectedBox() === "hurtbox" && canEditBox("hitbox", group);
      return false;
    }

    /**
     * Returns the combat-box facing multiplier.
     * @param {object|null} [group] Animation group.
     * @returns {number} Facing multiplier.
     */
    function combatBoxFacingForGroup(group = getCurrentGroup()) {
      return group?.flipH === true ? -1 : 1;
    }

    /**
     * Returns groups affected by a box adjustment mode.
     * @param {string} [mode] Adjustment mode.
     * @returns {Array<object>} Affected groups.
     */
    function boxScopeGroups(mode = getAdjustmentMode()) {
      const currentGroup = getCurrentGroup();
      if (!currentGroup) return [];
      if (mode === "character") {
        return (getConfig()?.groups || []).filter((group) => {
          if (!canEditBoxes(group)) return false;
          if (currentGroup.profileId || group.profileId) return group.profileId === currentGroup.profileId;
          if (currentGroup.characterScale || group.characterScale)
            return group.characterScale === currentGroup.characterScale;
          return (
            group.tuningTarget === currentGroup.tuningTarget &&
            group.profileLabel === currentGroup.profileLabel
          );
        });
      }
      return canEditBoxes(currentGroup) ? [currentGroup] : [];
    }

    /**
     * Returns frame indexes affected by a box adjustment mode.
     * @param {string} mode Adjustment mode.
     * @param {object|null} group Animation group.
     * @returns {Array<number>} Affected frame indexes.
     */
    function boxScopeFrameIndexes(mode, group) {
      const currentGroup = getCurrentGroup();
      if (!group?.frames?.length) return [];
      if (mode === "frame") {
        if (group?.uiId !== currentGroup?.uiId) return [];
        return selectedFrameIndexes(group);
      }
      return Array.from({ length: group.frames.length }, (_value, index) => index);
    }

    /**
     * Captures editable box entries for a set of groups.
     * @param {Array<object>} groups Groups to snapshot.
     * @param {string} [mode] Adjustment mode.
     * @returns {object} Box snapshot keyed by group ID.
     */
    function snapshotBoxEntriesForGroups(groups, mode = getAdjustmentMode()) {
      const snapshot = {};
      for (const group of groups) {
        const groupSnapshot = {};
        for (const index of boxScopeFrameIndexes(mode, group)) {
          const boxes = {};
          for (const boxName of boxNames) {
            if (canEditBox(boxName, group) && boxExistsOnFrame(boxName, index, group)) {
              boxes[boxName] = structuredClone(frameBox(boxName, index, group));
            }
          }
          if (Object.keys(boxes).length) {
            groupSnapshot[getFrameBoxKey(index, group)] = { index, boxes };
          }
        }
        snapshot[group.uiId] = groupSnapshot;
      }
      return snapshot;
    }

    return {
      boxExistsOnFrame,
      boxOverride,
      boxScopeFrameIndexes,
      boxScopeGroups,
      canEditBox,
      canEditBoxes,
      combatBoxFacingForGroup,
      defaultSelectedBoxForGroup,
      frameBox,
      shouldPreviewPairedBox,
      snapshotBoxEntriesForGroups,
      syncBoxSelectionForGroup,
    };
  }

  return { createController };
});
