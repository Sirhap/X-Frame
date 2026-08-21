(function attachExportRecipeCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ExportRecipeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const MAX_CANVAS = 8192;
  const PRESETS = Object.freeze({
    pixel: { interpolation: "nearest", canvasMode: "union", padding: 2, extrude: 1 },
    atlas: { interpolation: "smooth", canvasMode: "union", padding: 2, extrude: 1 },
    transparentVideo: { background: "transparent", canvasMode: "union", padding: 0 },
    socialMp4: {
      background: "color",
      backgroundColor: "#000000",
      canvasMode: "custom",
      width: 1080,
      height: 1080,
    },
  });

  /** Returns a bounded integer. */
  const integer = (value, fallback, minimum = 0, maximum = MAX_CANVAS) => {
    const number = Number(value);
    return Math.min(maximum, Math.max(minimum, Math.round(Number.isFinite(number) ? number : fallback)));
  };

  /** Creates the non-persistent settings for one export. */
  function createDefaultRecipe() {
    return {
      preset: "atlas",
      canvasMode: "union",
      width: 512,
      height: 512,
      fit: "contain",
      scaleX: 100,
      scaleY: 100,
      anchor: "bottom-center",
      offsetX: 0,
      offsetY: 0,
      trim: "union",
      alphaThreshold: 1,
      padding: 2,
      extrude: 1,
      interpolation: "smooth",
      background: "transparent",
      backgroundColor: "#f0f0f0",
      opacity: 100,
      brightness: 100,
      contrast: 100,
      saturation: 100,
      hue: 0,
      edgeFix: "none",
      timing: "keep",
      speed: 1,
      sheetColumns: 0,
      sheetGap: 0,
      maxTextureSize: 2048,
      sheetFixedSize: true,
      sheetPowerOfTwo: false,
      outputName: "animation",
      imageName: "animation",
      sheetQuality: "png32",
      metadataJson: true,
      metadataGodot: false,
      metadataUnity: false,
      metadataPlist: false,
      gifLoop: true,
      gifFps: 12,
      gifAlphaThreshold: 128,
      gifPalette: "stable",
      gifDenoise: "standard",
      gifCompression: "light",
      gifSoften: "off",
      mp4Fps: 30,
      mp4Quality: "medium",
      outputFormat: "spritesheet",
      gifQuality: "balanced",
    };
  }

  /** Validates a partial recipe and returns a safe serializable value. */
  function normalizeRecipe(value = {}) {
    const base = createDefaultRecipe();
    const recipe = { ...base, ...(value || {}) };
    recipe.canvasMode = ["original", "union", "custom"].includes(recipe.canvasMode)
      ? recipe.canvasMode
      : base.canvasMode;
    recipe.fit = ["contain", "cover", "stretch"].includes(recipe.fit) ? recipe.fit : base.fit;
    recipe.anchor = ["bottom-center", "center", "custom"].includes(recipe.anchor)
      ? recipe.anchor
      : base.anchor;
    recipe.trim = ["none", "union"].includes(recipe.trim) ? recipe.trim : base.trim;
    recipe.interpolation = recipe.interpolation === "nearest" ? "nearest" : "smooth";
    recipe.background = ["color", "transparent", "edge"].includes(recipe.background)
      ? recipe.background
      : base.background;
    recipe.edgeFix = ["none", "black", "white"].includes(recipe.edgeFix) ? recipe.edgeFix : "none";
    recipe.timing = recipe.timing === "speed" ? "speed" : "keep";
    recipe.width = integer(recipe.width, base.width, 1);
    recipe.height = integer(recipe.height, base.height, 1);
    recipe.padding = integer(recipe.padding, base.padding, 0, 256);
    recipe.extrude = integer(recipe.extrude, base.extrude, 0, 32);
    recipe.alphaThreshold = integer(recipe.alphaThreshold, base.alphaThreshold, 0, 255);
    recipe.offsetX = integer(recipe.offsetX, 0, -MAX_CANVAS, MAX_CANVAS);
    recipe.offsetY = integer(recipe.offsetY, 0, -MAX_CANVAS, MAX_CANVAS);
    recipe.scaleX = integer(recipe.scaleX, 100, 1, 300);
    recipe.scaleY = integer(recipe.scaleY, 100, 1, 300);
    recipe.opacity = integer(recipe.opacity, 100, 0, 100);
    recipe.brightness = integer(recipe.brightness, 100, 0, 300);
    recipe.contrast = integer(recipe.contrast, 100, 0, 300);
    recipe.saturation = integer(recipe.saturation, 100, 0, 300);
    recipe.hue = integer(recipe.hue, 0, -180, 180);
    recipe.speed = Math.min(2, Math.max(0.5, Number(recipe.speed) || 1));
    recipe.sheetColumns = integer(recipe.sheetColumns, 0, 0, 256);
    recipe.sheetGap = integer(recipe.sheetGap, 0, 0, 256);
    recipe.maxTextureSize = integer(recipe.maxTextureSize, base.maxTextureSize, 1, MAX_CANVAS);
    recipe.sheetFixedSize = recipe.sheetFixedSize === true;
    recipe.sheetPowerOfTwo = recipe.sheetPowerOfTwo === true;
    recipe.sheetQuality = recipe.sheetQuality === "png8" ? "png8" : "png32";
    recipe.metadataJson = recipe.metadataJson !== false;
    recipe.metadataGodot = recipe.metadataGodot === true;
    recipe.metadataUnity = recipe.metadataUnity === true;
    recipe.metadataPlist = recipe.metadataPlist === true;
    recipe.gifLoop = recipe.gifLoop !== false;
    recipe.gifFps = integer(recipe.gifFps, 12, 1, 50);
    recipe.gifAlphaThreshold = integer(recipe.gifAlphaThreshold, 128, 1, 255);
    recipe.gifPalette = ["default", "stable", "scene"].includes(recipe.gifPalette)
      ? recipe.gifPalette
      : "stable";
    recipe.gifDenoise = ["none", "light", "standard", "strong", "extreme"].includes(recipe.gifDenoise)
      ? recipe.gifDenoise
      : "standard";
    recipe.gifCompression = ["off", "light", "standard", "strong", "extreme"].includes(recipe.gifCompression)
      ? recipe.gifCompression
      : "light";
    recipe.gifSoften = ["off", "auto", "force"].includes(recipe.gifSoften) ? recipe.gifSoften : "off";
    recipe.mp4Fps = integer(recipe.mp4Fps, 30, 1, 60);
    recipe.mp4Quality = ["low", "medium", "high"].includes(recipe.mp4Quality) ? recipe.mp4Quality : "medium";
    recipe.outputFormat = ["frames", "spritesheet", "gif", "mp4"].includes(recipe.outputFormat)
      ? recipe.outputFormat
      : "spritesheet";
    recipe.outputName = String(recipe.outputName || "animation").slice(0, 96);
    recipe.imageName = String(recipe.imageName || recipe.outputName || "animation").slice(0, 96);
    return recipe;
  }

  /** Extends the source edge pixels into unused canvas space. */
  function drawEdgeFill(context, image, crop, destination, canvasWidth, canvasHeight) {
    const x = Math.round(destination.x);
    const y = Math.round(destination.y);
    const width = Math.max(1, Math.round(destination.width));
    const height = Math.max(1, Math.round(destination.height));
    const right = x + width;
    const bottom = y + height;
    if (x > 0) context.drawImage(image, crop.x, crop.y, 1, crop.height, 0, y, x, height);
    if (right < canvasWidth)
      context.drawImage(
        image,
        crop.x + crop.width - 1,
        crop.y,
        1,
        crop.height,
        right,
        y,
        canvasWidth - right,
        height,
      );
    if (y > 0) context.drawImage(image, crop.x, crop.y, crop.width, 1, x, 0, width, y);
    if (bottom < canvasHeight)
      context.drawImage(
        image,
        crop.x,
        crop.y + crop.height - 1,
        crop.width,
        1,
        x,
        bottom,
        width,
        canvasHeight - bottom,
      );
    if (x > 0 && y > 0) context.drawImage(image, crop.x, crop.y, 1, 1, 0, 0, x, y);
    if (right < canvasWidth && y > 0)
      context.drawImage(image, crop.x + crop.width - 1, crop.y, 1, 1, right, 0, canvasWidth - right, y);
    if (x > 0 && bottom < canvasHeight)
      context.drawImage(image, crop.x, crop.y + crop.height - 1, 1, 1, 0, bottom, x, canvasHeight - bottom);
    if (right < canvasWidth && bottom < canvasHeight)
      context.drawImage(
        image,
        crop.x + crop.width - 1,
        crop.y + crop.height - 1,
        1,
        1,
        right,
        bottom,
        canvasWidth - right,
        canvasHeight - bottom,
      );
  }

  /** Gets alpha bounds from one canvas/image source. */
  function alphaBounds(image, documentRef, threshold = 1) {
    const canvas = documentRef.createElement("canvas");
    canvas.width = Number(image.width) || 1;
    canvas.height = Number(image.height) || 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Export canvas is unavailable.");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width;
    let top = canvas.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] < threshold) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    return right < left
      ? { x: 0, y: 0, width: canvas.width, height: canvas.height }
      : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }

  /** Computes the stable shared crop used to prevent multi-frame jitter. */
  function unionCrop(items, documentRef, threshold) {
    const bounds = items.map((item) => alphaBounds(item.image, documentRef, threshold));
    return {
      x: Math.min(...bounds.map((entry) => entry.x)),
      y: Math.min(...bounds.map((entry) => entry.y)),
      width:
        Math.max(...bounds.map((entry) => entry.x + entry.width)) -
        Math.min(...bounds.map((entry) => entry.x)),
      height:
        Math.max(...bounds.map((entry) => entry.y + entry.height)) -
        Math.min(...bounds.map((entry) => entry.y)),
    };
  }

  /** Renders every source through one recipe without mutating its pixels. */
  function renderRecipe(items, inputRecipe, dependencies = {}) {
    const documentRef = dependencies.document || globalThis.document;
    if (!documentRef?.createElement || !Array.isArray(items) || !items.length)
      throw new Error("Export frames are required.");
    const recipe = normalizeRecipe(inputRecipe);
    const crop =
      recipe.trim === "union"
        ? unionCrop(items, documentRef, recipe.alphaThreshold)
        : {
            x: 0,
            y: 0,
            width: Math.max(...items.map((item) => item.width || item.image.width)),
            height: Math.max(...items.map((item) => item.height || item.image.height)),
          };
    const sourceWidth =
      recipe.canvasMode === "original"
        ? Math.max(...items.map((item) => item.width || item.image.width))
        : crop.width;
    const sourceHeight =
      recipe.canvasMode === "original"
        ? Math.max(...items.map((item) => item.height || item.image.height))
        : crop.height;
    const targetWidth = recipe.canvasMode === "custom" ? recipe.width : sourceWidth + recipe.padding * 2;
    const targetHeight = recipe.canvasMode === "custom" ? recipe.height : sourceHeight + recipe.padding * 2;
    if (targetWidth > MAX_CANVAS || targetHeight > MAX_CANVAS)
      throw new Error(`Export canvas exceeds ${MAX_CANVAS}px.`);
    const contentWidth = Math.max(1, targetWidth - recipe.padding * 2);
    const contentHeight = Math.max(1, targetHeight - recipe.padding * 2);
    let scaleX = contentWidth / Math.max(1, crop.width);
    let scaleY = contentHeight / Math.max(1, crop.height);
    if (recipe.fit === "contain") scaleX = scaleY = Math.min(scaleX, scaleY);
    if (recipe.fit === "cover") scaleX = scaleY = Math.max(scaleX, scaleY);
    if (recipe.canvasMode !== "custom") scaleX = scaleY = 1;
    const drawWidth = Math.max(1, Math.round(crop.width * scaleX * (recipe.scaleX / 100)));
    const drawHeight = Math.max(1, Math.round(crop.height * scaleY * (recipe.scaleY / 100)));
    const anchorX =
      recipe.anchor === "center"
        ? (targetWidth - drawWidth) / 2
        : recipe.anchor === "custom"
          ? recipe.padding
          : (targetWidth - drawWidth) / 2;
    const anchorY =
      recipe.anchor === "center"
        ? (targetHeight - drawHeight) / 2
        : recipe.anchor === "custom"
          ? recipe.padding
          : targetHeight - recipe.padding - drawHeight;
    return items.map((item, index) => {
      const canvas = documentRef.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Export canvas is unavailable.");
      context.imageSmoothingEnabled = recipe.interpolation !== "nearest";
      if (recipe.background === "color") {
        context.fillStyle = recipe.backgroundColor;
        context.fillRect(0, 0, targetWidth, targetHeight);
      }
      context.filter = `brightness(${recipe.brightness}%) contrast(${recipe.contrast}%) saturate(${recipe.saturation}%) hue-rotate(${recipe.hue}deg)`;
      context.globalAlpha = recipe.opacity / 100;
      const destination = {
        x: anchorX + recipe.offsetX,
        y: anchorY + recipe.offsetY,
        width: drawWidth,
        height: drawHeight,
      };
      if (recipe.background === "edge") {
        drawEdgeFill(context, item.image, crop, destination, targetWidth, targetHeight);
      }
      context.drawImage(
        item.image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        Math.round(destination.x),
        Math.round(destination.y),
        drawWidth,
        drawHeight,
      );
      if (recipe.sheetQuality === "png8" || recipe.outputFormat === "gif") {
        const pixels = context.getImageData(0, 0, targetWidth, targetHeight);
        for (let pixel = 0; pixel < pixels.data.length; pixel += 4) {
          if (recipe.sheetQuality === "png8") {
            pixels.data[pixel] &= 0xe0;
            pixels.data[pixel + 1] &= 0xe0;
            pixels.data[pixel + 2] &= 0xc0;
          }
          if (recipe.outputFormat === "gif") {
            pixels.data[pixel + 3] = pixels.data[pixel + 3] < recipe.gifAlphaThreshold ? 0 : 255;
          }
        }
        context.putImageData(pixels, 0, 0);
      }
      context.filter = "none";
      context.globalAlpha = 1;
      return {
        ...item,
        image: canvas,
        width: targetWidth,
        height: targetHeight,
        data: canvas.toDataURL("image/png"),
        crop,
        exportIndex: index,
        durationMs: Math.max(1, Math.round((Number(item.durationMs) || 1000 / 12) / recipe.speed)),
      };
    });
  }

  return Object.freeze({
    MAX_CANVAS,
    PRESETS,
    alphaBounds,
    createDefaultRecipe,
    drawEdgeFill,
    normalizeRecipe,
    renderRecipe,
    unionCrop,
  });
});
