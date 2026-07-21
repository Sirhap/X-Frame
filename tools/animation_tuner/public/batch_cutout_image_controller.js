(function attachBatchCutoutImageController(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutImageController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the image-loading and queue-item helper controller.
   *
   * This module deliberately owns only the existing image/item helpers. It
   * does not change image processing, cache keys, repair records, or queue
   * state semantics; those remain injected from the batch controller.
   * @param {object} dependencies Helper dependencies supplied by the batch controller.
   * @param {object} dependencies.state Mutable batch state.
   * @param {Record<string,HTMLElement|null>} dependencies.elements Batch DOM elements.
   * @param {object} dependencies.colorUtils Public display color helpers.
   * @param {object} dependencies.sessionCore Session option/edit helpers.
   * @param {object} dependencies.imagePixelBudget Image pixel-budget evaluator.
   * @param {{maxPixelsPerImage:number,maxTotalPixels:number}} dependencies.imagePixelLimits Pixel limits.
   * @param {()=>object} dependencies.captureProcessingParameters Parameter snapshot callback.
   * @param {(source:CanvasImageSource,currentPixels?:number)=>object} dependencies.assertImagePixelBudget Pixel guard callback.
   * @param {(key:string,variables?:Record<string,string|number>)=>string} dependencies.text Localized text callback.
   * @param {Document} [dependencies.documentRef] Document implementation.
   * @param {typeof Image} [dependencies.imageConstructor] Image constructor.
   * @param {typeof URL} [dependencies.urlRef] URL implementation.
   * @param {object} [dependencies.cryptoRef] Crypto implementation.
   * @returns {object} Image and queue-item helper API.
   */
  function createController(dependencies = {}) {
    const {
      state,
      elements,
      colorUtils,
      sessionCore,
      imagePixelBudget,
      imagePixelLimits,
      captureProcessingParameters,
      assertImagePixelBudget,
      text,
      documentRef = root?.document,
      imageConstructor = root?.Image,
      urlRef = root?.URL,
      cryptoRef = root?.crypto,
    } = dependencies;
    if (
      !state ||
      !elements ||
      !colorUtils ||
      !sessionCore ||
      !imagePixelBudget ||
      !imagePixelLimits ||
      typeof captureProcessingParameters !== "function" ||
      typeof assertImagePixelBudget !== "function" ||
      typeof text !== "function"
    ) {
      throw new TypeError("BatchCutoutImageController dependencies are required.");
    }

    const documentApi = documentRef;
    const ImageClass = imageConstructor;
    const URLApi = urlRef;
    const cryptoApi = cryptoRef;

    /**
     * Converts an image source into source pixels.
     * @param {CanvasImageSource} image Browser image or canvas source.
     * @returns {{canvas:HTMLCanvasElement,context:CanvasRenderingContext2D,imageData:ImageData}}
     */
    function imagePixels(image) {
      const dimensions = assertImagePixelBudget(image);
      const { width, height } = dimensions;
      const canvas = documentApi.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      return { canvas, context, imageData: context.getImageData(0, 0, width, height) };
    }

    /**
     * Loads an image file into a browser image element.
     * @param {File} file Local image file.
     * @returns {Promise<HTMLImageElement>}
     */
    function loadFileImage(file) {
      return new Promise((resolve, reject) => {
        const url = URLApi.createObjectURL(file);
        const image = new ImageClass();
        image.onload = () => {
          URLApi.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URLApi.revokeObjectURL(url);
          reject(new Error(`Cannot read ${file.name}`));
        };
        image.src = url;
      });
    }

    /**
     * Creates a bounded thumbnail URL without retaining a full-resolution data URL.
     * @param {CanvasImageSource} source Source image or canvas.
     * @returns {string}
     */
    function createThumbnailUrl(source) {
      const sourceWidth = Number(source.naturalWidth || source.width || 1);
      const sourceHeight = Number(source.naturalHeight || source.height || 1);
      const scale = Math.min(1, 180 / sourceWidth, 100 / sourceHeight);
      const canvas = documentApi.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    }

    /**
     * Builds a processable queue item.
     * @param {CanvasImageSource} image Source image.
     * @param {string} name Display and export name.
     * @param {object|null} frame Optional current-animation frame.
     * @returns {object}
     */
    function createItem(image, name, frame = null) {
      const pixels = imagePixels(image);
      return {
        id: cryptoApi?.randomUUID?.() || `cutout_${Date.now()}_${Math.random()}`,
        name,
        frame,
        image,
        sourceCanvas: pixels.canvas,
        publishedCanvas: pixels.canvas,
        sourceImageData: pixels.imageData,
        resultCanvas: null,
        statistics: null,
        repairs: [],
        undoneRepairs: [],
        editUndo: [],
        editRedo: [],
        protectedColors: [],
        backgroundSamples: [],
        seedPoints: [],
        automaticImageData: null,
        automaticCacheKey: "",
        resultImageData: null,
        shapeDescriptor: null,
        shapeCandidates: [],
        qualityMetrics: null,
        quality: null,
        diagnosticCanvases: {},
        excluded: false,
        status: "ready",
        error: "",
        sourceThumbnail: createThumbnailUrl(pixels.canvas),
        resultThumbnail: "",
        thumbnailRevision: -1,
        processingActivated: false,
        automaticCutoutActivated: false,
        pendingAutomaticPropagation: false,
        processingParameters: captureProcessingParameters(),
        processingRevision: 0,
        processingPromise: null,
      };
    }

    /** @returns {object|null} The selected queue item. */
    function selectedItem() {
      return state.items[state.selectedIndex] || null;
    }

    /** @param {object|null} [item] Item about to change. @returns {void} */
    function recordItemEdit(item = selectedItem()) {
      if (item) sessionCore.recordItemEdit(item);
    }

    /**
     * Returns the selected FramePacker reference color.
     * @param {object|null} item Queue item.
     * @returns {{r:number,g:number,b:number,hex:string}}
     */
    function selectedBackgroundColor(item = selectedItem()) {
      if (item?.backgroundSamples?.length) {
        const color = item.backgroundSamples[0];
        return { ...color, hex: colorUtils.rgbToHex(color) };
      }
      const parameters = item?.processingParameters || captureProcessingParameters();
      const color = colorUtils.hexToRgb(parameters.backgroundColor || elements.cutoutColor.value);
      return { ...color, a: 255, hex: colorUtils.rgbToHex(color) };
    }

    /**
     * Returns all active background samples for an item.
     * @param {object} item Queue item.
     * @returns {Array<{r:number,g:number,b:number}>}
     */
    function selectedBackgroundColors(item) {
      if (item?.backgroundSamples?.length) return item.backgroundSamples;
      return [selectedBackgroundColor(item)];
    }

    /**
     * Returns deduplicated protected colors with their editable source record.
     * @param {object|null} item Queue item.
     * @returns {Array<{color:object,container:Array<object>,index:number}>}
     */
    function protectedColorEntries(item) {
      if (!item) return [];
      const entries = [];
      const append = (container) => {
        for (const [index, color] of container.entries()) {
          if (entries.some((entry) => colorUtils.colorDistance(color.r, color.g, color.b, entry.color) < 2))
            continue;
          entries.push({ color, container, index });
          if (entries.length >= 32) return;
        }
      };
      append(item.protectedColors || []);
      for (const repair of item.repairs || []) {
        if (repair.mode === "protect-color" && Array.isArray(repair.colors)) append(repair.colors);
        if (entries.length >= 32) break;
      }
      return entries;
    }

    /**
     * Returns the effective manual and propagated protected-color palette.
     * @param {object|null} item Queue item.
     * @returns {Array<object>}
     */
    function effectiveProtectedColors(item) {
      return protectedColorEntries(item).map((entry) => entry.color);
    }

    /**
     * Returns normalized processing options for a queue item.
     * @param {object} item Queue item.
     * @returns {object}
     */
    function processingOptions(item) {
      if (!item.processingParameters) item.processingParameters = captureProcessingParameters();
      return sessionCore.createProcessingOptions(item, {
        backgroundColor: selectedBackgroundColor(item),
        backgroundColors: selectedBackgroundColors(item),
        protectedColors: effectiveProtectedColors(item),
      });
    }

    return {
      imagePixels,
      loadFileImage,
      createThumbnailUrl,
      createItem,
      selectedItem,
      recordItemEdit,
      selectedBackgroundColor,
      selectedBackgroundColors,
      protectedColorEntries,
      effectiveProtectedColors,
      processingOptions,
    };
  }

  return { createController };
});
