(function attachFrameSequenceOrder(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameSequenceOrder = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const ORDER_STRATEGIES = Object.freeze({ FILENAME: "filename", SELECTION: "selection" });
  const SOURCE_TYPES = Object.freeze({ MANIFEST: "manifest", IMAGE: "image", VIDEO: "video" });

  /**
   * Normalizes a user-provided image ordering strategy.
   * @param {unknown} value Candidate strategy.
   * @returns {"filename"|"selection"} Supported strategy.
   */
  function normalizeOrderStrategy(value) {
    return value === ORDER_STRATEGIES.SELECTION ? ORDER_STRATEGIES.SELECTION : ORDER_STRATEGIES.FILENAME;
  }

  /**
   * Splits a filename into normalized text and numeric chunks.
   * @param {unknown} value Filename-like value.
   * @returns {string[]} Comparable chunks.
   */
  function naturalNameChunks(value) {
    return (
      String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        .match(/\d+|\D+/g) || [""]
    );
  }

  /**
   * Compares filenames naturally without converting large numeric chunks to unsafe numbers.
   * @param {string} left Left filename.
   * @param {string} right Right filename.
   * @returns {number} Sort comparison result.
   */
  function compareNaturalNames(left, right) {
    const leftChunks = naturalNameChunks(left);
    const rightChunks = naturalNameChunks(right);
    const chunkCount = Math.max(leftChunks.length, rightChunks.length);
    for (let index = 0; index < chunkCount; index += 1) {
      const leftChunk = leftChunks[index];
      const rightChunk = rightChunks[index];
      if (leftChunk === undefined) return -1;
      if (rightChunk === undefined) return 1;
      if (leftChunk === rightChunk) continue;
      const leftNumeric = /^\d+$/.test(leftChunk);
      const rightNumeric = /^\d+$/.test(rightChunk);
      if (leftNumeric && rightNumeric) {
        const leftValue = leftChunk.replace(/^0+(?=\d)/, "");
        const rightValue = rightChunk.replace(/^0+(?=\d)/, "");
        if (leftValue.length !== rightValue.length) return leftValue.length - rightValue.length;
        if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
        if (leftChunk.length !== rightChunk.length) return leftChunk.length - rightChunk.length;
        continue;
      }
      return leftChunk < rightChunk ? -1 : 1;
    }
    return 0;
  }

  /**
   * Decorates a selected image batch with stable selection and filename indexes.
   * @template T
   * @param {T[]} items File-like items in FileList order.
   * @param {(item:T)=>string} [getName] Filename accessor.
   * @returns {Array<{item:T,selectionIndex:number,filenameIndex:number}>} Stable metadata entries.
   */
  function describeImageBatch(items, getName = (item) => String(item?.name || "")) {
    const selected = (Array.isArray(items) ? items : []).map((item, selectionIndex) => ({
      item,
      selectionIndex,
      filenameIndex: -1,
    }));
    selected
      .slice()
      .sort(
        (left, right) =>
          compareNaturalNames(getName(left.item), getName(right.item)) ||
          left.selectionIndex - right.selectionIndex,
      )
      .forEach((entry, filenameIndex) => {
        entry.filenameIndex = filenameIndex;
      });
    return selected;
  }

  /**
   * Orders one image batch without mutating its input or mixing it with other batches.
   * @template T
   * @param {T[]} items File-like items in FileList order.
   * @param {"filename"|"selection"} [strategy] Image ordering strategy.
   * @param {(item:T)=>string} [getName] Filename accessor.
   * @returns {Array<{item:T,selectionIndex:number,filenameIndex:number}>} Ordered entries.
   */
  function orderImageBatch(items, strategy = ORDER_STRATEGIES.FILENAME, getName) {
    const normalizedStrategy = normalizeOrderStrategy(strategy);
    const entries = describeImageBatch(items, getName);
    const key = normalizedStrategy === ORDER_STRATEGIES.SELECTION ? "selectionIndex" : "filenameIndex";
    return entries.slice().sort((left, right) => left[key] - right[key]);
  }

  /**
   * Returns the next stable imported-batch index found in a workset.
   * @param {object[]} frames Organizer frames.
   * @returns {number} Next non-negative batch index.
   */
  function nextImportBatchIndex(frames) {
    return (Array.isArray(frames) ? frames : []).reduce(
      (next, frame) =>
        Number.isInteger(frame?.importBatchIndex) && frame.importBatchIndex >= next
          ? frame.importBatchIndex + 1
          : next,
      0,
    );
  }

  /**
   * Creates normalized frame-order metadata.
   * @param {{sourceType?:string,batchIndex?:number,selectionIndex?:number,filenameIndex?:number}} input Raw metadata.
   * @returns {{sequenceSource:"manifest"|"image"|"video",importBatchIndex:number,importSelectionIndex:number,importFilenameIndex:number}}
   */
  function createFrameOrderMetadata(input = {}) {
    const sourceType = Object.values(SOURCE_TYPES).includes(input.sourceType)
      ? input.sourceType
      : SOURCE_TYPES.MANIFEST;
    const imported = sourceType !== SOURCE_TYPES.MANIFEST;
    const selectionIndex = Number.isInteger(input.selectionIndex) ? input.selectionIndex : 0;
    return {
      sequenceSource: sourceType,
      importBatchIndex: imported && Number.isInteger(input.batchIndex) ? input.batchIndex : -1,
      importSelectionIndex: selectionIndex,
      importFilenameIndex: Number.isInteger(input.filenameIndex) ? input.filenameIndex : selectionIndex,
    };
  }

  /**
   * Restores Manifest frames followed by imported batches and their selected ordering strategy.
   * Video extraction order always wins over filename strategy.
   * @param {object[]} frames Organizer frames in their current grid order.
   * @param {"filename"|"selection"} [strategy] Image ordering strategy.
   * @returns {object[]} Sorted shallow copy.
   */
  function restoreImportOrder(frames, strategy = ORDER_STRATEGIES.FILENAME) {
    const normalizedStrategy = normalizeOrderStrategy(strategy);
    return (Array.isArray(frames) ? frames : [])
      .map((frame, currentIndex) => ({ frame, currentIndex }))
      .sort((leftEntry, rightEntry) => {
        const left = leftEntry.frame || {};
        const right = rightEntry.frame || {};
        const leftImported = left.sequenceSource
          ? left.sequenceSource !== SOURCE_TYPES.MANIFEST
          : Boolean(left.imported);
        const rightImported = right.sequenceSource
          ? right.sequenceSource !== SOURCE_TYPES.MANIFEST
          : Boolean(right.imported);
        if (leftImported !== rightImported) return leftImported ? 1 : -1;
        if (!leftImported) {
          const leftIndex = Number.isInteger(left.sourceIndex)
            ? left.sourceIndex
            : Number.isInteger(left.originalIndex)
              ? left.originalIndex
              : leftEntry.currentIndex;
          const rightIndex = Number.isInteger(right.sourceIndex)
            ? right.sourceIndex
            : Number.isInteger(right.originalIndex)
              ? right.originalIndex
              : rightEntry.currentIndex;
          return leftIndex - rightIndex || leftEntry.currentIndex - rightEntry.currentIndex;
        }
        const batchDifference =
          (Number.isInteger(left.importBatchIndex) ? left.importBatchIndex : leftEntry.currentIndex) -
          (Number.isInteger(right.importBatchIndex) ? right.importBatchIndex : rightEntry.currentIndex);
        if (batchDifference) return batchDifference;
        const leftSelection = Number.isInteger(left.importSelectionIndex)
          ? left.importSelectionIndex
          : leftEntry.currentIndex;
        const rightSelection = Number.isInteger(right.importSelectionIndex)
          ? right.importSelectionIndex
          : rightEntry.currentIndex;
        const useFilename =
          normalizedStrategy === ORDER_STRATEGIES.FILENAME &&
          left.sequenceSource === SOURCE_TYPES.IMAGE &&
          right.sequenceSource === SOURCE_TYPES.IMAGE;
        const leftIndex =
          useFilename && Number.isInteger(left.importFilenameIndex)
            ? left.importFilenameIndex
            : leftSelection;
        const rightIndex =
          useFilename && Number.isInteger(right.importFilenameIndex)
            ? right.importFilenameIndex
            : rightSelection;
        return (
          leftIndex - rightIndex ||
          leftSelection - rightSelection ||
          leftEntry.currentIndex - rightEntry.currentIndex
        );
      })
      .map(({ frame }) => frame);
  }

  return Object.freeze({
    ORDER_STRATEGIES,
    SOURCE_TYPES,
    compareNaturalNames,
    createFrameOrderMetadata,
    describeImageBatch,
    nextImportBatchIndex,
    normalizeOrderStrategy,
    orderImageBatch,
    restoreImportOrder,
  });
});
