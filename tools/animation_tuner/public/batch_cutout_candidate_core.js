(function attachBatchCutoutCandidateCore(root, factory) {
  "use strict";

  const sessionCore =
    typeof module === "object" && module.exports
      ? require("./batch_cutout_session_core.js")
      : root.BatchCutoutSessionCore;
  const api = factory(sessionCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutCandidateCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (sessionCore) => {
  "use strict";

  if (!sessionCore?.normalizeProcessingParameters) {
    throw new Error("BatchCutoutSessionCore is required.");
  }

  const PARAMETER_ORDER = Object.freeze([
    "backgroundColor",
    "connected",
    "perceptual",
    "tolerance",
    "edgeBoost",
    "blendStrength",
    "blendMode",
    "despillStrength",
    "despillMode",
    "edgeDespillRadius",
    "edgeRecoveryStrength",
    "backgroundRadius",
    "blurRadius",
    "feather",
    "chromaFeather",
    "alphaLow",
    "alphaHigh",
    "alphaThreshold",
    "protectionTolerance",
  ]);
  const SUBJECT_DAMAGE_CODES = new Set(["empty", "holes", "split", "area"]);

  /** @param {*} value Value to clone. @returns {*} Independent serializable value. */
  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
  }

  /** @param {number} value Channel value. @returns {number} Byte channel. */
  function byte(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  }

  /** @param {{r:number,g:number,b:number}} color RGB color. @returns {string} Six-digit HEX. */
  function rgbToHex(color) {
    return `#${[color.r, color.g, color.b]
      .map((channel) => byte(channel).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  /**
   * Creates a deterministic local suggestion from current quality signals.
   * @param {{parameters:object,quality?:object,metric?:object,backgroundSamples?:object[],seedPoints?:object[],estimatedBackground?:object|null}} options Candidate inputs.
   * @returns {{parameters:object,backgroundSamples:object[],seedPoints:object[],reasonCodes:string[]}}
   */
  function createSuggestedCandidate(options = {}) {
    const baseline = sessionCore.normalizeProcessingParameters(options.parameters);
    const parameters = { ...baseline };
    const codes = new Set(options.quality?.codes || []);
    const reasonCodes = [];
    const hasSubjectDamage = Array.from(SUBJECT_DAMAGE_CODES).some((code) => codes.has(code));
    const hasBackgroundResidue = codes.has("background-residue");
    const hasSoftEdge = codes.has("soft-edge");
    const hasTransparentRgb = codes.has("transparent-rgb");

    if (hasSubjectDamage) {
      parameters.connected = true;
      parameters.tolerance = parameters.tolerance < 0 ? -1 : parameters.tolerance - 2;
      parameters.edgeBoost -= 10;
      parameters.alphaThreshold -= 4;
      if (parameters.alphaLow > 0 || parameters.alphaHigh > 0) {
        parameters.alphaLow -= 8;
        parameters.alphaHigh += 8;
      }
      reasonCodes.push("preserve-subject");
    } else if (hasBackgroundResidue) {
      parameters.connected = false;
      parameters.tolerance = parameters.tolerance < 0 ? 1 : parameters.tolerance + 2;
      parameters.edgeBoost += 10;
      parameters.despillStrength += 10;
      parameters.edgeDespillRadius += 1;
      reasonCodes.push("clean-background");
    }

    if (hasSoftEdge && !hasSubjectDamage) {
      parameters.feather -= 1;
      parameters.chromaFeather -= 8;
      parameters.blurRadius -= 1;
      if (parameters.alphaLow > 0 || parameters.alphaHigh > 0) {
        parameters.alphaLow += 8;
        parameters.alphaHigh -= 8;
      }
      reasonCodes.push("sharpen-edge");
    }

    if (hasTransparentRgb || (hasSubjectDamage && hasBackgroundResidue)) {
      parameters.despillStrength += 10;
      parameters.edgeDespillRadius += 1;
      if (hasTransparentRgb) parameters.edgeRecoveryStrength += 10;
      reasonCodes.push("clean-transparent-color");
    }

    if (!hasSubjectDamage && !hasBackgroundResidue && !hasSoftEdge && !hasTransparentRgb) {
      parameters.tolerance = parameters.tolerance < 0 ? 0 : parameters.tolerance + 1;
      parameters.edgeBoost += 5;
      reasonCodes.push("balanced-exploration");
    }

    let backgroundSamples = cloneValue(options.backgroundSamples || []);
    const seedPoints = cloneValue(options.seedPoints || []);
    const estimatedBackground = options.estimatedBackground;
    if (!seedPoints.length && estimatedBackground) {
      const estimatedHex = rgbToHex(estimatedBackground);
      if (estimatedHex !== baseline.backgroundColor) {
        parameters.backgroundColor = estimatedHex;
        backgroundSamples = [
          {
            r: byte(estimatedBackground.r),
            g: byte(estimatedBackground.g),
            b: byte(estimatedBackground.b),
            a: byte(estimatedBackground.a ?? 255),
          },
        ];
        reasonCodes.push("refresh-background");
      }
    }

    return {
      parameters: sessionCore.normalizeProcessingParameters(parameters, baseline),
      backgroundSamples,
      seedPoints,
      reasonCodes,
    };
  }

  /**
   * Lists changed automatic parameters in stable UI order.
   * @param {object} baseline Baseline parameters.
   * @param {object} suggestion Suggested parameters.
   * @returns {Array<{key:string,from:*,to:*}>} Changed fields.
   */
  function diffProcessingParameters(baseline, suggestion) {
    const left = sessionCore.normalizeProcessingParameters(baseline);
    const right = sessionCore.normalizeProcessingParameters(suggestion, left);
    return PARAMETER_ORDER.flatMap((key) =>
      left[key] === right[key] ? [] : [{ key, from: left[key], to: right[key] }],
    );
  }

  return Object.freeze({ createSuggestedCandidate, diffProcessingParameters });
});
