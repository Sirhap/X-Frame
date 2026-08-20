(function attachXsxbBoxGeometry(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBBoxGeometry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const BOX_MIN_SIZE = 1;
  const BOX_NUDGE_STEP = 1;

  /**
   * Returns a finite number or the fallback when the value cannot be used.
   * @param {unknown} value Raw numeric value.
   * @param {number} fallback Value used for NaN, Infinity, or missing input.
   * @returns {number} Finite number.
   */
  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  /**
   * Returns whether a box uses the collision-body constraints.
   * @param {string} boxName Box identifier.
   * @returns {boolean} Whether the box is a collision box.
   */
  function isCollisionBox(boxName) {
    return boxName === "collisionbox";
  }

  /**
   * Returns whether a box matches the no-image defaultHurtbox template.
   * Foot-anchored auto boxes clamp to 8×8 when the source rect is 1×1.
   * @param {object|null|undefined} box Box value.
   * @returns {boolean} Whether the box is the 1×1 / 8×8 foot stub.
   */
  function isDefaultFootStubBox(box) {
    const width = finiteNumber(box?.size?.x, Number.NaN);
    const height = finiteNumber(box?.size?.y, Number.NaN);
    return Number.isFinite(width) && Number.isFinite(height) && width <= 8 && height <= 8;
  }

  /**
   * Centers a collision box vertically around its body origin.
   * @param {number} height Box height.
   * @returns {number} Collision offset.
   */
  function collisionOffsetYForHeight(height) {
    return -Math.max(1, Number(height || 1)) / 2;
  }

  /**
   * Normalizes a persisted box while enforcing collision-box invariants.
   * @param {string} boxName Box identifier.
   * @param {object|null|undefined} box Raw box value.
   * @returns {{offset:{x:number,y:number},size:{x:number,y:number},rotation:number,enabled:boolean}}
   * Normalized box value.
   */
  function normalizeFrameBox(boxName, box) {
    const size = {
      x: Math.max(BOX_MIN_SIZE, finiteNumber(box?.size?.x, BOX_MIN_SIZE)),
      y: Math.max(BOX_MIN_SIZE, finiteNumber(box?.size?.y, BOX_MIN_SIZE)),
    };
    if (isCollisionBox(boxName)) {
      return {
        offset: {
          x: finiteNumber(box?.offset?.x, 0),
          y: collisionOffsetYForHeight(size.y),
        },
        size,
        rotation: 0,
        enabled: box?.enabled !== false,
      };
    }
    return {
      offset: {
        x: finiteNumber(box?.offset?.x, 0),
        y: finiteNumber(box?.offset?.y, 0),
      },
      size,
      rotation: finiteNumber(box?.rotation, 0),
      enabled: box?.enabled !== false,
    };
  }

  /**
   * Moves a box by a local offset without changing its size.
   * @param {string} boxName Box identifier.
   * @param {object} box Existing box.
   * @param {number} deltaX Local X step.
   * @param {number} deltaY Local Y step.
   * @returns {object} Normalized nudged box.
   */
  function nudgeFrameBox(boxName, box, deltaX, deltaY) {
    const current = normalizeFrameBox(boxName, box);
    return normalizeFrameBox(boxName, {
      ...current,
      offset: {
        x: current.offset.x + finiteNumber(deltaX, 0),
        y: current.offset.y + finiteNumber(deltaY, 0),
      },
    });
  }

  /**
   * Resizes one grabbed edge or corner while keeping width/height at least 1×1.
   * @param {string} boxName Box identifier.
   * @param {object} box Box captured at the start of the gesture.
   * @param {string} handle Resize handle name (`n`, `e`, `se`, …).
   * @param {{x?:number,y?:number}} [localDelta] Movement in box-local coordinates.
   * @returns {object} Normalized resized box.
   */
  function resizeFrameBox(boxName, box, handle, localDelta = {}) {
    const current = normalizeFrameBox(boxName, box);
    const handleName = String(handle || "");
    const dx = finiteNumber(localDelta?.x, 0);
    const dy = finiteNumber(localDelta?.y, 0);
    const collision = isCollisionBox(boxName);
    let left = -current.size.x / 2;
    let right = current.size.x / 2;
    let top = -current.size.y / 2;
    let bottom = current.size.y / 2;
    if (handleName.includes("w")) left += dx;
    if (handleName.includes("e")) right += dx;
    if (collision) {
      if (right - left < BOX_MIN_SIZE) {
        if (handleName.includes("w")) left = right - BOX_MIN_SIZE;
        else right = left + BOX_MIN_SIZE;
      }
      const width = Math.max(BOX_MIN_SIZE, right - left);
      const heightDelta = handleName.includes("n") ? -dy : 0;
      const height = Math.max(BOX_MIN_SIZE, current.size.y + heightDelta);
      return normalizeFrameBox(boxName, {
        offset: {
          x: current.offset.x + (left + right) / 2,
          y: collisionOffsetYForHeight(height),
        },
        size: { x: width, y: height },
        rotation: 0,
        enabled: current.enabled,
      });
    }
    if (handleName.includes("n")) top += dy;
    if (handleName.includes("s")) bottom += dy;
    if (right - left < BOX_MIN_SIZE) {
      if (handleName.includes("w")) left = right - BOX_MIN_SIZE;
      else right = left + BOX_MIN_SIZE;
    }
    if (bottom - top < BOX_MIN_SIZE) {
      if (handleName.includes("n")) top = bottom - BOX_MIN_SIZE;
      else bottom = top + BOX_MIN_SIZE;
    }
    const width = Math.max(BOX_MIN_SIZE, right - left);
    const height = Math.max(BOX_MIN_SIZE, bottom - top);
    const localCenter = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const rotation = (finiteNumber(current.rotation, 0) * Math.PI) / 180;
    const worldCenter = rotateVector(localCenter, rotation);
    return normalizeFrameBox(boxName, {
      offset: {
        x: current.offset.x + worldCenter.x,
        y: current.offset.y + worldCenter.y,
      },
      size: { x: width, y: height },
      rotation: current.rotation,
      enabled: current.enabled,
    });
  }

  /**
   * Reads a non-zero horizontal transform scale.
   * @param {object|null|undefined} transform Transform value.
   * @returns {number} Horizontal scale.
   */
  function transformScaleX(transform) {
    const value = Number(transform?.scaleX ?? transform?.scale ?? 1);
    return Math.abs(value) > 0.0001 ? value : 1;
  }

  /**
   * Reads a non-zero vertical transform scale.
   * @param {object|null|undefined} transform Transform value.
   * @returns {number} Vertical scale.
   */
  function transformScaleY(transform) {
    const value = Number(transform?.scaleY ?? transform?.scale ?? 1);
    return Math.abs(value) > 0.0001 ? value : 1;
  }

  /**
   * Compares transform properties using the editor tolerance.
   * @param {object|null|undefined} previous Previous transform.
   * @param {object|null|undefined} next Next transform.
   * @returns {boolean} Whether a transform property changed.
   */
  function transformHasDelta(previous, next) {
    return (
      !nearlyEqual(transformScaleX(previous), transformScaleX(next)) ||
      !nearlyEqual(transformScaleY(previous), transformScaleY(next)) ||
      !nearlyEqual(Number(previous?.offset?.x || 0), Number(next?.offset?.x || 0)) ||
      !nearlyEqual(Number(previous?.offset?.y || 0), Number(next?.offset?.y || 0)) ||
      !nearlyEqual(Number(previous?.rotation || 0), Number(next?.rotation || 0))
    );
  }

  /**
   * Applies a transform delta to a collision or combat box.
   * @param {string} boxName Box identifier.
   * @param {object} box Existing box.
   * @param {object} previousTransform Previous parent transform.
   * @param {object} nextTransform Next parent transform.
   * @returns {object} Transformed and normalized box.
   */
  function transformBoxByDelta(boxName, box, previousTransform, nextTransform) {
    const previousScaleX = transformScaleX(previousTransform);
    const previousScaleY = transformScaleY(previousTransform);
    const scaleXRatio = transformScaleX(nextTransform) / previousScaleX;
    const scaleYRatio = transformScaleY(nextTransform) / previousScaleY;
    const offsetDelta = {
      x: Number(nextTransform?.offset?.x || 0) - Number(previousTransform?.offset?.x || 0),
      y: Number(nextTransform?.offset?.y || 0) - Number(previousTransform?.offset?.y || 0),
    };
    const rotationDelta = Number(nextTransform?.rotation || 0) - Number(previousTransform?.rotation || 0);
    const collision = isCollisionBox(boxName);
    const size = {
      x: Math.max(1, Number(box?.size?.x || 1) * Math.abs(scaleXRatio)),
      y: Math.max(1, Number(box?.size?.y || 1) * Math.abs(scaleYRatio)),
    };
    let offset = {
      x: Number(box?.offset?.x || 0) * scaleXRatio,
      y: Number(box?.offset?.y || 0) * scaleYRatio,
    };
    if (!collision && !nearlyEqual(rotationDelta, 0)) {
      offset = rotateVector(offset, (rotationDelta * Math.PI) / 180);
    }
    offset.x += offsetDelta.x;
    offset.y += offsetDelta.y;
    if (collision) offset.y = collisionOffsetYForHeight(size.y);
    return normalizeFrameBox(boxName, {
      offset,
      size,
      rotation: collision ? 0 : Number(box?.rotation || 0) + rotationDelta,
      enabled: box?.enabled !== false,
    });
  }

  /**
   * Rotates a vector around the origin.
   * @param {{x:number,y:number}} point Vector.
   * @param {number} radians Rotation in radians.
   * @returns {{x:number,y:number}} Rotated vector.
   */
  function rotateVector(point, radians) {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return {
      x: point.x * c - point.y * s,
      y: point.x * s + point.y * c,
    };
  }

  /**
   * Rotates a point around an optional origin.
   * @param {{x:number,y:number}} point Point.
   * @param {number} radians Rotation in radians.
   * @param {{x:number,y:number}} [origin] Rotation origin.
   * @returns {{x:number,y:number}} Rotated point.
   */
  function rotatePoint(point, radians, origin = { x: 0, y: 0 }) {
    const rotated = rotateVector(point, radians);
    return { x: origin.x + rotated.x, y: origin.y + rotated.y };
  }

  /**
   * Checks whether a point lies inside an axis-aligned rectangle.
   * @param {{x:number,y:number}} point Point.
   * @param {{x:number,y:number,width:number,height:number}} rect Rectangle.
   * @returns {boolean} Whether the point is inside the rectangle.
   */
  function pointInRect(point, rect) {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  }

  /**
   * Checks a point against a rectangle with optional padding.
   * @param {{x:number,y:number}} point Point.
   * @param {{x:number,y:number,width:number,height:number}} rect Rectangle.
   * @param {number} [padding=0] Extra hit-test padding.
   * @returns {boolean} Whether the point is inside the padded rectangle.
   */
  function pointInBoxRect(point, rect, padding = 0) {
    const local = rotateVector({ x: point.x - rect.centerX, y: point.y - rect.centerY }, -rect.rotation);
    return (
      local.x >= -rect.halfWidth - padding &&
      local.x <= rect.halfWidth + padding &&
      local.y >= -rect.halfHeight - padding &&
      local.y <= rect.halfHeight + padding
    );
  }

  /**
   * Compares numeric values using the editor tolerance.
   * @param {unknown} left First value.
   * @param {unknown} right Second value.
   * @returns {boolean} Whether values are effectively equal.
   */
  function nearlyEqual(left, right) {
    return Math.abs(Number(left || 0) - Number(right || 0)) < 0.0001;
  }

  return {
    BOX_MIN_SIZE,
    BOX_NUDGE_STEP,
    collisionOffsetYForHeight,
    isCollisionBox,
    isDefaultFootStubBox,
    nearlyEqual,
    normalizeFrameBox,
    nudgeFrameBox,
    pointInBoxRect,
    pointInRect,
    resizeFrameBox,
    rotatePoint,
    rotateVector,
    transformBoxByDelta,
    transformHasDelta,
    transformScaleX,
    transformScaleY,
  };
});
