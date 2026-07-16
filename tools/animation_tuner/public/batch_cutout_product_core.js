(function attachBatchCutoutProductCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutProductCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Creates the product repair pipeline behind the BatchCutoutCore compatibility facade.
   * @param {{
   *   applyCutout:Function,
   *   clamp:Function,
   *   colorDistance:Function,
   *   estimateBackgroundColor:Function,
   *   perceptualColorDistance:Function
   * }} dependencies Pixel-kernel dependencies owned by the core facade.
   * @returns {{
   *   applyCutoutBrushStroke:Function,
   *   applyCutoutRepairs:Function,
   *   applyProductCutout:Function
   * }}
   */
  function createProductPipeline(dependencies) {
    const {
      applyCutout,
      clamp,
      colorDistance,
      estimateBackgroundColor,
      perceptualColorDistance,
    } = dependencies || {};
    [
      ["applyCutout", applyCutout],
      ["clamp", clamp],
      ["colorDistance", colorDistance],
      ["estimateBackgroundColor", estimateBackgroundColor],
      ["perceptualColorDistance", perceptualColorDistance],
    ].forEach(([name, dependency]) => {
      if (typeof dependency !== "function") {
        throw new TypeError(`BatchCutoutProductCore requires ${name}().`);
      }
    });

    /**
     * Applies one serialized brush or eraser stroke to mutable RGBA pixels.
     * @param {Uint8ClampedArray} pixels Mutable result pixels.
     * @param {number} width Image width.
     * @param {number} height Image height.
     * @param {object} stroke Brush settings and source-space points.
     * @returns {void}
     */
    function applyCutoutBrushStroke(pixels, width, height, stroke) {
      const points = Array.isArray(stroke?.points) ? stroke.points : [];
      if (!points.length) return;
      const radius = Math.max(0.5, Number(stroke.size || 1) / 2);
      const hardness = Math.max(0.01, Math.min(0.999, Number(stroke.hardness || 1)));
      const opacity = Math.max(0.01, Math.min(1, Number(stroke.opacity || 1)));
      const color = stroke.color || { r: 0, g: 200, b: 0 };
      const stamp = (centerX, centerY) => {
        const startX = Math.max(0, Math.floor(centerX - radius));
        const endX = Math.min(width - 1, Math.ceil(centerX + radius));
        const startY = Math.max(0, Math.floor(centerY - radius));
        const endY = Math.min(height - 1, Math.ceil(centerY + radius));
        for (let y = startY; y <= endY; y += 1) {
          for (let x = startX; x <= endX; x += 1) {
            const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY) / radius;
            if (distance > 1) continue;
            const feather = distance <= hardness
              ? 1
              : 1 - ((distance - hardness) / (1 - hardness));
            const strength = opacity * Math.max(0, Math.min(1, feather));
            const offset = (y * width + x) * 4;
            if (stroke.mode === "eraser") {
              pixels[offset + 3] = Math.round(pixels[offset + 3] * (1 - strength));
            } else {
              pixels[offset] = Math.round(
                pixels[offset] * (1 - strength) + color.r * strength,
              );
              pixels[offset + 1] = Math.round(
                pixels[offset + 1] * (1 - strength) + color.g * strength,
              );
              pixels[offset + 2] = Math.round(
                pixels[offset + 2] * (1 - strength) + color.b * strength,
              );
              pixels[offset + 3] = Math.round(
                pixels[offset + 3] + (255 - pixels[offset + 3]) * strength,
              );
            }
          }
        }
      };
      points.forEach((point, index) => {
        const previous = points[Math.max(0, index - 1)];
        const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
        const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.35)));
        for (let step = 1; step <= steps; step += 1) {
          const ratio = step / steps;
          stamp(
            previous.x + (point.x - previous.x) * ratio,
            previous.y + (point.y - previous.y) * ratio,
          );
        }
      });
    }

    /**
     * Applies serialized product repairs to one automatic cutout result.
     * @param {Uint8ClampedArray|Uint8Array} source Original RGBA pixels.
     * @param {Uint8ClampedArray} resultData Mutable automatic cutout pixels.
     * @param {number} width Image width.
     * @param {number} height Image height.
     * @param {object} options Processing options.
     * @param {Array<object>} repairs Serialized repairs.
     * @returns {Uint8ClampedArray}
     */
    function applyCutoutRepairs(source, resultData, width, height, options, repairs = []) {
      const protectedColors = Array.isArray(options.protectedColors) ? options.protectedColors : [];
      const protectionTolerance = clamp(options.protectionTolerance ?? 8, 0, 100);
      const defaultBackground = (
        Array.isArray(options.backgroundColors) && options.backgroundColors.length
          ? options.backgroundColors[0]
          : options.backgroundColor
      ) || estimateBackgroundColor(source, width, height);
      for (const repair of repairs) {
        if (repair.mode === "brush" || repair.mode === "eraser") {
          applyCutoutBrushStroke(resultData, width, height, repair);
          continue;
        }
        if (![repair.x1, repair.y1, repair.x2, repair.y2].every(Number.isFinite)) continue;
        const startX = Math.max(0, Math.floor(Math.min(repair.x1, repair.x2)));
        const endX = Math.min(width - 1, Math.ceil(Math.max(repair.x1, repair.x2)));
        const startY = Math.max(0, Math.floor(Math.min(repair.y1, repair.y2)));
        const endY = Math.min(height - 1, Math.ceil(Math.max(repair.y1, repair.y2)));
        const background = repair.backgroundColor || defaultBackground;
        const distanceFromBackground = (offset) => (
          options.perceptual
            ? perceptualColorDistance(
              source[offset],
              source[offset + 1],
              source[offset + 2],
              background,
            )
            : colorDistance(
              source[offset],
              source[offset + 1],
              source[offset + 2],
              background,
            )
        );
        const maximumDistance = Number(repair.tolerance ?? options.tolerance ?? 18)
          + Number(repair.feather ?? options.feather ?? 6);
        if (repair.mode === "smart") {
          const selectionMask = new Uint8Array(width * height);
          for (let y = startY; y <= endY; y += 1) {
            selectionMask.fill(255, y * width + startX, y * width + endX + 1);
          }
          const seedPoints = [];
          for (let gridY = 0; gridY < 3; gridY += 1) {
            const cellStartY = Math.round(startY + (endY - startY) * gridY / 3);
            const cellEndY = gridY === 2
              ? endY
              : Math.round(startY + (endY - startY) * (gridY + 1) / 3);
            for (let gridX = 0; gridX < 3; gridX += 1) {
              const cellStartX = Math.round(startX + (endX - startX) * gridX / 3);
              const cellEndX = gridX === 2
                ? endX
                : Math.round(startX + (endX - startX) * (gridX + 1) / 3);
              let bestSeed = null;
              let bestDistance = Number.POSITIVE_INFINITY;
              for (let y = cellStartY; y <= cellEndY; y += 1) {
                for (let x = cellStartX; x <= cellEndX; x += 1) {
                  const distance = distanceFromBackground((y * width + x) * 4);
                  if (distance >= bestDistance) continue;
                  bestDistance = distance;
                  bestSeed = { x, y };
                }
              }
              if (bestSeed) seedPoints.push(bestSeed);
            }
          }
          const smartResult = applyCutout(source, width, height, {
            ...options,
            backgroundColor: background,
            backgroundColors: [background],
            tolerance: Number(repair.tolerance ?? options.tolerance ?? 18),
            feather: Number(repair.feather ?? options.feather ?? 6),
            connected: true,
            selectionMask,
            seedPoints,
          });
          for (let y = startY; y <= endY; y += 1) {
            const startOffset = (y * width + startX) * 4;
            const endOffset = (y * width + endX + 1) * 4;
            resultData.set(smartResult.data.subarray(startOffset, endOffset), startOffset);
          }
          continue;
        }
        for (let y = startY; y <= endY; y += 1) {
          for (let x = startX; x <= endX; x += 1) {
            const offset = (y * width + x) * 4;
            const protectedPixel = protectedColors.some((color) => (
              colorDistance(source[offset], source[offset + 1], source[offset + 2], color)
                <= protectionTolerance
            ));
            if (repair.mode === "clear") {
              resultData[offset + 3] = 0;
            } else if (repair.mode === "restore") {
              if (distanceFromBackground(offset) > maximumDistance) {
                resultData.set(source.subarray(offset, offset + 4), offset);
              }
            } else if (!protectedPixel && distanceFromBackground(offset) <= maximumDistance) {
              resultData[offset + 3] = 0;
            }
          }
        }
      }
      return resultData;
    }

    /**
     * Executes the complete product path shared by preview, export, and replacement.
     * @param {Uint8ClampedArray|Uint8Array} source Original RGBA pixels.
     * @param {number} width Image width.
     * @param {number} height Image height.
     * @param {object} options Processing options.
     * @param {Array<object>} repairs Serialized local repairs.
     * @returns {{data:Uint8ClampedArray,automaticData:Uint8ClampedArray,removedPixels:number,partialPixels:number}}
     */
    function applyProductCutout(source, width, height, options = {}, repairs = []) {
      const result = applyCutout(source, width, height, options);
      const automaticData = new Uint8ClampedArray(result.data);
      applyCutoutRepairs(source, result.data, width, height, options, repairs);
      return { ...result, automaticData };
    }

    return Object.freeze({
      applyCutoutBrushStroke,
      applyCutoutRepairs,
      applyProductCutout,
    });
  }

  return {
    createProductPipeline,
  };
}));
