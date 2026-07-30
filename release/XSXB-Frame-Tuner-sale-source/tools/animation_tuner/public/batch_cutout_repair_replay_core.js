(function attachBatchCutoutRepairReplayCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutRepairReplayCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Identifies automatic-cutout inputs independently from paint and area repairs.
   * @param {object} options Normalized automatic processing options.
   * @returns {string} Stable automatic-result cache identity.
   */
  function automaticCacheKey(options) {
    return JSON.stringify(options);
  }

  /**
   * Replays local repairs over an immutable automatic cutout and derives export statistics.
   * @param {{source:Uint8ClampedArray|Uint8Array,automatic:Uint8ClampedArray|Uint8Array,width:number,height:number,options:object,repairs:Array<object>,applyRepairs:Function}} input Replay dependencies.
   * @returns {{data:Uint8ClampedArray,automaticData:Uint8ClampedArray,removedPixels:number,partialPixels:number}} Replayed product result.
   */
  function replayAutomaticResult(input) {
    const source = input.source;
    const automaticData = new Uint8ClampedArray(input.automatic);
    const data = new Uint8ClampedArray(automaticData);
    input.applyRepairs(
      source,
      data,
      input.width,
      input.height,
      input.options,
      input.repairs || [],
      automaticData,
    );
    let removedPixels = 0;
    let partialPixels = 0;
    for (let offset = 3; offset < data.length; offset += 4) {
      if (source[offset] > 0 && data[offset] === 0) removedPixels += 1;
      else if (data[offset] < source[offset]) partialPixels += 1;
    }
    return { data, automaticData, removedPixels, partialPixels };
  }

  return { automaticCacheKey, replayAutomaticResult };
});
