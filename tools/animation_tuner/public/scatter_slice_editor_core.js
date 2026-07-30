(function attachScatterSliceEditorCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBScatterSliceEditorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const RESIZE_HANDLES = Object.freeze(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);

  /**
   * Clamps a number to an inclusive range.
   * @param {number} value Candidate value.
   * @param {number} minimum Inclusive minimum.
   * @param {number} maximum Inclusive maximum.
   * @returns {number} Clamped value.
   */
  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  /**
   * Converts an unknown value to a rounded finite integer.
   * @param {unknown} value Candidate value.
   * @param {number} fallback Fallback value.
   * @returns {number} Safe integer.
   */
  function finiteInteger(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
  }

  /**
   * Validates source bounds.
   * @param {{width:number,height:number}} bounds Source bounds.
   * @returns {{width:number,height:number}} Normalized bounds.
   */
  function normalizeBounds(bounds) {
    const width = finiteInteger(bounds?.width, 0);
    const height = finiteInteger(bounds?.height, 0);
    if (width <= 0 || height <= 0) throw new RangeError("bounds 必须包含正整数 width 和 height");
    return { width, height };
  }

  /**
   * Normalizes a slice rectangle into source bounds.
   * @param {{x:number,y:number,w:number,h:number,pixels?:number}} box Candidate rectangle.
   * @param {{width:number,height:number}} bounds Source bounds.
   * @returns {{x:number,y:number,w:number,h:number,pixels:number}} Valid rectangle.
   */
  function normalizeBox(box, bounds) {
    const safeBounds = normalizeBounds(bounds);
    const x = clamp(finiteInteger(box?.x, 0), 0, safeBounds.width - 1);
    const y = clamp(finiteInteger(box?.y, 0), 0, safeBounds.height - 1);
    const w = clamp(finiteInteger(box?.w, 1), 1, safeBounds.width - x);
    const h = clamp(finiteInteger(box?.h, 1), 1, safeBounds.height - y);
    return { x, y, w, h, pixels: w * h };
  }

  /**
   * Creates a bounded rectangle from two drag points in either direction.
   * @param {{x:number,y:number}} start Drag origin in source pixels.
   * @param {{x:number,y:number}} current Current drag point in source pixels.
   * @param {{width:number,height:number}} bounds Source bounds.
   * @returns {{x:number,y:number,w:number,h:number,pixels:number}} New rectangle.
   */
  function createBoxFromPoints(start, current, bounds) {
    const safeBounds = normalizeBounds(bounds);
    const startX = clamp(finiteInteger(start?.x, 0), 0, safeBounds.width);
    const startY = clamp(finiteInteger(start?.y, 0), 0, safeBounds.height);
    const currentX = clamp(finiteInteger(current?.x, startX), 0, safeBounds.width);
    const currentY = clamp(finiteInteger(current?.y, startY), 0, safeBounds.height);
    let left = Math.min(startX, currentX);
    let top = Math.min(startY, currentY);
    let right = Math.max(startX, currentX);
    let bottom = Math.max(startY, currentY);
    if (left >= safeBounds.width) left = safeBounds.width - 1;
    if (top >= safeBounds.height) top = safeBounds.height - 1;
    if (right <= left) right = left + 1;
    if (bottom <= top) bottom = top + 1;
    const w = right - left;
    const h = bottom - top;
    return { x: left, y: top, w, h, pixels: w * h };
  }

  /**
   * Moves a slice rectangle without changing its size.
   * @param {{x:number,y:number,w:number,h:number,pixels?:number}} box Source rectangle.
   * @param {number} deltaX Horizontal source-pixel delta.
   * @param {number} deltaY Vertical source-pixel delta.
   * @param {{width:number,height:number}} bounds Source bounds.
   * @returns {{x:number,y:number,w:number,h:number,pixels:number}} Moved rectangle.
   */
  function moveBox(box, deltaX, deltaY, bounds) {
    const safeBounds = normalizeBounds(bounds);
    const safeBox = normalizeBox(box, safeBounds);
    const x = clamp(safeBox.x + finiteInteger(deltaX, 0), 0, safeBounds.width - safeBox.w);
    const y = clamp(safeBox.y + finiteInteger(deltaY, 0), 0, safeBounds.height - safeBox.h);
    return { ...safeBox, x, y };
  }

  /**
   * Resizes a slice rectangle from one of its eight handles.
   * @param {{x:number,y:number,w:number,h:number,pixels?:number}} box Source rectangle.
   * @param {string} handle Resize handle.
   * @param {number} deltaX Horizontal source-pixel delta.
   * @param {number} deltaY Vertical source-pixel delta.
   * @param {{width:number,height:number}} bounds Source bounds.
   * @returns {{x:number,y:number,w:number,h:number,pixels:number}} Resized rectangle.
   */
  function resizeBox(box, handle, deltaX, deltaY, bounds) {
    if (!RESIZE_HANDLES.includes(handle)) throw new RangeError("handle 必须是有效的缩放控制点");
    const safeBounds = normalizeBounds(bounds);
    const safeBox = normalizeBox(box, safeBounds);
    const dx = finiteInteger(deltaX, 0);
    const dy = finiteInteger(deltaY, 0);
    let left = safeBox.x;
    let top = safeBox.y;
    let right = safeBox.x + safeBox.w;
    let bottom = safeBox.y + safeBox.h;

    if (handle.includes("w")) left = clamp(left + dx, 0, right - 1);
    if (handle.includes("e")) right = clamp(right + dx, left + 1, safeBounds.width);
    if (handle.includes("n")) top = clamp(top + dy, 0, bottom - 1);
    if (handle.includes("s")) bottom = clamp(bottom + dy, top + 1, safeBounds.height);

    const w = right - left;
    const h = bottom - top;
    return { x: left, y: top, w, h, pixels: w * h };
  }

  /**
   * Maps a browser client point to integer source-image coordinates.
   * @param {{x:number,y:number}} clientPoint Browser client coordinates.
   * @param {{left:number,top:number,width:number,height:number}} clientRect Rendered canvas bounds.
   * @param {{width:number,height:number}} bounds Source bounds.
   * @returns {{x:number,y:number}} Source-image point.
   */
  function pointFromClient(clientPoint, clientRect, bounds) {
    const safeBounds = normalizeBounds(bounds);
    if (!Number.isFinite(clientRect?.width) || !Number.isFinite(clientRect?.height)) {
      throw new RangeError("clientRect 尺寸无效");
    }
    if (clientRect.width <= 0 || clientRect.height <= 0) throw new RangeError("clientRect 尺寸必须大于 0");
    const clientX = Number(clientPoint?.x);
    const clientY = Number(clientPoint?.y);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) throw new TypeError("clientPoint 坐标无效");
    return {
      x: clamp(
        Math.round(((clientX - Number(clientRect.left || 0)) / clientRect.width) * safeBounds.width),
        0,
        safeBounds.width,
      ),
      y: clamp(
        Math.round(((clientY - Number(clientRect.top || 0)) / clientRect.height) * safeBounds.height),
        0,
        safeBounds.height,
      ),
    };
  }

  /**
   * Returns source coordinates for all resize handles.
   * @param {{x:number,y:number,w:number,h:number}} box Rectangle.
   * @returns {Array<{handle:string,x:number,y:number}>} Handle points.
   */
  function handlePoints(box) {
    const left = box.x;
    const top = box.y;
    const right = box.x + box.w;
    const bottom = box.y + box.h;
    const centerX = left + box.w / 2;
    const centerY = top + box.h / 2;
    return [
      { handle: "nw", x: left, y: top },
      { handle: "n", x: centerX, y: top },
      { handle: "ne", x: right, y: top },
      { handle: "e", x: right, y: centerY },
      { handle: "se", x: right, y: bottom },
      { handle: "s", x: centerX, y: bottom },
      { handle: "sw", x: left, y: bottom },
      { handle: "w", x: left, y: centerY },
    ];
  }

  /**
   * Hit-tests resize handles and slice interiors.
   * @param {Array<{x:number,y:number,w:number,h:number}>} boxes Current rectangles.
   * @param {{x:number,y:number}} point Source-image point.
   * @param {number|null} selectedIndex Selected rectangle index.
   * @param {number} [handleRadius] Handle hit radius in source pixels.
   * @returns {{index:number,action:"move"|"resize",handle?:string}|null} Hit result.
   */
  function hitTestBoxes(boxes, point, selectedIndex, handleRadius = 6) {
    if (!Array.isArray(boxes)) throw new TypeError("boxes 必须是数组");
    const radius = Math.max(0, Number.isFinite(Number(handleRadius)) ? Number(handleRadius) : 6);
    if (Number.isInteger(selectedIndex) && boxes[selectedIndex]) {
      const nearestHandle = handlePoints(boxes[selectedIndex])
        .filter(
          (handlePoint) =>
            Math.abs(point.x - handlePoint.x) <= radius && Math.abs(point.y - handlePoint.y) <= radius,
        )
        .map((handlePoint) => ({
          ...handlePoint,
          distance: (point.x - handlePoint.x) ** 2 + (point.y - handlePoint.y) ** 2,
        }))
        .sort((first, second) => first.distance - second.distance)[0];
      if (nearestHandle) {
        return { index: selectedIndex, action: "resize", handle: nearestHandle.handle };
      }
    }

    const indexes = [];
    if (Number.isInteger(selectedIndex) && boxes[selectedIndex]) indexes.push(selectedIndex);
    for (let index = boxes.length - 1; index >= 0; index -= 1) {
      if (index !== selectedIndex) indexes.push(index);
    }
    for (const index of indexes) {
      const candidate = boxes[index];
      if (
        point.x >= candidate.x &&
        point.x <= candidate.x + candidate.w &&
        point.y >= candidate.y &&
        point.y <= candidate.y + candidate.h
      ) {
        return { index, action: "move" };
      }
    }
    return null;
  }

  /**
   * Keeps a regrouped row selected only when every member was previously included.
   * @param {Array<{id:string,boxes:object[]}>} groups Regrouped rows.
   * @param {Set<object>} includedBoxes Previously included box identities.
   * @returns {string[]} Safely selected group ids.
   */
  function selectedGroupIdsAfterRegroup(groups, includedBoxes) {
    if (!Array.isArray(groups)) throw new TypeError("groups 必须是数组");
    if (!(includedBoxes instanceof Set)) throw new TypeError("includedBoxes 必须是 Set");
    return groups
      .filter(
        (group) =>
          Array.isArray(group.boxes) &&
          group.boxes.length > 0 &&
          group.boxes.every((box) => includedBoxes.has(box)),
      )
      .map((group) => group.id);
  }

  /**
   * Computes the selected index after deleting one rectangle.
   * @param {number} length Collection length before deletion.
   * @param {number} deletedIndex Deleted rectangle index.
   * @returns {number|null} Next selected index.
   */
  function selectionAfterDelete(length, deletedIndex) {
    if (!Number.isInteger(length) || length <= 0) throw new RangeError("length 必须是正整数");
    if (!Number.isInteger(deletedIndex) || deletedIndex < 0 || deletedIndex >= length) {
      throw new RangeError("deletedIndex 超出范围");
    }
    const nextLength = length - 1;
    return nextLength === 0 ? null : Math.min(deletedIndex, nextLength - 1);
  }

  return Object.freeze({
    RESIZE_HANDLES,
    createBoxFromPoints,
    handlePoints,
    hitTestBoxes,
    moveBox,
    normalizeBox,
    pointFromClient,
    resizeBox,
    selectedGroupIdsAfterRegroup,
    selectionAfterDelete,
  });
});
