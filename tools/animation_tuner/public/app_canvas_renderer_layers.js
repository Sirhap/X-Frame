(function attachXsxbCanvasRendererLayers(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppCanvasRendererLayers = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Creates the canvas layer renderer used by the animation workbench.
   *
   * The controller owns only frame/layer drawing. Geometry, state, and image
   * lookup stay injected so the parent canvas renderer keeps its existing API.
   *
   * @param {object} options - Canvas state accessors and drawing callbacks.
   * @returns {object} Frame and layer rendering operations.
   */
  function createController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const state = () => getState() || {};
    const ctx = options.context;
    const getDevicePixelRatio =
      typeof options.getDevicePixelRatio === "function" ? options.getDevicePixelRatio : () => 1;
    const {
      attachedLayerGroups = () => [],
      cloneVector = (value) => ({ x: Number(value?.x || 0), y: Number(value?.y || 0) }),
      compositeLayerFlipH = () => false,
      compositeLayerTransform = (layerGroup, layerIndex, ownerGroup, ownerIndex) =>
        options.frameTransform?.(layerIndex, layerGroup) || options.frameTransform?.(ownerIndex, ownerGroup),
      compositeOwnerFrameIndex = (index) => index,
      drawableFrameAttachments = () => [],
      effectiveFlipH = (group, drawOptions = {}) => Boolean(drawOptions.flipH ?? group?.flipH === true),
      frameImageAttachmentScreenRect = () => null,
      framePlayback = () => ({ disabled: false }),
      frameScreenRect = () => null,
      frameTransform = () => ({ scaleX: 1, scaleY: 1, rotation: 0, offset: { x: 0, y: 0 } }),
      nextPlayableFrameInGroup = (_group, index) => ({ index }),
      rawGroupPlaybackFps = () => 12,
      renderTransformForGroup = (transform) => transform,
      runtimeBaseScaleForGroup = () => 1,
      valueStore = () => ({}),
      drawAttackTrailLayer = () => {},
      attackTrailNeedsContinuousDraw = () => false,
    } = options;

    if (!ctx) throw new TypeError("Canvas layer renderer requires a drawing context.");

    /**
     * Draws one frame image using the supplied transform and alpha.
     * @param {number} index Frame index.
     * @param {number} alpha Opacity.
     * @param {boolean} selected Whether to draw the selection marker.
     * @param {object} [group] Frame group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @param {object} [drawOptions] Transform and facing overrides.
     * @returns {void}
     */
    function drawFrame(
      index,
      alpha,
      selected,
      group = state().currentGroup,
      groupImages = state().images,
      drawOptions = {},
    ) {
      const img = groupImages[index];
      if (!img) return;
      const transform = renderTransformForGroup(drawOptions.transform || frameTransform(index, group), group);
      const runtimeBaseScale = runtimeBaseScaleForGroup(index, group, groupImages);
      const spriteScaleX = runtimeBaseScale * transform.scaleX * state().view.zoom * getDevicePixelRatio();
      const spriteScaleY = runtimeBaseScale * transform.scaleY * state().view.zoom * getDevicePixelRatio();
      const rect = frameScreenRect(index, group, groupImages, drawOptions);
      const flipH = effectiveFlipH(group, drawOptions);
      const facing = flipH ? -1 : 1;
      if (!rect) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.translate(rect.originX, rect.originY);
      ctx.rotate((Number(transform.rotation || 0) * facing * Math.PI) / 180);
      if (flipH) ctx.scale(-1, 1);
      if (group.type === "vfx") {
        const store = valueStore(group);
        const anchor = cloneVector(
          store[group.anchor] || group.anchorValue || { x: img.width, y: img.height },
        );
        ctx.drawImage(
          img,
          -anchor.x * spriteScaleX,
          -anchor.y * spriteScaleY,
          img.width * spriteScaleX,
          img.height * spriteScaleY,
        );
      } else {
        ctx.drawImage(
          img,
          (-img.width * spriteScaleX) / 2,
          (-img.height * spriteScaleY) / 2,
          img.width * spriteScaleX,
          img.height * spriteScaleY,
        );
      }
      if (selected) {
        ctx.strokeStyle = "rgba(145,215,255,.95)";
        ctx.lineWidth = 2;
        ctx.strokeRect(-5, -5, 10, 10);
      }
      ctx.restore();
    }

    /** Returns whether a group should show the next-frame overlap. */
    function sequenceOverlapEnabled(group = state().currentGroup) {
      return Boolean(group?.sequenceOverlap) && (group.frames?.length || 0) > 1;
    }

    /** Returns the clamped alpha used for sequence overlap. */
    function sequenceOverlapAlpha(group = state().currentGroup) {
      return Math.max(0, Math.min(1, Number(group?.sequenceOverlapAlpha ?? 0.48)));
    }

    /** Chooses the current timed frame for an independently playing layer. */
    function timedPlayableFrameIndex(group) {
      if (!group?.frames?.length) return 0;
      const playable = [];
      for (let index = 0; index < group.frames.length; index += 1) {
        if (!framePlayback(index, group).disabled) playable.push(index);
      }
      if (!playable.length) return 0;
      const fps = rawGroupPlaybackFps(group);
      return playable[Math.floor((performance.now() / 1000) * fps) % playable.length];
    }

    /** Draws the next frame as a translucent sequence overlap. */
    function drawSequenceOverlapFrame(
      index,
      alpha,
      group = state().currentGroup,
      groupImages = state().images,
      drawOptions = {},
    ) {
      if (!state().playing || !sequenceOverlapEnabled(group)) return;
      const nextIndex = nextPlayableFrameInGroup(group, index).index;
      if (nextIndex === index) return;
      drawFrame(nextIndex, alpha * sequenceOverlapAlpha(group), false, group, groupImages, drawOptions);
    }

    /** Returns whether animation playback needs a continuous canvas redraw. */
    function playbackNeedsContinuousDraw() {
      if (!state().playing || !state().currentGroup) return false;
      if (sequenceOverlapEnabled(state().currentGroup)) return true;
      if (attackTrailNeedsContinuousDraw()) return true;
      return attachedLayerGroups(state().currentGroup).some(
        (group) => group.independentPlayback === true || sequenceOverlapEnabled(group),
      );
    }

    /** Draws all attached layers for the active owner frame. */
    function drawAttachedLayersForOwner(ownerGroup, ownerIndex, alpha) {
      for (const layerGroup of attachedLayerGroups(ownerGroup)) {
        if (layerGroup.uiId === state().currentGroup?.uiId) continue;
        const layerImages = state().attachedLayerImageSets.get(layerGroup.uiId) || [];
        if (!layerImages.length) continue;
        const layerIndex =
          layerGroup.independentPlayback === true && state().playing
            ? timedPlayableFrameIndex(layerGroup)
            : Math.min(ownerIndex, layerImages.length - 1);
        const layerOptions = {
          transform: compositeLayerTransform(layerGroup, layerIndex, ownerGroup, ownerIndex),
          flipH: compositeLayerFlipH(layerGroup, ownerGroup),
        };
        drawSequenceOverlapFrame(layerIndex, alpha, layerGroup, layerImages, {
          transform: compositeLayerTransform(
            layerGroup,
            nextPlayableFrameInGroup(layerGroup, layerIndex).index,
            ownerGroup,
            ownerIndex,
          ),
          flipH: compositeLayerFlipH(layerGroup, ownerGroup),
        });
        drawFrame(layerIndex, alpha, false, layerGroup, layerImages, layerOptions);
      }
    }

    /** Draws one frame image attachment in its resolved screen rectangle. */
    function drawFrameImageAttachment(
      attachment,
      index,
      alpha,
      group = state().currentGroup,
      groupImages = state().images,
    ) {
      const rect = frameImageAttachmentScreenRect(attachment, index, group, groupImages);
      if (!rect) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.translate(rect.originX, rect.originY);
      ctx.rotate(rect.rotation);
      if (rect.flipH) ctx.scale(-1, 1);
      ctx.drawImage(rect.img, -rect.drawWidth / 2, -rect.drawHeight / 2, rect.drawWidth, rect.drawHeight);
      if (state().selectedAttachmentId === attachment.id) {
        ctx.strokeStyle = "rgba(255, 196, 74, .95)";
        ctx.lineWidth = 2;
        ctx.strokeRect(-rect.drawWidth / 2, -rect.drawHeight / 2, rect.drawWidth, rect.drawHeight);
      }
      ctx.restore();
    }

    /** Draws all attachments on one side of the frame. */
    function drawFrameImageAttachments(
      index,
      alpha,
      layer,
      group = state().currentGroup,
      groupImages = state().images,
    ) {
      for (const attachment of drawableFrameAttachments(index, layer, group)) {
        drawFrameImageAttachment(attachment, index, alpha, group, groupImages);
      }
    }

    /** Draws the owner frame, attachments, overlays, and attached layers in order. */
    function drawCompositeFrame(index, alpha, selected) {
      if (
        state().currentGroup?.previewOwner &&
        state().previewOwnerGroup &&
        state().previewOwnerImages.length
      ) {
        const ownerIndex = compositeOwnerFrameIndex(index, state().previewOwnerGroup);
        drawFrame(
          ownerIndex,
          Math.min(alpha, 0.72),
          false,
          state().previewOwnerGroup,
          state().previewOwnerImages,
        );
        drawFrameImageAttachments(index, alpha, "below", state().currentGroup, state().images);
        if (selected) drawAttackTrailLayer("behind", index, alpha);
        if (selected) {
          const nextIndex = nextPlayableFrameInGroup(state().currentGroup, index).index;
          drawSequenceOverlapFrame(index, alpha, state().currentGroup, state().images, {
            transform: compositeLayerTransform(
              state().currentGroup,
              nextIndex,
              state().previewOwnerGroup,
              ownerIndex,
            ),
            flipH: compositeLayerFlipH(state().currentGroup, state().previewOwnerGroup),
          });
        }
        drawFrame(index, alpha, selected, state().currentGroup, state().images, {
          transform: compositeLayerTransform(
            state().currentGroup,
            index,
            state().previewOwnerGroup,
            ownerIndex,
          ),
          flipH: compositeLayerFlipH(state().currentGroup, state().previewOwnerGroup),
        });
        drawFrameImageAttachments(index, alpha, "above", state().currentGroup, state().images);
        if (selected) drawAttackTrailLayer("front", index, alpha);
        return;
      }
      if (selected) drawSequenceOverlapFrame(index, alpha);
      drawFrameImageAttachments(index, alpha, "below");
      if (selected) drawAttackTrailLayer("behind", index, alpha);
      drawFrame(index, alpha, selected);
      drawFrameImageAttachments(index, alpha, "above");
      if (selected) drawAttackTrailLayer("front", index, alpha);
      drawAttachedLayersForOwner(state().currentGroup, index, alpha);
    }

    return {
      drawCompositeFrame,
      drawFrame,
      playbackNeedsContinuousDraw,
    };
  }

  return { createController };
});
