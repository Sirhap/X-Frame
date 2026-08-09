(function attachBatchCutoutBackgroundEstimator(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutBackgroundEstimator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Converts one byte channel to a two-character hexadecimal component.
   * @param {number} channel RGB channel.
   * @returns {string} Lowercase hexadecimal component.
   */
  function channelToHex(channel) {
    return Math.max(0, Math.min(255, Math.round(Number(channel) || 0)))
      .toString(16)
      .padStart(2, "0");
  }

  /**
   * Formats a browser RGB color without depending on protected color kernels.
   * @param {{r:number,g:number,b:number}} color RGB color.
   * @returns {string} CSS hexadecimal color.
   */
  function rgbToHex(color) {
    return `#${channelToHex(color.r)}${channelToHex(color.g)}${channelToHex(color.b)}`;
  }

  /**
   * Estimates the dominant visible color around an image perimeter.
   * This lightweight sampler is UI orchestration, not a product cutout kernel,
   * so production pages can initialize without shipping protected algorithms.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixel data.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @returns {{r:number,g:number,b:number,hex:string,sampleCount:number}}
   */
  function estimateBackgroundColor(data, width, height) {
    const normalizedWidth = Math.max(0, Math.trunc(Number(width) || 0));
    const normalizedHeight = Math.max(0, Math.trunc(Number(height) || 0));
    if (!data || data.length < normalizedWidth * normalizedHeight * 4) {
      return { r: 255, g: 255, b: 255, hex: "#ffffff", sampleCount: 0 };
    }

    const buckets = new Map();
    const edgeDepth = Math.max(
      1,
      Math.min(12, Math.ceil(Math.min(normalizedWidth, normalizedHeight) * 0.04)),
    );
    /** @param {number} x Pixel x coordinate. @param {number} y Pixel y coordinate. */
    const addPixel = (x, y) => {
      const offset = (y * normalizedWidth + x) * 4;
      if ((data[offset + 3] || 0) < 16) return;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const key = `${red >> 4},${green >> 4},${blue >> 4}`;
      const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0, colors: new Map() };
      bucket.r += red;
      bucket.g += green;
      bucket.b += blue;
      bucket.count += 1;
      const packedColor = (red << 16) | (green << 8) | blue;
      const exactColor = bucket.colors.get(packedColor) || {
        r: red,
        g: green,
        b: blue,
        count: 0,
        firstSeen: bucket.count,
      };
      exactColor.count += 1;
      bucket.colors.set(packedColor, exactColor);
      buckets.set(key, bucket);
    };

    for (let y = 0; y < normalizedHeight; y += 1) {
      for (let depth = 0; depth < edgeDepth; depth += 1) {
        addPixel(depth, y);
        addPixel(normalizedWidth - 1 - depth, y);
      }
    }
    for (let x = edgeDepth; x < normalizedWidth - edgeDepth; x += 1) {
      for (let depth = 0; depth < edgeDepth; depth += 1) {
        addPixel(x, depth);
        addPixel(x, normalizedHeight - 1 - depth);
      }
    }

    let dominant = null;
    for (const bucket of buckets.values()) {
      if (!dominant || bucket.count > dominant.count) dominant = bucket;
    }
    if (!dominant?.count) {
      return { r: 255, g: 255, b: 255, hex: "#ffffff", sampleCount: 0 };
    }

    const centroid = {
      r: dominant.r / dominant.count,
      g: dominant.g / dominant.count,
      b: dominant.b / dominant.count,
    };
    const selectedColor = [...dominant.colors.values()].sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      const leftDistance =
        (left.r - centroid.r) ** 2 + (left.g - centroid.g) ** 2 + (left.b - centroid.b) ** 2;
      const rightDistance =
        (right.r - centroid.r) ** 2 + (right.g - centroid.g) ** 2 + (right.b - centroid.b) ** 2;
      return leftDistance - rightDistance || left.firstSeen - right.firstSeen;
    })[0];
    const color = { r: selectedColor.r, g: selectedColor.g, b: selectedColor.b };
    return { ...color, hex: rgbToHex(color), sampleCount: dominant.count };
  }

  return Object.freeze({ estimateBackgroundColor });
});
