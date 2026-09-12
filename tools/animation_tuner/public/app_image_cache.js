(function attachXFrameImageCache(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameImageCache = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const appUtils =
    root?.XFrameAppUtils || (typeof module === "object" && module.exports ? require("./app_utils") : null);

  /**
   * Creates image loading, caching, bounded preloading, and opaque-boundary operations.
   * @param {{
   *   getImageCache?:()=>Map<string,Promise<object>>,
   *   getImageElements?:()=>Map<string,object>,
   *   getOpaqueRectCache?:()=>WeakMap<object,object>,
   *   getConfig?:()=>object|null,
   *   preloadFrameLimit?:number,
   *   preloadConcurrency?:number,
   *   mapWithConcurrency?:(items:object[],mapper:(item:object)=>Promise<object>)=>Promise<object[]>,
   *   assetUrl?:(frame:object)=>string,
   *   status?:(message:string)=>void,
   *   translate?:(key:string,variables?:object)=>string,
   *   imageConstructor?:typeof Image,
   *   documentRef?:Document,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   imageCacheKey:(frame:object)=>string,
   *   cachedImageForFrame:(frame:object)=>object|null,
   *   loadImageCached:(frame:object)=>Promise<object>,
   *   loadImagesBounded:(frames:object[])=>Promise<object[]>,
   *   loadImage:(frame:object)=>Promise<object>,
   *   opaqueRectForImage:(image:object|null)=>object,
   *   startPreloadImages:(priorityGroup?:object|null)=>void,
   * }} Image operations.
   */
  function createController(dependencies = {}) {
    const {
      getImageCache = () => new Map(),
      getImageElements = () => new Map(),
      getOpaqueRectCache = () => new WeakMap(),
      getConfig = () => null,
      preloadFrameLimit = 160,
      preloadConcurrency = 6,
      mapWithConcurrency = async (items, mapper) => Promise.all(items.map(mapper)),
      assetUrl = (frame) => String(frame?.path || ""),
      status = () => {},
      translate = (key) => key,
      imageConstructor = root.Image,
      documentRef = root.document,
    } = dependencies;

    /**
     * Returns a stable cache key preferring an asset hash over a path.
     * Cropped atlas cells must not share the sheet path key.
     * @param {object|null|undefined} frame Frame or attachment descriptor.
     * @returns {string} Image cache key.
     */
    function atlasCacheKey(frame) {
      const hash = String(frame?.assetHash || "");
      if (hash) return `asset:${hash}`;
      return String(frame?.path || "");
    }

    /**
     * Returns a stable cache key preferring an asset hash over a path.
     * @param {object|null|undefined} frame Frame or attachment descriptor.
     * @returns {string} Image cache key.
     */
    function imageCacheKey(frame) {
      const base = atlasCacheKey(frame);
      const crop = appUtils?.normalizeFrameCrop?.(frame?.crop);
      if (!crop) return base;
      return `${base}@${crop.x},${crop.y},${crop.width},${crop.height}`;
    }

    /**
     * Returns a decoded image from either its hash or path alias.
     * @param {object|null|undefined} frame Frame descriptor.
     * @returns {object|null} Cached image or null.
     */
    function cachedImageForFrame(frame) {
      const imageElements = getImageElements();
      return imageElements.get(imageCacheKey(frame)) || imageElements.get(String(frame?.path || "")) || null;
    }

    /**
     * Loads one image and resolves only after the browser decoder finishes.
     * @param {object} frame Frame descriptor.
     * @returns {Promise<object>} Decoded image.
     */
    function loadImage(frame) {
      if (typeof imageConstructor !== "function") return Promise.reject(new Error("Image is unavailable."));
      return new Promise((resolve, reject) => {
        const image = new imageConstructor();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = assetUrl(frame);
      });
    }

    /**
     * Decodes one atlas or standalone image once, independent of cell crops.
     * @param {object} frame Frame descriptor.
     * @returns {Promise<object>} Decoded source image.
     */
    function loadAtlasImage(frame) {
      const crop = appUtils?.normalizeFrameCrop?.(frame?.crop);
      if (!crop) return loadImage(frame);
      const atlasKey = `atlas:${atlasCacheKey(frame)}`;
      const imageCache = getImageCache();
      if (!imageCache.has(atlasKey)) imageCache.set(atlasKey, loadImage(frame));
      return imageCache.get(atlasKey);
    }

    /**
     * Loads one image once and shares its promise with all callers.
     * Spritesheet frames are sliced to their crop so consumers receive cells.
     * @param {object} frame Frame descriptor.
     * @returns {Promise<object>} Decoded image.
     */
    function loadImageCached(frame) {
      const key = imageCacheKey(frame);
      const imageCache = getImageCache();
      if (!imageCache.has(key)) {
        const crop = appUtils?.normalizeFrameCrop?.(frame?.crop);
        imageCache.set(
          key,
          loadAtlasImage(frame).then((image) => {
            const cropped = appUtils?.extractFrameCrop
              ? appUtils.extractFrameCrop(image, frame?.crop, documentRef)
              : image;
            const imageElements = getImageElements();
            imageElements.set(key, cropped);
            if (!crop && frame?.path) imageElements.set(String(frame.path), cropped);
            return cropped;
          }),
        );
      }
      return imageCache.get(key);
    }

    /**
     * Loads frames with the shared bounded-concurrency mapper.
     * @param {object[]} frames Frame descriptors.
     * @returns {Promise<object[]>} Ordered decoded images.
     */
    function loadImagesBounded(frames) {
      return mapWithConcurrency(frames, (frame) => loadImageCached(frame));
    }

    /**
     * Preloads a bounded frame set with limited concurrency.
     * @param {object|null} [priorityGroup] Group whose frames are queued first.
     * @returns {void}
     */
    function startPreloadImages(priorityGroup = null) {
      const config = getConfig();
      const paths = new Set((priorityGroup?.frames || []).map((frame) => frame.path));
      for (const group of config?.groups || []) {
        for (const frame of group.frames || []) {
          if (paths.size >= preloadFrameLimit) break;
          paths.add(frame.path);
        }
        if (paths.size >= preloadFrameLimit) break;
      }
      const queue = Array.from(paths);
      let loaded = 0;
      const total = queue.length;
      const worker = async () => {
        while (queue.length) {
          const framePath = queue.shift();
          try {
            await loadImageCached({ path: framePath });
          } catch {
            // Individual missing frames are represented by project warnings.
          }
          loaded += 1;
          if (loaded === total) {
            status(translate("preloadedFrames", { count: total }));
          }
        }
      };
      void Promise.all(Array.from({ length: Math.min(preloadConcurrency, queue.length) }, () => worker()));
    }

    /**
     * Calculates the smallest rectangle containing visible pixels.
     * @param {object|null} image Decoded image.
     * @returns {{x:number,y:number,width:number,height:number}} Opaque rectangle.
     */
    function opaqueRectForImage(image) {
      if (!image) return { x: 0, y: 0, width: 1, height: 1 };
      const opaqueRectCache = getOpaqueRectCache();
      if (opaqueRectCache.has(image)) return opaqueRectCache.get(image);
      if (!documentRef?.createElement) return { x: 0, y: 0, width: image.width, height: image.height };
      const canvas = documentRef.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context?.getImageData) return { x: 0, y: 0, width: image.width, height: image.height };
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const alpha = data[(y * width + x) * 4 + 3];
          if (alpha <= 3) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      const rect =
        maxX >= minX && maxY >= minY
          ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
          : { x: 0, y: 0, width: image.width, height: image.height };
      opaqueRectCache.set(image, rect);
      return rect;
    }

    return {
      cachedImageForFrame,
      imageCacheKey,
      loadImage,
      loadImageCached,
      loadImagesBounded,
      opaqueRectForImage,
      startPreloadImages,
    };
  }

  return { createController };
});
