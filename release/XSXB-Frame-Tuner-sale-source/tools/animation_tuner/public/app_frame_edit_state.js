(function attachXsxbAppFrameEditState(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppFrameEditState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the frame-transform, box-override, and frame-audio UI helpers.
   * Mutable editor data remains owned by app.js and is accessed through
   * injected getters/setters so the module does not create a second state
   * singleton.
   *
   * @param {object} dependencies State accessors and geometry collaborators.
   * @returns {object} Frame-edit operations.
   */
  function createController(dependencies = {}) {
    const {
      boxNames = [],
      getConfig = () => null,
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      getImages = () => [],
      getAdjustmentMode = () => "group",
      getFrameAudioBinding = () => null,
      baseTransform = () => ({
        scale: 1,
        scaleX: 1,
        scaleY: 1,
        offset: { x: 0, y: 0 },
        rotation: 0,
      }),
      overrideStore = () => ({}),
      boxOverrideStore = () => ({}),
      frameBox = () => ({ offset: { x: 0, y: 0 }, size: { x: 1, y: 1 }, rotation: 0, enabled: true }),
      tuningFrameKey = (index) => String(index),
      groupOwnsFrameKey = () => false,
      normalizeFrameBox = (_name, box) => box,
      cloneScaleVector = (value, fallback = 1) => {
        if (value && typeof value === "object")
          return { x: Number(value.x ?? fallback), y: Number(value.y ?? fallback) };
        return { x: Number(fallback), y: Number(fallback) };
      },
      cloneVector = (value, fallback = { x: 0, y: 0 }) => ({
        x: Number(value?.x ?? fallback.x ?? 0),
        y: Number(value?.y ?? fallback.y ?? 0),
      }),
      scaleVectorFromTransform = (transform, fallback = 1) => ({
        x: Number(transform?.scaleX ?? transform?.scale ?? fallback),
        y: Number(transform?.scaleY ?? transform?.scale ?? fallback),
      }),
      nearlyEqual = (left, right) => Math.abs(Number(left) - Number(right)) < 0.0001,
      markDirty = () => {},
      usesCanvasLeftBottomAnchor = () => false,
      usesCanvasBottomCenterAnchor = () => false,
      opaqueRectForImage = () => null,
      boxScopeGroups = () => [],
      boxScopeFrameIndexes = () => [],
      boxSpaceTransformForAdjustment = (_mode, transform) => transform,
      transformForAdjustmentMode = () => baseTransform(),
      snapshotBoxEntriesForGroups = () => ({}),
      elements = {},
      translate = (key) => key,
    } = dependencies;

    /** Returns the transform override store for a frame. */
    function frameTransform(index = getSelectedFrame(), group = getCurrentGroup()) {
      const base = baseTransform(group);
      const store = overrideStore(group);
      const override = store[tuningFrameKey(index, group)];
      if (!override) return base;
      const scale = Number(override.visual_size ?? base.scale);
      let scaleVector;
      if (override.visual_scale) {
        scaleVector = cloneScaleVector(override.visual_scale, scale);
      } else if (override.visual_size !== undefined) {
        scaleVector = cloneScaleVector(null, scale);
      } else {
        scaleVector = { x: base.scaleX, y: base.scaleY };
      }
      return {
        scale,
        scaleX: scaleVector.x,
        scaleY: scaleVector.y,
        offset: cloneVector(override.offset ?? base.offset),
        rotation: Number(override.rotation || 0),
      };
    }

    /** Reports whether a frame has a persisted transform override. */
    function hasFrameTransformOverride(index = getSelectedFrame(), group = getCurrentGroup()) {
      return Boolean(group && overrideStore(group)[tuningFrameKey(index, group)]);
    }

    /** Persists one frame transform while preserving non-uniform scale data. */
    function setFrameTransform(index, transform) {
      const store = overrideStore();
      const previous = frameTransform(index, getCurrentGroup());
      const scale = Number(transform.scale ?? previous.scale);
      const scaleVector = scaleVectorFromTransform(
        {
          ...previous,
          ...transform,
          scale,
        },
        scale,
      );
      const data = {
        visual_size: scale,
        offset: cloneVector(transform.offset ?? previous.offset),
        rotation: Number(transform.rotation ?? previous.rotation ?? 0),
      };
      if (!nearlyEqual(scaleVector.x, scale) || !nearlyEqual(scaleVector.y, scale)) {
        data.visual_scale = scaleVector;
      }
      store[tuningFrameKey(index, getCurrentGroup())] = data;
      markDirty();
    }

    /** Returns the stable key used by frame-box overrides. */
    function frameBoxKey(index = getSelectedFrame(), group = getCurrentGroup()) {
      return tuningFrameKey(index, group);
    }

    /** Returns the source image dimensions used by box defaults. */
    function sourceFrameSize(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      const frame = group?.frames?.[index] || group?.frames?.[0] || {};
      const image = groupImages?.[index] || null;
      return {
        width: Math.max(1, Number(image?.width || frame.width || 1)),
        height: Math.max(1, Number(image?.height || frame.height || 1)),
      };
    }

    /** Returns the source anchor used to convert image coordinates to actor coordinates. */
    function sourceAnchorForBox(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      const size = sourceFrameSize(index, group, groupImages);
      if (usesCanvasLeftBottomAnchor(group)) return { x: 0, y: size.height };
      if (usesCanvasBottomCenterAnchor(group)) return { x: size.width * 0.5, y: size.height };
      return { x: size.width * 0.5, y: size.height };
    }

    /** Returns the opaque source rectangle used by box defaults. */
    function sourceRectForBox(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      const size = sourceFrameSize(index, group, groupImages);
      const image = groupImages?.[index] || null;
      if (image) return opaqueRectForImage(image);
      return { x: 0, y: 0, width: size.width, height: size.height };
    }

    /** Returns the source body center relative to the configured image anchor. */
    function sourceBodyCenterForBox(
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      const rect = sourceRectForBox(index, group, groupImages);
      const anchor = sourceAnchorForBox(index, group, groupImages);
      return {
        x: rect.x + rect.width * 0.5 - anchor.x,
        y: rect.y + rect.height * 0.5 - anchor.y,
        rect,
      };
    }

    /** Writes a normalized box override and marks the workbench dirty. */
    function setBoxOverride(boxName, box, index = getSelectedFrame(), group = getCurrentGroup()) {
      const store = boxOverrideStore(group);
      const key = frameBoxKey(index, group);
      const entry = structuredCloneValue(store[key] || {});
      entry[boxName] = normalizeFrameBox(boxName, box);
      store[key] = entry;
      markDirty();
    }

    /** Disables one box on a frame while retaining its geometry. */
    function deleteBoxOnFrame(boxName, index = getSelectedFrame(), group = getCurrentGroup()) {
      const box = frameBox(boxName, index, group);
      setBoxOverride(
        boxName,
        {
          offset: box.offset,
          size: box.size,
          rotation: box.rotation || 0,
          enabled: false,
        },
        index,
        group,
      );
    }

    /** Removes one frame-box override and cleans up an empty frame entry. */
    function clearBoxOverride(boxName, index = getSelectedFrame(), group = getCurrentGroup()) {
      const store = boxOverrideStore(group);
      const key = frameBoxKey(index, group);
      const entry = store[key];
      if (!entry) return;
      delete entry[boxName];
      if (!boxNames.some((name) => entry[name])) delete store[key];
      markDirty();
    }

    /** Captures the box and transform values affected by an adjustment edit. */
    function createBoxEditSnapshot(mode = getAdjustmentMode()) {
      const groups = boxScopeGroups(mode);
      const transforms = {};
      const frameTransforms = {};
      for (const group of groups) {
        transforms[group.uiId] = structuredCloneValue(
          boxSpaceTransformForAdjustment(mode, transformForAdjustmentMode(mode, group), group),
        );
        if (mode === "frame") {
          frameTransforms[group.uiId] = {};
          for (const index of boxScopeFrameIndexes(mode, group)) {
            frameTransforms[group.uiId][String(index)] = structuredCloneValue(
              boxSpaceTransformForAdjustment(mode, frameTransform(index, group), group),
            );
          }
        }
      }
      return {
        mode,
        groupUiIds: groups.map((group) => group.uiId),
        transforms,
        frameTransforms,
        boxes: snapshotBoxEntriesForGroups(groups, mode),
      };
    }

    /** Synchronizes the frame-audio name and drop-zone controls. */
    function syncFrameAudioInputs() {
      const binding = getFrameAudioBinding();
      if (elements.frameAudioName) {
        elements.frameAudioName.textContent = binding
          ? translate("frameSfx", { name: binding.name })
          : translate("noFrameSfx");
        elements.frameAudioName.title = binding?.name || "";
      }
      const enabled = Boolean(getCurrentGroup());
      if (elements.frameAudioDrop) {
        elements.frameAudioDrop.classList.toggle("disabled", !enabled);
        elements.frameAudioDrop.setAttribute("aria-disabled", enabled ? "false" : "true");
      }
      if (elements.clearFrameAudio) elements.clearFrameAudio.disabled = !binding;
    }

    /** Removes frame overrides that exactly equal their group base transform. */
    function pruneNoopFrameOverrides() {
      for (const group of getConfig()?.groups || []) {
        const store = overrideStore(group);
        const base = baseTransform(group);
        for (const key of Object.keys(store)) {
          if (!groupOwnsFrameKey(group, key)) continue;
          const override = store[key];
          const overrideScale = cloneScaleVector(override?.visual_scale, override?.visual_size);
          if (
            nearlyEqual(override?.visual_size, base.scale) &&
            nearlyEqual(overrideScale.x, base.scaleX) &&
            nearlyEqual(overrideScale.y, base.scaleY) &&
            nearlyEqual(override?.offset?.x, base.offset.x) &&
            nearlyEqual(override?.offset?.y, base.offset.y) &&
            nearlyEqual(override?.rotation, base.rotation)
          ) {
            delete store[key];
          }
        }
      }
    }

    function structuredCloneValue(value) {
      if (typeof root?.structuredClone === "function") return root.structuredClone(value);
      return JSON.parse(JSON.stringify(value));
    }

    return {
      frameTransform,
      hasFrameTransformOverride,
      setFrameTransform,
      frameBoxKey,
      sourceFrameSize,
      sourceAnchorForBox,
      sourceRectForBox,
      sourceBodyCenterForBox,
      setBoxOverride,
      deleteBoxOnFrame,
      clearBoxOverride,
      createBoxEditSnapshot,
      syncFrameAudioInputs,
      pruneNoopFrameOverrides,
    };
  }

  return { createController };
});
