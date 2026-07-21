(function attachBatchCutoutPublicColor(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutPublicColor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Keeps a number inside an inclusive range.
   * @param {number} value Candidate number.
   * @param {number} minimum Inclusive minimum.
   * @param {number} maximum Inclusive maximum.
   * @returns {number} Clamped value.
   */
  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value || 0)));
  }

  /**
   * Converts RGB channels into a CSS hexadecimal color.
   * @param {{r:number,g:number,b:number}} color RGB color.
   * @returns {string} Six-digit CSS color.
   */
  function rgbToHex(color) {
    return `#${[color.r, color.g, color.b]
      .map((channel) =>
        Math.round(clamp(channel, 0, 255))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  }

  /**
   * Converts a six-digit CSS hexadecimal color into RGB channels.
   * @param {string} value CSS color.
   * @returns {{r:number,g:number,b:number}} RGB color.
   */
  function hexToRgb(value) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(value || ""));
    if (!match) return { r: 255, g: 255, b: 255 };
    const number = Number.parseInt(match[1], 16);
    return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255 };
  }

  /**
   * Calculates display-level RGB distance normalized to 0-100.
   * @param {number} red Red channel.
   * @param {number} green Green channel.
   * @param {number} blue Blue channel.
   * @param {{r:number,g:number,b:number}} target Target RGB color.
   * @returns {number} Normalized distance.
   */
  function colorDistance(red, green, blue, target) {
    const redMean = (red + target.r) / 2;
    const redDelta = red - target.r;
    const greenDelta = green - target.g;
    const blueDelta = blue - target.b;
    const weighted = Math.sqrt(
      (2 + redMean / 256) * redDelta * redDelta +
        4 * greenDelta * greenDelta +
        (2 + (255 - redMean) / 256) * blueDelta * blueDelta,
    );
    return clamp((weighted / 764.834) * 100, 0, 100);
  }

  return Object.freeze({ clamp, colorDistance, hexToRgb, rgbToHex });
});
