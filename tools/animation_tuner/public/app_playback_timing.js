(function attachXsxbPlaybackTiming(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBPlaybackTiming = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates frame-duration and group-playback timing operations.
   * @param {{
   *   minFrameDurationMs:number,
   *   getCurrentGroup?:()=>object|null,
   *   getConfig?:()=>object|null,
   *   getSelectedFrame?:()=>number,
   *   getPlaybackStore:(group:object)=>Record<string,object>,
   *   getTuningFrameKey:(index:number,group:object)=>string,
   *   getGroupPlaybackKey:(group:object)=>string,
   *   groupOwnsFrameKey:(group:object,key:string)=>boolean,
   *   getClampInteger:(value:number,min:number,max:number)=>number,
   *   cloneVector:(value:object,fallback?:object)=>{x:number,y:number},
   *   nearlyEqual:(left:number,right:number)=>boolean,
   *   markDirty?:()=>void,
   *   getAdjustmentMode?:()=>string,
   *   elements?:{groupTimeMs?:object,groupTimeField?:object},
   *   canEditFramePlayback?:()=>boolean,
   *   confirm?:(message:string)=>boolean,
   *   translate?:(key:string,variables?:object)=>string,
   *   pushUndo?:(label:string)=>void,
   *   syncFrameInputs?:()=>void,
   *   syncGroupPlaybackInputs?:()=>void,
   *   renderFilmstrip?:()=>void,
   *   updateGroupMeta?:()=>void,
   *   updateWorkbenchHud?:()=>void,
   *   draw?:()=>void,
   * }} dependencies Controller dependencies.
   * @returns {object} Playback timing operations.
   */
  function createController(dependencies) {
    const {
      minFrameDurationMs,
      getCurrentGroup = () => null,
      getConfig = () => null,
      getSelectedFrame = () => 0,
      getPlaybackStore,
      getTuningFrameKey,
      getGroupPlaybackKey,
      groupOwnsFrameKey,
      getClampInteger,
      cloneVector,
      nearlyEqual,
      markDirty = () => {},
      getAdjustmentMode = () => "group",
      elements = {},
      canEditFramePlayback = () => false,
      confirm = () => true,
      translate = (key) => key,
      pushUndo = () => {},
      syncFrameInputs = () => {},
      syncGroupPlaybackInputs = () => {},
      renderFilmstrip = () => {},
      updateGroupMeta = () => {},
      updateWorkbenchHud = () => {},
      draw = () => {},
    } = dependencies;

    /**
     * Returns one frame's playback override with safe defaults.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {{duration:number,disabled:boolean}} Effective frame playback.
     */
    function framePlayback(index = getSelectedFrame(), group = getCurrentGroup()) {
      if (!group) return { duration: 1, disabled: false };
      const override = getPlaybackStore(group)[getTuningFrameKey(index, group)] || {};
      return {
        duration: Number(override.duration || 1),
        disabled: override.disabled === true,
      };
    }

    /**
     * Writes one frame's playback override and removes no-op data.
     * @param {number} index Frame index.
     * @param {{duration?:number,disabled?:boolean}} playback Playback values.
     * @param {object|null} [group] Animation group.
     * @returns {void}
     */
    function setFramePlayback(index, playback, group = getCurrentGroup()) {
      if (!group) return;
      const store = getPlaybackStore(group);
      const data = {
        duration: Math.max(0.001, Number(playback.duration || 1)),
        disabled: playback.disabled === true,
      };
      if (data.disabled || data.duration !== 1) store[getTuningFrameKey(index, group)] = data;
      else delete store[getTuningFrameKey(index, group)];
      markDirty();
    }

    /**
     * Returns the raw FPS configured by a group or its override.
     * @param {object|null} [group] Animation group.
     * @returns {number} Positive FPS.
     */
    function rawGroupPlaybackFps(group = getCurrentGroup()) {
      if (!group) return 12;
      const override = groupPlaybackOverride(group);
      return Math.max(0.001, Number(override.fps ?? group.speed ?? 12));
    }

    /**
     * Finds the owner group for an attached VFX group.
     * @param {object|null} [group] Animation group.
     * @returns {object|null} Owner group.
     */
    function attachedPlaybackOwnerGroup(group = getCurrentGroup()) {
      if (!group || group.type !== "vfx" || !group.attachTo) return null;
      return (
        getConfig()?.groups?.find(
          (entry) => entry.tuningTarget === group.tuningTarget && entry.name === group.attachTo,
        ) || null
      );
    }

    /**
     * Returns whether a VFX group follows its owner's frame timing.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether owner timing is active.
     */
    function usesAttachedPlaybackTiming(group = getCurrentGroup()) {
      return Boolean(attachedPlaybackOwnerGroup(group)) && group?.independentPlayback !== true;
    }

    /**
     * Returns the group-level playback override.
     * @param {object|null} [group] Animation group.
     * @returns {object} Playback override.
     */
    function groupPlaybackOverride(group = getCurrentGroup()) {
      if (!group) return {};
      return getPlaybackStore(group)[getGroupPlaybackKey(group)] || {};
    }

    /**
     * Returns the owner-frame window used by attached VFX playback.
     * @param {object|null} [group] Animation group.
     * @returns {{owner:object|null,start:number,end:number}} Owner window.
     */
    function attachedVfxPlaybackWindow(group = getCurrentGroup()) {
      const owner = attachedPlaybackOwnerGroup(group);
      const ownerFrameCount = owner?.frames?.length || 0;
      if (!owner || ownerFrameCount <= 0) return { owner: null, start: 0, end: -1 };
      const override = groupPlaybackOverride(group);
      const defaultEnd = ownerFrameCount - 1;
      const start = getClampInteger(override.start_frame ?? 0, 0, defaultEnd);
      const end = getClampInteger(override.end_frame ?? defaultEnd, start, defaultEnd);
      return { owner, start, end };
    }

    /**
     * Counts enabled frames in a group.
     * @param {object|null} [group] Animation group.
     * @returns {number} Playable frame count.
     */
    function playableFrameCount(group = getCurrentGroup()) {
      if (!group?.frames?.length) return 0;
      return group.frames.reduce(
        (count, _frame, index) => count + (framePlayback(index, group).disabled ? 0 : 1),
        0,
      );
    }

    /**
     * Sums enabled frame duration units in a range.
     * @param {object|null} [group] Animation group.
     * @param {{start?:number,end?:number}|null} [range] Optional frame range.
     * @returns {number} Duration units.
     */
    function groupPlaybackDurationUnits(group = getCurrentGroup(), range = null) {
      if (!group?.frames?.length) return 0;
      const start = getClampInteger(range?.start ?? 0, 0, group.frames.length - 1);
      const end = getClampInteger(range?.end ?? group.frames.length - 1, start, group.frames.length - 1);
      let durationUnits = 0;
      for (let index = start; index <= end; index += 1) {
        const playback = framePlayback(index, group);
        if (!playback.disabled) durationUnits += Math.max(0.001, Number(playback.duration || 1));
      }
      return durationUnits;
    }

    /**
     * Converts group duration units to seconds.
     * @param {object|null} [group] Animation group.
     * @param {{start?:number,end?:number}|null} [range] Optional frame range.
     * @returns {number} Duration seconds.
     */
    function groupPlaybackDurationSeconds(group = getCurrentGroup(), range = null) {
      if (!group?.frames?.length) return 0;
      return groupPlaybackDurationUnits(group, range) / rawGroupPlaybackFps(group);
    }

    /**
     * Returns effective FPS, including attached VFX owner timing.
     * @param {object|null} [group] Animation group.
     * @returns {number} Effective FPS.
     */
    function groupPlaybackFps(group = getCurrentGroup()) {
      if (usesAttachedPlaybackTiming(group)) {
        const owner = attachedPlaybackOwnerGroup(group);
        const window = attachedVfxPlaybackWindow(group);
        const ownerDuration = groupPlaybackDurationSeconds(owner, window);
        const vfxFrames = playableFrameCount(group);
        if (ownerDuration > 0 && vfxFrames > 0) return vfxFrames / ownerDuration;
      }
      return rawGroupPlaybackFps(group);
    }

    /**
     * Returns a frame duration multiplier for the playback loop.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {number} Duration multiplier.
     */
    function effectiveFrameDurationMultiplier(index = getSelectedFrame(), group = getCurrentGroup()) {
      return usesAttachedPlaybackTiming(group) ? 1 : framePlayback(index, group).duration;
    }

    /**
     * Returns one frame duration in milliseconds.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {number} Duration milliseconds.
     */
    function frameDurationMs(index = getSelectedFrame(), group = getCurrentGroup()) {
      if (!group) return 0;
      return (1000 / groupPlaybackFps(group)) * effectiveFrameDurationMultiplier(index, group);
    }

    /**
     * Converts milliseconds to a frame duration multiplier.
     * @param {number} ms Duration milliseconds.
     * @param {object|null} [group] Animation group.
     * @returns {number} Duration multiplier.
     */
    function frameDurationMultiplierFromMs(ms, group = getCurrentGroup()) {
      if (!group) return 1;
      return Math.max(
        0.001,
        (Math.max(minFrameDurationMs, Number(ms) || minFrameDurationMs) / 1000) * groupPlaybackFps(group),
      );
    }

    /**
     * Formats a frame duration for the UI.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {string} Duration label.
     */
    function frameDurationMsLabel(index = getSelectedFrame(), group = getCurrentGroup()) {
      return `${Math.round(frameDurationMs(index, group))}ms`;
    }

    /**
     * Returns total group duration in milliseconds.
     * @param {object|null} [group] Animation group.
     * @returns {number} Group duration milliseconds.
     */
    function groupTimeMs(group = getCurrentGroup()) {
      return Math.max(minFrameDurationMs, Math.round(groupPlaybackDurationSeconds(group) * 1000));
    }

    /**
     * Tests own-property presence for override records.
     * @param {object|null|undefined} object Source object.
     * @param {string} key Property name.
     * @returns {boolean} Whether property exists directly.
     */
    function hasOwn(object, key) {
      return Object.prototype.hasOwnProperty.call(object || {}, key);
    }

    /**
     * Returns whether a group has an FPS override.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether an FPS override exists.
     */
    function groupHasGroupTimeOverride(group = getCurrentGroup()) {
      return hasOwn(groupPlaybackOverride(group), "fps");
    }

    /**
     * Returns whether a group has frame duration overrides.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether frame duration overrides exist.
     */
    function groupHasFrameDurationOverrides(group = getCurrentGroup()) {
      if (!group) return false;
      const store = getPlaybackStore(group);
      const groupKey = getGroupPlaybackKey(group);
      for (const key of Object.keys(store)) {
        if (key === groupKey || !groupOwnsFrameKey(group, key)) continue;
        const entry = store[key] || {};
        if (hasOwn(entry, "duration") && !nearlyEqual(entry.duration, 1)) return true;
      }
      return false;
    }

    /**
     * Removes an FPS override while preserving other group playback fields.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether data changed.
     */
    function clearGroupTimeOverride(group = getCurrentGroup()) {
      if (!group) return false;
      const store = getPlaybackStore(group);
      const key = getGroupPlaybackKey(group);
      const previous = store[key];
      if (!previous || !hasOwn(previous, "fps")) return false;
      const next = { ...previous };
      delete next.fps;
      if (Object.keys(next).length) store[key] = next;
      else delete store[key];
      markDirty();
      return true;
    }

    /**
     * Removes frame duration overrides while preserving disabled flags.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether data changed.
     */
    function clearFrameDurationOverrides(group = getCurrentGroup()) {
      if (!group) return false;
      const store = getPlaybackStore(group);
      const groupKey = getGroupPlaybackKey(group);
      let changed = false;
      for (const key of Object.keys(store)) {
        if (key === groupKey || !groupOwnsFrameKey(group, key)) continue;
        const previous = store[key] || {};
        if (!hasOwn(previous, "duration")) continue;
        const next = { ...previous };
        delete next.duration;
        if (Object.keys(next).length) store[key] = next;
        else delete store[key];
        changed = true;
      }
      if (changed) markDirty();
      return changed;
    }

    /**
     * Synchronizes the group total-time input.
     * @returns {void}
     */
    function syncGroupTimeInputs() {
      if (!elements.groupTimeMs) return;
      const visible = getAdjustmentMode() === "group";
      if (elements.groupTimeField) elements.groupTimeField.hidden = !visible;
      if (!visible) return;
      const currentGroup = getCurrentGroup();
      const editable = Boolean(currentGroup) && canEditFramePlayback() && !usesAttachedPlaybackTiming();
      elements.groupTimeMs.disabled = !editable;
      elements.groupTimeMs.value = editable ? groupTimeMs(currentGroup) : "";
    }

    /**
     * Sets group FPS to preserve a requested total duration.
     * @param {number} ms Target duration milliseconds.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether the value was applied.
     */
    function setGroupTimeMs(ms, group = getCurrentGroup()) {
      if (!group || usesAttachedPlaybackTiming(group)) return false;
      const targetSeconds = Math.max(minFrameDurationMs, Number(ms) || minFrameDurationMs) / 1000;
      const durationUnits = groupPlaybackDurationUnits(group);
      if (durationUnits <= 0 || targetSeconds <= 0) return false;
      setGroupPlaybackData({ fps: durationUnits / targetSeconds }, group);
      return true;
    }

    /**
     * Applies the group total-time input, resolving frame override conflicts.
     * @returns {void}
     */
    function applyGroupTimeFromInput() {
      const currentGroup = getCurrentGroup();
      if (!currentGroup || !elements.groupTimeMs || !canEditFramePlayback() || usesAttachedPlaybackTiming()) {
        syncGroupTimeInputs();
        return;
      }
      const targetMs = Math.max(
        minFrameDurationMs,
        Math.round(Number(elements.groupTimeMs.value || minFrameDurationMs)),
      );
      const hasFrameTiming = groupHasFrameDurationOverrides();
      const currentMs = groupTimeMs(currentGroup);
      if (!hasFrameTiming && Math.round(targetMs) === Math.round(currentMs)) {
        syncGroupTimeInputs();
        return;
      }
      if (hasFrameTiming && !confirm(translate("groupTimeConflict"))) {
        syncGroupTimeInputs();
        return;
      }
      pushUndo("group time");
      if (hasFrameTiming) clearFrameDurationOverrides(currentGroup);
      setGroupTimeMs(targetMs, currentGroup);
      syncFrameInputs();
      renderFilmstrip();
      updateGroupMeta();
      updateWorkbenchHud();
      draw();
    }

    /**
     * Returns root-motion data from a group override.
     * @param {object|null} [group] Animation group.
     * @returns {{x:number,y:number}} Root motion.
     */
    function groupRootMotion(group = getCurrentGroup()) {
      if (!group) return { x: 0, y: 0 };
      const override = groupPlaybackOverride(group);
      return cloneVector(override.root_motion || { x: 0, y: 0 });
    }

    /**
     * Writes group-level FPS, owner window, and root-motion data.
     * @param {{fps?:number,start_frame?:number,end_frame?:number,root_motion?:object}} data Playback data.
     * @param {object|null} [group] Animation group.
     * @returns {void}
     */
    function setGroupPlaybackData(data, group = getCurrentGroup()) {
      if (!group) return;
      const store = getPlaybackStore(group);
      const key = getGroupPlaybackKey(group);
      const previous = store[key] || {};
      const owner = attachedPlaybackOwnerGroup(group);
      if (owner) {
        const defaultEnd = Math.max((owner.frames?.length || 1) - 1, 0);
        const start = getClampInteger(data.start_frame ?? previous.start_frame ?? 0, 0, defaultEnd);
        const end = getClampInteger(data.end_frame ?? previous.end_frame ?? defaultEnd, start, defaultEnd);
        const next = {};
        if (start !== 0) next.start_frame = start;
        if (end !== defaultEnd) next.end_frame = end;
        if (!Object.keys(next).length) {
          delete store[key];
          markDirty();
          return;
        }
        store[key] = next;
        markDirty();
        return;
      }
      const safeFps = Math.max(0.001, Number(data.fps ?? previous.fps ?? group.speed ?? 12));
      const defaultFps = Math.max(0.001, Number(group.speed || 12));
      const rootMotion = cloneVector(data.root_motion ?? previous.root_motion ?? { x: 0, y: 0 });
      const next = {};
      if (!nearlyEqual(safeFps, defaultFps)) next.fps = safeFps;
      if (!nearlyEqual(rootMotion.x, 0) || !nearlyEqual(rootMotion.y, 0)) next.root_motion = rootMotion;
      if (!Object.keys(next).length) {
        delete store[key];
        markDirty();
        return;
      }
      store[key] = next;
      markDirty();
    }

    /**
     * Recalculates FPS to preserve a prior group duration.
     * @param {number} previousDurationSeconds Previous duration.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether duration was preserved.
     */
    function preserveGroupPlaybackDuration(previousDurationSeconds, group = getCurrentGroup()) {
      if (!group || attachedPlaybackOwnerGroup(group) || previousDurationSeconds <= 0) return false;
      const durationUnits = groupPlaybackDurationUnits(group);
      if (durationUnits <= 0) return false;
      setGroupPlaybackData({ fps: durationUnits / previousDurationSeconds }, group);
      syncGroupPlaybackInputs();
      syncGroupTimeInputs();
      updateGroupMeta();
      return true;
    }

    return {
      applyGroupTimeFromInput,
      attachedPlaybackOwnerGroup,
      attachedVfxPlaybackWindow,
      clearFrameDurationOverrides,
      clearGroupTimeOverride,
      effectiveFrameDurationMultiplier,
      frameDurationMs,
      frameDurationMsLabel,
      frameDurationMultiplierFromMs,
      framePlayback,
      getGroupPlaybackOverride: groupPlaybackOverride,
      groupHasFrameDurationOverrides,
      groupHasGroupTimeOverride,
      groupPlaybackDurationSeconds,
      groupPlaybackDurationUnits,
      groupPlaybackFps,
      groupRootMotion,
      groupTimeMs,
      hasOwn,
      playableFrameCount,
      preserveGroupPlaybackDuration,
      rawGroupPlaybackFps,
      setFramePlayback,
      setGroupPlaybackData,
      setGroupTimeMs,
      syncGroupTimeInputs,
      usesAttachedPlaybackTiming,
    };
  }

  return { createController };
});
