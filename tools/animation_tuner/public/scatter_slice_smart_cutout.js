(function attachScatterSliceSmartCutout(root, factory) {
  "use strict";

  const cutoutCore =
    typeof module === "object" && module.exports ? require("./batch_cutout_core") : root?.BatchCutoutCore;
  const smartCutoutDefaults =
    typeof module === "object" && module.exports
      ? require("./smart_cutout_defaults")
      : root?.XSXBSmartCutoutDefaults;
  const api = factory(cutoutCore, smartCutoutDefaults);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBScatterSliceSmartCutout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (cutoutCore, smartCutoutDefaults) => {
  "use strict";

  if (!cutoutCore?.applyProductCutout || !cutoutCore?.estimateBackgroundColor) {
    throw new Error("BatchCutoutCore is required for smart slice cutout.");
  }
  if (!smartCutoutDefaults?.REGULAR_AUTO_BACKGROUND_PARAMETERS) {
    throw new Error("Shared smart-cutout defaults are required.");
  }

  /**
   * Validates one RGBA image before running background analysis or replacement.
   * @param {Uint8ClampedArray} rgba Source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @returns {void}
   */
  function validateImage(rgba, width, height) {
    if (!(rgba instanceof Uint8ClampedArray)) throw new TypeError("rgba 必须是 Uint8ClampedArray");
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("切片尺寸必须是正整数");
    }
    if (rgba.length !== width * height * 4) throw new RangeError("RGBA 长度与切片尺寸不一致");
  }

  /**
   * Detects one shared background sample from the complete source image.
   * @param {Uint8ClampedArray} rgba Source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @returns {{r:number,g:number,b:number}} Detected RGB background.
   */
  function detectBackgroundColor(rgba, width, height) {
    validateImage(rgba, width, height);
    const detected = cutoutCore.estimateBackgroundColor(rgba, width, height);
    return { r: detected.r, g: detected.g, b: detected.b };
  }

  /**
   * Creates the regular background-clear settings used by the single-image editor.
   * @param {{r:number,g:number,b:number}} backgroundColor Automatically detected background.
   * @returns {object} BatchCutoutCore product options.
   */
  function createSmartCutoutOptions(backgroundColor) {
    // A black reference and transparent replacement share the same RGB axis, so
    // the reference blend cannot derive opacity. Use border connectivity instead.
    const nearBlackBackground = Math.max(backgroundColor.r, backgroundColor.g, backgroundColor.b) <= 24;
    return {
      ...smartCutoutDefaults.REGULAR_AUTO_BACKGROUND_PARAMETERS,
      automaticCutout: true,
      backgroundColor,
      backgroundColors: [backgroundColor],
      connected: nearBlackBackground,
      edgeRecoveryTolerance: 0,
      referenceChromaKey: !nearBlackBackground,
      tolerance: nearBlackBackground ? 4 : smartCutoutDefaults.REGULAR_AUTO_BACKGROUND_PARAMETERS.tolerance,
    };
  }

  /**
   * Applies the existing product smart-cutout pipeline to one cropped slice.
   * @param {Uint8ClampedArray} rgba Source RGBA pixels.
   * @param {number} width Slice width.
   * @param {number} height Slice height.
   * @param {{r:number,g:number,b:number}} [backgroundColor] Shared source background sample.
   * @returns {Uint8ClampedArray} Smart-cutout pixels.
   */
  function applySmartCutout(rgba, width, height, backgroundColor) {
    validateImage(rgba, width, height);
    const resolvedBackground = backgroundColor || detectBackgroundColor(rgba, width, height);
    return cutoutCore.applyProductCutout(
      rgba,
      width,
      height,
      createSmartCutoutOptions(resolvedBackground),
      [],
    ).data;
  }

  return Object.freeze({ applySmartCutout, createSmartCutoutOptions, detectBackgroundColor });
});
