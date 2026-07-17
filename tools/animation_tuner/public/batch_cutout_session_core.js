(function attachBatchCutoutSessionCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BatchCutoutSessionCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const NUMERIC_CONTROLS = Object.freeze([
    ["cutoutTolerance", "cutoutToleranceValue", "tolerance"],
    ["cutoutFeather", "cutoutFeatherValue", "feather"],
    ["cutoutAlphaThreshold", "cutoutAlphaValue", "alphaThreshold"],
    ["cutoutChromaFeather", "cutoutChromaFeatherValue", "chromaFeather"],
    ["cutoutEdgeBoost", "cutoutEdgeBoostValue", "edgeBoost"],
    ["cutoutBlendStrength", "cutoutBlendStrengthValue", "blendStrength"],
    ["cutoutAlphaLow", "cutoutAlphaLowValue", "alphaLow"],
    ["cutoutAlphaHigh", "cutoutAlphaHighValue", "alphaHigh"],
    ["cutoutDespillStrength", "cutoutDespillStrengthValue", "despillStrength"],
    ["cutoutEdgeDespillRadius", "cutoutEdgeDespillRadiusValue", "edgeDespillRadius"],
    ["cutoutEdgeRecoveryStrength", "cutoutEdgeRecoveryStrengthValue", "edgeRecoveryStrength"],
    ["cutoutBackgroundRadius", "cutoutBackgroundRadiusValue", "backgroundRadius"],
    ["cutoutBlurRadius", "cutoutBlurRadiusValue", "blurRadius"],
    ["cutoutProtectionTolerance", "cutoutProtectionToleranceValue", "protectionTolerance"],
  ]);
  const PROPAGATION_FIELDS = Object.freeze([
    "repairs",
    "undoneRepairs",
    "protectedColors",
    "backgroundSamples",
    "seedPoints",
    "processingParameters",
    "processingActivated",
    "automaticCutoutActivated",
    "pendingAutomaticPropagation",
  ]);

  /**
   * Clones logical session values without copying Canvas or ImageData instances.
   * @param {*} value Serializable repair or parameter value.
   * @returns {*} Independent clone.
   */
  function cloneSessionValue(value) {
    if (Array.isArray(value)) return value.map(cloneSessionValue);
    if (ArrayBuffer.isView(value)) return value.slice();
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneSessionValue(entry)]));
  }

  /**
   * Captures logical item state for a reversible apply-to-all transaction.
   * @param {object[]} items Session items.
   * @returns {Array<{item:object,state:object}>} In-memory transaction snapshot.
   */
  function captureItems(items) {
    return Array.from(items || []).map((item) => ({
      item,
      state: Object.fromEntries(PROPAGATION_FIELDS.map((field) => [field, cloneSessionValue(item[field])])),
    }));
  }

  /**
   * Restores a transaction snapshot and invalidates every restored result.
   * @param {Array<{item:object,state:object}>} snapshot Transaction snapshot.
   * @returns {void}
   */
  function restoreItems(snapshot) {
    for (const entry of snapshot || []) {
      for (const field of PROPAGATION_FIELDS) {
        entry.item[field] = cloneSessionValue(entry.state[field]);
      }
      resetItemProcessing(entry.item);
    }
  }

  /**
   * Ensures the DOM adapter exposes every required processing control.
   * @param {object} elements Cutout DOM adapter.
   * @returns {void}
   * @throws {TypeError} When a required control is missing.
   */
  function assertControls(elements) {
    const required = [
      "cutoutAutoColor",
      "cutoutColor",
      "cutoutConnected",
      "cutoutPerceptual",
      "cutoutDespillMode",
      ...NUMERIC_CONTROLS.flatMap(([inputKey, outputKey]) => [inputKey, outputKey]),
    ];
    const missing = required.filter((key) => !elements?.[key]);
    if (missing.length) throw new TypeError(`Missing cutout controls: ${missing.join(", ")}`);
  }

  /**
   * Captures automatic-cutout controls as a serializable per-image snapshot.
   * @param {object} elements Cutout DOM adapter.
   * @returns {object} Normalized processing parameters.
   */
  function captureProcessingParameters(elements) {
    assertControls(elements);
    const parameters = {
      autoColor: Boolean(elements.cutoutAutoColor.checked),
      backgroundColor: String(elements.cutoutColor.value || "#ffffff"),
      connected: Boolean(elements.cutoutConnected.checked),
      perceptual: Boolean(elements.cutoutPerceptual.checked),
      despillMode: String(elements.cutoutDespillMode.value || "general"),
    };
    for (const [inputKey, , parameterKey] of NUMERIC_CONTROLS) {
      parameters[parameterKey] = Number(elements[inputKey].value);
    }
    return parameters;
  }

  /**
   * Restores a processing snapshot through the DOM adapter without emitting input events.
   * @param {object} elements Cutout DOM adapter.
   * @param {object|null|undefined} parameters Stored processing parameters.
   * @param {{syncNumericRange?:(input:object,output:object)=>void,onApplied?:()=>void}} [adapter] UI synchronization adapter.
   * @returns {void}
   */
  function applyProcessingParameters(elements, parameters, adapter = {}) {
    if (!parameters) return;
    assertControls(elements);
    elements.cutoutAutoColor.checked = Boolean(parameters.autoColor);
    elements.cutoutColor.value = String(parameters.backgroundColor || "#ffffff");
    elements.cutoutColor.disabled = elements.cutoutAutoColor.checked;
    elements.cutoutConnected.checked = Boolean(parameters.connected);
    elements.cutoutPerceptual.checked = Boolean(parameters.perceptual);
    elements.cutoutDespillMode.value = String(parameters.despillMode || "general");
    for (const [inputKey, outputKey, parameterKey] of NUMERIC_CONTROLS) {
      const value = Number(parameters[parameterKey]);
      if (Number.isFinite(value)) elements[inputKey].value = String(value);
      adapter.syncNumericRange?.(elements[inputKey], elements[outputKey]);
    }
    adapter.onApplied?.();
  }

  /**
   * Creates normalized worker options from one item's processing snapshot.
   * @param {object} item Queue item.
   * @param {{backgroundColor:object,backgroundColors:object[],protectedColors:object[]}} palettes Resolved per-image colors.
   * @returns {object} Worker processing options.
   */
  function createProcessingOptions(item, palettes) {
    const parameters = item?.processingParameters;
    if (!parameters) throw new TypeError("Cutout item has no processing parameter snapshot.");
    return {
      backgroundColor: palettes.backgroundColor,
      backgroundColors: palettes.backgroundColors,
      tolerance: parameters.tolerance,
      feather: parameters.feather,
      alphaThreshold: parameters.alphaThreshold,
      connected: parameters.connected,
      perceptual: parameters.perceptual,
      referenceChromaKey: !parameters.perceptual,
      chromaFeather: parameters.chromaFeather,
      seedPoints: item.seedPoints || [],
      edgeBoost: parameters.edgeBoost,
      blendStrength: parameters.blendStrength,
      alphaLow: Math.min(parameters.alphaLow, parameters.alphaHigh),
      alphaHigh: Math.max(parameters.alphaLow, parameters.alphaHigh),
      despillStrength: parameters.despillStrength,
      despillMode: parameters.despillMode,
      edgeDespillRadius: parameters.edgeDespillRadius,
      edgeRecoveryStrength: parameters.edgeRecoveryStrength,
      edgeRecoveryTolerance: 0,
      backgroundRadius: parameters.backgroundRadius,
      blurRadius: parameters.blurRadius,
      protectedColors: palettes.protectedColors,
      protectionTolerance: parameters.protectionTolerance,
      automaticCutout: Boolean(item.automaticCutoutActivated),
    };
  }

  /**
   * Clears one item's derived processing caches while retaining source data and edits.
   * @param {object|null} item Queue item.
   * @returns {void}
   */
  function resetItemProcessing(item) {
    if (!item) return;
    item.processingRevision = Number(item.processingRevision || 0) + 1;
    item.processingPromise = null;
    item.status = "ready";
    item.error = "";
    item.resultCanvas = null;
    item.resultImageData = null;
    item.resultThumbnail = "";
    item.thumbnailRevision = -1;
    item.qualityMetrics = null;
    item.quality = null;
    item.diagnosticCanvases = {};
  }

  /**
   * Copies one source image's automatic-cutout settings to every session item.
   * Manual background colors are copied; automatic mode keeps per-image detection.
   * @param {object[]} items Session items.
   * @param {object} sourceItem Selected source item.
   * @returns {number} Number of updated items.
   */
  function propagateAutomaticProcessing(items, sourceItem) {
    if (!sourceItem?.processingParameters) {
      throw new TypeError("Automatic propagation requires a source parameter snapshot.");
    }
    beginPropagation(items, sourceItem);
    const sourceParameters = sourceItem.processingParameters;
    const useAutomaticColor = Boolean(sourceParameters.autoColor);
    const sourceSamples = (sourceItem.backgroundSamples || []).map((color) => ({ ...color }));
    for (const item of items || []) {
      item.processingParameters = { ...sourceParameters };
      item.automaticCutoutActivated = true;
      item.processingActivated = true;
      item.pendingAutomaticPropagation = false;
      if (!useAutomaticColor) {
        item.backgroundSamples = sourceSamples.map((color) => ({ ...color }));
        item.seedPoints = [];
      } else if (item !== sourceItem) {
        item.backgroundSamples = [];
        item.seedPoints = [];
      }
      resetItemProcessing(item);
    }
    return Array.isArray(items) ? items.length : 0;
  }

  /**
   * Starts a reversible apply-to-all transaction on the source item.
   * @param {object[]} items Session items.
   * @param {object} sourceItem Selected source item.
   * @returns {void}
   */
  function beginPropagation(items, sourceItem) {
    if (!sourceItem) throw new TypeError("Propagation requires a source item.");
    sourceItem.propagationUndo = {
      snapshot: captureItems(items),
      repairCount: sourceItem.repairs?.length || 0,
    };
    sourceItem.propagationRedo = null;
  }

  /**
   * Restores the state preceding the latest apply-to-all transaction.
   * @param {object[]} items Session items.
   * @param {object} sourceItem Selected source item.
   * @returns {boolean} Whether a transaction was restored.
   */
  function undoPropagation(items, sourceItem) {
    const transaction = sourceItem?.propagationUndo;
    if (!transaction || (sourceItem.repairs?.length || 0) > transaction.repairCount) return false;
    const redoSnapshot = captureItems(items);
    restoreItems(transaction.snapshot);
    sourceItem.propagationUndo = null;
    sourceItem.propagationRedo = { snapshot: redoSnapshot };
    return true;
  }

  /**
   * Reapplies the most recently undone apply-to-all transaction.
   * @param {object[]} items Session items.
   * @param {object} sourceItem Selected source item.
   * @returns {boolean} Whether a transaction was reapplied.
   */
  function redoPropagation(items, sourceItem) {
    const transaction = sourceItem?.propagationRedo;
    if (!transaction) return false;
    const undoSnapshot = captureItems(items);
    restoreItems(transaction.snapshot);
    sourceItem.propagationUndo = {
      snapshot: undoSnapshot,
      repairCount: sourceItem.repairs?.length || 0,
    };
    sourceItem.propagationRedo = null;
    return true;
  }

  /**
   * Undoes the latest local edit or apply-to-all transaction in user-visible order.
   * @param {object[]} items Session items.
   * @param {object} sourceItem Selected source item.
   * @returns {{changed:boolean,live:boolean}} Undo result and live-publish requirement.
   */
  function undoEdit(items, sourceItem) {
    if (undoPropagation(items, sourceItem)) return { changed: true, live: true };
    const repair = sourceItem?.repairs?.pop();
    if (!repair) return { changed: false, live: false };
    sourceItem.undoneRepairs.push(repair);
    resetItemProcessing(sourceItem);
    return { changed: true, live: Boolean(sourceItem.propagationRedo) };
  }

  /**
   * Redoes local edits before reapplying a later apply-to-all transaction.
   * @param {object[]} items Session items.
   * @param {object} sourceItem Selected source item.
   * @returns {{changed:boolean,live:boolean}} Redo result and live-publish requirement.
   */
  function redoEdit(items, sourceItem) {
    const repair = sourceItem?.undoneRepairs?.pop();
    if (repair) {
      sourceItem.repairs.push(repair);
      resetItemProcessing(sourceItem);
      return { changed: true, live: Boolean(sourceItem.propagationRedo) };
    }
    return redoPropagation(items, sourceItem)
      ? { changed: true, live: true }
      : { changed: false, live: false };
  }

  return Object.freeze({
    applyProcessingParameters,
    beginPropagation,
    captureProcessingParameters,
    createProcessingOptions,
    propagateAutomaticProcessing,
    redoEdit,
    redoPropagation,
    resetItemProcessing,
    undoEdit,
    undoPropagation,
  });
});
