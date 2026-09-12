(function attachScatterSliceCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameScatterSliceCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /** @typedef {"auto"|"alpha"|"colorkey"} DetectionMode */
  /** @typedef {"row-major"|"column-major"} SortOrder */

  /**
   * @typedef {object} DetectionOptions
   * @property {DetectionMode} [mode]
   * @property {string} [colorKey]
   * @property {number} [threshold]
   * @property {number} [mergeGap]
   * @property {number} [minPixels]
   * @property {number} [minSide]
   * @property {SortOrder} [sortOrder]
   */

  /**
   * @typedef {object} SliceBox
   * @property {number} x
   * @property {number} y
   * @property {number} w
   * @property {number} h
   * @property {number} pixels
   */

  /** @type {Readonly<Required<DetectionOptions>>} */
  const DEFAULT_OPTIONS = Object.freeze({
    mode: "auto",
    colorKey: "#ffffff",
    threshold: 24,
    mergeGap: 0,
    minPixels: 4,
    minSide: 1,
    sortOrder: "row-major",
  });

  /**
   * Clamps a numeric option to a finite range.
   * @param {unknown} value Raw option value.
   * @param {number} fallback Default value.
   * @param {number} minimum Inclusive minimum.
   * @returns {number} Normalized numeric value.
   */
  function normalizeNumber(value, fallback, minimum) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(minimum, numeric) : fallback;
  }

  /**
   * Normalizes untrusted detector options before allocating scan buffers.
   * @param {DetectionOptions} [options] Raw options.
   * @returns {Required<DetectionOptions>} Safe options.
   */
  function normalizeOptions(options = {}) {
    const mode = ["auto", "alpha", "colorkey"].includes(options.mode) ? options.mode : DEFAULT_OPTIONS.mode;
    const sortOrder = ["row-major", "column-major"].includes(options.sortOrder)
      ? options.sortOrder
      : DEFAULT_OPTIONS.sortOrder;
    return {
      mode,
      colorKey: typeof options.colorKey === "string" ? options.colorKey : DEFAULT_OPTIONS.colorKey,
      threshold: normalizeNumber(options.threshold, DEFAULT_OPTIONS.threshold, 0),
      mergeGap: normalizeNumber(options.mergeGap, DEFAULT_OPTIONS.mergeGap, 0),
      minPixels: normalizeNumber(options.minPixels, DEFAULT_OPTIONS.minPixels, 1),
      minSide: normalizeNumber(options.minSide, DEFAULT_OPTIONS.minSide, 1),
      sortOrder,
    };
  }

  /**
   * Converts a six-digit CSS hex color to RGB channels.
   * @param {string} hex CSS hex color.
   * @returns {{r:number,g:number,b:number}} RGB channels.
   */
  function hexToRgb(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!match) return { r: 255, g: 255, b: 255 };
    return {
      r: Number.parseInt(match[1], 16),
      g: Number.parseInt(match[2], 16),
      b: Number.parseInt(match[3], 16),
    };
  }

  /**
   * Converts RGB channels to a six-digit CSS hex color.
   * @param {{r:number,g:number,b:number}} color RGB channels.
   * @returns {string} Lowercase CSS hex color.
   */
  function rgbToHex(color) {
    const channel = (value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0");
    return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
  }

  /**
   * Validates an RGBA buffer before allocating working memory.
   * @param {Uint8ClampedArray} rgba Raw pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @returns {void}
   */
  function validateRgba(rgba, width, height) {
    if (!(rgba instanceof Uint8ClampedArray)) throw new TypeError("rgba 必须是 Uint8ClampedArray");
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("width 和 height 必须是正整数");
    }
    if (rgba.length !== width * height * 4) throw new RangeError("RGBA 长度与图片尺寸不一致");
  }

  /**
   * Resolves automatic mode from a border-connected punched field (a<16).
   * A 1px real-alpha gutter is alpha even when it is under 5% of the canvas.
   * Corner punches on an opaque plate stay color-key. A stray a=200 fringe
   * must not leave color-key detection.
   * @param {Uint8ClampedArray} rgba Raw pixels.
   * @param {DetectionMode} mode Requested mode.
   * @param {number} [width] Image width.
   * @param {number} [height] Image height.
   * @returns {"alpha"|"colorkey"} Concrete mode.
   */
  function resolveDetectionMode(rgba, mode, width, height) {
    if (mode !== "auto") return mode;
    const w = Number(width);
    const h = Number(height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || rgba.length !== w * h * 4) {
      return "colorkey";
    }
    let ring = 0;
    let punched = 0;
    const visit = (x, y) => {
      ring += 1;
      if (rgba[(y * w + x) * 4 + 3] < 16) punched += 1;
    };
    for (let x = 0; x < w; x += 1) {
      visit(x, 0);
      if (h > 1) visit(x, h - 1);
    }
    for (let y = 1; y < h - 1; y += 1) {
      visit(0, y);
      if (w > 1) visit(w - 1, y);
    }
    return ring > 0 && punched * 2 >= ring ? "alpha" : "colorkey";
  }

  /**
   * Tests whether one pixel belongs to the foreground.
   * @param {number} r Red channel.
   * @param {number} g Green channel.
   * @param {number} b Blue channel.
   * @param {number} a Alpha channel.
   * @param {"alpha"|"colorkey"} mode Concrete detection mode.
   * @param {{r:number,g:number,b:number}} colorKey Background color.
   * @param {number} threshold Detection tolerance.
   * @returns {boolean} Whether the pixel is foreground.
   */
  function isForegroundPixel(r, g, b, a, mode, colorKey, threshold) {
    const safeThreshold = Math.max(0, threshold);
    if (mode === "alpha") return a > safeThreshold;
    const distance = Math.abs(r - colorKey.r) + Math.abs(g - colorKey.g) + Math.abs(b - colorKey.b);
    return a > 0 && distance > safeThreshold * 3;
  }

  /**
   * Creates a compact foreground mask.
   * @param {Uint8ClampedArray} rgba Raw pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {Required<DetectionOptions>} options Safe options.
   * @returns {{mask:Uint8Array,mode:"alpha"|"colorkey",foregroundPixels:number}} Mask result.
   */
  function createForegroundMask(rgba, width, height, options) {
    const mode = resolveDetectionMode(rgba, options.mode, width, height);
    const colorKey = hexToRgb(options.colorKey);
    const mask = new Uint8Array(width * height);
    let foregroundPixels = 0;
    for (let index = 0; index < mask.length; index += 1) {
      const offset = index * 4;
      if (
        isForegroundPixel(
          rgba[offset],
          rgba[offset + 1],
          rgba[offset + 2],
          rgba[offset + 3],
          mode,
          colorKey,
          options.threshold,
        )
      ) {
        mask[index] = 1;
        foregroundPixels += 1;
      }
    }
    const ignoredGuidePixels = mode === "colorkey" ? removeAxisAlignedGuides(mask, width, height) : 0;
    return { mask, mode, foregroundPixels: foregroundPixels - ignoredGuidePixels, ignoredGuidePixels };
  }

  /**
   * Marks thin runs of dense scan lines while leaving solid subjects intact.
   * @param {Float64Array} densities Foreground density for each row or column.
   * @param {number} maximumThickness Largest line thickness to suppress.
   * @returns {Uint8Array} Dense line indexes that belong to thin runs.
   */
  function markThinDenseRuns(densities, maximumThickness) {
    const marked = new Uint8Array(densities.length);
    let start = 0;
    while (start < densities.length) {
      if (densities[start] < 0.72) {
        start += 1;
        continue;
      }
      let end = start + 1;
      while (end < densities.length && densities[end] >= 0.72) end += 1;
      if (end - start <= maximumThickness) marked.fill(1, start, end);
      start = end;
    }
    return marked;
  }

  /**
   * Removes long, thin horizontal and vertical editor guides from a color-key mask.
   * Dense runs thicker than the guide limit are preserved so large subjects are not erased.
   * @param {Uint8Array} mask Mutable foreground mask.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @returns {number} Number of ignored foreground pixels.
   */
  function removeAxisAlignedGuides(mask, width, height) {
    if (width < 48 || height < 48) return 0;
    const rowDensities = new Float64Array(height);
    const columnDensities = new Float64Array(width);
    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x += 1) {
        if (!mask[rowOffset + x]) continue;
        rowDensities[y] += 1 / width;
        columnDensities[x] += 1 / height;
      }
    }
    const maximumThickness = Math.max(2, Math.min(8, Math.ceil(Math.min(width, height) * 0.004)));
    const ignoredRows = markThinDenseRuns(rowDensities, maximumThickness);
    const ignoredColumns = markThinDenseRuns(columnDensities, maximumThickness);
    let ignoredPixels = 0;
    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x += 1) {
        const index = rowOffset + x;
        if (!mask[index] || (!ignoredRows[y] && !ignoredColumns[x])) continue;
        mask[index] = 0;
        ignoredPixels += 1;
      }
    }
    return ignoredPixels;
  }

  /**
   * Finds four-neighbour connected components using iterative breadth-first search.
   * @param {Uint8Array} mask Foreground mask.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {Required<DetectionOptions>} options Safe options.
   * @returns {SliceBox[]} Component bounds.
   */
  function findComponents(mask, width, height, options) {
    const visited = new Uint8Array(mask.length);
    const queue = new Uint32Array(mask.length);
    const boxes = [];
    const minPixels = Math.max(1, Math.round(options.minPixels));
    const minSide = Math.max(1, Math.round(options.minSide));

    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || visited[start]) continue;
      let head = 0;
      let tail = 1;
      queue[0] = start;
      visited[start] = 1;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      let pixels = 0;

      while (head < tail) {
        const current = queue[head];
        head += 1;
        const x = current % width;
        const y = Math.floor(current / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        pixels += 1;
        if (x > 0) {
          const neighbour = current - 1;
          if (mask[neighbour] && !visited[neighbour]) {
            visited[neighbour] = 1;
            queue[tail] = neighbour;
            tail += 1;
          }
        }
        if (x < width - 1) {
          const neighbour = current + 1;
          if (mask[neighbour] && !visited[neighbour]) {
            visited[neighbour] = 1;
            queue[tail] = neighbour;
            tail += 1;
          }
        }
        if (y > 0) {
          const neighbour = current - width;
          if (mask[neighbour] && !visited[neighbour]) {
            visited[neighbour] = 1;
            queue[tail] = neighbour;
            tail += 1;
          }
        }
        if (y < height - 1) {
          const neighbour = current + width;
          if (mask[neighbour] && !visited[neighbour]) {
            visited[neighbour] = 1;
            queue[tail] = neighbour;
            tail += 1;
          }
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      if (pixels >= minPixels && w >= minSide && h >= minSide) {
        boxes.push({ x: minX, y: minY, w, h, pixels });
      }
    }
    return boxes;
  }

  /**
   * Checks whether two expanded rectangles overlap.
   * @param {SliceBox} first First rectangle.
   * @param {SliceBox} second Second rectangle.
   * @param {number} gap Expansion radius.
   * @returns {boolean} Whether the rectangles should merge.
   */
  function boxesAreNear(first, second, gap) {
    return (
      second.x <= first.x + first.w + gap &&
      second.x + second.w >= first.x - gap &&
      second.y <= first.y + first.h + gap &&
      second.y + second.h >= first.y - gap
    );
  }

  /**
   * Merges rectangles whose expanded bounds overlap.
   * @param {SliceBox[]} boxes Source rectangles.
   * @param {number} mergeGap Expansion radius.
   * @returns {SliceBox[]} Merged copies.
   */
  function mergeBoxes(boxes, mergeGap) {
    const gap = Math.max(0, Math.round(mergeGap));
    const remaining = boxes.map((box) => ({ ...box }));
    const merged = [];
    while (remaining.length > 0) {
      let box = remaining.shift();
      let changed = true;
      while (changed) {
        changed = false;
        for (let index = remaining.length - 1; index >= 0; index -= 1) {
          const other = remaining[index];
          if (!boxesAreNear(box, other, gap)) continue;
          const left = Math.min(box.x, other.x);
          const top = Math.min(box.y, other.y);
          const right = Math.max(box.x + box.w, other.x + other.w);
          const bottom = Math.max(box.y + box.h, other.y + other.h);
          box = {
            x: left,
            y: top,
            w: right - left,
            h: bottom - top,
            pixels: box.pixels + other.pixels,
          };
          remaining.splice(index, 1);
          changed = true;
        }
      }
      merged.push(box);
    }
    return merged;
  }

  /**
   * Sorts boxes in visual reading order.
   * @param {SliceBox[]} boxes Source rectangles.
   * @param {SortOrder} [order] Reading direction.
   * @returns {SliceBox[]} Sorted copies.
   */
  function sortBoxes(boxes, order = "row-major") {
    const copies = boxes.map((box) => ({ ...box }));
    const primary = order === "column-major" ? "x" : "y";
    const secondary = order === "column-major" ? "y" : "x";
    copies.sort((first, second) => first[primary] - second[primary] || first[secondary] - second[secondary]);
    const bands = [];
    for (const box of copies) {
      const last = bands[bands.length - 1];
      if (last && Math.abs(last.anchor - box[primary]) <= 8) last.items.push(box);
      else bands.push({ anchor: box[primary], items: [box] });
    }
    const sorted = [];
    for (const band of bands) {
      band.items.sort(
        (first, second) => first[secondary] - second[secondary] || first[primary] - second[primary],
      );
      sorted.push(...band.items);
    }
    return sorted;
  }

  /**
   * Splits a wide connected box on interior columns that are almost empty.
   * Three-view sheets often share a ground line that would otherwise stay one box.
   * @param {SliceBox} box Merged component bounds.
   * @param {Uint8Array} mask Foreground mask.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {Required<DetectionOptions>} options Safe options.
   * @returns {SliceBox[]} Split copies, or the original box.
   */
  function splitBoxByGutters(box, mask, width, height, options) {
    if (box.w < 16) return [box];
    const counts = new Int32Array(box.w);
    for (let y = box.y; y < box.y + box.h && y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < box.w; x += 1) {
        const index = row + box.x + x;
        if (index >= 0 && index < mask.length && mask[index]) counts[x] += 1;
      }
    }
    let peak = 0;
    for (const count of counts) if (count > peak) peak = count;
    if (peak < 4) return [box];
    const gutterMax = Math.max(1, Math.round(peak * 0.12));
    const minRun = Math.max(2, Math.round(box.w * 0.02));
    const ranges = [];
    let start = 0;
    while (start < counts.length) {
      if (counts[start] > gutterMax) {
        start += 1;
        continue;
      }
      let end = start + 1;
      while (end < counts.length && counts[end] <= gutterMax) end += 1;
      const interior = start > 0 && end < counts.length;
      if (interior && end - start >= minRun) ranges.push({ start, end });
      start = end;
    }
    if (!ranges.length) return [box];
    const segments = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start - cursor >= Math.max(1, options.minSide)) {
        segments.push({ start: cursor, end: range.start });
      }
      cursor = range.end;
    }
    if (counts.length - cursor >= Math.max(1, options.minSide)) {
      segments.push({ start: cursor, end: counts.length });
    }
    if (segments.length < 2) return [box];
    return segments
      .map((segment) => {
        const x = box.x + segment.start;
        const w = segment.end - segment.start;
        let minY = box.y + box.h;
        let maxY = box.y;
        let pixels = 0;
        for (let y = box.y; y < box.y + box.h && y < height; y += 1) {
          const row = y * width;
          for (let column = 0; column < w; column += 1) {
            const index = row + x + column;
            if (index < 0 || index >= mask.length || !mask[index]) continue;
            pixels += 1;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        return {
          x,
          y: minY <= maxY ? minY : box.y,
          w,
          h: minY <= maxY ? maxY - minY + 1 : box.h,
          pixels,
        };
      })
      .filter(
        (next) => next.pixels >= options.minPixels && next.w >= options.minSide && next.h >= options.minSide,
      );
  }

  /**
   * Detects scattered foreground regions from raw RGBA pixels.
   * @param {Uint8ClampedArray} rgba Raw pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {DetectionOptions} [userOptions] Detection parameters.
   * @returns {{boxes:SliceBox[],mode:"alpha"|"colorkey",foregroundPixels:number}} Detection result.
   */
  function detectScatterSlices(rgba, width, height, userOptions = {}) {
    validateRgba(rgba, width, height);
    const options = normalizeOptions(userOptions);
    const { mask, mode, foregroundPixels, ignoredGuidePixels } = createForegroundMask(
      rgba,
      width,
      height,
      options,
    );
    const components = findComponents(mask, width, height, options);
    const merged = mergeBoxes(components, options.mergeGap);
    const split = merged.flatMap((box) => splitBoxByGutters(box, mask, width, height, options));
    const boxes = sortBoxes(split, options.sortOrder);
    return { boxes, mode, foregroundPixels, ignoredGuidePixels };
  }

  /**
   * Samples one clamped pixel as a CSS hex color.
   * @param {Uint8ClampedArray} rgba Raw pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {number} x Horizontal coordinate.
   * @param {number} y Vertical coordinate.
   * @returns {string} Sampled color.
   */
  function samplePixelHex(rgba, width, height, x, y) {
    validateRgba(rgba, width, height);
    const safeX = Math.max(0, Math.min(width - 1, Math.floor(x)));
    const safeY = Math.max(0, Math.min(height - 1, Math.floor(y)));
    const offset = (safeY * width + safeX) * 4;
    return rgbToHex({ r: rgba[offset], g: rgba[offset + 1], b: rgba[offset + 2] });
  }

  /**
   * Returns a copy whose color-key background pixels are transparent.
   * @param {Uint8ClampedArray} rgba Raw pixels.
   * @param {string} colorKeyHex Background color.
   * @param {number} threshold Detection tolerance.
   * @returns {Uint8ClampedArray} New RGBA buffer.
   */
  function removeColorKey(rgba, colorKeyHex, threshold) {
    if (!(rgba instanceof Uint8ClampedArray) || rgba.length % 4 !== 0) {
      throw new TypeError("rgba 必须是完整的 Uint8ClampedArray");
    }
    const output = new Uint8ClampedArray(rgba);
    const colorKey = hexToRgb(colorKeyHex);
    const safeThreshold = normalizeNumber(threshold, DEFAULT_OPTIONS.threshold, 0);
    for (let offset = 0; offset < output.length; offset += 4) {
      if (
        !isForegroundPixel(
          output[offset],
          output[offset + 1],
          output[offset + 2],
          output[offset + 3],
          "colorkey",
          colorKey,
          safeThreshold,
        )
      ) {
        output[offset + 3] = 0;
      }
    }
    return output;
  }

  return Object.freeze({
    DEFAULT_OPTIONS,
    detectScatterSlices,
    hexToRgb,
    isForegroundPixel,
    mergeBoxes,
    normalizeOptions,
    removeColorKey,
    resolveDetectionMode,
    rgbToHex,
    samplePixelHex,
    sortBoxes,
  });
});
