(function attachMediaExportCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MediaExportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DEFAULT_MAX_TEXTURE_SIZE = 8192;

  /** Rounds a positive size up to the nearest power of two. */
  function nextPowerOfTwo(value) {
    return 2 ** Math.ceil(Math.log2(Math.max(1, Number(value) || 1)));
  }

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
   * @param {{maxTextureSize?:number,columns?:number,gap?:number,fixedPageSize?:boolean,powerOfTwo?:boolean}} [options] Packing constraints.
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
    const gap = Math.max(0, Math.min(256, Math.floor(Number(options.gap) || 0)));
    const maximumColumns = Math.max(1, Math.floor((maxTextureSize + gap) / (cellWidth + gap)));
    const maximumRows = Math.max(1, Math.floor((maxTextureSize + gap) / (cellHeight + gap)));
    const pageCapacity = maximumColumns * maximumRows;
    const pages = [];
    const placements = [];
    for (let start = 0; start < frames.length; start += pageCapacity) {
      const pageFrames = frames.slice(start, start + pageCapacity);
      const requestedColumns = Math.max(0, Math.floor(Number(options.columns) || 0));
      const columns = Math.min(maximumColumns, pageFrames.length, requestedColumns || maximumColumns);
      const rows = Math.ceil(pageFrames.length / columns);
      const pageIndex = pages.length;
      const contentWidth = columns * cellWidth + Math.max(0, columns - 1) * gap;
      const contentHeight = rows * cellHeight + Math.max(0, rows - 1) * gap;
      pages.push({
        index: pageIndex,
        start,
        count: pageFrames.length,
        columns,
        rows,
        width: options.fixedPageSize
          ? maxTextureSize
          : Math.min(maxTextureSize, options.powerOfTwo ? nextPowerOfTwo(contentWidth) : contentWidth),
        height: options.fixedPageSize
          ? maxTextureSize
          : Math.min(maxTextureSize, options.powerOfTwo ? nextPowerOfTwo(contentHeight) : contentHeight),
      });
      pageFrames.forEach((frame, localIndex) => {
        const dimension = dimensions[start + localIndex];
        placements.push({
          index: start + localIndex,
          page: pageIndex,
          x: (localIndex % columns) * (cellWidth + gap),
          y: Math.floor(localIndex / columns) * (cellHeight + gap),
          width: dimension.width,
          height: dimension.height,
          cellWidth,
          cellHeight,
          sourceName: String(frame.name || ""),
          frameId: String(frame.frameId || frame.id || ""),
          assetRevision: Math.max(0, Number(frame.assetRevision) || 0),
        });
      });
    }
    return Object.freeze({ cellWidth, cellHeight, gap, maxTextureSize, pages, placements });
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
      totalDurationMs: frames.reduce(
        (sum, frame) => sum + Math.max(1, Number(frame?.durationMs) || frameDurationMs),
        0,
      ),
      recipe: metadata?.exportRecipe || null,
      frames: frames.map((frame, index) => ({
        index,
        file: `frames/${safeStem(metadata?.exportRecipe?.imageName)}${index + 1}.png`,
        sourceName: String(frame?.name || ""),
        frameId: String(frame?.frameId || frame?.id || ""),
        assetRevision: Math.max(0, Number(frame?.assetRevision) || 0),
        durationMs: Math.max(1, Number(frame?.durationMs) || frameDurationMs),
        crop: frame?.crop || null,
        anchor: metadata?.exportRecipe?.anchor || "bottom-center",
      })),
    };
  }

  /**
   * Creates atlas metadata for one or more sprite-sheet pages.
   * @param {object} metadata Animation metadata.
   * @param {ReturnType<typeof planSpriteSheets>} plan Packing plan.
   */
  function createAtlasManifest(metadata, plan) {
    const stem = safeStem(metadata?.exportRecipe?.imageName || metadata?.animationName);
    const fps = Math.max(1, Math.min(120, Number(metadata?.fps) || 12));
    const padded = plan.pages.length > 1;
    return {
      schemaVersion: 1,
      generator: "XSXB Frame Tuner",
      animation: String(metadata?.animationName || "animation"),
      fps,
      frameDurationMs: Math.round(1000 / fps),
      cell: { width: plan.cellWidth, height: plan.cellHeight, gap: plan.gap || 0 },
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

  /** Creates a self-contained Godot SpriteFrames resource using relative atlas texture paths. */
  function createGodotSpriteFrames(metadata, plan) {
    const atlas = createAtlasManifest(metadata, plan);
    const external = atlas.sheets
      .map(
        (sheet, index) =>
          `[ext_resource type="Texture2D" path="${sheet.file.replace("spritesheets/", "")}" id="${index + 1}"]`,
      )
      .join("\n");
    const subresources = plan.placements
      .map(
        (placement, index) =>
          `[sub_resource type="AtlasTexture" id="AtlasTexture_${index + 1}"]\natlas = ExtResource("${placement.page + 1}")\nregion = Rect2(${placement.x}, ${placement.y}, ${placement.width}, ${placement.height})`,
      )
      .join("\n\n");
    const fps = Math.max(1, Math.min(120, Number(metadata?.fps) || 12));
    const frames = plan.placements
      .map((_, index) => `{ "duration": 1.0, "texture": SubResource("AtlasTexture_${index + 1}") }`)
      .join(", ");
    return `; Generated by XSXB Frame Tuner\n[gd_resource type="SpriteFrames" load_steps="${plan.pages.length + plan.placements.length + 1}" format=3]\n\n${external}\n\n${subresources}\n\n[resource]\nanimations = [{\n"frames": [${frames}],\n"loop": true,\n"name": &"${String(metadata?.animationName || "animation").replace(/"/g, "_")}",\n"speed": ${fps}\n}]\n`;
  }

  /** Creates a Unity-oriented TexturePacker-style JSON description. */
  function createUnityTpsheet(metadata, plan) {
    const atlas = createAtlasManifest(metadata, plan);
    return {
      frames: Object.fromEntries(
        plan.placements.map((placement, index) => [
          `${safeStem(metadata?.exportRecipe?.imageName)}${index + 1}.png`,
          {
            frame: { x: placement.x, y: placement.y, w: placement.width, h: placement.height },
            rotated: false,
            trimmed: false,
            spriteSourceSize: { x: 0, y: 0, w: placement.width, h: placement.height },
            sourceSize: { w: placement.width, h: placement.height },
            page: placement.page,
          },
        ]),
      ),
      meta: { app: "XSXB Frame Tuner", image: atlas.sheets.map((sheet) => sheet.file), format: "RGBA8888" },
    };
  }

  /** Creates a compact Apple plist atlas description. */
  function createPlistAtlas(metadata, plan) {
    const escapeXml = (value) =>
      String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const name = safeStem(metadata?.exportRecipe?.imageName || metadata?.animationName);
    const frames = plan.placements
      .map(
        (placement, index) =>
          `<key>${escapeXml(`${name}${index + 1}.png`)}</key><dict><key>frame</key><string>{{${placement.x},${placement.y}},{${placement.width},${placement.height}}}</string><key>offset</key><string>{0,0}</string><key>rotated</key><false/><key>sourceColorRect</key><string>{{0,0},{${placement.width},${placement.height}}}</string><key>sourceSize</key><string>{${placement.width},${placement.height}}</string><key>page</key><integer>${placement.page}</integer></dict>`,
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>frames</key><dict>${frames}</dict><key>metadata</key><dict><key>format</key><integer>3</integer><key>realTextureFileName</key><string>${escapeXml(name)}.png</string></dict></dict></plist>`;
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
      if (dependencies.metadata?.exportRecipe?.sheetQuality === "png8") {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
          pixels.data[index] &= 0xe0;
          pixels.data[index + 1] &= 0xe0;
          pixels.data[index + 2] &= 0xc0;
        }
        context.putImageData(pixels, 0, 0);
      }
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
    createGodotSpriteFrames,
    createPlistAtlas,
    createUnityTpsheet,
    createFramesManifest,
    planSpriteSheets,
    nextPowerOfTwo,
    renderSpriteSheetEntries,
    safeStem,
  });
});
