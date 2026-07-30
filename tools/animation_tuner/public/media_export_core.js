(function attachMediaExportCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MediaExportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DEFAULT_MAX_TEXTURE_SIZE = 8192;

  /** Produces a filesystem-safe stem. @param {unknown} value Candidate name. */
  function safeStem(value) {
    const stem = String(value || "animation")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 96);
    return stem && !/^\.{1,2}$/.test(stem) ? stem : "animation";
  }

  /**
   * Creates a page-aware row-major sprite-sheet plan.
   * @param {Array<{width:number,height:number,name?:string}>} frames Ordered frames.
   * @param {{maxTextureSize?:number}} [options] Packing constraints.
   */
  function planSpriteSheets(frames, options = {}) {
    if (!Array.isArray(frames) || !frames.length) throw new Error("Sprite sheet requires frames.");
    const requestedTextureSize = Math.floor(Number(options.maxTextureSize) || DEFAULT_MAX_TEXTURE_SIZE);
    const maxTextureSize = Math.min(DEFAULT_MAX_TEXTURE_SIZE, Math.max(1, requestedTextureSize));
    const dimensions = frames.map((frame) => ({
      width: Math.floor(Number(frame?.width)),
      height: Math.floor(Number(frame?.height)),
    }));
    if (
      dimensions.some(
        ({ width, height }) =>
          !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0,
      )
    ) {
      throw new Error("Sprite sheet frame dimensions are invalid.");
    }
    const cellWidth = Math.max(...dimensions.map(({ width }) => width));
    const cellHeight = Math.max(...dimensions.map(({ height }) => height));
    if (cellWidth > maxTextureSize || cellHeight > maxTextureSize) {
      throw new Error(`A frame exceeds the ${maxTextureSize}px sprite-sheet limit.`);
    }
    const maximumColumns = Math.max(1, Math.floor(maxTextureSize / cellWidth));
    const maximumRows = Math.max(1, Math.floor(maxTextureSize / cellHeight));
    const pageCapacity = maximumColumns * maximumRows;
    const pages = [];
    const placements = [];
    for (let start = 0; start < frames.length; start += pageCapacity) {
      const pageFrames = frames.slice(start, start + pageCapacity);
      const columns = Math.min(maximumColumns, pageFrames.length);
      const rows = Math.ceil(pageFrames.length / columns);
      const pageIndex = pages.length;
      pages.push({
        index: pageIndex,
        start,
        count: pageFrames.length,
        columns,
        rows,
        width: columns * cellWidth,
        height: rows * cellHeight,
      });
      pageFrames.forEach((frame, localIndex) => {
        const dimension = dimensions[start + localIndex];
        placements.push({
          index: start + localIndex,
          page: pageIndex,
          x: (localIndex % columns) * cellWidth,
          y: Math.floor(localIndex / columns) * cellHeight,
          width: dimension.width,
          height: dimension.height,
          cellWidth,
          cellHeight,
          sourceName: String(frame.name || ""),
        });
      });
    }
    return Object.freeze({ cellWidth, cellHeight, maxTextureSize, pages, placements });
  }

  /**
   * Creates per-frame timing metadata shared by PNG and sheet exports.
   * @param {object} metadata Animation metadata.
   * @param {Array<{name?:string}>} frames Ordered frames.
   */
  function createFramesManifest(metadata, frames) {
    const fps = Math.max(1, Math.min(120, Number(metadata?.fps) || 12));
    const frameDurationMs = Math.round(1000 / fps);
    return {
      schemaVersion: 1,
      generator: "XSXB Frame Tuner",
      animation: String(metadata?.animationName || "animation"),
      fps,
      frameDurationMs,
      totalDurationMs: frameDurationMs * frames.length,
      frames: frames.map((frame, index) => ({
        index,
        file: `frames/frame_${String(index + 1).padStart(4, "0")}.png`,
        sourceName: String(frame?.name || ""),
        durationMs: frameDurationMs,
      })),
    };
  }

  /**
   * Creates atlas metadata for one or more sprite-sheet pages.
   * @param {object} metadata Animation metadata.
   * @param {ReturnType<typeof planSpriteSheets>} plan Packing plan.
   */
  function createAtlasManifest(metadata, plan) {
    const stem = safeStem(metadata?.animationName);
    const fps = Math.max(1, Math.min(120, Number(metadata?.fps) || 12));
    const padded = plan.pages.length > 1;
    return {
      schemaVersion: 1,
      generator: "XSXB Frame Tuner",
      animation: String(metadata?.animationName || "animation"),
      fps,
      frameDurationMs: Math.round(1000 / fps),
      cell: { width: plan.cellWidth, height: plan.cellHeight },
      sheets: plan.pages.map((page) => ({
        index: page.index,
        file: padded
          ? `spritesheets/${stem}_${String(page.index + 1).padStart(3, "0")}.png`
          : `spritesheets/${stem}.png`,
        width: page.width,
        height: page.height,
        columns: page.columns,
        rows: page.rows,
      })),
      frames: plan.placements,
    };
  }

  /**
   * Converts a canvas to PNG without relying on a data-URL allocation.
   * @param {HTMLCanvasElement} canvas Source canvas.
   * @returns {Promise<Blob>}
   */
  function canvasPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Canvas PNG encoding failed."))),
        "image/png",
      );
    });
  }

  /** Throws a consistent error when an in-browser export was cancelled. */
  function throwIfCancelled(signal) {
    if (!signal?.aborted) return;
    const error = new Error("Export cancelled.");
    error.name = "AbortError";
    throw error;
  }

  /**
   * Renders planned pages with top-left frame alignment so source anchors do not shift.
   * @param {Array<{image:CanvasImageSource,width:number,height:number,name?:string}>} frames Ordered sources.
   * @param {ReturnType<typeof planSpriteSheets>} plan Packing plan.
   * @param {{document?:Document,metadata?:object,signal?:AbortSignal}} [dependencies] DOM adapter, animation metadata, and cancellation signal.
   * @returns {Promise<Array<{name:string,data:Blob}>>}
   */
  async function renderSpriteSheetEntries(frames, plan, dependencies = {}) {
    const documentRef = dependencies.document || globalThis.document;
    if (!documentRef?.createElement) throw new Error("Sprite-sheet canvas is unavailable.");
    const atlas = createAtlasManifest(dependencies.metadata || {}, plan);
    const entries = [];
    for (const page of plan.pages) {
      throwIfCancelled(dependencies.signal);
      const canvas = documentRef.createElement("canvas");
      canvas.width = page.width;
      canvas.height = page.height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Sprite-sheet 2D context is unavailable.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      plan.placements
        .filter((placement) => placement.page === page.index)
        .forEach((placement) => {
          const frame = frames[placement.index];
          context.drawImage(frame.image, placement.x, placement.y, placement.width, placement.height);
        });
      const data = await canvasPngBlob(canvas);
      throwIfCancelled(dependencies.signal);
      entries.push({ name: atlas.sheets[page.index].file, data });
    }
    return entries;
  }

  return Object.freeze({
    DEFAULT_MAX_TEXTURE_SIZE,
    canvasPngBlob,
    createAtlasManifest,
    createFramesManifest,
    planSpriteSheets,
    renderSpriteSheetEntries,
    safeStem,
  });
});
