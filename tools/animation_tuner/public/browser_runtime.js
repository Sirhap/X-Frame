(function attachBrowserRuntime(root, factory) {
  "use strict";

  const projectStorageModule =
    root?.XSXBBrowserProjectStorage ||
    (typeof module === "object" && module.exports ? require("./browser_project_storage") : null);
  const api = factory(root, projectStorageModule);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBBrowserRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root, projectStorageModule) => {
  "use strict";

  const FRAME_NAME_PADDING = 4;
  const PROJECT_NAME_MAX_LENGTH = 80;
  const sessionProjects = new Map();
  const sessionRegistry = {
    activeProjectId: "browser-session",
    projects: [{ id: "browser-session", label: "浏览器临时工作区", projectRoot: "" }],
  };
  let projectStorage = projectStorageModule?.createStore({ indexedDBRef: root?.indexedDB });
  let hydrationPromise = null;
  let api = null;

  /** @param {unknown} value Cloneable value. @returns {any} Independent copy. */
  function cloneValue(value) {
    if (typeof root.structuredClone === "function") return root.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  /** @param {Iterable<string>} values Feature identifiers. @returns {string[]} Stable unique values. */
  function mergeFeatureIds(values) {
    return [
      ...new Set(
        Array.from(values || [])
          .map(String)
          .filter(Boolean),
      ),
    ];
  }

  /** @param {object} boxes Frame boxes. @returns {object} Horizontally mirrored boxes. */
  function mirrorFrameBoxes(boxes) {
    const result = cloneValue(boxes);
    for (const box of Object.values(result || {})) {
      if (!box || typeof box !== "object") continue;
      if (box.offset && typeof box.offset === "object") box.offset.x = -Number(box.offset.x || 0);
      if (box.rotation !== undefined) box.rotation = -Number(box.rotation || 0);
    }
    return result;
  }

  /** Throws a consistent cancellation error at safe browser export checkpoints. */
  function throwIfExportCancelled(signal) {
    if (!signal?.aborted) return;
    const error = new Error("Export cancelled.");
    error.name = "AbortError";
    throw error;
  }

  /**
   * Remaps one animation's indexed records while preserving unrelated groups.
   * @param {object} source Indexed record.
   * @param {string} prefix Animation key prefix.
   * @param {Array<{sourceIndex?:number,flipped?:boolean}>} items New frame plan.
   * @param {boolean} [mirrorBoxes=false] Whether flipped records contain frame boxes.
   * @returns {object} Remapped record.
   */
  function remapIndexedRecord(source, prefix, items, mirrorBoxes = false) {
    const record = source && typeof source === "object" ? source : {};
    const result = Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !key.startsWith(prefix) || key === `${prefix}__group`)
        .map(([key, value]) => [key, cloneValue(value)]),
    );
    items.forEach((item, nextIndex) => {
      if (!Number.isInteger(item.sourceIndex)) return;
      const sourceKey = `${prefix}${item.sourceIndex}`;
      if (!(sourceKey in record)) return;
      result[`${prefix}${nextIndex}`] =
        mirrorBoxes && item.flipped ? mirrorFrameBoxes(record[sourceKey]) : cloneValue(record[sourceKey]);
    });
    return result;
  }

  /** @param {string} value Key ending in a frame number. @param {number} frame Next frame. @returns {string} */
  function rekeyFrameValue(value, frame) {
    const text = String(value || "");
    return /:\d+$/u.test(text) ? text.replace(/:\d+$/u, `:${frame}`) : text;
  }

  /** @param {object} binding Binding record. @returns {{animation:string,frame:number|null}} Ownership. */
  function bindingIdentity(binding) {
    const metadata = binding?.metadata && typeof binding.metadata === "object" ? binding.metadata : {};
    const keyMatch = /^(.*):(\d+)$/u.exec(String(binding?.key || binding?.frameKey || ""));
    const animation = String(metadata.animation || binding?.animation || keyMatch?.[1] || "");
    const frame = Number(metadata.frame ?? binding?.frame ?? keyMatch?.[2]);
    return { animation, frame: Number.isInteger(frame) ? frame : null };
  }

  /**
   * Remaps frame bindings and preserves their original array/object storage shape.
   * @param {object[]|object} source Binding collection.
   * @param {string} animationKey Runtime animation key.
   * @param {Array<{sourceIndex?:number}>} items New frame plan.
   * @returns {object[]|object} Remapped bindings.
   */
  function remapBindings(source, animationKey, items) {
    const sourceIsArray = Array.isArray(source);
    const entries = sourceIsArray
      ? source.map((binding, index) => [String(index), binding])
      : Object.entries(source && typeof source === "object" ? source : {});
    const untouched = [];
    const indexed = new Map();
    for (const [storageKey, rawBinding] of entries) {
      const binding = rawBinding && typeof rawBinding === "object" ? rawBinding : null;
      if (!binding) continue;
      const identity = bindingIdentity(
        !binding.key && !binding.frameKey ? { ...binding, key: storageKey } : binding,
      );
      if (identity.animation === animationKey && Number.isInteger(identity.frame)) {
        if (!indexed.has(identity.frame)) indexed.set(identity.frame, []);
        indexed.get(identity.frame).push([storageKey, binding]);
      } else {
        untouched.push([storageKey, cloneValue(binding)]);
      }
    }
    const remapped = [];
    items.forEach((item, nextIndex) => {
      if (!Number.isInteger(item.sourceIndex)) return;
      for (const [storageKey, rawBinding] of indexed.get(item.sourceIndex) || []) {
        const binding = cloneValue(rawBinding);
        if (binding.metadata && typeof binding.metadata === "object") {
          binding.metadata.frame = nextIndex;
          binding.metadata.displayFrame = nextIndex;
        }
        if (binding.frame !== undefined) binding.frame = nextIndex;
        if (binding.key) binding.key = rekeyFrameValue(binding.key, nextIndex);
        if (binding.frameKey) binding.frameKey = rekeyFrameValue(binding.frameKey, nextIndex);
        remapped.push([rekeyFrameValue(storageKey, nextIndex), binding]);
      }
    });
    const combined = [...untouched, ...remapped];
    return sourceIsArray ? combined.map(([, binding]) => binding) : Object.fromEntries(combined);
  }

  /**
   * Normalizes a trail stick's phase for deterministic chronological sorting.
   * @param {unknown} value Saved frame phase.
   * @returns {number} Finite phase clamped to the current frame.
   */
  function normalizedTrailFramePhase(value) {
    if (value === null || value === undefined) return 0.5;
    const phase = Number(value);
    return Number.isFinite(phase) ? Math.min(1, Math.max(0, phase)) : 0.5;
  }

  /**
   * Remaps the active animation's trail sticks to a new frame plan.
   * @param {object} source Attack-trail document.
   * @param {string} animationKey Runtime animation key.
   * @param {Array<{sourceIndex?:number}>} items New frame plan.
   * @returns {object} Remapped attack-trail document.
   */
  function remapAttackTrails(source, animationKey, items) {
    const result = cloneValue(
      source && typeof source === "object" ? source : { schemaVersion: 8, bindings: {} },
    );
    if (!result.bindings || typeof result.bindings !== "object") result.bindings = {};
    if (!Array.isArray(result.bindings[animationKey])) return result;
    const frameMap = new Map();
    items.forEach((item, nextIndex) => {
      if (!Number.isInteger(item.sourceIndex)) return;
      if (!frameMap.has(item.sourceIndex)) frameMap.set(item.sourceIndex, []);
      frameMap.get(item.sourceIndex).push(nextIndex);
    });
    result.bindings[animationKey] = result.bindings[animationKey].map((segment) => {
      const sticks = Array.from(segment?.sticks || [])
        .flatMap((stick, sourceIndex) => {
          const savedOrder = Number(stick?.order);
          const stableOrder = Number.isFinite(savedOrder) ? savedOrder : sourceIndex;
          return Array.from(frameMap.get(Number(stick?.frame)) || []).map((frame) => ({
            stick: { ...stick, frame },
            sourceIndex,
            stableOrder,
          }));
        })
        .sort(
          (left, right) =>
            left.stick.frame - right.stick.frame ||
            normalizedTrailFramePhase(left.stick.framePhase) -
              normalizedTrailFramePhase(right.stick.framePhase) ||
            left.stableOrder - right.stableOrder ||
            left.sourceIndex - right.sourceIndex,
        )
        .map(({ stick }, order) => ({ ...stick, order }));
      return { ...segment, sticks };
    });
    return result;
  }

  /**
   * Applies an organizer frame plan to a transient browser animation.
   * @param {object} group Active browser group.
   * @param {Array<{sourceIndex?:number,data?:string,name?:string,flipped?:boolean}>} items Frame plan.
   * @param {{frameVisualOverrides?:object,framePlaybackOverrides?:object,frameBoxOverrides?:object,frameAudioBindings?:object|object[],frameImageAttachments?:object|object[],attackTrails?:object,premiumFeatures?:string[]}} [state] Group-owned state.
   * @returns {{frames:object[],frameVisualOverrides:object,framePlaybackOverrides:object,frameBoxOverrides:object,frameAudioBindings:object|object[],frameImageAttachments:object|object[],attackTrails:object,premiumFeatures:string[]}} Updated state.
   */
  function reorganizeSessionAnimation(group, items, state = {}) {
    if (!group?.runtimeAnimation || !Array.isArray(group.frames))
      throw new Error("Browser animation is required.");
    if (!Array.isArray(items) || !items.length) throw new Error("An animation must keep at least one frame.");
    const frames = items.map((item, index) => {
      const sourceFrame = Number.isInteger(item.sourceIndex) ? group.frames[item.sourceIndex] : null;
      const data = String(item.data || sourceFrame?.path || "");
      if (!data.startsWith("data:image/png")) throw new Error(`Frame ${index + 1} is missing PNG data.`);
      return {
        ...(sourceFrame || {}),
        id: String(
          item.frameId ||
            item.id ||
            sourceFrame?.id ||
            `frame_${String(index + 1).padStart(FRAME_NAME_PADDING, "0")}`,
        ),
        name: String(item.name || sourceFrame?.name || `frame_${index + 1}.png`),
        path: data,
        assetRevision: Math.max(0, Number(item.assetRevision ?? sourceFrame?.assetRevision) || 0),
        duration: Number(sourceFrame?.duration || 1),
      };
    });
    const prefix = `${group.runtimeAnimation}:`;
    const result = {
      frames,
      frameVisualOverrides: remapIndexedRecord(state.frameVisualOverrides, prefix, items),
      framePlaybackOverrides: remapIndexedRecord(state.framePlaybackOverrides, prefix, items),
      frameBoxOverrides: remapIndexedRecord(state.frameBoxOverrides, prefix, items, true),
      frameAudioBindings: remapBindings(state.frameAudioBindings || {}, group.runtimeAnimation, items),
      frameImageAttachments: remapBindings(state.frameImageAttachments || [], group.runtimeAnimation, items),
      attackTrails: remapAttackTrails(state.attackTrails, group.runtimeAnimation, items),
      premiumFeatures: mergeFeatureIds([
        ...Array.from(group.premiumFeatures || []),
        ...Array.from(state.premiumFeatures || []),
      ]),
    };
    group.frames = result.frames;
    group.premiumFeatures = result.premiumFeatures;
    return result;
  }

  /**
   * Deletes selected frames from one transient animation and remaps all frame-owned state.
   * @param {object} group Active browser-session animation.
   * @param {Iterable<number>} indexes Zero-based frame indexes to delete.
   * @param {{frameVisualOverrides?:object,framePlaybackOverrides?:object,frameBoxOverrides?:object,frameAudioBindings?:object|object[],frameImageAttachments?:object|object[],attackTrails?:object,premiumFeatures?:string[]}} [state] Group-owned state.
   * @returns {{frames:object[],frameVisualOverrides:object,framePlaybackOverrides:object,frameBoxOverrides:object,frameAudioBindings:object|object[],frameImageAttachments:object|object[],attackTrails:object,premiumFeatures:string[]}} Updated state.
   */
  function deleteSessionAnimationFrames(group, indexes, state = {}) {
    if (group?.source !== "browser-session" || !Array.isArray(group.frames)) {
      throw new Error("Browser animation is required.");
    }
    const removedIndexes = new Set(
      Array.from(indexes || []).filter(
        (index) => Number.isInteger(index) && index >= 0 && index < group.frames.length,
      ),
    );
    if (!removedIndexes.size) throw new Error("Select at least one frame to delete.");
    if (removedIndexes.size === group.frames.length) {
      throw new Error("Delete the animation when removing all of its frames.");
    }
    const items = group.frames.flatMap((frame, sourceIndex) =>
      removedIndexes.has(sourceIndex) ? [] : [{ sourceIndex, sourcePath: frame.path, name: frame.name }],
    );
    return reorganizeSessionAnimation(group, items, state);
  }

  /**
   * Removes all indexed values owned by one animation while cloning retained entries.
   * @param {object} record Indexed record.
   * @param {string} prefix Animation key prefix.
   * @returns {object} Filtered record.
   */
  function withoutIndexedPrefix(record, prefix) {
    return Object.fromEntries(
      Object.entries(record && typeof record === "object" ? record : {})
        .filter(([key]) => !String(key).startsWith(prefix))
        .map(([key, value]) => [key, cloneValue(value)]),
    );
  }

  /**
   * Removes audio or attachment bindings owned by one animation.
   * @param {object[]|object} bindings Binding collection.
   * @param {string} animationKey Runtime animation key.
   * @returns {object[]|object} Filtered collection with its original storage shape.
   */
  function withoutAnimationBindings(bindings, animationKey) {
    if (Array.isArray(bindings)) {
      return bindings
        .filter((binding) => bindingIdentity(binding).animation !== animationKey)
        .map(cloneValue);
    }
    return Object.fromEntries(
      Object.entries(bindings && typeof bindings === "object" ? bindings : {})
        .filter(([storageKey, binding]) => {
          const candidate =
            binding && typeof binding === "object" && !binding.key && !binding.frameKey
              ? { ...binding, key: storageKey }
              : binding;
          return bindingIdentity(candidate).animation !== animationKey;
        })
        .map(([key, value]) => [key, cloneValue(value)]),
    );
  }

  /**
   * Deletes one transient animation and every in-memory record exclusively owned by it.
   * @param {object} config Browser-session project configuration.
   * @param {object} group Animation group to delete.
   * @param {{values?:object,frameVisualOverrides?:object,framePlaybackOverrides?:object,frameBoxOverrides?:object,frameAudioBindings?:object|object[],frameImageAttachments?:object|object[],attachmentAssets?:object[],attackTrails?:object}} [state] Browser workbench state.
   * @returns {{config:object,nextGroup:object|null,values:object,frameVisualOverrides:object,framePlaybackOverrides:object,frameBoxOverrides:object,frameAudioBindings:object|object[],frameImageAttachments:object|object[],attachmentAssets:object[],attackTrails:object}} Filtered browser-session state.
   */
  function deleteSessionAnimation(config, group, state = {}) {
    if (group?.source !== "browser-session" || !group.runtimeAnimation) {
      throw new Error("Browser animation is required.");
    }
    const groups = Array.isArray(config?.groups) ? config.groups : [];
    const removedIndex = groups.findIndex(
      (candidate) =>
        candidate === group ||
        (group.uiId && candidate?.uiId === group.uiId) ||
        candidate?.runtimeAnimation === group.runtimeAnimation,
    );
    if (removedIndex < 0) throw new Error("Browser animation is not part of the current session.");
    const remainingGroups = groups.filter((_candidate, index) => index !== removedIndex);
    const profileStillUsed = remainingGroups.some(
      (candidate) => String(candidate.profileId || "") === String(group.profileId || ""),
    );
    const profiles = (Array.isArray(config?.profiles) ? config.profiles : []).filter(
      (profile) => profileStillUsed || String(profile?.id || "") !== String(group.profileId || ""),
    );
    const animationValuePrefix = `profiles.${group.profileId}.groups.${group.animationId}.`;
    const profileValuePrefix = `profiles.${group.profileId}.character.`;
    const values = Object.fromEntries(
      Object.entries(state.values && typeof state.values === "object" ? state.values : {})
        .filter(
          ([key]) =>
            !String(key).startsWith(animationValuePrefix) &&
            (profileStillUsed || !String(key).startsWith(profileValuePrefix)),
        )
        .map(([key, value]) => [key, cloneValue(value)]),
    );
    const framePrefix = `${group.runtimeAnimation}:`;
    const attackTrails = cloneValue(
      state.attackTrails && typeof state.attackTrails === "object"
        ? state.attackTrails
        : { schemaVersion: 8, bindings: {} },
    );
    if (!attackTrails.bindings || typeof attackTrails.bindings !== "object") {
      attackTrails.bindings = {};
    }
    delete attackTrails.bindings[group.runtimeAnimation];
    const nextConfig = { ...config, groups: remainingGroups, profiles, attackTrails };
    return {
      config: nextConfig,
      nextGroup: remainingGroups[Math.min(removedIndex, remainingGroups.length - 1)] || null,
      values,
      frameVisualOverrides: withoutIndexedPrefix(state.frameVisualOverrides, framePrefix),
      framePlaybackOverrides: withoutIndexedPrefix(state.framePlaybackOverrides, framePrefix),
      frameBoxOverrides: withoutIndexedPrefix(state.frameBoxOverrides, framePrefix),
      frameAudioBindings: withoutAnimationBindings(state.frameAudioBindings || {}, group.runtimeAnimation),
      frameImageAttachments: withoutAnimationBindings(
        state.frameImageAttachments || [],
        group.runtimeAnimation,
      ),
      attachmentAssets: Array.from(state.attachmentAssets || [])
        .filter((asset) => String(asset?.groupKey || "") !== group.runtimeAnimation)
        .map(cloneValue),
      attackTrails,
    };
  }

  /**
   * Replaces the pixels of a transient browser animation without changing its frame ownership.
   * @param {object} group Active browser group.
   * @param {Array<{data?:string,canvas?:HTMLCanvasElement}>} outputs Processed frames.
   * @param {Iterable<string>} [premiumFeatures] Used Pro features.
   * @returns {object[]} Updated frames.
   */
  function replaceSessionAnimationFrames(group, outputs, premiumFeatures = []) {
    if (!group?.frames?.length || !Array.isArray(outputs) || outputs.length !== group.frames.length) {
      throw new Error("Processed frame count does not match the active animation.");
    }
    group.frames = group.frames.map((frame, index) => {
      const output = outputs[index];
      const data = String(output?.data || output?.canvas?.toDataURL?.("image/png") || "");
      if (!data.startsWith("data:image/png")) throw new Error(`Frame ${index + 1} is missing PNG data.`);
      return {
        ...frame,
        path: data,
        assetRevision: Math.max(0, Number(frame.assetRevision) || 0) + 1,
        width: Number(output?.canvas?.width || frame.width || 0),
        height: Number(output?.canvas?.height || frame.height || 0),
      };
    });
    group.premiumFeatures = mergeFeatureIds([
      ...Array.from(group.premiumFeatures || []),
      ...Array.from(premiumFeatures || []),
    ]);
    return group.frames;
  }

  /**
   * Replaces one transient browser-animation frame without rebuilding its siblings.
   * @param {object} group Active browser group.
   * @param {number} frameIndex Zero-based target frame index.
   * @param {{data?:string,canvas?:HTMLCanvasElement}} output Processed frame.
   * @param {Iterable<string>} [premiumFeatures] Used Pro features.
   * @returns {object} Updated frame.
   */
  function replaceSessionAnimationFrame(group, frameIndex, output, premiumFeatures = []) {
    if (!group?.frames?.length || !Number.isInteger(frameIndex) || !group.frames[frameIndex]) {
      throw new Error("The selected browser animation frame is unavailable.");
    }
    const data = String(output?.data || output?.canvas?.toDataURL?.("image/png") || "");
    if (!data.startsWith("data:image/png")) throw new Error("The processed frame is missing PNG data.");
    const frame = group.frames[frameIndex];
    const updatedFrame = {
      ...frame,
      path: data,
      assetRevision: Math.max(0, Number(frame.assetRevision) || 0) + 1,
      width: Number(output?.canvas?.width || frame.width || 0),
      height: Number(output?.canvas?.height || frame.height || 0),
    };
    group.frames = group.frames.map((candidate, index) => (index === frameIndex ? updatedFrame : candidate));
    group.premiumFeatures = mergeFeatureIds([
      ...Array.from(group.premiumFeatures || []),
      ...Array.from(premiumFeatures || []),
    ]);
    return updatedFrame;
  }

  /** @param {object} record Indexed record. @param {string} prefix Group prefix. @returns {object} */
  function filterIndexedRecord(record, prefix) {
    return Object.fromEntries(
      Object.entries(record && typeof record === "object" ? record : {})
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key, cloneValue(value)]),
    );
  }

  /** @param {object[]|object} bindings Bindings. @param {string} animationKey Group key. @returns {object[]|object} */
  function filterBindings(bindings, animationKey) {
    if (Array.isArray(bindings)) {
      return bindings
        .filter((binding) => bindingIdentity(binding).animation === animationKey)
        .map(cloneValue);
    }
    return Object.fromEntries(
      Object.entries(bindings && typeof bindings === "object" ? bindings : {})
        .filter(([, binding]) => bindingIdentity(binding).animation === animationKey)
        .map(([key, value]) => [key, cloneValue(value)]),
    );
  }

  /**
   * Builds a tuning snapshot containing only the active browser animation group.
   * @param {object} group Active group.
   * @param {object} state Workbench state stores.
   * @returns {object} Group-scoped export state.
   */
  function createSessionExportSnapshot(group, state = {}) {
    if (!group?.runtimeAnimation) throw new Error("Browser animation is required.");
    const valueKeys = [
      group.characterScale,
      group.characterScaleVector,
      group.characterOffset,
      group.characterRotation,
      group.scale,
      group.scaleVector,
      group.offset,
      group.rotation,
      group.anchor,
    ].filter(Boolean);
    const values = Object.fromEntries(
      valueKeys
        .filter((key) => state.values?.[key] !== undefined)
        .map((key) => [key, cloneValue(state.values[key])]),
    );
    const prefix = `${group.runtimeAnimation}:`;
    return {
      values,
      sceneSettings: {},
      frameAudioBindings: filterBindings(state.frameAudioBindings || {}, group.runtimeAnimation),
      frameImageAttachments: filterBindings(state.frameImageAttachments || [], group.runtimeAnimation),
      frameVisualOverrides: filterIndexedRecord(state.frameVisualOverrides, prefix),
      framePlaybackOverrides: filterIndexedRecord(state.framePlaybackOverrides, prefix),
      frameBoxOverrides: filterIndexedRecord(state.frameBoxOverrides, prefix),
    };
  }

  /**
   * Overlays live workbench stores onto a project config for IndexedDB persist.
   * config.tuning is the load-time copy; typed offset/scale live in `values`.
   * @param {object} config Project config captured at load.
   * @param {{
   *   values?:object,
   *   referenceFrame?:unknown,
   *   frameVisualOverrides?:object,
   *   framePlaybackOverrides?:object,
   *   frameBoxOverrides?:object,
   *   vfxFrameOverrides?:object,
   *   vfxPlaybackOverrides?:object,
   *   sceneSettings?:object,
   *   frameAudioBindings?:object,
   *   frameImageAttachments?:object,
   *   attachmentAssets?:object,
   *   attackTrails?:object,
   * }} [state] Live workbench stores.
   * @returns {object} Config that persist must write.
   */
  function mergeLiveTuningIntoConfig(config, state = {}) {
    const next = cloneValue(config) || {};
    const liveValues = state.values && typeof state.values === "object" ? cloneValue(state.values) : {};
    next.tuning = {
      ...(next.tuning || {}),
      ...liveValues,
    };
    if (state.referenceFrame !== undefined) next.tuning.reference_frame = cloneValue(state.referenceFrame);
    if (state.frameVisualOverrides !== undefined) {
      next.tuning.frame_visual_overrides = cloneValue(state.frameVisualOverrides);
    }
    if (state.framePlaybackOverrides !== undefined) {
      next.tuning.frame_playback_overrides = cloneValue(state.framePlaybackOverrides);
    }
    if (state.frameBoxOverrides !== undefined) {
      next.tuning.frame_box_overrides = cloneValue(state.frameBoxOverrides);
    }
    if (state.vfxFrameOverrides !== undefined) {
      next.tuning.attack_vfx_frame_overrides = cloneValue(state.vfxFrameOverrides);
    }
    if (state.vfxPlaybackOverrides !== undefined) {
      next.tuning.attack_vfx_playback_overrides = cloneValue(state.vfxPlaybackOverrides);
    }
    if (state.sceneSettings !== undefined) next.tuning.scene_settings = cloneValue(state.sceneSettings);
    if (state.frameAudioBindings !== undefined)
      next.frameAudioBindings = cloneValue(state.frameAudioBindings);
    if (state.frameImageAttachments !== undefined) {
      next.frameImageAttachments = cloneValue(state.frameImageAttachments);
    }
    if (state.attachmentAssets !== undefined) next.attachmentAssets = cloneValue(state.attachmentAssets);
    if (state.attackTrails !== undefined) next.attackTrails = cloneValue(state.attackTrails);
    return next;
  }

  /**
   * Detects the static browser-only production runtime.
   * @returns {boolean} Whether server-backed project operations must be disabled.
   */
  function isEnabled() {
    return (
      root.__XSXB_PRODUCTION__ === true || root.document?.documentElement?.dataset.runtimeMode === "browser"
    );
  }

  /**
   * Adds current animation-group counts to browser project summaries.
   * @param {Array<object>} projects Project registry entries.
   * @param {Map<string,object>} configs Project configs keyed by project ID.
   * @returns {Array<object>} Cloned project summaries with derived counts.
   */
  function projectSummaries(projects = sessionRegistry.projects, configs = sessionProjects) {
    return Array.from(projects || [], (project) => {
      const config = configs?.get?.(String(project?.id || ""));
      const storedCount = Number(project?.animationGroupCount);
      const animationGroupCount = Array.isArray(config?.groups)
        ? config.groups.length
        : Number.isFinite(storedCount) && storedCount >= 0
          ? Math.floor(storedCount)
          : 0;
      return { ...cloneValue(project), animationGroupCount };
    });
  }

  /**
   * Creates a transient project shell for UI components that expect project metadata.
   * @returns {object} Empty browser-session configuration.
   */
  function createEmptyConfig(project = sessionRegistry.projects[0]) {
    const activeProject = cloneValue(project);
    return {
      activeProjectId: activeProject.id,
      activeProject,
      projects: projectSummaries([activeProject]),
      profiles: [{ id: "browser-character", label: "新角色", kind: "actor" }],
      groups: [],
      scenes: [],
      tuning: {},
      dataRevision: "browser-session",
    };
  }

  /** Ensures the initial browser project has an authoritative in-memory config. */
  function ensureSessionProjects() {
    if (!sessionProjects.has("browser-session")) {
      sessionProjects.set("browser-session", createEmptyConfig(sessionRegistry.projects[0]));
    }
  }

  /** Restores browser projects before the first configuration query. */
  async function hydrateSessionProjects() {
    if (hydrationPromise) return hydrationPromise;
    hydrationPromise = (async () => {
      try {
        const snapshot = await projectStorage?.load();
        if (snapshot) {
          sessionRegistry.activeProjectId = String(snapshot.registry.activeProjectId || "browser-session");
          sessionRegistry.projects = cloneValue(snapshot.registry.projects);
          sessionProjects.clear();
          for (const [projectId, config] of snapshot.projects) {
            if (projectId && config) sessionProjects.set(String(projectId), cloneValue(config));
          }
        }
      } catch (error) {
        root?.console?.warn?.("Browser projects could not be restored; using the in-memory session.", error);
      }
      ensureSessionProjects();
    })();
    return hydrationPromise;
  }

  /** Writes the registry when a snapshot store is bound; returns false when none exists. */
  async function persistSessionProjectsIfAvailable() {
    if (!projectStorage) return false;
    return Boolean(await projectStorage.save(sessionRegistry, sessionProjects));
  }

  /** Persists the complete browser project registry atomically. */
  async function persistSessionProjects() {
    const saved = await persistSessionProjectsIfAvailable();
    if (!saved) {
      throw new Error("浏览器项目存储不可用，无法保证刷新后保留项目。请允许本站使用 IndexedDB。");
    }
  }

  /**
   * Creates or returns one browser-session project and persists the shell.
   * First save / first fetch of an unregistered id must not 404.
   * @param {string} projectId Stable project identifier from the URL or create flow.
   * @param {string} [label] Display label; defaults to the identifier.
   * @returns {Promise<object>} Cloned project config.
   */
  async function ensureSessionProject(projectId, label) {
    await hydrateSessionProjects();
    ensureSessionProjects();
    const id = String(projectId || "").trim();
    if (!id) throw new Error("Project name is required.");
    const existing = sessionRegistry.projects.find((entry) => entry.id === id);
    if (existing && sessionProjects.has(id)) return getSessionProjectConfig(id);
    const project = existing || {
      id,
      label: String(label || id).trim() || id,
      projectRoot: "",
    };
    if (!existing) sessionRegistry.projects.push(project);
    if (!sessionProjects.has(id)) sessionProjects.set(id, createEmptyConfig(project));
    sessionRegistry.activeProjectId = id;
    await persistSessionProjectsIfAvailable();
    return getSessionProjectConfig(id);
  }

  /** Returns a cloned browser-session project config by stable identifier. */
  function getSessionProjectConfig(projectId) {
    ensureSessionProjects();
    const config = sessionProjects.get(String(projectId || sessionRegistry.activeProjectId));
    if (!config) return null;
    return {
      ...cloneValue(config),
      activeProjectId: config.activeProject?.id || projectId,
      projects: projectSummaries(),
    };
  }

  /** Atomically replaces one browser-session project config. */
  async function commitSessionProjectConfig(projectId, nextConfig) {
    const id = String(projectId || "").trim();
    if (!id) throw new Error("Project not found: ");
    await ensureSessionProject(id);
    const project = sessionRegistry.projects.find((entry) => entry.id === id);
    if (!project) throw new Error(`Project not found: ${id}`);
    const previous = sessionProjects.has(id) ? cloneValue(sessionProjects.get(id)) : null;
    const committed = {
      ...cloneValue(nextConfig),
      activeProjectId: id,
      activeProject: cloneValue(project),
      projects: [],
    };
    sessionProjects.set(id, committed);
    committed.projects = projectSummaries();
    try {
      await persistSessionProjects();
      return getSessionProjectConfig(id);
    } catch (error) {
      if (previous) sessionProjects.set(id, previous);
      else sessionProjects.delete(id);
      throw error;
    }
  }

  /** Creates an empty browser-session project and persists the shell before navigation. */
  async function createSessionProject(label) {
    await hydrateSessionProjects();
    ensureSessionProjects();
    const normalizedLabel = String(label || "")
      .trim()
      .slice(0, PROJECT_NAME_MAX_LENGTH);
    if (!normalizedLabel) throw new Error("Project name is required.");
    const baseId = safeFilename(normalizedLabel).toLowerCase() || "project";
    const usedIds = new Set(sessionRegistry.projects.map((project) => project.id));
    let projectId = baseId;
    let suffix = 2;
    while (usedIds.has(projectId)) {
      projectId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const project = { id: projectId, label: normalizedLabel, projectRoot: "" };
    sessionRegistry.projects.push(project);
    const config = createEmptyConfig(project);
    sessionProjects.set(projectId, config);
    sessionRegistry.activeProjectId = projectId;
    await persistSessionProjectsIfAvailable();
    return { projectId, config: getSessionProjectConfig(projectId) };
  }

  /** Deletes an uncommitted browser-session project shell and persists the removal. */
  async function discardSessionProject(projectId) {
    const id = String(projectId || "");
    if (!id || id === "browser-session") return false;
    const index = sessionRegistry.projects.findIndex((project) => project.id === id);
    if (index < 0) return false;
    sessionRegistry.projects.splice(index, 1);
    sessionProjects.delete(id);
    if (sessionRegistry.activeProjectId === id) {
      sessionRegistry.activeProjectId = "browser-session";
    }
    await persistSessionProjectsIfAvailable();
    return true;
  }

  /**
   * Empties one browser project's animations while keeping the project shell.
   * @param {string} projectId Target project id.
   * @returns {Promise<boolean>} Whether the project was cleared.
   */
  async function clearSessionProject(projectId) {
    const id = String(projectId || "");
    await hydrateSessionProjects();
    ensureSessionProjects();
    const project = sessionRegistry.projects.find((entry) => entry.id === id);
    if (!id || !project) return false;
    sessionProjects.set(id, createEmptyConfig(project));
    await persistSessionProjectsIfAvailable();
    return true;
  }

  /**
   * Handles browser-session project mutations that the local server would serve.
   * @param {string} input Request URL.
   * @param {{method?:string,body?:string}} [options] Fetch options.
   * @returns {Promise<{ok:boolean,status:number,json:()=>Promise<object>,text:()=>Promise<string>}>}
   */
  async function fetchProjectMutation(input, options = {}) {
    const parsed = new URL(String(input || ""), "https://xsxb.local");
    const method = String(options.method || "GET").toUpperCase();
    let payload = {};
    if (options.body) {
      try {
        payload = JSON.parse(String(options.body));
      } catch {
        payload = {};
      }
    }
    const jsonResponse = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    if (method === "POST" && parsed.pathname === "/api/projects/clear") {
      const cleared = await clearSessionProject(payload.projectId);
      if (!cleared) return jsonResponse(404, { error: `Project not found: ${payload.projectId}` });
      return jsonResponse(200, {
        ok: true,
        projectId: payload.projectId,
        dataRevision: "browser-session",
      });
    }
    if (method === "POST" && parsed.pathname === "/api/projects/delete") {
      if (String(payload.projectId || "") === "browser-session") {
        return jsonResponse(409, {
          error: "The browser temporary workspace cannot be deleted.",
          code: "protected_system_project",
        });
      }
      const deleted = await discardSessionProject(payload.projectId);
      if (!deleted) return jsonResponse(404, { error: `Project not found: ${payload.projectId}` });
      return jsonResponse(200, {
        ok: true,
        projectId: payload.projectId,
        activeProjectId: sessionRegistry.activeProjectId,
        dataRevision: "browser-session",
      });
    }
    if (method === "POST" && parsed.pathname === "/api/projects/active") {
      if (!payload.projectId) return jsonResponse(400, { error: "Project name is required." });
      await ensureSessionProject(payload.projectId);
      return jsonResponse(200, {
        ok: true,
        activeProjectId: sessionRegistry.activeProjectId,
        projects: projectSummaries(),
      });
    }
    return fetchConfig(input);
  }

  /**
   * Returns a response-like transient configuration without making a network request.
   * @returns {Promise<{ok:boolean,status:number,json:()=>Promise<object>,text:()=>Promise<string>}>} Config response.
   */
  async function fetchConfig(input = "/api/config") {
    await hydrateSessionProjects();
    ensureSessionProjects();
    const parsed = new URL(String(input || "/api/config"), "https://xsxb.local");
    const requestedProjectId = parsed.searchParams.get("project") || sessionRegistry.activeProjectId;
    let payload = getSessionProjectConfig(requestedProjectId);
    if (!payload && requestedProjectId) {
      payload = await ensureSessionProject(requestedProjectId);
    }
    if (!payload) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: `Project not found: ${requestedProjectId}` }),
        text: async () => `Project not found: ${requestedProjectId}`,
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  }

  /**
   * Converts user-entered labels into a safe portable filename component.
   * @param {unknown} value Candidate filename component.
   * @returns {string} Sanitized filename component.
   */
  function safeFilename(value) {
    const normalized = String(value || "animation")
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80);
    return normalized || "animation";
  }

  /**
   * Builds an in-memory animation group compatible with the tuning workbench.
   * @param {object} metadata Animation metadata collected by the organizer.
   * @param {Array<object>} items Processed PNG frame records.
   * @param {Array<object>} existingGroups Existing browser-session groups.
   * @param {string} [language="zh"] Active interface language.
   * @returns {object} Transient animation group.
   */
  function createSessionAnimationGroup(metadata, items, existingGroups, language = "zh") {
    if (!Array.isArray(items) || !items.length) {
      throw new Error(language === "zh" ? "至少需要一帧动画。" : "At least one animation frame is required.");
    }
    if (items.some((item) => !String(item?.data || "").startsWith("data:image/png"))) {
      throw new Error(
        language === "zh" ? "动画帧缺少有效的 PNG 数据。" : "An animation frame is missing PNG data.",
      );
    }
    const groups = Array.isArray(existingGroups) ? existingGroups : [];
    const profileId = String(metadata?.profileId || "browser-character");
    const baseId =
      safeFilename(metadata?.animationId || metadata?.animationName).toLowerCase() || "animation";
    const usedAnimationIds = new Set(
      groups
        .filter((group) => String(group.profileId || "") === profileId)
        .map((group) => String(group.animationId || "")),
    );
    let animationId = baseId;
    let suffix = 2;
    while (usedAnimationIds.has(animationId)) {
      animationId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const profileLabel = String(metadata?.profileLabel || (language === "zh" ? "新角色" : "New Character"));
    const keyBase = `profiles.${profileId}.groups.${animationId}`;
    const characterKeyBase = `profiles.${profileId}.character`;
    return {
      uiId: `browser-session:${metadata?.animationType || "actor"}:${animationId}:${groups.length}`,
      name: String(metadata?.animationName || animationId),
      animationId,
      runtimeAnimation: `${profileId}/${animationId}`,
      profileId,
      profileLabel,
      profileKind: String(metadata?.profileKind || "actor"),
      profileScaleSemantic: "character_group_frame",
      profileAnchorMode: String(metadata?.anchorMode || "canvas_bottom_center"),
      profileSupports: [],
      type: String(metadata?.animationType || "actor"),
      tuningTarget: "",
      anchorMode: String(metadata?.anchorMode || "canvas_bottom_center"),
      sourceAnchor: null,
      scaleSemantic: "",
      source: "browser-session",
      premiumFeatures: Array.from(metadata?.premiumFeatures || []),
      speed: Math.max(1, Math.min(120, Number(metadata?.fps || 12))),
      frames: items.map((item, index) => ({
        id: String(item.frameId || item.id || `frame_${String(index + 1).padStart(FRAME_NAME_PADDING, "0")}`),
        name: String(item.name || `frame_${index + 1}.png`),
        path: String(item.data),
        assetRevision: Math.max(0, Number(item.assetRevision) || 0),
        duration: 1,
        width: 0,
        height: 0,
      })),
      characterScale: `${characterKeyBase}.visual_size`,
      characterScaleVector: `${characterKeyBase}.visual_scale`,
      characterOffset: `${characterKeyBase}.offset`,
      characterRotation: `${characterKeyBase}.rotation`,
      characterBaseScale: 1,
      characterBaseScaleVector: null,
      characterBaseOffset: { x: 0, y: 0 },
      characterBaseRotation: 0,
      characterBaseSource: "browser-session",
      runtimeScale: 1,
      bodyScale: 1,
      scale: `${keyBase}.visual_size`,
      scaleVector: `${keyBase}.visual_scale`,
      offset: `${keyBase}.offset`,
      rotation: `${keyBase}.rotation`,
      defaultScale: 1,
      defaultScaleVector: null,
      defaultOffset: { x: 0, y: 0 },
      defaultRotation: 0,
      baseScale: 1,
      baseScaleVector: null,
      baseOffset: { x: 0, y: 0 },
      baseRotation: 0,
    };
  }

  /**
   * Starts a same-tab download for one Blob without wrapping it in a ZIP.
   * @param {Blob} blob File bytes.
   * @param {string} filename Suggested download name.
   * @param {Document|undefined} documentApi Host document.
   * @param {typeof URL|undefined} urlApi URL constructor.
   * @returns {void}
   */
  function triggerBrowserDownload(blob, filename, documentApi, urlApi) {
    if (!blob || !documentApi || !urlApi?.createObjectURL) return;
    const objectUrl = urlApi.createObjectURL(blob);
    try {
      const anchor = documentApi.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.hidden = true;
      documentApi.body.append(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      root.setTimeout?.(() => urlApi.revokeObjectURL(objectUrl), 1000);
    }
  }

  /**
   * Builds a browser-downloadable animation package from processed PNG data URLs.
   * @param {object} metadata Animation metadata collected by the organizer.
   * @param {Array<{name?:string,data:string,flipped?:boolean}>} items Processed frame items.
   * @param {{authorization?:{permit?:string}|null,fetchImpl?:typeof fetch,premiumFeatures?:string[],formats?:{frames?:boolean,spritesheet?:boolean},batchZip?:{buildZip:(entries:Array<object>,options?:object)=>Promise<Blob>},mediaExportCore?:object,document?:Document,urlApi?:typeof URL,now?:()=>Date,onProgress?:(current:number,total:number)=>void,signal?:AbortSignal}} [dependencies] Browser adapters.
   * @returns {Promise<{filename:string,frameCount:number,blob:Blob,premiumFeatures:string[]}>} Export result.
   */
  async function exportAnimationPackage(metadata, items, dependencies = {}) {
    if (!metadata || typeof metadata !== "object") throw new TypeError("Animation metadata is required.");
    if (!Array.isArray(items) || !items.length) throw new Error("At least one processed frame is required.");
    throwIfExportCancelled(dependencies.signal);
    const batchZip = dependencies.batchZip || root.BatchZip;
    const premiumFeatureIds = Array.from(dependencies.premiumFeatures || []);
    await verifyPremiumExportAuthorization(
      premiumFeatureIds,
      dependencies.authorization || null,
      dependencies.fetchImpl || root.fetch,
    );

    const formats = {
      frames: dependencies.formats?.frames !== false,
      spritesheet: dependencies.formats?.spritesheet === true,
    };
    const recipe = metadata.exportRecipe || {};
    const imageStem = safeFilename(recipe.imageName || metadata.animationName || "animation");
    const frameEntries = items.map((item, index) => {
      if (typeof item?.data !== "string" || !item.data.startsWith("data:image/png")) {
        throw new Error(`Frame ${index + 1} is missing processed PNG data.`);
      }
      const frameName = `${imageStem}${index + 1}.png`;
      return { name: `frames/${frameName}`, data: item.data };
    });
    const manifest = {
      schemaVersion: 1,
      generator: "XSXB Frame Tuner",
      exportedAt: (dependencies.now?.() || new Date()).toISOString(),
      animation: {
        name: metadata.animationName,
        profile: metadata.profileLabel,
        type: metadata.animationType,
        fps: metadata.fps,
        anchorMode: metadata.anchorMode,
        frames: frameEntries.map((entry, index) => ({
          index,
          ...(formats.frames ? { file: entry.name } : {}),
          sourceName: items[index].name || "",
          flipped: items[index].flipped === true,
        })),
      },
      outputs: {
        pngSequence: formats.frames,
        spriteSheet: formats.spritesheet,
      },
      premiumFeatures: premiumFeatureIds,
      godotImport: { enabled: false, status: "placeholder" },
    };
    const entries = [
      ...(formats.frames ? frameEntries : []),
      { name: "xsxb-animation.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
      {
        name: "README.txt",
        data: [
          "XSXB browser animation package",
          "",
          "Godot automatic import is currently disabled.",
          formats.frames ? "PNG sequence: frames/" : null,
          formats.spritesheet ? "Sprite Sheet and atlas: spritesheets/" : null,
          "",
        ]
          .filter((line) => line !== null)
          .join("\n"),
      },
    ];
    const mediaExportCore = dependencies.mediaExportCore || root.MediaExportCore;
    if (formats.frames) {
      if (typeof mediaExportCore?.createFramesManifest !== "function") {
        throw new Error("PNG frame manifest export is unavailable.");
      }
      entries.push({
        name: "frames.json",
        data: `${JSON.stringify(mediaExportCore.createFramesManifest(metadata, items), null, 2)}\n`,
      });
    }
    if (formats.spritesheet) {
      if (
        typeof mediaExportCore?.planSpriteSheets !== "function" ||
        typeof mediaExportCore?.createAtlasManifest !== "function" ||
        typeof mediaExportCore?.renderSpriteSheetEntries !== "function" ||
        !items.every((item) => item.image && Number(item.width) > 0 && Number(item.height) > 0)
      ) {
        throw new Error("Sprite-sheet export requires decoded frame canvases.");
      }
      const plan = mediaExportCore.planSpriteSheets(
        items,
        typeof mediaExportCore.sheetPlanOptions === "function"
          ? mediaExportCore.sheetPlanOptions(recipe)
          : {
              columns: recipe.sheetColumns,
              gap: recipe.sheetGap,
              maxTextureSize: recipe.maxTextureSize,
              fixedPageSize: recipe.sheetFixedSize,
              powerOfTwo: recipe.sheetPowerOfTwo,
            },
      );
      const atlas = mediaExportCore.createAtlasManifest(metadata, plan);
      entries.push(
        ...(await mediaExportCore.renderSpriteSheetEntries(items, plan, {
          document: dependencies.document || root.document,
          metadata,
          signal: dependencies.signal,
        })),
        ...(recipe.metadataJson !== false
          ? [{ name: "spritesheets/atlas.json", data: `${JSON.stringify(atlas, null, 2)}\n` }]
          : []),
        ...(recipe.metadataGodot && typeof mediaExportCore.createGodotSpriteFrames === "function"
          ? [
              {
                name: "spritesheets/godot_spriteframes.tres",
                data: mediaExportCore.createGodotSpriteFrames(metadata, plan),
              },
            ]
          : []),
        ...(recipe.metadataUnity && typeof mediaExportCore.createUnityTpsheet === "function"
          ? [
              {
                name: "spritesheets/unity.tpsheet.json",
                data: `${JSON.stringify(mediaExportCore.createUnityTpsheet(metadata, plan), null, 2)}\n`,
              },
            ]
          : []),
        ...(recipe.metadataPlist && typeof mediaExportCore.createPlistAtlas === "function"
          ? [{ name: "spritesheets/atlas.plist", data: mediaExportCore.createPlistAtlas(metadata, plan) }]
          : []),
      );
    }
    throwIfExportCancelled(dependencies.signal);
    const documentApi = dependencies.document || root.document;
    const urlApi = dependencies.urlApi || root.URL;
    if (formats.spritesheet && !formats.frames && recipe.metadataJson === false) {
      const sheetEntries = entries.filter(
        (entry) => typeof entry?.name === "string" && /\.png$/i.test(entry.name) && entry.data,
      );
      if (!sheetEntries.length) throw new Error("Sprite-sheet export produced no PNG pages.");
      const downloads = [];
      for (const entry of sheetEntries) {
        const filename = String(entry.name).replace(/^.*\//, "");
        const blob =
          typeof Blob === "function" && entry.data instanceof Blob
            ? entry.data
            : new Blob([entry.data], { type: "image/png" });
        triggerBrowserDownload(blob, filename, documentApi, urlApi);
        downloads.push({ filename, blob });
      }
      return {
        filename: downloads[0].filename,
        frameCount: items.length,
        blob: downloads[0].blob,
        downloads,
        premiumFeatures: premiumFeatureIds,
      };
    }
    if (!batchZip || typeof batchZip.buildZip !== "function") throw new Error("ZIP export is unavailable.");
    const blob = await batchZip.buildZip(entries, {
      onProgress: (current) => {
        throwIfExportCancelled(dependencies.signal);
        dependencies.onProgress?.(current, entries.length);
      },
    });
    throwIfExportCancelled(dependencies.signal);
    const filename = `${safeFilename(metadata.animationName)}-xsxb.zip`;
    triggerBrowserDownload(blob, filename, documentApi, urlApi);
    return { filename, frameCount: items.length, blob, premiumFeatures: premiumFeatureIds };
  }

  /**
   * Verifies a device-bound Pro export permit immediately before ZIP generation.
   * @param {string[]} featureIds Pro features represented by the package.
   * @param {{permit?:string}|null} authorization Short-lived server authorization.
   * @param {typeof fetch} fetchImpl Fetch implementation.
   * @returns {Promise<void>}
   */
  async function verifyPremiumExportAuthorization(featureIds, authorization, fetchImpl) {
    if (!featureIds.length) return;
    if (!authorization?.permit || typeof fetchImpl !== "function") {
      throw new Error("A verified Pro export permit is required.");
    }
    const response = await fetchImpl("/api/export/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: featureIds, permit: authorization.permit }),
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      payload = {};
    }
    if (!response.ok || payload.authorized !== true) {
      throw new Error(payload.error || "Pro export authorization failed.");
    }
  }

  /**
   * Exports one tuned browser-session animation with its workbench settings and attached assets.
   * @param {object} metadata Animation metadata.
   * @param {Array<{name?:string,data:string}>} items Animation frames.
   * @param {{tuning?:object,premiumFeatures?:string[],attachmentAssets?:object[]}} workbench Workbench state.
   * @param {{authorization?:{permit?:string}|null,fetchImpl?:typeof fetch,batchZip?:{buildZip:(entries:Array<object>,options?:object)=>Promise<Blob>},document?:Document,urlApi?:typeof URL,now?:()=>Date,onProgress?:(current:number,total:number)=>void}} [dependencies] Browser adapters.
   * @returns {Promise<{filename:string,frameCount:number,blob:Blob,premiumFeatures:string[]}>} Export result.
   */
  async function exportWorkbenchPackage(metadata, items, workbench = {}, dependencies = {}) {
    if (!metadata || typeof metadata !== "object") throw new TypeError("Animation metadata is required.");
    if (!Array.isArray(items) || !items.length) throw new Error("At least one animation frame is required.");
    const batchZip = dependencies.batchZip || root.BatchZip;
    if (!batchZip || typeof batchZip.buildZip !== "function") throw new Error("ZIP export is unavailable.");
    const frameEntries = items.map((item, index) => {
      if (typeof item?.data !== "string" || !item.data.startsWith("data:image/png")) {
        throw new Error(`Frame ${index + 1} is missing PNG data.`);
      }
      return {
        name: `frames/frame_${String(index + 1).padStart(FRAME_NAME_PADDING, "0")}.png`,
        data: item.data,
      };
    });
    const assetEntries = Array.from(workbench.attachmentAssets || []).flatMap((asset, index) => {
      const data = String(asset?.data || asset?.path || "");
      if (!data.startsWith("data:image/")) return [];
      const extension = data.startsWith("data:image/jpeg")
        ? "jpg"
        : data.startsWith("data:image/webp")
          ? "webp"
          : "png";
      return [{ name: `attachments/asset_${String(index + 1).padStart(4, "0")}.${extension}`, data }];
    });
    const premiumFeatureIds = Array.from(workbench.premiumFeatures || []);
    await verifyPremiumExportAuthorization(
      premiumFeatureIds,
      dependencies.authorization || null,
      dependencies.fetchImpl || root.fetch,
    );
    const manifest = {
      schemaVersion: 2,
      generator: "XSXB Frame Tuner",
      exportedAt: (dependencies.now?.() || new Date()).toISOString(),
      animation: {
        id: metadata.animationId || "animation",
        name: metadata.animationName || metadata.name || "animation",
        profile: metadata.profileLabel || "character",
        type: metadata.animationType || metadata.type || "actor",
        fps: Math.max(1, Number(metadata.fps || 12)),
        anchorMode: metadata.anchorMode || "canvas_bottom_center",
        frames: frameEntries.map((entry, index) => ({
          index,
          file: entry.name,
          sourceName: items[index]?.name || "",
        })),
      },
      workbench: {
        tuning: workbench.tuning || {},
        premiumFeatures: premiumFeatureIds,
        attachments: assetEntries.map((entry) => entry.name),
      },
      godotImport: { enabled: false, status: "portable-browser-package" },
    };
    const entries = [
      ...frameEntries,
      ...assetEntries,
      { name: "xsxb-animation.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
      {
        name: "README.txt",
        data: "XSXB tuned animation package\n\nFrames, tuning metadata, and session attachment assets are included.\n",
      },
    ];
    const blob = await batchZip.buildZip(entries, {
      onProgress: (current) => dependencies.onProgress?.(current, entries.length),
    });
    const filename = `${safeFilename(metadata.animationName || metadata.name)}-tuned-xsxb.zip`;
    const documentApi = dependencies.document || root.document;
    const urlApi = dependencies.urlApi || root.URL;
    if (documentApi && urlApi?.createObjectURL) {
      const objectUrl = urlApi.createObjectURL(blob);
      try {
        const anchor = documentApi.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.hidden = true;
        documentApi.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        root.setTimeout?.(() => urlApi.revokeObjectURL(objectUrl), 1000);
      }
    }
    return { filename, frameCount: items.length, blob, premiumFeatures: premiumFeatureIds };
  }

  /** Restores the empty in-memory session used by isolated runtime tests. */
  function resetSessionState() {
    hydrationPromise = null;
    sessionProjects.clear();
    sessionRegistry.activeProjectId = "browser-session";
    sessionRegistry.projects = [{ id: "browser-session", label: "浏览器临时工作区", projectRoot: "" }];
  }

  /**
   * Rebuilds the singleton against an injected snapshot store so tests can
   * prove create/reload persistence without sharing IndexedDB.
   * @param {{projectStorage?:{load:()=>Promise<object|null>,save:(registry:object,projects:Map<string,object>)=>Promise<boolean>}|null,indexedDBRef?:IDBFactory|null}} [options]
   * @returns {object} The same runtime API bound to the new store.
   */
  function createRuntime(options = {}) {
    resetSessionState();
    if (Object.prototype.hasOwnProperty.call(options, "projectStorage")) {
      projectStorage = options.projectStorage || null;
    } else {
      projectStorage = projectStorageModule?.createStore({
        indexedDBRef: options.indexedDBRef === undefined ? root?.indexedDB : options.indexedDBRef,
      });
    }
    return api;
  }

  api = {
    clearSessionProject,
    commitSessionProjectConfig,
    createRuntime,
    createSessionExportSnapshot,
    mergeLiveTuningIntoConfig,
    createEmptyConfig,
    createSessionAnimationGroup,
    createSessionProject,
    deleteSessionAnimation,
    deleteSessionAnimationFrames,
    discardSessionProject,
    ensureSessionProject,
    exportAnimationPackage,
    exportWorkbenchPackage,
    fetchConfig,
    fetchProjectMutation,
    getSessionProjectConfig,
    isEnabled,
    reorganizeSessionAnimation,
    replaceSessionAnimationFrame,
    replaceSessionAnimationFrames,
    safeFilename,
    projectSummaries,
  };
  return api;
});
