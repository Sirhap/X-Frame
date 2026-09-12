(function attachScatterSliceProductionAdapter(root, factory) {
  "use strict";

  const api = factory(root?.BatchCutoutBackgroundEstimator);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameScatterSliceSmartCutout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (backgroundEstimator) => {
  "use strict";

  if (!backgroundEstimator?.estimateBackgroundColor) {
    throw new Error("The production background estimator is required.");
  }

  /**
   * Samples the source perimeter without exposing protected cutout kernels.
   * @param {Uint8ClampedArray|Uint8Array} rgba Source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @returns {{r:number,g:number,b:number}} Estimated RGB background.
   */
  function detectBackgroundColor(rgba, width, height) {
    const color = backgroundEstimator.estimateBackgroundColor(rgba, width, height);
    return { r: color.r, g: color.g, b: color.b };
  }

  /**
   * Fails closed if production UI state attempts to bypass the disabled transparent-output control.
   * @returns {never}
   */
  function applySmartCutout() {
    throw new Error("Cloud transparent slicing is not available in this build.");
  }

  return Object.freeze({ applySmartCutout, detectBackgroundColor });
});
