(function attachBatchCutoutBackgroundController(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutBackgroundController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Clamps one RGBA channel to the byte range used by canvas pixels.
   * @param {unknown} value Candidate channel value.
   * @param {number} fallback Value used when the candidate is not finite.
   * @returns {number} Normalized channel.
   */
  function clampChannel(value, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.max(0, Math.min(255, Math.round(numericValue)));
  }

  /**
   * Copies an RGBA color into a stable, serializable sample record.
   * @param {object} color Source color.
   * @returns {{r:number,g:number,b:number,a:number}} Normalized color.
   */
  function normalizeColor(color = {}) {
    return {
      r: clampChannel(color.r),
      g: clampChannel(color.g),
      b: clampChannel(color.b),
      a: clampChannel(color.a, 255),
    };
  }

  /**
   * Compares two RGBA colors, treating an omitted alpha as opaque.
   * @param {object} left First color.
   * @param {object} right Second color.
   * @returns {boolean} Whether the colors are identical.
   */
  function colorsEqual(left, right) {
    const first = normalizeColor(left);
    const second = normalizeColor(right);
    return first.r === second.r && first.g === second.g && first.b === second.b && first.a === second.a;
  }

  /**
   * Copies a source-space point used by connected background removal.
   * @param {object} point Source-space point.
   * @returns {{x:number,y:number}} Normalized point.
   */
  function normalizePoint(point = {}) {
    return {
      x: Number.isFinite(Number(point.x)) ? Number(point.x) : 0,
      y: Number.isFinite(Number(point.y)) ? Number(point.y) : 0,
    };
  }

  /**
   * Reads one pixel from an ImageData-like object without exposing its backing array.
   * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} imageData Pixel buffer.
   * @param {number} x Pixel x coordinate.
   * @param {number} y Pixel y coordinate.
   * @returns {{r:number,g:number,b:number,a:number}|null} Pixel color or null outside the image.
   */
  function readPixel(imageData, x, y) {
    const width = Math.trunc(Number(imageData?.width));
    const height = Math.trunc(Number(imageData?.height));
    const pixelX = Math.floor(Number(x));
    const pixelY = Math.floor(Number(y));
    if (
      !imageData?.data ||
      width <= 0 ||
      height <= 0 ||
      pixelX < 0 ||
      pixelY < 0 ||
      pixelX >= width ||
      pixelY >= height
    )
      return null;
    const offset = (pixelY * width + pixelX) * 4;
    return normalizeColor({
      r: imageData.data[offset],
      g: imageData.data[offset + 1],
      b: imageData.data[offset + 2],
      a: imageData.data[offset + 3],
    });
  }

  /**
   * Promotes the newest background sample to the active color while retaining prior samples.
   * The clicked point is refreshed even for duplicate colors so connected removal follows the
   * location the user most recently chose.
   * @param {{backgroundSamples?:Array<object>,seedPoints?:Array<object>}} item Queue item.
   * @param {object} color Sampled RGBA color.
   * @param {{x:number,y:number}} point Source-space sample point.
   * @returns {{added:boolean,promoted:boolean}} Sample mutation result.
   */
  function promoteBackgroundSample(item, color, point) {
    if (!item) return { added: false, promoted: false };
    if (!Array.isArray(item.backgroundSamples)) item.backgroundSamples = [];
    if (!Array.isArray(item.seedPoints)) item.seedPoints = [];
    const normalizedColor = normalizeColor(color);
    const existingIndex = item.backgroundSamples.findIndex((sample) => colorsEqual(sample, normalizedColor));
    if (existingIndex >= 0) {
      item.backgroundSamples.splice(existingIndex, 1);
      if (existingIndex < item.seedPoints.length) item.seedPoints.splice(existingIndex, 1);
      item.backgroundSamples.unshift(normalizedColor);
      item.seedPoints.unshift(normalizePoint(point));
      return { added: false, promoted: existingIndex > 0 };
    }
    item.backgroundSamples.unshift(normalizedColor);
    item.seedPoints.unshift(normalizePoint(point));
    return { added: true, promoted: false };
  }

  /**
   * Removes one background sample and its aligned seed point.
   * @param {{backgroundSamples?:Array<object>,seedPoints?:Array<object>}} item Queue item.
   * @param {number} index Sample index.
   * @returns {{r:number,g:number,b:number,a:number}|null} Removed sample.
   */
  function removeBackgroundSample(item, index) {
    if (!item || !Array.isArray(item.backgroundSamples)) return null;
    const sampleIndex = Math.trunc(Number(index));
    if (sampleIndex < 0 || sampleIndex >= item.backgroundSamples.length) return null;
    const [removed] = item.backgroundSamples.splice(sampleIndex, 1);
    if (Array.isArray(item.seedPoints) && sampleIndex < item.seedPoints.length) {
      item.seedPoints.splice(sampleIndex, 1);
    }
    if (!item.backgroundSamples.length && "automaticCutoutActivated" in item) {
      item.automaticCutoutActivated = false;
    }
    return normalizeColor(removed);
  }

  /**
   * Removes every manually sampled background color but leaves local repairs untouched.
   * @param {{backgroundSamples?:Array<object>,seedPoints?:Array<object>}} item Queue item.
   * @returns {number} Number of removed samples.
   */
  function clearBackgroundSamples(item) {
    if (!item) return 0;
    const count = Array.isArray(item.backgroundSamples) ? item.backgroundSamples.length : 0;
    item.backgroundSamples = [];
    item.seedPoints = [];
    return count;
  }

  /**
   * Creates a serialized repair that clears the currently visible connected result color.
   * @param {{id:string, color:object, point:{x:number,y:number}, tolerance:number, metadata?:object}} input Repair inputs.
   * @returns {object} Recolor repair with a transparent replacement.
   */
  function createVisibleColorClearRepair(input = {}) {
    const point = normalizePoint(input.point);
    return {
      ...(input.metadata || {}),
      id: String(input.id || ""),
      mode: "recolor",
      scope: "connected",
      x: point.x,
      y: point.y,
      sourceColor: normalizeColor(input.color),
      color: { r: 0, g: 0, b: 0, a: 0 },
      tolerance: Math.max(0, Number(input.tolerance) || 0),
    };
  }

  return {
    clearBackgroundSamples,
    colorsEqual,
    createVisibleColorClearRepair,
    normalizeColor,
    promoteBackgroundSample,
    readPixel,
    removeBackgroundSample,
  };
});
