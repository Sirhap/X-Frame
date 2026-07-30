(function attachXsxbAttachmentSequence(root, factory) {
  "use strict";

  const sequenceOrder =
    root?.FrameSequenceOrder ||
    (typeof module === "object" && module.exports ? require("./frame_sequence_order") : null);
  const api = factory(sequenceOrder);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAttachmentSequence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (sequenceOrder) => {
  "use strict";

  if (!sequenceOrder?.compareNaturalNames) throw new Error("FrameSequenceOrder is required.");
  const { compareNaturalNames } = sequenceOrder;

  /**
   * Returns reusable assets in stable natural filename order.
   * @param {object[]} assets Attachment asset descriptors.
   * @returns {object[]} Sorted shallow copy.
   */
  function sortSequenceAssets(assets) {
    return (Array.isArray(assets) ? assets : [])
      .map((asset, sourceIndex) => ({ asset, sourceIndex }))
      .sort(
        (left, right) =>
          compareNaturalNames(left.asset?.name, right.asset?.name) || left.sourceIndex - right.sourceIndex,
      )
      .map(({ asset }) => asset);
  }

  /** Returns the canvas compatibility for one owner/attachment pair. */
  function canvasCompatibility(ownerFrame, asset) {
    const ownerWidth = Number(ownerFrame?.width || 0);
    const ownerHeight = Number(ownerFrame?.height || 0);
    const assetWidth = Number(asset?.width || 0);
    const assetHeight = Number(asset?.height || 0);
    if (![ownerWidth, ownerHeight, assetWidth, assetHeight].every((value) => value > 0)) {
      return "unknown";
    }
    return ownerWidth === assetWidth && ownerHeight === assetHeight ? "shared" : "mismatch";
  }

  /**
   * Builds a strict one-to-one sequence plan without mutating editor state.
   * @param {{assets?:object[],frameIndexes?:number[],ownerFrames?:object[]}} input Planning input.
   * @returns {{ok:boolean,code:string,assetCount:number,frameCount:number,entries:object[],canvas:object}}
   */
  function buildOneToOneSequencePlan(input = {}) {
    const assets = sortSequenceAssets(input.assets).filter((asset) => asset?.path);
    const frameIndexes = Array.from(
      new Set(
        (Array.isArray(input.frameIndexes) ? input.frameIndexes : [])
          .map(Number)
          .filter((index) => Number.isInteger(index) && index >= 0),
      ),
    ).sort((left, right) => left - right);
    const emptyCanvas = { shared: 0, mismatch: 0, unknown: 0, mode: "unknown" };
    if (!assets.length) {
      return {
        ok: false,
        code: "no_assets",
        assetCount: 0,
        frameCount: frameIndexes.length,
        entries: [],
        canvas: emptyCanvas,
      };
    }
    if (!frameIndexes.length) {
      return {
        ok: false,
        code: "no_frames",
        assetCount: assets.length,
        frameCount: 0,
        entries: [],
        canvas: emptyCanvas,
      };
    }
    if (assets.length !== frameIndexes.length) {
      return {
        ok: false,
        code: "count_mismatch",
        assetCount: assets.length,
        frameCount: frameIndexes.length,
        entries: [],
        canvas: emptyCanvas,
      };
    }

    const ownerFrames = Array.isArray(input.ownerFrames) ? input.ownerFrames : [];
    const entries = frameIndexes.map((frameIndex, sequenceIndex) => {
      const asset = assets[sequenceIndex];
      return {
        sequenceIndex,
        frameIndex,
        ownerFrame: ownerFrames[frameIndex] || null,
        asset,
        canvasCompatibility: canvasCompatibility(ownerFrames[frameIndex], asset),
        transform: { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 },
      };
    });
    const canvas = entries.reduce(
      (summary, entry) => {
        summary[entry.canvasCompatibility] += 1;
        return summary;
      },
      { shared: 0, mismatch: 0, unknown: 0 },
    );
    canvas.mode = canvas.shared === entries.length ? "shared" : canvas.mismatch ? "review" : "unknown";
    return {
      ok: true,
      code: "ready",
      assetCount: assets.length,
      frameCount: frameIndexes.length,
      entries,
      canvas,
    };
  }

  return Object.freeze({ buildOneToOneSequencePlan, compareNaturalNames, sortSequenceAssets });
});
