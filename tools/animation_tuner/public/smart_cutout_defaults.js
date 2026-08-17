(function attachSmartCutoutDefaults(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBSmartCutoutDefaults = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Shared regular background-clear profile used by organizer and slice tools.
   * Background color is a placeholder and is replaced by automatic detection.
   */
  const REGULAR_AUTO_BACKGROUND_PARAMETERS = Object.freeze({
    backgroundColor: "#ffffff",
    connected: false,
    perceptual: false,
    // The tolerance slider reaches down to -1, which is its off position: the
    // reference replacement compares distance <= tolerance, so -1 matches no
    // pixel at all and the whole profile becomes a no-op. 1 is the value the
    // cutout workbench itself starts from.
    tolerance: 1,
    feather: 0,
    alphaThreshold: 0,
    chromaFeather: 0,
    edgeBoost: 10,
    blendStrength: 100,
    blendMode: "blend",
    alphaLow: 0,
    alphaHigh: 0,
    despillStrength: 100,
    despillMode: "general",
    edgeDespillRadius: 0,
    edgeRecoveryStrength: 0,
    backgroundRadius: 0,
    blurRadius: 0,
    protectionTolerance: 0,
  });

  return Object.freeze({ REGULAR_AUTO_BACKGROUND_PARAMETERS });
});
