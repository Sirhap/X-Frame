(function attachXsxbAttachmentManipulation(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppAttachmentManipulation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (globalScope) => {
  "use strict";

  /**
   * Creates the direct-manipulation helpers for frame image attachments.
   *
   * The animation workbench keeps its state in app.js. This controller only
   * performs geometry and wheel-edit operations through injected accessors so
   * the existing facade can retain the same public function names.
   *
   * @param {object} [dependencies] State accessors and rendering callbacks.
   * @returns {object} Attachment direct-manipulation operations.
   */
  function createController(dependencies = {}) {
    const {
      getCurrentGroup = () => null,
      getImages = () => [],
      getSelectedFrame = () => 0,
      getView = () => ({ zoom: 1 }),
      getDevicePixelRatio = () => Number(globalScope?.devicePixelRatio || 1),
      getHeldAttachmentTransformKeys = () => new Set(),
      getAttachmentWheelUndoTimer = () => null,
      setAttachmentWheelUndoTimer = () => {},
      getAttachmentWheelUndoLabel = () => "",
      setAttachmentWheelUndoLabel = () => {},
      attachmentFrameIndex = () => 0,
      directManipulationAttachment = () => null,
      selectedFrameAttachment = () => null,
      cachedImageForFrame = () => null,
      loadImageCached = () => Promise.resolve(),
      frameTransform = () => ({ scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
      baseTransform = () => ({ scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
      frameScreenRect = () => null,
      renderTransformForGroup = (transform) => transform,
      runtimeBaseScaleForGroup = () => 1,
      effectiveFlipH = () => false,
      normalizeAttachmentTransform = (value) => value || {},
      rotatePoint = (point) => point,
      rotateVector = (vector) => vector,
      stagePoint = (event) => ({ x: event?.clientX || 0, y: event?.clientY || 0 }),
      activateFrameAttachmentForEditing = () => {},
      pushUndo = () => {},
      markDirty = () => {},
      syncAdjustmentInputs = () => {},
      renderFilmstrip = () => {},
      draw = () => {},
      windowRef = globalScope,
    } = dependencies;

    /**
     * Owner render transform for attachments: group/value-store rotation still
     * applies when a per-frame override pins rotation to 0.
     */
    function renderOwnerTransformForGroup(ownerTransform, group) {
      const base = baseTransform(group) || {};
      return renderTransformForGroup(
        {
          ...ownerTransform,
          rotation: Number(ownerTransform?.rotation || 0) || Number(base.rotation || 0),
        },
        group,
      );
    }

    /**
     * Calculates the screen-space bounding rectangle for an image attachment.
     * @param {object|null} attachment Attachment metadata and transform.
     * @param {number} [index] Owning frame index.
     * @param {object|null} [group] Owning animation group.
     * @param {Array<object>} [groupImages] Decoded owner-frame images.
     * @returns {object|undefined} Rotated screen rectangle, or undefined when unavailable.
     */
    function frameImageAttachmentScreenRect(
      attachment,
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      if (!attachment?.path || !group) return;
      const img = cachedImageForFrame(attachment);
      if (!img) {
        loadImageCached(attachment)
          .then(() => draw())
          .catch(() => {});
        return;
      }
      const ownerTransform = frameTransform(index, group);
      const ownerRect = frameScreenRect(index, group, groupImages, { transform: ownerTransform });
      if (!ownerRect) return;
      const ownerRenderTransform = renderOwnerTransformForGroup(ownerTransform, group);
      const local = normalizeAttachmentTransform(attachment.transform);
      const runtimeBaseScale = runtimeBaseScaleForGroup(index, group, groupImages);
      const flipH = effectiveFlipH(group);
      const view = getView();
      const worldScale = view.zoom * Number(getDevicePixelRatio() || 1);
      const utils =
        (typeof module === "object" && module.exports
          ? require("./app_attachment_utils")
          : globalScope.XSXBAttachmentUtils) || {};
      const placed = utils.attachmentOwnerPlacement(local, {
        scaleX: ownerRenderTransform.scaleX,
        scaleY: ownerRenderTransform.scaleY,
        runtimeScale: runtimeBaseScale,
        worldScale,
        flipH,
        rotation: Number(ownerRenderTransform.rotation || 0),
      });
      const originX = ownerRect.originX + placed.originX;
      const originY = ownerRect.originY + placed.originY;
      const rotation = placed.rotation;
      const width = img.width * Math.abs(placed.scaleX);
      const height = img.height * Math.abs(placed.scaleY);
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      const rotationRadians = (rotation * Math.PI) / 180;
      const corners = [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight },
      ].map((point) => rotatePoint(point, rotationRadians, { x: originX, y: originY }));
      const xs = corners.map((point) => point.x);
      const ys = corners.map((point) => point.y);
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        originX,
        originY,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        halfWidth,
        halfHeight,
        rotation: rotationRadians,
        drawWidth: width,
        drawHeight: height,
        flipH,
        img,
      };
    }

    /**
     * Tests a stage-space point against a rotated attachment rectangle.
     * @param {{x:number,y:number}} point Stage-space point.
     * @param {object} rect Attachment screen rectangle.
     * @param {number} [padding=0] Hit-test padding in screen pixels.
     * @returns {boolean} Whether the point lies inside the rectangle.
     */
    function pointInAttachmentRect(point, rect, padding = 0) {
      const local = rotateVector({ x: point.x - rect.originX, y: point.y - rect.originY }, -rect.rotation);
      return (
        local.x >= -rect.drawWidth / 2 - padding &&
        local.x <= rect.drawWidth / 2 + padding &&
        local.y >= -rect.drawHeight / 2 - padding &&
        local.y <= rect.drawHeight / 2 + padding
      );
    }

    /**
     * Finds the attachment currently under a direct-manipulation pointer.
     * @param {PointerEvent|MouseEvent} event Pointer event from the stage.
     * @returns {object|null} Hit attachment, or null when no attachment is hit.
     */
    function hitTestDirectManipulationAttachment(event) {
      const attachment = directManipulationAttachment();
      if (!attachment) return null;
      const group = getCurrentGroup();
      const frameIndex = attachmentFrameIndex(attachment, group);
      const rect = frameImageAttachmentScreenRect(attachment, frameIndex, group, getImages());
      if (!rect) return null;
      const padding = Math.max(6 * Number(getDevicePixelRatio() || 1), 6);
      return pointInAttachmentRect(stagePoint(event), rect, padding) ? attachment : null;
    }

    /**
     * Converts a client-space pointer delta into attachment-local coordinates.
     * @param {number} dx Client-space horizontal delta.
     * @param {number} dy Client-space vertical delta.
     * @param {object|null} [attachment] Attachment being moved.
     * @returns {{x:number,y:number}} Local attachment offset delta.
     */
    function attachmentOffsetDeltaFromClientDelta(dx, dy, attachment = selectedFrameAttachment()) {
      const group = getCurrentGroup();
      const index = attachmentFrameIndex(attachment, group);
      const ownerTransform = frameTransform(index, group);
      const ownerRenderTransform = renderOwnerTransformForGroup(ownerTransform, group);
      const runtimeBaseScale = runtimeBaseScaleForGroup(index, group, getImages());
      const facing = effectiveFlipH(group) ? -1 : 1;
      const view = getView();
      const scaleX = ownerRenderTransform.scaleX * runtimeBaseScale * view.zoom * facing;
      const scaleY = ownerRenderTransform.scaleY * runtimeBaseScale * view.zoom;
      const safeScaleX = Math.abs(scaleX) > 0.0001 ? scaleX : scaleX < 0 ? -0.0001 : 0.0001;
      const safeScaleY = Math.abs(scaleY) > 0.0001 ? scaleY : scaleY < 0 ? -0.0001 : 0.0001;
      const ownerRotationRadians = (Number(ownerRenderTransform.rotation || 0) * facing * Math.PI) / 180;
      const unrotated = rotateVector({ x: dx, y: dy }, -ownerRotationRadians);
      return {
        x: unrotated.x / safeScaleX,
        y: unrotated.y / safeScaleY,
      };
    }

    /**
     * Coalesces rapid wheel edits into one undo entry.
     * @param {string} label Undo label for the current wheel gesture.
     * @returns {void}
     */
    function pushAttachmentWheelUndo(label) {
      const timer = getAttachmentWheelUndoTimer();
      if (!timer || getAttachmentWheelUndoLabel() !== label) {
        pushUndo(label);
        setAttachmentWheelUndoLabel(label);
      }
      if (typeof windowRef?.clearTimeout === "function") windowRef.clearTimeout(timer);
      const nextTimer = windowRef?.setTimeout
        ? windowRef.setTimeout(() => {
            setAttachmentWheelUndoTimer(null);
            setAttachmentWheelUndoLabel("");
          }, 400)
        : null;
      setAttachmentWheelUndoTimer(nextTimer);
    }

    /**
     * Determines whether held modifier keys request attachment rotation/scaling.
     * @returns {"rotate"|"scale"|""} Active wheel edit mode.
     */
    function attachmentWheelMode() {
      const keys = getHeldAttachmentTransformKeys();
      if (keys.has("r")) return "rotate";
      if (keys.has("z")) return "scale";
      return "";
    }

    /**
     * Clamps attachment scale to the same range used by the existing editor.
     * @param {number} value Candidate scale.
     * @returns {number} Clamped finite scale.
     */
    function clampAttachmentScale(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 1;
      return Math.min(20, Math.max(0.001, numeric));
    }

    /**
     * Applies a wheel factor to one attachment scale axis.
     * @param {number} value Existing axis scale.
     * @param {number} fallback Fallback uniform scale.
     * @param {number} factor Wheel scale factor.
     * @returns {number} Clamped axis scale.
     */
    function scaleAttachmentAxis(value, fallback, factor) {
      const numeric = Number(value);
      const base = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
      return clampAttachmentScale(base * factor);
    }

    /**
     * Applies the active wheel rotation/scale edit to the hit attachment.
     * @param {WheelEvent} event Stage wheel event.
     * @returns {boolean} Whether the wheel event was consumed.
     */
    function applySelectedAttachmentWheel(event) {
      const mode = attachmentWheelMode();
      if (!mode) return false;
      const attachment = hitTestDirectManipulationAttachment(event);
      if (!attachment) return false;
      activateFrameAttachmentForEditing(attachment);
      const transform = normalizeAttachmentTransform(attachment.transform);
      if (mode === "rotate") {
        pushAttachmentWheelUndo("rotate attached image");
        const rotationDelta = event.deltaY < 0 ? 2 : -2;
        attachment.transform = normalizeAttachmentTransform({
          ...transform,
          rotation: transform.rotation + rotationDelta,
        });
      } else {
        pushAttachmentWheelUndo("scale attached image");
        const factor = event.deltaY < 0 ? 1.04 : 1 / 1.04;
        const previousScale = Number(transform.scale || 1);
        const nextScale = clampAttachmentScale(previousScale * factor);
        attachment.transform = normalizeAttachmentTransform({
          ...transform,
          scale: nextScale,
          scaleX: scaleAttachmentAxis(transform.scaleX, previousScale, factor),
          scaleY: scaleAttachmentAxis(transform.scaleY, previousScale, factor),
        });
      }
      markDirty();
      syncAdjustmentInputs();
      renderFilmstrip();
      draw();
      return true;
    }

    return {
      applySelectedAttachmentWheel,
      attachmentOffsetDeltaFromClientDelta,
      attachmentWheelMode,
      clampAttachmentScale,
      frameImageAttachmentScreenRect,
      hitTestDirectManipulationAttachment,
      pointInAttachmentRect,
      pushAttachmentWheelUndo,
      scaleAttachmentAxis,
    };
  }

  return { createController };
});
