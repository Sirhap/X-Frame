(function attachImagePixelBudget(root) {
  "use strict";

  const DEFAULT_LIMITS = Object.freeze({
    maxPixelsPerImage: 16_777_216,
    maxTotalPixels: 64_000_000,
  });

  /**
   * Reads normalized dimensions and pixel count from a browser image source.
   * @param {CanvasImageSource} source Browser image or canvas source.
   * @returns {{width:number,height:number,pixels:number}} Normalized dimensions.
   */
  function measure(source) {
    const width = Math.max(0, Number(source?.naturalWidth || source?.videoWidth || source?.width || 0));
    const height = Math.max(0, Number(source?.naturalHeight || source?.videoHeight || source?.height || 0));
    return { width, height, pixels: width * height };
  }

  /**
   * Evaluates one image before allocating a canvas or ImageData buffer.
   * @param {CanvasImageSource} source Browser image or canvas source.
   * @param {number} currentPixels Pixels already retained by the caller.
   * @param {{maxPixelsPerImage?:number,maxTotalPixels?:number}} [limits] Memory limits.
   * @returns {{allowed:boolean,reason:""|"unreadable"|"single"|"total",width:number,height:number,pixels:number,totalPixels:number,limit:number}}
   */
  function evaluate(source, currentPixels = 0, limits = {}) {
    const resolvedLimits = { ...DEFAULT_LIMITS, ...limits };
    const dimensions = measure(source);
    const totalPixels = Math.max(0, Number(currentPixels) || 0) + dimensions.pixels;
    if (!dimensions.width || !dimensions.height) {
      return { allowed: false, reason: "unreadable", ...dimensions, totalPixels, limit: 0 };
    }
    if (dimensions.pixels > resolvedLimits.maxPixelsPerImage) {
      return {
        allowed: false,
        reason: "single",
        ...dimensions,
        totalPixels,
        limit: resolvedLimits.maxPixelsPerImage,
      };
    }
    if (totalPixels > resolvedLimits.maxTotalPixels) {
      return {
        allowed: false,
        reason: "total",
        ...dimensions,
        totalPixels,
        limit: resolvedLimits.maxTotalPixels,
      };
    }
    return { allowed: true, reason: "", ...dimensions, totalPixels, limit: resolvedLimits.maxTotalPixels };
  }

  /**
   * Sums decoded pixels retained by browser image sources.
   * @param {CanvasImageSource[]} sources Browser image or canvas sources.
   * @returns {number} Total decoded pixels.
   */
  function totalPixels(sources) {
    return Array.from(sources || []).reduce((total, source) => total + measure(source).pixels, 0);
  }

  /**
   * Keeps the longest prefix of sources that still fits the decoded-pixel budget.
   * @param {CanvasImageSource[]} sources Ordered image sources.
   * @param {number} [currentPixels] Pixels already retained by the caller.
   * @param {{maxPixelsPerImage?:number,maxTotalPixels?:number}} [limits] Memory limits.
   * @returns {{kept:Array<{source:CanvasImageSource,index:number,width:number,height:number,pixels:number,totalPixels:number}>,skipped:number,reason:string,limit:number}}
   */
  function takeUntilBudget(sources, currentPixels = 0, limits = {}) {
    const list = Array.from(sources || []);
    const kept = [];
    let pixels = Math.max(0, Number(currentPixels) || 0);
    for (let index = 0; index < list.length; index += 1) {
      const result = evaluate(list[index], pixels, limits);
      if (!result.allowed) {
        return {
          kept,
          skipped: list.length - kept.length,
          reason: result.reason,
          limit: result.limit,
        };
      }
      pixels = result.totalPixels;
      kept.push({ source: list[index], index, ...result });
    }
    return { kept, skipped: 0, reason: "", limit: 0 };
  }

  const api = Object.freeze({ DEFAULT_LIMITS, evaluate, measure, totalPixels, takeUntilBudget });
  root.ImagePixelBudget = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
