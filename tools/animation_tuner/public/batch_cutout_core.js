(function attachBatchCutoutCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Keeps a number inside an inclusive range.
   * @param {number} value Candidate number.
   * @param {number} minimum Inclusive minimum.
   * @param {number} maximum Inclusive maximum.
   * @returns {number}
   */
  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value || 0)));
  }

  /**
   * Converts an RGB color into a CSS hexadecimal color.
   * @param {{r:number,g:number,b:number}} color RGB color.
   * @returns {string}
   */
  function rgbToHex(color) {
    return `#${[color.r, color.g, color.b]
      .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  /**
   * Converts a CSS hexadecimal color into RGB channels.
   * @param {string} value Hexadecimal color.
   * @returns {{r:number,g:number,b:number}}
   */
  function hexToRgb(value) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(value || ""));
    if (!match) return { r: 255, g: 255, b: 255 };
    const number = Number.parseInt(match[1], 16);
    return {
      r: (number >> 16) & 255,
      g: (number >> 8) & 255,
      b: number & 255,
    };
  }

  /**
   * Returns perceptual RGB distance normalized to the range 0-100.
   * @param {number} red Red channel.
   * @param {number} green Green channel.
   * @param {number} blue Blue channel.
   * @param {{r:number,g:number,b:number}} target Target color.
   * @returns {number}
   */
  function colorDistance(red, green, blue, target) {
    const redMean = (red + target.r) / 2;
    const redDelta = red - target.r;
    const greenDelta = green - target.g;
    const blueDelta = blue - target.b;
    const weighted = Math.sqrt(
      (2 + redMean / 256) * redDelta * redDelta
      + 4 * greenDelta * greenDelta
      + (2 + (255 - redMean) / 256) * blueDelta * blueDelta,
    );
    return clamp((weighted / 764.834) * 100, 0, 100);
  }

  /**
   * Converts an sRGB channel to linear light.
   * @param {number} channel Eight-bit sRGB channel.
   * @returns {number}
   */
  function srgbToLinear(channel) {
    const normalized = clamp(channel, 0, 255) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  }

  /**
   * Converts a linear-light channel to eight-bit sRGB.
   * @param {number} channel Linear-light channel.
   * @returns {number}
   */
  function linearToSrgb(channel) {
    const normalized = clamp(channel, 0, 1);
    const encoded = normalized <= 0.0031308
      ? normalized * 12.92
      : 1.055 * normalized ** (1 / 2.4) - 0.055;
    return clamp(Math.round(encoded * 255), 0, 255);
  }

  /**
   * Reads the public WASM's float32 sRGB lookup-table value.
   * @param {number} channel Eight-bit sRGB channel.
   * @returns {number}
   */
  function referenceSrgbToLinear(channel) {
    return Math.fround(srgbToLinear(channel));
  }

  /**
   * Applies the public WASM's linear-to-sRGB clamp and rounding rules.
   * @param {number} channel Linear-light channel.
   * @returns {number}
   */
  function referenceLinearToSrgb(channel) {
    if (channel <= 0) return 0;
    if (channel >= 1) return 255;
    const encoded = channel <= 0.003131
      ? channel * 12.92
      : channel ** (1 / 2.4) * 1.055 - 0.055;
    return clamp(Math.trunc(encoded * 255 + 0.5), 0, 255);
  }

  /**
   * Converts RGB into OKLab.
   * @param {number} red Red channel.
   * @param {number} green Green channel.
   * @param {number} blue Blue channel.
   * @returns {{l:number,a:number,b:number,chroma:number,hue:number}}
   */
  function rgbToOklab(red, green, blue) {
    const linearRed = srgbToLinear(red);
    const linearGreen = srgbToLinear(green);
    const linearBlue = srgbToLinear(blue);
    const l = Math.cbrt(0.4122214708 * linearRed + 0.5363325363 * linearGreen + 0.0514459929 * linearBlue);
    const m = Math.cbrt(0.2119034982 * linearRed + 0.6806995451 * linearGreen + 0.1073969566 * linearBlue);
    const s = Math.cbrt(0.0883024619 * linearRed + 0.2817188376 * linearGreen + 0.6299787005 * linearBlue);
    const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const axisA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const axisB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return {
      l: lightness,
      a: axisA,
      b: axisB,
      chroma: Math.hypot(axisA, axisB),
      hue: (Math.atan2(axisB, axisA) * 180) / Math.PI,
    };
  }

  /**
   * Converts OKLab coordinates back to eight-bit sRGB.
   * @param {number} lightness OKLab lightness.
   * @param {number} axisA OKLab a axis.
   * @param {number} axisB OKLab b axis.
   * @returns {{r:number,g:number,b:number}}
   */
  function oklabToRgb(lightness, axisA, axisB) {
    const lRoot = lightness + 0.3963377774 * axisA + 0.2158037573 * axisB;
    const mRoot = lightness - 0.1055613458 * axisA - 0.0638541728 * axisB;
    const sRoot = lightness - 0.0894841775 * axisA - 1.291485548 * axisB;
    const l = lRoot ** 3;
    const m = mRoot ** 3;
    const s = sRoot ** 3;
    return {
      r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    };
  }

  /**
   * Converts RGB into normalized YCbCr values.
   * @param {number} red Red channel.
   * @param {number} green Green channel.
   * @param {number} blue Blue channel.
   * @returns {{y:number,cb:number,cr:number}}
   */
  function rgbToYcbcr(red, green, blue) {
    const normalizedRed = red / 255;
    const normalizedGreen = green / 255;
    const normalizedBlue = blue / 255;
    return {
      y: 0.299 * normalizedRed + 0.587 * normalizedGreen + 0.114 * normalizedBlue,
      cb: -0.168736 * normalizedRed - 0.331264 * normalizedGreen + 0.5 * normalizedBlue,
      cr: 0.5 * normalizedRed - 0.418688 * normalizedGreen - 0.081312 * normalizedBlue,
    };
  }

  /**
   * Returns the shortest circular hue distance in degrees.
   * @param {number} left First hue.
   * @param {number} right Second hue.
   * @returns {number}
   */
  function hueDistance(left, right) {
    const difference = Math.abs(left - right) % 360;
    return Math.min(difference, 360 - difference);
  }

  /**
   * Calculates a perceptual background distance in the range 0-100.
   * @param {number} red Red channel.
   * @param {number} green Green channel.
   * @param {number} blue Blue channel.
   * @param {{r:number,g:number,b:number}} target Background color.
   * @returns {number}
   */
  function perceptualColorDistance(red, green, blue, target) {
    const pixelLab = rgbToOklab(red, green, blue);
    const targetLab = rgbToOklab(target.r, target.g, target.b);
    const pixelYcbcr = rgbToYcbcr(red, green, blue);
    const targetYcbcr = rgbToYcbcr(target.r, target.g, target.b);
    const rgbDifference = colorDistance(red, green, blue, target);
    const chromaDifference = clamp(
      (Math.hypot(pixelYcbcr.cb - targetYcbcr.cb, pixelYcbcr.cr - targetYcbcr.cr) / 0.7072) * 100,
      0,
      100,
    );
    const labDifference = clamp(
      (Math.hypot(
        pixelLab.l - targetLab.l,
        pixelLab.a - targetLab.a,
        pixelLab.b - targetLab.b,
      ) / 0.8) * 100,
      0,
      100,
    );
    let distance = rgbDifference * 0.22 + chromaDifference * 0.46 + labDifference * 0.32;
    if (pixelLab.chroma > 0.035 && targetLab.chroma > 0.035) {
      const hueDifference = hueDistance(pixelLab.hue, targetLab.hue);
      if (hueDifference > 15) distance += clamp(((hueDifference - 15) / 30) * 24, 0, 24);
    }
    if (pixelLab.l < 0.22 && targetLab.l > 0.32) distance += 28;
    return clamp(distance, 0, 100);
  }

  /**
   * Returns the closest distance to any sampled background color.
   * @param {number} red Red channel.
   * @param {number} green Green channel.
   * @param {number} blue Blue channel.
   * @param {Array<{r:number,g:number,b:number}>} colors Background samples.
   * @param {boolean} perceptual Whether to use perceptual color space.
   * @returns {number}
   */
  function nearestBackgroundDistance(red, green, blue, colors, perceptual) {
    let closest = 100;
    for (const color of colors) {
      const distance = perceptual
        ? perceptualColorDistance(red, green, blue, color)
        : colorDistance(red, green, blue, color);
      if (distance < closest) closest = distance;
    }
    return closest;
  }

  /**
   * Converts RGB to the byte-scale YCbCr representation used by the reference chroma kernel.
   * @param {number} red Red channel.
   * @param {number} green Green channel.
   * @param {number} blue Blue channel.
   * @returns {{y:number,cb:number,cr:number}}
   */
  function rgbToReferenceYcbcr(red, green, blue) {
    return {
      y: red * 0.299 + green * 0.587 + blue * 0.114,
      cb: red * -0.168736 + green * -0.331264 + blue * 0.5 + 128,
      cr: red * 0.5 + green * -0.418688 + blue * -0.081312 + 128,
    };
  }

  /**
   * Converts the reference byte-scale YCbCr representation back to RGB.
   * @param {number} y Luma channel.
   * @param {number} cb Blue-difference chroma including the 128 offset.
   * @param {number} cr Red-difference chroma including the 128 offset.
   * @returns {{r:number,g:number,b:number}}
   */
  function referenceYcbcrToRgb(y, cb, cr) {
    const centeredCb = cb - 128;
    const centeredCr = cr - 128;
    return {
      r: clamp(Math.round(y + centeredCr * 1.402), 0, 255),
      g: clamp(Math.round(y - centeredCb * 0.344136 - centeredCr * 0.714136), 0, 255),
      b: clamp(Math.round(y + centeredCb * 1.772), 0, 255),
    };
  }

  /**
   * Executes the behavior of the reference `fp_kernel_09` chroma-key operation.
   * @param {Uint8ClampedArray|Uint8Array} source Source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{
   *   backgroundColor:{r:number,g:number,b:number},
   *   replacementColor?:Array<number>,
   *   cleanup?:number,
   *   feather?:number,
   *   mask?:Uint8Array|null
   * }} options Reference kernel options.
   * @returns {Uint8ClampedArray}
   */
  function applyReferenceChromaKey(source, width, height, options) {
    const pixelCount = width * height;
    if (!source || source.length !== pixelCount * 4) {
      throw new RangeError("Reference chroma-key RGBA length does not match its dimensions.");
    }
    const backgroundColor = options?.backgroundColor || { r: 0, g: 255, b: 0 };
    const replacement = Array.isArray(options?.replacementColor)
      ? options.replacementColor
      : [0, 0, 0, 0];
    const cleanupBand = Math.trunc(options?.cleanup ?? 40) * 0.6;
    const featherWidth = Math.trunc(options?.feather ?? 30) * 0.3;
    const outerBand = cleanupBand + featherWidth;
    const mask = options?.mask || null;
    if (mask && mask.length !== pixelCount) {
      throw new RangeError("Reference chroma-key mask length does not match its dimensions.");
    }
    const output = new Uint8ClampedArray(source);
    const backgroundLab = rgbToOklab(backgroundColor.r, backgroundColor.g, backgroundColor.b);
    const backgroundYcbcr = rgbToReferenceYcbcr(backgroundColor.r, backgroundColor.g, backgroundColor.b);
    const backgroundChromatic = backgroundLab.chroma >= 0.02;
    const maximumBackgroundChroma = backgroundLab.chroma * 1.5;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      if (mask && !mask[pixel]) continue;
      const offset = pixel * 4;
      const sourceAlpha = source[offset + 3];
      if (!sourceAlpha) continue;
      const red = source[offset];
      const green = source[offset + 1];
      const blue = source[offset + 2];
      let innerBand = cleanupBand;
      if (backgroundChromatic) {
        const pixelLab = rgbToOklab(red, green, blue);
        if (pixelLab.l < 0.22 || pixelLab.chroma < 0.03) continue;
        const hueWeight = 1 - smoothstep(15, 30, hueDistance(pixelLab.hue, backgroundLab.hue));
        if (!hueWeight) continue;
        let magnitudeWeight = 0;
        if (pixelLab.chroma <= backgroundLab.chroma) {
          magnitudeWeight = pixelLab.chroma / backgroundLab.chroma;
        } else {
          if (pixelLab.chroma >= maximumBackgroundChroma) continue;
          magnitudeWeight = 1 - smoothstep(
            backgroundLab.chroma,
            maximumBackgroundChroma,
            pixelLab.chroma,
          );
        }
        if (!magnitudeWeight) continue;
        innerBand *= hueWeight * magnitudeWeight;
      }
      const pixelYcbcr = rgbToReferenceYcbcr(red, green, blue);
      const deltaCb = pixelYcbcr.cb - backgroundYcbcr.cb;
      const deltaCr = pixelYcbcr.cr - backgroundYcbcr.cr;
      const chromaDistance = Math.sqrt(deltaCb * deltaCb + deltaCr * deltaCr);
      if (innerBand >= chromaDistance) {
        output[offset] = replacement[0] || 0;
        output[offset + 1] = replacement[1] || 0;
        output[offset + 2] = replacement[2] || 0;
        output[offset + 3] = replacement[3] || 0;
        continue;
      }
      if (featherWidth <= 0 || chromaDistance > outerBand) continue;
      const blend = (chromaDistance - innerBand) / (outerBand - innerBand);
      if (!(replacement[3] || 0)) {
        output[offset] = red;
        output[offset + 1] = green;
        output[offset + 2] = blue;
        output[offset + 3] = Math.round(sourceAlpha * blend);
        continue;
      }
      const replacementWeight = 1 - blend;
      const correctedCb = pixelYcbcr.cb - replacementWeight * deltaCb - 128;
      const correctedCr = pixelYcbcr.cr - replacementWeight * deltaCr - 128;
      const correctedRed = clamp(Math.round(pixelYcbcr.y + correctedCr * 1.402), 0, 255);
      const correctedGreen = clamp(
        Math.round(pixelYcbcr.y - correctedCb * 0.344136 - correctedCr * 0.714136),
        0,
        255,
      );
      const correctedBlue = clamp(Math.round(pixelYcbcr.y + correctedCb * 1.772), 0, 255);
      output[offset] = Math.round(correctedRed * blend + replacement[0] * replacementWeight);
      output[offset + 1] = Math.round(correctedGreen * blend + replacement[1] * replacementWeight);
      output[offset + 2] = Math.round(correctedBlue * blend + replacement[2] * replacementWeight);
      output[offset + 3] = Math.round(sourceAlpha * blend + replacement[3] * replacementWeight);
    }
    return output;
  }

  /**
   * Executes the reference chroma-key operation followed by its main-band OKLab despill.
   * @param {Uint8ClampedArray|Uint8Array} source Source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {object} options Reference chroma options.
   * @returns {{data:Uint8ClampedArray,removedPixels:number,partialPixels:number}}
   */
  function applyReferenceChromaKeyClean(source, width, height, options = {}) {
    const backgroundColor = options.backgroundColor || { r: 0, g: 255, b: 0 };
    const data = applyReferenceChromaKey(source, width, height, {
      backgroundColor,
      replacementColor: options.replacementColor || [0, 0, 0, 0],
      cleanup: options.cleanup ?? 40,
      feather: options.feather ?? 30,
      mask: options.mask || null,
    });
    const strength = clamp(options.despillStrength ?? 70, 0, 100) / 100;
    if (strength > 0) {
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        const offset = pixel * 4;
        applyReferenceDespillPixel(data, offset, backgroundColor, strength);
        if (options.mask && !options.mask[pixel]) {
          data[offset] = source[offset];
          data[offset + 1] = source[offset + 1];
          data[offset + 2] = source[offset + 2];
        }
      }
    }
    let removedPixels = 0;
    let partialPixels = 0;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      if (source[offset + 3] > 0 && data[offset + 3] === 0) removedPixels += 1;
      else if (data[offset + 3] < source[offset + 3]) partialPixels += 1;
    }
    return { data, removedPixels, partialPixels };
  }

  /**
   * Estimates the dominant visible color around the image perimeter.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixel data.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @returns {{r:number,g:number,b:number,hex:string,sampleCount:number}}
   */
  function estimateBackgroundColor(data, width, height) {
    const buckets = new Map();
    const edgeDepth = Math.max(1, Math.min(12, Math.ceil(Math.min(width, height) * 0.04)));
    const addPixel = (x, y) => {
      const offset = (y * width + x) * 4;
      if ((data[offset + 3] || 0) < 16) return;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const key = `${red >> 4},${green >> 4},${blue >> 4}`;
      const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
      bucket.r += red;
      bucket.g += green;
      bucket.b += blue;
      bucket.count += 1;
      buckets.set(key, bucket);
    };

    for (let y = 0; y < height; y += 1) {
      for (let depth = 0; depth < edgeDepth; depth += 1) {
        addPixel(depth, y);
        addPixel(width - 1 - depth, y);
      }
    }
    for (let x = edgeDepth; x < width - edgeDepth; x += 1) {
      for (let depth = 0; depth < edgeDepth; depth += 1) {
        addPixel(x, depth);
        addPixel(x, height - 1 - depth);
      }
    }

    let dominant = null;
    for (const bucket of buckets.values()) {
      if (!dominant || bucket.count > dominant.count) dominant = bucket;
    }
    if (!dominant?.count) {
      return { r: 255, g: 255, b: 255, hex: "#ffffff", sampleCount: 0 };
    }
    const color = {
      r: Math.round(dominant.r / dominant.count),
      g: Math.round(dominant.g / dominant.count),
      b: Math.round(dominant.b / dominant.count),
    };
    return { ...color, hex: rgbToHex(color), sampleCount: dominant.count };
  }

  /**
   * Produces an edge-connected removal mask using an iterative flood fill.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixel data.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{r:number,g:number,b:number}} backgroundColor Background color.
   * @param {number} maximumDistance Maximum accepted normalized color distance.
   * @returns {Uint8Array}
   */
  function connectedRemovalMask(data, width, height, backgroundColor, maximumDistance) {
    const pixelCount = width * height;
    const visited = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;

    const enqueue = (index) => {
      if (index < 0 || index >= pixelCount || visited[index]) return;
      const offset = index * 4;
      if ((data[offset + 3] || 0) === 0) {
        visited[index] = 1;
        queue[tail] = index;
        tail += 1;
        return;
      }
      if (colorDistance(data[offset], data[offset + 1], data[offset + 2], backgroundColor) > maximumDistance) return;
      visited[index] = 1;
      queue[tail] = index;
      tail += 1;
    };

    for (let x = 0; x < width; x += 1) {
      enqueue(x);
      enqueue((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueue(y * width);
      enqueue(y * width + width - 1);
    }

    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) enqueue(index - 1);
      if (x + 1 < width) enqueue(index + 1);
      if (y > 0) enqueue(index - width);
      if (y + 1 < height) enqueue(index + width);
    }
    return visited;
  }

  /**
   * Flood-fills a binary candidate mask with scanline spans.
   * @param {Uint8Array} candidates Non-zero pixels can be selected.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{
   *   seeds?:Array<{x:number,y:number}>,
   *   selectionMask?:Uint8Array|null,
   *   maximumPixels?:number
   * }} options Fill constraints.
   * @returns {Uint8Array}
   */
  function connectedCandidateMask(candidates, width, height, options = {}) {
    const pixelCount = width * height;
    const selected = new Uint8Array(pixelCount);
    const selectionMask = options.selectionMask || null;
    const maximumPixels = Math.max(1, Math.min(pixelCount, Number(options.maximumPixels || pixelCount)));
    const stack = [];
    let selectedPixels = 0;
    const allowed = (index) => (
      index >= 0
      && index < pixelCount
      && candidates[index]
      && !selected[index]
      && (!selectionMask || selectionMask[index])
    );
    const pushSeed = (x, y) => {
      const safeX = Math.round(x);
      const safeY = Math.round(y);
      if (safeX < 0 || safeY < 0 || safeX >= width || safeY >= height) return;
      const index = safeY * width + safeX;
      if (allowed(index)) stack.push(index);
    };
    const seeds = Array.isArray(options.seeds) && options.seeds.length ? options.seeds : null;
    if (seeds) {
      seeds.forEach((seed) => pushSeed(seed.x, seed.y));
    } else {
      for (let x = 0; x < width; x += 1) {
        pushSeed(x, 0);
        pushSeed(x, height - 1);
      }
      for (let y = 1; y < height - 1; y += 1) {
        pushSeed(0, y);
        pushSeed(width - 1, y);
      }
    }

    while (stack.length && selectedPixels < maximumPixels) {
      const seedIndex = stack.pop();
      if (!allowed(seedIndex)) continue;
      const seedY = Math.floor(seedIndex / width);
      let left = seedIndex % width;
      let right = left;
      while (left > 0 && allowed(seedY * width + left - 1)) left -= 1;
      while (right + 1 < width && allowed(seedY * width + right + 1)) right += 1;
      for (let x = left; x <= right && selectedPixels < maximumPixels; x += 1) {
        const index = seedY * width + x;
        if (!allowed(index)) continue;
        selected[index] = 1;
        selectedPixels += 1;
        if (seedY > 0 && allowed(index - width)) stack.push(index - width);
        if (seedY + 1 < height && allowed(index + width)) stack.push(index + width);
      }
    }
    return selected;
  }

  /**
   * Builds the squared RGBA radius used by `fp_kernel_06` and `fp_kernel_10`.
   * @param {number} tolerance Integer tolerance in the range normally exposed as 0-100.
   * @returns {number}
   */
  function referenceRgbaToleranceSquared(tolerance) {
    const radius = (Math.trunc(tolerance) / 100) * 2 * 255;
    return radius * radius;
  }

  /**
   * Tests an RGBA pixel against the reference kernel's Euclidean threshold.
   * @param {Uint8ClampedArray|Uint8Array} source RGBA source pixels.
   * @param {number} pixel Pixel index.
   * @param {{r:number,g:number,b:number,a?:number}} referenceColor Reference color.
   * @param {number} thresholdSquared Squared RGBA threshold.
   * @returns {boolean}
   */
  function referenceRgbaMatches(source, pixel, referenceColor, thresholdSquared) {
    const offset = pixel * 4;
    const referenceAlpha = referenceColor.a == null ? 255 : (referenceColor.a & 255);
    const deltaRed = source[offset] - (referenceColor.r & 255);
    const deltaGreen = source[offset + 1] - (referenceColor.g & 255);
    const deltaBlue = source[offset + 2] - (referenceColor.b & 255);
    const deltaAlpha = source[offset + 3] - referenceAlpha;
    return (
      deltaRed * deltaRed
      + deltaGreen * deltaGreen
      + deltaBlue * deltaBlue
      + deltaAlpha * deltaAlpha
    ) <= thresholdSquared;
  }

  /**
   * Rebuilds `fp_kernel_06`: a four-neighbour scanline diffusion from one seed.
   * A maximum-pixel overflow rejects the whole candidate instead of truncating it.
   * @param {Uint8ClampedArray|Uint8Array} source RGBA source pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{x:number,y:number}} seed Rounded seed coordinate.
   * @param {{r:number,g:number,b:number,a?:number}} referenceColor Reference RGBA color.
   * @param {number} tolerance Integer tolerance.
   * @param {number} [maximumPixels=0] Zero disables the region-size cap.
   * @returns {Uint8Array|null}
   */
  function diffuseReferenceCandidateMask(
    source,
    width,
    height,
    seed,
    referenceColor,
    tolerance,
    maximumPixels = 0,
  ) {
    const pixelCount = width * height;
    if (width <= 0 || height <= 0 || !source || source.length !== pixelCount * 4) return null;
    const seedX = Math.round(seed?.x);
    const seedY = Math.round(seed?.y);
    if (seedX < 0 || seedX >= width || seedY < 0 || seedY >= height) return null;
    const thresholdSquared = referenceRgbaToleranceSquared(tolerance);
    const seedIndex = seedY * width + seedX;
    if (!referenceRgbaMatches(source, seedIndex, referenceColor, thresholdSquared)) return null;
    const selected = new Uint8Array(pixelCount);
    const visited = new Uint8Array(pixelCount);
    const stack = [seedIndex];
    visited[seedIndex] = 1;
    const limit = Number.isFinite(maximumPixels) && maximumPixels > 0
      ? Math.min(Math.trunc(maximumPixels), 0x7fffffff)
      : 0;
    let selectedPixels = 0;
    while (stack.length) {
      const current = stack.pop();
      const y = Math.floor(current / width);
      let left = current % width;
      let right = left;
      while (
        left > 0
        && !visited[y * width + left - 1]
        && referenceRgbaMatches(source, y * width + left - 1, referenceColor, thresholdSquared)
      ) {
        left -= 1;
      }
      while (
        right + 1 < width
        && !visited[y * width + right + 1]
        && referenceRgbaMatches(source, y * width + right + 1, referenceColor, thresholdSquared)
      ) {
        right += 1;
      }
      for (let x = left; x <= right; x += 1) {
        const index = y * width + x;
        if (!visited[index]) visited[index] = 1;
        if (!referenceRgbaMatches(source, index, referenceColor, thresholdSquared)) continue;
        if (!selected[index]) {
          selected[index] = 255;
          selectedPixels += 1;
          if (limit > 0 && selectedPixels > limit) return null;
        }
        if (y > 0) {
          const above = index - width;
          if (!visited[above] && referenceRgbaMatches(source, above, referenceColor, thresholdSquared)) {
            visited[above] = 1;
            stack.push(above);
          }
        }
        if (y + 1 < height) {
          const below = index + width;
          if (!visited[below] && referenceRgbaMatches(source, below, referenceColor, thresholdSquared)) {
            visited[below] = 1;
            stack.push(below);
          }
        }
      }
    }
    return selectedPixels > 0 ? selected : null;
  }

  /**
   * Rebuilds `fp_kernel_10`: selects every RGBA pixel inside the reference radius.
   * @param {Uint8ClampedArray|Uint8Array} source RGBA source pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{r:number,g:number,b:number,a?:number}} referenceColor Reference RGBA color.
   * @param {number} tolerance Integer tolerance.
   * @returns {Uint8Array|null}
   */
  function diffuseReferenceGlobalCandidateMask(source, width, height, referenceColor, tolerance) {
    const pixelCount = width * height;
    if (width <= 0 || height <= 0 || !source || source.length !== pixelCount * 4) return null;
    const thresholdSquared = referenceRgbaToleranceSquared(tolerance);
    const selected = new Uint8Array(pixelCount);
    let selectedPixels = 0;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      if (!referenceRgbaMatches(source, pixel, referenceColor, thresholdSquared)) continue;
      selected[pixel] = 255;
      selectedPixels += 1;
    }
    return selectedPixels > 0 ? selected : null;
  }

  /**
   * Creates the reference directional protection mask. Mask bytes intentionally
   * use one for internal state while public selection masks continue to require 255.
   * @param {Uint8ClampedArray|Uint8Array} source RGBA source pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{r:number,g:number,b:number}} backgroundColor Reference/background color.
   * @param {Array<{r:number,g:number,b:number}|number[]>} protectedColors Protected colors.
   * @returns {Uint8Array|null}
   */
  function createReferenceProtectionMask(source, width, height, backgroundColor, protectedColors) {
    if (!Array.isArray(protectedColors) || !protectedColors.length) return null;
    const background = referenceProtectionDescriptor(
      backgroundColor.r,
      backgroundColor.g,
      backgroundColor.b,
    );
    const descriptors = protectedColors.slice(0, 32).map((color) => (
      referenceProtectionDescriptor(
        Array.isArray(color) ? color[0] : color.r,
        Array.isArray(color) ? color[1] : color.g,
        Array.isArray(color) ? color[2] : color.b,
      )
    ));
    const protectedMask = new Uint8Array(width * height);
    for (let pixel = 0; pixel < protectedMask.length; pixel += 1) {
      const offset = pixel * 4;
      if (!source[offset + 3]) continue;
      if (descriptors.some((descriptor) => referenceProtectionMatches(
        background,
        descriptor,
        source[offset],
        source[offset + 1],
        source[offset + 2],
      ))) protectedMask[pixel] = 1;
    }
    return protectedMask;
  }

  /**
   * Applies the reference Alpha high/low threshold branch in its original order.
   * @param {Uint8ClampedArray} data Mutable RGBA pixels.
   * @param {Uint8Array|null} operationMask Optional public 255 mask.
   * @param {number} high Alpha values above this value become opaque.
   * @param {number} low Alpha values below this value become transparent.
   * @returns {void}
   */
  function applyReferenceAlphaThresholds(data, operationMask, high, low) {
    const highThreshold = Math.trunc(high || 0) & 255;
    const lowThreshold = Math.trunc(low || 0) & 255;
    if ((!highThreshold && !lowThreshold) || highThreshold < lowThreshold) return;
    if (!lowThreshold && highThreshold === 255) return;
    for (let pixel = 0; pixel < data.length / 4; pixel += 1) {
      if (operationMask && operationMask[pixel] !== 255) continue;
      const alphaOffset = pixel * 4 + 3;
      const alpha = data[alphaOffset];
      if (highThreshold && alpha > highThreshold) data[alphaOffset] = 255;
      else if (lowThreshold && alpha < lowThreshold) data[alphaOffset] = 0;
    }
  }

  /**
   * Applies the byte-YCbCr directional despill stage shared by the public color
   * replacement and flood-fill kernels.
   * @param {Uint8ClampedArray} data Mutable RGBA pixels.
   * @param {Uint8Array|null} selectedMask Replaced pixels.
   * @param {Uint8Array|null} operationMask Optional public 255 mask.
   * @param {Uint8Array|null} protectedMask Protected pixels.
   * @param {{r:number,g:number,b:number}} referenceColor Despill direction.
   * @param {number} strength Strength in the range 0-100.
   * @returns {void}
   */
  function applyReferenceDirectionalDespill(
    data,
    selectedMask,
    operationMask,
    protectedMask,
    referenceColor,
    strength,
  ) {
    const normalizedStrength = Math.min(100, Math.max(0, Math.trunc(strength || 0))) / 100;
    if (!normalizedStrength) return;
    const reference = rgbToReferenceYcbcr(referenceColor.r, referenceColor.g, referenceColor.b);
    const referenceCb = reference.cb - 128;
    const referenceCr = reference.cr - 128;
    const referenceChroma = Math.hypot(referenceCb, referenceCr);
    if (referenceChroma < 5) return;
    const directionCb = referenceCb / referenceChroma;
    const directionCr = referenceCr / referenceChroma;
    for (let pixel = 0; pixel < data.length / 4; pixel += 1) {
      if (
        (operationMask && operationMask[pixel] !== 255)
        || protectedMask?.[pixel]
        || selectedMask?.[pixel]
      ) continue;
      const offset = pixel * 4;
      if (!data[offset + 3]) continue;
      const converted = rgbToReferenceYcbcr(data[offset], data[offset + 1], data[offset + 2]);
      const centeredCb = converted.cb - 128;
      const centeredCr = converted.cr - 128;
      if (Math.hypot(centeredCb, centeredCr) < 3) continue;
      const projection = centeredCb * directionCb + centeredCr * directionCr;
      if (projection <= 0) continue;
      const removal = projection * normalizedStrength;
      const convertedRgb = referenceYcbcrToRgb(
        converted.y,
        centeredCb - removal * directionCb + 128,
        centeredCr - removal * directionCr + 128,
      );
      data[offset] = convertedRgb.r;
      data[offset + 1] = convertedRgb.g;
      data[offset + 2] = convertedRgb.b;
    }
  }

  /**
   * Builds the shared reconstruction configuration used by public kernel 07.
   * @param {{r:number,g:number,b:number,a:number}} referenceColor Sampled color.
   * @param {{r:number,g:number,b:number,a:number}} replacementColor Replacement color.
   * @param {{r:number,g:number,b:number}|null} despillReferenceColor Optional despill axis color.
   * @param {number} strength Blend strength in the range 0-100.
   * @returns {object}
   */
  function createReferenceBlendConfiguration(
    referenceColor,
    replacementColor,
    despillReferenceColor,
    strength,
  ) {
    const fallbackReference = despillReferenceColor
      && (despillReferenceColor.r || despillReferenceColor.g || despillReferenceColor.b)
      ? despillReferenceColor
      : referenceColor;
    const replacementLinear = [
      referenceSrgbToLinear(replacementColor.r),
      referenceSrgbToLinear(replacementColor.g),
      referenceSrgbToLinear(replacementColor.b),
    ];
    const referenceLinear = [
      referenceSrgbToLinear(fallbackReference.r),
      referenceSrgbToLinear(fallbackReference.g),
      referenceSrgbToLinear(fallbackReference.b),
    ];
    const axis = referenceLinear.map((channel, index) => channel - replacementLinear[index]);
    const axisLengthSquared = axis.reduce((sum, channel) => sum + channel * channel, 0);
    const replacementYcbcr = rgbToReferenceYcbcr(
      replacementColor.r,
      replacementColor.g,
      replacementColor.b,
    );
    const referenceYcbcr = rgbToReferenceYcbcr(
      fallbackReference.r,
      fallbackReference.g,
      fallbackReference.b,
    );
    const referenceCb = referenceYcbcr.cb - 128;
    const referenceCr = referenceYcbcr.cr - 128;
    const referenceChroma = Math.hypot(referenceCb, referenceCr);
    return {
      strength: Math.min(100, Math.max(0, Math.trunc(strength || 0))) / 100,
      replacementAlpha: replacementColor.a / 255,
      replacementAlphaByte: replacementColor.a,
      referenceAlphaByte: referenceColor.a,
      replacementLinear,
      referenceLinear,
      axis,
      axisLengthSquared,
      halfAxisLengthSquared: axisLengthSquared * 0.5,
      hasLinearAxis: axisLengthSquared >= 0.0001,
      replacementCb: replacementYcbcr.cb,
      replacementCr: replacementYcbcr.cr,
      referenceChroma,
      referenceDirectionCb: referenceChroma >= 5 ? referenceCb / referenceChroma : 0,
      referenceDirectionCr: referenceChroma >= 5 ? referenceCr / referenceChroma : 0,
    };
  }

  /**
   * Rebuilds the public linear-axis recovery branch (`f_n`).
   * @param {object} configuration Shared blend configuration.
   * @param {number} red Source red channel.
   * @param {number} green Source green channel.
   * @param {number} blue Source blue channel.
   * @param {number} alpha Source alpha channel.
   * @param {boolean} includeAuxiliary Whether hybrid confidence data is required.
   * @returns {{valid:boolean,linear:number[],alpha:number,confidence:number,magnitude:number}}
   */
  function recoverReferenceLinearAxis(
    configuration,
    red,
    green,
    blue,
    alpha,
    includeAuxiliary,
  ) {
    if (!alpha) return { valid: false };
    if (!configuration.hasLinearAxis) {
      const converted = rgbToReferenceYcbcr(red, green, blue);
      const centeredCb = converted.cb - 128;
      const centeredCr = converted.cr - 128;
      if (Math.hypot(centeredCb, centeredCr) < 3) return { valid: false };
      const projection = centeredCb * configuration.referenceDirectionCb
        + centeredCr * configuration.referenceDirectionCr;
      if (projection <= 0) return { valid: false };
      const removal = -configuration.strength * projection;
      const recovered = referenceYcbcrToRgb(
        converted.y,
        centeredCb + removal * configuration.referenceDirectionCb + 128,
        centeredCr + removal * configuration.referenceDirectionCr + 128,
      );
      return {
        valid: true,
        linear: [
          referenceSrgbToLinear(recovered.r),
          referenceSrgbToLinear(recovered.g),
          referenceSrgbToLinear(recovered.b),
        ],
        alpha: alpha / 255,
        confidence: includeAuxiliary ? 1 : 0,
        magnitude: 0,
      };
    }
    const pixelLinear = [
      referenceSrgbToLinear(red),
      referenceSrgbToLinear(green),
      referenceSrgbToLinear(blue),
    ];
    const relative = pixelLinear.map(
      (channel, index) => channel - configuration.replacementLinear[index],
    );
    const projection = relative.reduce(
      (sum, channel, index) => sum + channel * configuration.axis[index],
      0,
    ) / configuration.axisLengthSquared;
    if (projection <= 0.01) return { valid: false };
    const residual = relative.map(
      (channel, index) => channel - projection * configuration.axis[index],
    );
    const residualSquared = residual.reduce((sum, channel) => sum + channel * channel, 0);
    if (!(residualSquared < configuration.halfAxisLengthSquared)) return { valid: false };
    const confidence = 1 - residualSquared / configuration.halfAxisLengthSquared;
    if (confidence <= 0) return { valid: false };
    const magnitude = Math.min(1, projection) * confidence;
    const colorStrength = Math.sqrt(configuration.strength * magnitude);
    const converted = rgbToReferenceYcbcr(red, green, blue);
    const recovered = referenceYcbcrToRgb(
      converted.y,
      colorStrength * (configuration.replacementCb - converted.cb) + converted.cb,
      colorStrength * (configuration.replacementCr - converted.cr) + converted.cr,
    );
    return {
      valid: true,
      linear: [
        referenceSrgbToLinear(recovered.r),
        referenceSrgbToLinear(recovered.g),
        referenceSrgbToLinear(recovered.b),
      ],
      alpha: (
        configuration.strength
          * magnitude
          * (configuration.replacementAlphaByte - configuration.referenceAlphaByte)
        + alpha
      ) / 255,
      confidence: includeAuxiliary ? confidence : 0,
      magnitude: includeAuxiliary ? magnitude : 0,
    };
  }

  /**
   * Rebuilds the public compositing recovery branch (`f_o`).
   * @param {object} configuration Shared blend configuration.
   * @param {number} red Source red channel.
   * @param {number} green Source green channel.
   * @param {number} blue Source blue channel.
   * @param {number} alpha Source alpha channel.
   * @param {boolean} includeAuxiliary Whether hybrid confidence data is required.
   * @returns {{valid:boolean,linear:number[],alpha:number,confidence:number,ratio:number,fallback:number}}
   */
  function recoverReferenceComposite(
    configuration,
    red,
    green,
    blue,
    alpha,
    includeAuxiliary,
  ) {
    if (!alpha) return { valid: false };
    const converted = rgbToReferenceYcbcr(red, green, blue);
    const centeredCb = converted.cb - 128;
    const centeredCr = converted.cr - 128;
    const chroma = Math.hypot(centeredCb, centeredCr);
    const chromaRatio = chroma / configuration.referenceChroma;
    const chromaConfidence = chromaRatio <= 0.05
      ? 0
      : chromaRatio >= 0.2
        ? 1
        : (chromaRatio - 0.05) / 0.15;
    const directionProjection = centeredCb * configuration.referenceDirectionCb
      + centeredCr * configuration.referenceDirectionCr;
    if (chroma < 3 || directionProjection <= 0) {
      if (chroma < 3) return { valid: false };
      return {
        valid: true,
        linear: [
          referenceSrgbToLinear(red),
          referenceSrgbToLinear(green),
          referenceSrgbToLinear(blue),
        ],
        alpha: alpha / 255,
        confidence: includeAuxiliary ? chromaConfidence : 0,
        ratio: 0,
        fallback: includeAuxiliary ? 1 : 0,
      };
    }
    const ratio = clamp(directionProjection / configuration.referenceChroma, 0, 0.95);
    const reconstructionAmount = configuration.strength * ratio;
    const reconstructedAlpha = 1
      - ratio * configuration.strength * (1 - configuration.replacementAlpha);
    const pixelLinear = [
      referenceSrgbToLinear(red),
      referenceSrgbToLinear(green),
      referenceSrgbToLinear(blue),
    ];
    const recovered = [0, 0, 0];
    if (reconstructedAlpha > 0.02) {
      for (let channel = 0; channel < 3; channel += 1) {
        recovered[channel] = (
          reconstructionAmount * (
            configuration.replacementAlpha * configuration.replacementLinear[channel]
            - configuration.referenceLinear[channel]
          )
          + pixelLinear[channel]
        ) / reconstructedAlpha;
      }
    }
    const negativeMagnitude = recovered.reduce(
      (sum, channel) => sum + (channel < 0 ? -channel : 0),
      0,
    );
    const gamutConfidence = negativeMagnitude >= 0.1 ? 0 : 1 - negativeMagnitude / 0.1;
    const saturationPenalty = ratio > 0.6 ? Math.min(1, (ratio - 0.6) / 0.35) : 0;
    return {
      valid: true,
      linear: recovered,
      alpha: reconstructedAlpha,
      confidence: includeAuxiliary
        ? chromaConfidence * gamutConfidence * (1 - saturationPenalty * 0.5)
        : 0,
      ratio: includeAuxiliary ? ratio : 0,
      fallback: 0,
    };
  }

  /**
   * Applies the reference blend/reconstruction slot before Alpha thresholds.
   * Modes zero and three use linear-axis recovery, mode one reverses source
   * compositing, and mode two combines both branches by public confidence data.
   * @param {Uint8ClampedArray} data Mutable output pixels.
   * @param {Uint8ClampedArray|Uint8Array} source Original pixels.
   * @param {Uint8Array} selectedMask Replaced pixels.
   * @param {Uint8Array|null} operationMask Optional public 255 mask.
   * @param {Uint8Array|null} protectedMask Protected pixels.
   * @param {{r:number,g:number,b:number,a:number}} referenceColor Reference color.
   * @param {{r:number,g:number,b:number,a:number}} replacementColor Replacement color.
   * @param {number} strength Blend strength in the range 0-100.
   * @param {number} mode Reconstruction mode.
   * @param {{r:number,g:number,b:number}|null} despillReferenceColor Optional despill axis color.
   * @returns {void}
   */
  function applyReferenceBlendRecovery(
    data,
    source,
    selectedMask,
    operationMask,
    protectedMask,
    referenceColor,
    replacementColor,
    strength,
    mode,
    despillReferenceColor,
  ) {
    if (!Math.min(100, Math.max(0, Math.trunc(strength || 0)))) return;
    const configuration = createReferenceBlendConfiguration(
      referenceColor,
      replacementColor,
      despillReferenceColor,
      strength,
    );
    for (let pixel = 0; pixel < selectedMask.length; pixel += 1) {
      if (
        selectedMask[pixel]
        || protectedMask?.[pixel]
        || (operationMask && operationMask[pixel] !== 255)
      ) continue;
      const offset = pixel * 4;
      let recovered;
      if ((mode | 0) === 1) {
        recovered = recoverReferenceComposite(
          configuration,
          source[offset],
          source[offset + 1],
          source[offset + 2],
          source[offset + 3],
          false,
        );
      } else if ((mode | 0) === 2) {
        const linearRecovery = recoverReferenceLinearAxis(
          configuration,
          source[offset],
          source[offset + 1],
          source[offset + 2],
          source[offset + 3],
          true,
        );
        const compositeRecovery = recoverReferenceComposite(
          configuration,
          source[offset],
          source[offset + 1],
          source[offset + 2],
          source[offset + 3],
          true,
        );
        if (!linearRecovery.valid) recovered = compositeRecovery;
        else if (!compositeRecovery.valid) recovered = linearRecovery;
        else if (linearRecovery.confidence < 0.1 && compositeRecovery.confidence < 0.1) {
          recovered = linearRecovery;
        } else if (linearRecovery.confidence < 0.1) recovered = compositeRecovery;
        else if (compositeRecovery.confidence < 0.1) recovered = linearRecovery;
        else {
          const inverseRatio = 1 - compositeRecovery.ratio;
          const ratioWeight = inverseRatio <= 0.15
            ? 0
            : inverseRatio >= 0.4
              ? 1
              : (inverseRatio - 0.15) * 4;
          const magnitudeDelta = linearRecovery.magnitude - compositeRecovery.ratio;
          const deltaWeight = Math.abs(magnitudeDelta) <= 0.25
            ? 1
            : Math.abs(magnitudeDelta) >= 0.6
              ? 0
              : 1 - (Math.abs(magnitudeDelta) - 0.25) / 0.35;
          const adjustedLinearConfidence = linearRecovery.confidence
            + (1 - ratioWeight) * 0.15;
          const confidenceSum = compositeRecovery.confidence
            + adjustedLinearConfidence
            + 0.000001;
          const linearShare = adjustedLinearConfidence / confidenceSum;
          let directionGate = 0;
          if (compositeRecovery.fallback > 0 && magnitudeDelta > 0) directionGate = 1;
          else if (magnitudeDelta > 0.3) {
            directionGate = magnitudeDelta >= 0.5 ? 1 : (magnitudeDelta - 0.3) / 0.2;
          }
          const preliminaryWeight = (
            linearShare * (deltaWeight * 0.5 + 0.5)
            + (compositeRecovery.confidence <= linearRecovery.confidence ? 1 : 0)
              * (deltaWeight * -0.5 + 0.5)
          );
          const suppression = compositeRecovery.confidence * ratioWeight * directionGate;
          const linearWeight = preliminaryWeight * (1 - suppression);
          const compositeWeight = 1 - linearWeight;
          const linear = linearRecovery.linear.map((channel, index) => (
            linearWeight * channel + compositeWeight * compositeRecovery.linear[index]
          ));
          let alpha;
          if (suppression > 0.5) alpha = compositeRecovery.alpha;
          else {
            const alphaWeight = ((1 - ratioWeight) * (1 - linearShare) + linearShare)
              * (1 - suppression);
            if (deltaWeight > 0.5) {
              alpha = alphaWeight * linearRecovery.alpha
                + (1 - alphaWeight) * compositeRecovery.alpha;
            } else {
              const selectedAlpha = alphaWeight >= 0.5
                ? linearRecovery.alpha
                : compositeRecovery.alpha;
              alpha = selectedAlpha * 0.6
                + Math.min(linearRecovery.alpha, compositeRecovery.alpha) * 0.4;
            }
          }
          recovered = { valid: true, linear, alpha };
        }
      } else {
        recovered = recoverReferenceLinearAxis(
          configuration,
          source[offset],
          source[offset + 1],
          source[offset + 2],
          source[offset + 3],
          false,
        );
      }
      if (!recovered?.valid) continue;
      data[offset] = referenceLinearToSrgb(recovered.linear[0]);
      data[offset + 1] = referenceLinearToSrgb(recovered.linear[1]);
      data[offset + 2] = referenceLinearToSrgb(recovered.linear[2]);
      data[offset + 3] = clamp(Math.trunc(recovered.alpha * 255 + 0.5), 0, 255);
    }
  }

  /**
   * Restores the non-zero-radius boundary produced by reference replacement.
   * Mode zero grows replacement RGBA, mode one subtracts the sampled background,
   * and mode two performs the same recovery in YCbCr before Alpha reconstruction.
   * @param {Uint8ClampedArray} data Mutable replaced RGBA pixels.
   * @param {Uint8ClampedArray|Uint8Array} source Original RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {Uint8Array} selectedMask Replaced pixels.
   * @param {Uint8Array|null} operationMask Optional public 255 mask.
   * @param {Uint8Array|null} protectedMask Protected pixels.
   * @param {{r:number,g:number,b:number,a:number}} referenceColor Sampled color.
   * @param {{r:number,g:number,b:number,a:number}} replacementColor Replacement color.
   * @param {number} radius Edge radius.
   * @param {number} mode Reference recovery mode.
   * @param {number} selectionThresholdSquared Squared RGBA selection tolerance.
   * @returns {void}
   */
  function restoreReferenceReplacementEdges(
    data,
    source,
    width,
    height,
    selectedMask,
    operationMask,
    protectedMask,
    referenceColor,
    replacementColor,
    radius,
    mode,
    selectionThresholdSquared,
  ) {
    const safeRadius = Math.max(0, Math.min(600, Math.trunc(radius || 0)));
    if (!safeRadius) return;
    const pixelCount = width * height;
    const edgeSource = new Uint8ClampedArray(data);
    const visited = new Uint8Array(pixelCount);
    let frontier = new Uint8Array(pixelCount);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      if (selectedMask[pixel] !== 1) continue;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (
        (x > 0 && !selectedMask[pixel - 1])
        || (x + 1 < width && !selectedMask[pixel + 1])
        || (y > 0 && !selectedMask[pixel - width])
        || (y + 1 < height && !selectedMask[pixel + width])
      ) frontier[pixel] = 1;
    }
    const referenceLinear = [
      referenceSrgbToLinear(referenceColor.r),
      referenceSrgbToLinear(referenceColor.g),
      referenceSrgbToLinear(referenceColor.b),
    ];
    const replacementLinear = [
      referenceSrgbToLinear(replacementColor.r),
      referenceSrgbToLinear(replacementColor.g),
      referenceSrgbToLinear(replacementColor.b),
    ];
    const linearAxis = referenceLinear.map(
      (channel, index) => channel - replacementLinear[index],
    );
    const linearAxisLengthSquared = linearAxis.reduce(
      (sum, channel) => sum + channel * channel,
      0,
    );
    const halfLinearAxisLengthSquared = linearAxisLengthSquared * 0.5;
    const replacementYcbcr = rgbToReferenceYcbcr(
      replacementColor.r,
      replacementColor.g,
      replacementColor.b,
    );
    let minimumAlpha = replacementColor.a;
    let maximumAlpha = replacementColor.a;
    const alphaDelta = replacementColor.a - referenceColor.a;

    /**
     * Returns the public eight-neighbor minimum alpha among earlier edge layers.
     * @param {number} pixel Pixel index.
     * @returns {number}
     */
    const minimumVisitedNeighborAlpha = (pixel) => {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      let minimum = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          const neighborX = x + offsetX;
          const neighborY = y + offsetY;
          if (
            neighborX < 0
            || neighborX >= width
            || neighborY < 0
            || neighborY >= height
          ) continue;
          const neighbor = neighborY * width + neighborX;
          if (!visited[neighbor]) continue;
          const alpha = data[neighbor * 4 + 3];
          if (!minimum || alpha < minimum) minimum = alpha;
        }
      }
      return minimum;
    };

    /**
     * Applies the public Alpha bounds and opaque-neighbor recovery.
     * @param {number} pixel Pixel index.
     * @param {number} candidate Candidate alpha.
     * @param {number} layer Current one-based layer.
     * @returns {number}
     */
    const constrainLayerAlpha = (pixel, candidate, layer) => {
      let alpha = clamp(Math.trunc(candidate + 0.5), 0, 255);
      if (alphaDelta > 0) alpha = Math.min(alpha, maximumAlpha);
      else if (alphaDelta < 0) {
        alpha = Math.max(alpha, minimumAlpha);
        const neighborAlpha = minimumVisitedNeighborAlpha(pixel);
        if (neighborAlpha >= 241) {
          const recovered = Math.trunc(
            (layer / safeRadius) * (255 - neighborAlpha) + neighborAlpha + 0.5,
          );
          alpha = Math.max(alpha, recovered);
        }
      }
      return alpha;
    };

    const modeNumber = mode | 0;
    const threshold = Math.max(0, Math.trunc(selectionThresholdSquared || 0));
    const expandedThreshold = Math.min(260100, threshold * 4);
    const thresholdRange = expandedThreshold - threshold;
    if (modeNumber === 0 && thresholdRange <= 0) return;
    if (
      modeNumber !== 0
      && referenceColor.a === replacementColor.a
      && linearAxisLengthSquared < 0.0001
    ) return;

    for (let layer = 1; layer <= safeRadius; layer += 1) {
      const next = new Uint8Array(pixelCount);
      let nextCount = 0;
      for (let pixel = 0; pixel < frontier.length; pixel += 1) {
        if (!frontier[pixel]) continue;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        const neighbors = [];
        if (x > 0) neighbors.push(pixel - 1);
        if (x + 1 < width) neighbors.push(pixel + 1);
        if (y > 0) neighbors.push(pixel - width);
        if (y + 1 < height) neighbors.push(pixel + width);
        for (const neighbor of neighbors) {
          if (
            selectedMask[neighbor]
            || visited[neighbor]
          ) continue;
          if (!next[neighbor]) {
            next[neighbor] = 1;
            nextCount += 1;
          }
        }
      }
      if (!nextCount) break;
      const layerWeight = 1 - (layer - 1) / safeRadius;
      const layerRatio = layer / safeRadius;
      let layerChanged = false;
      let alphaTotal = 0;
      let alphaCount = 0;
      for (let pixel = 0; pixel < next.length; pixel += 1) {
        if (!next[pixel]) continue;
        visited[pixel] = 1;
        const offset = pixel * 4;
        if (modeNumber === 0) {
          const redDelta = edgeSource[offset] - referenceColor.r;
          const greenDelta = edgeSource[offset + 1] - referenceColor.g;
          const blueDelta = edgeSource[offset + 2] - referenceColor.b;
          const distanceSquared = redDelta * redDelta
            + greenDelta * greenDelta
            + blueDelta * blueDelta;
          if (distanceSquared > expandedThreshold) {
            if (edgeSource[offset + 3] !== 255) layerChanged = true;
            continue;
          }
          const toleranceWeight = distanceSquared > threshold
            ? 1 - (distanceSquared - threshold) / thresholdRange
            : 1;
          const influence = toleranceWeight
            * (1 - (layer - 0.5) / safeRadius)
            * toleranceWeight;
          data[offset] = clamp(Math.trunc(edgeSource[offset]
            + (replacementColor.r - referenceColor.r) * influence + 0.5), 0, 255);
          data[offset + 1] = clamp(Math.trunc(edgeSource[offset + 1]
            + (replacementColor.g - referenceColor.g) * influence + 0.5), 0, 255);
          data[offset + 2] = clamp(Math.trunc(edgeSource[offset + 2]
            + (replacementColor.b - referenceColor.b) * influence + 0.5), 0, 255);
          data[offset + 3] = clamp(Math.trunc(edgeSource[offset + 3]
            + alphaDelta * influence + 0.5), 0, 255);
          layerChanged = true;
          continue;
        }
        if (linearAxisLengthSquared < 0.0001) {
          data[offset + 3] = constrainLayerAlpha(
            pixel,
            edgeSource[offset + 3] + layerWeight * alphaDelta,
            layer,
          );
          layerChanged = true;
          alphaTotal += data[offset + 3];
          alphaCount += 1;
          continue;
        }
        let projection = 0;
        let confidence = 0;
        const pixelLinear = [
          referenceSrgbToLinear(edgeSource[offset]),
          referenceSrgbToLinear(edgeSource[offset + 1]),
          referenceSrgbToLinear(edgeSource[offset + 2]),
        ];
        const relative = pixelLinear.map(
          (channel, index) => channel - replacementLinear[index],
        );
        projection = relative.reduce(
          (sum, channel, index) => sum + channel * linearAxis[index],
          0,
        ) / linearAxisLengthSquared;
        if (projection > 0.01) {
          if (modeNumber === 2) confidence = 1;
          else {
            const residual = relative.map(
              (channel, index) => channel - projection * linearAxis[index],
            );
            const residualSquared = residual.reduce(
              (sum, channel) => sum + channel * channel,
              0,
            );
            if (residualSquared < halfLinearAxisLengthSquared) {
              confidence = 1 - residualSquared / halfLinearAxisLengthSquared;
            }
          }
        }
        if (projection <= 0.01 || confidence <= 0) {
          alphaTotal += data[offset + 3];
          alphaCount += 1;
          continue;
        }
        const magnitude = Math.min(1, projection) * confidence;
        if (modeNumber === 2) {
          const colorInfluence = layerWeight * Math.sqrt(Math.min(1, projection));
          const converted = rgbToReferenceYcbcr(
            edgeSource[offset],
            edgeSource[offset + 1],
            edgeSource[offset + 2],
          );
          const recovered = referenceYcbcrToRgb(
            converted.y,
            colorInfluence * (replacementYcbcr.cb - converted.cb) + converted.cb,
            colorInfluence * (replacementYcbcr.cr - converted.cr) + converted.cr,
          );
          data[offset] = recovered.r;
          data[offset + 1] = recovered.g;
          data[offset + 2] = recovered.b;
          const alphaCandidate = projection < 0.3
            ? 255
            : edgeSource[offset + 3] + colorInfluence * alphaDelta;
          data[offset + 3] = constrainLayerAlpha(pixel, alphaCandidate, layer);
        } else {
          let taper = 1;
          if (linearAxisLengthSquared >= 0.0001 && safeRadius > 2 && layer > safeRadius * 0.7) {
            taper = Math.max(0.2, Math.min(1, (safeRadius - layer) / (safeRadius * 0.3)));
          }
          const colorScale = magnitude * -taper;
          for (let channel = 0; channel < 3; channel += 1) {
            data[offset + channel] = referenceLinearToSrgb(
              clamp(pixelLinear[channel] + colorScale * linearAxis[channel], 0, 1),
            );
          }
          data[offset + 3] = constrainLayerAlpha(
            pixel,
            edgeSource[offset + 3] + layerWeight * magnitude * alphaDelta,
            layer,
          );
        }
        layerChanged = true;
        alphaTotal += data[offset + 3];
        alphaCount += 1;
      }
      if (modeNumber !== 0 && alphaCount > 0) {
        const averageAlpha = Math.trunc(alphaTotal / alphaCount);
        if (alphaDelta > 0) {
          const blendedMaximum = Math.trunc((maximumAlpha * 2 + averageAlpha) / 3);
          maximumAlpha = Math.min(maximumAlpha, blendedMaximum);
        } else if (alphaDelta < 0) {
          const blendedMinimum = Math.trunc((replacementColor.a * 2 + averageAlpha) / 3);
          minimumAlpha = Math.max(minimumAlpha, blendedMinimum);
        }
      }
      frontier = next;
      if (modeNumber !== 0 && !layerChanged) break;
    }
  }

  /**
   * Runs the shared post-selection replacement pipeline used by kernels 07 and 13.
   * @param {Uint8ClampedArray|Uint8Array} source Original RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {Uint8Array} selectedMask Selected pixels.
   * @param {{r:number,g:number,b:number,a:number}} referenceColor Reference color.
   * @param {{r:number,g:number,b:number,a:number}} replacementColor Replacement color.
   * @param {object} options Pipeline options.
   * @param {number} selectionThresholdSquared Squared RGBA selection tolerance.
   * @returns {Uint8ClampedArray}
   */
  function applyReferenceReplacementPipeline(
    source,
    width,
    height,
    selectedMask,
    referenceColor,
    replacementColor,
    options,
    selectionThresholdSquared,
  ) {
    const operationMask = options.mask || null;
    const protectedMask = createReferenceProtectionMask(
      source,
      width,
      height,
      referenceColor,
      options.protectColors || [],
    );
    const output = new Uint8ClampedArray(source);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      if (
        !selectedMask[pixel]
        || (operationMask && operationMask[pixel] !== 255)
        || protectedMask?.[pixel]
      ) continue;
      const offset = pixel * 4;
      output[offset] = replacementColor.r;
      output[offset + 1] = replacementColor.g;
      output[offset + 2] = replacementColor.b;
      output[offset + 3] = replacementColor.a;
    }
    applyReferenceBlendRecovery(
      output,
      source,
      selectedMask,
      operationMask,
      protectedMask,
      referenceColor,
      replacementColor,
      options.blendStrength,
      options.despillMode,
      options.despillRefColor || null,
    );
    applyReferenceAlphaThresholds(
      output,
      operationMask,
      options.alphaThresholdHigh,
      options.alphaThresholdLow,
    );
    restoreReferenceReplacementEdges(
      output,
      source,
      width,
      height,
      selectedMask,
      operationMask,
      protectedMask,
      referenceColor,
      replacementColor,
      options.edgeRestoreRadius,
      options.edgeRestoreMode,
      selectionThresholdSquared,
    );
    const despillReference = options.despillRefColor || referenceColor;
    applyReferenceDirectionalDespill(
      output,
      selectedMask,
      operationMask,
      protectedMask,
      despillReference,
      options.despillStrength,
    );
    if (protectedMask) {
      for (let pixel = 0; pixel < protectedMask.length; pixel += 1) {
        if (!protectedMask[pixel]) continue;
        const offset = pixel * 4;
        output.set(source.subarray(offset, offset + 4), offset);
      }
    }
    return output;
  }

  /**
   * Rebuilds the public `fp_kernel_07` color-replacement entry point.
   * @param {Uint8ClampedArray|Uint8Array} source RGBA source pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{x:number,y:number}} seed Rounded reference coordinate.
   * @param {{r:number,g:number,b:number,a?:number}} fillColor Replacement color.
   * @param {number} tolerance Integer tolerance.
   * @param {object} [options] Reference pipeline options.
   * @returns {Uint8ClampedArray}
   */
  function applyReferenceColorReplace(source, width, height, seed, fillColor, tolerance, options = {}) {
    const pixelCount = width * height;
    if (width <= 0 || height <= 0 || !source || source.length !== pixelCount * 4) {
      throw new RangeError("Reference color-replace RGBA length does not match its dimensions.");
    }
    const operationMask = options.mask || null;
    if (operationMask && operationMask.length !== pixelCount) {
      throw new RangeError("Reference color-replace mask length does not match its dimensions.");
    }
    const seedX = Math.round(seed?.x);
    const seedY = Math.round(seed?.y);
    const output = new Uint8ClampedArray(source);
    if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return output;
    const seedOffset = (seedY * width + seedX) * 4;
    const referenceColor = options.referenceColor || {
      r: source[seedOffset],
      g: source[seedOffset + 1],
      b: source[seedOffset + 2],
      a: source[seedOffset + 3],
    };
    const reference = {
      r: referenceColor.r & 255,
      g: referenceColor.g & 255,
      b: referenceColor.b & 255,
      a: referenceColor.a == null ? 255 : (referenceColor.a & 255),
    };
    const replacement = {
      r: fillColor.r & 255,
      g: fillColor.g & 255,
      b: fillColor.b & 255,
      a: fillColor.a == null ? 255 : (fillColor.a & 255),
    };
    if (
      reference.r === replacement.r
      && reference.g === replacement.g
      && reference.b === replacement.b
      && reference.a === replacement.a
    ) return output;
    const safeTolerance = Math.trunc(tolerance);
    const edgeEnhance = Math.trunc(options.edgeEnhance || 0);
    const effectiveTolerance = safeTolerance < 0
      ? -1
      : (Math.max(0, 100 - safeTolerance) * edgeEnhance / 100 + safeTolerance);
    const thresholdSquared = effectiveTolerance < 0
      ? -1
      : Math.trunc((effectiveTolerance * 5.1) ** 2 + 0.5);
    const selectedMask = new Uint8Array(pixelCount);
    if (thresholdSquared >= 0) {
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        if (operationMask && operationMask[pixel] !== 255) continue;
        if (referenceRgbaMatches(source, pixel, reference, thresholdSquared)) selectedMask[pixel] = 1;
      }
    }
    return applyReferenceReplacementPipeline(
      source,
      width,
      height,
      selectedMask,
      reference,
      replacement,
      options,
      thresholdSquared,
    );
  }

  /**
   * Rebuilds `fp_kernel_13` flood-fill replacement and its shared edge pipeline.
   * @param {Uint8ClampedArray|Uint8Array} source RGBA source pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{x:number,y:number}} seed Rounded seed coordinate.
   * @param {{r:number,g:number,b:number,a?:number}} fillColor Replacement RGBA color.
   * @param {number} tolerance Integer tolerance.
   * @param {{referenceColor?:{r:number,g:number,b:number,a?:number}|null,mask?:Uint8Array|null,edgeRestoreRadius?:number}} [options] Kernel options.
   * @returns {Uint8ClampedArray}
   */
  function applyReferenceFloodFillDespill(
    source,
    width,
    height,
    seed,
    fillColor,
    tolerance,
    options = {},
  ) {
    const pixelCount = width * height;
    if (width <= 0 || height <= 0 || !source || source.length !== pixelCount * 4) {
      throw new RangeError("Reference flood-fill RGBA length does not match its dimensions.");
    }
    const mask = options.mask || null;
    if (mask && mask.length !== pixelCount) {
      throw new RangeError("Reference flood-fill mask length does not match its dimensions.");
    }
    const seedX = Math.round(seed?.x);
    const seedY = Math.round(seed?.y);
    const output = new Uint8ClampedArray(source);
    if (seedX < 0 || seedX >= width || seedY < 0 || seedY >= height) return output;
    const seedOffset = (seedY * width + seedX) * 4;
    const referenceColor = options.referenceColor || {
      r: source[seedOffset],
      g: source[seedOffset + 1],
      b: source[seedOffset + 2],
      a: source[seedOffset + 3],
    };
    const replacement = {
      r: fillColor.r & 255,
      g: fillColor.g & 255,
      b: fillColor.b & 255,
      a: fillColor.a == null ? 255 : (fillColor.a & 255),
    };
    const reference = {
      r: referenceColor.r & 255,
      g: referenceColor.g & 255,
      b: referenceColor.b & 255,
      a: referenceColor.a == null ? 255 : (referenceColor.a & 255),
    };
    if (
      replacement.r === reference.r
      && replacement.g === reference.g
      && replacement.b === reference.b
      && replacement.a === reference.a
    ) {
      return output;
    }
    const thresholdSquared = Math.trunc((Math.trunc(tolerance) * 5.1) ** 2 + 0.5);
    const candidates = new Uint8Array(pixelCount);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      if (mask && mask[pixel] !== 255) continue;
      if (referenceRgbaMatches(source, pixel, reference, thresholdSquared)) candidates[pixel] = 1;
    }
    const selected = connectedCandidateMask(candidates, width, height, {
      seeds: [{ x: seedX, y: seedY }],
      maximumPixels: pixelCount,
    });
    return applyReferenceReplacementPipeline(
      source,
      width,
      height,
      selected,
      reference,
      replacement,
      {
        ...options,
        protectColors: [],
        despillStrength: 0,
        alphaThresholdHigh: 0,
        alphaThresholdLow: 0,
      },
      thresholdSquared,
    );
  }

  /**
   * Computes a 3-4 chamfer distance to transparent pixels.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels or an alpha plane.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {boolean} [rgba=true] Whether data contains RGBA pixels.
   * @returns {Uint16Array}
   */
  function chamferDistanceToTransparent(data, width, height, rgba = true) {
    const pixelCount = width * height;
    const distance = new Uint16Array(pixelCount);
    const infinity = 0x3fff;
    for (let index = 0; index < pixelCount; index += 1) {
      const alpha = rgba ? data[index * 4 + 3] : data[index];
      distance[index] = alpha === 0 ? 0 : infinity;
    }
    const update = (index, neighbor, cost) => {
      if (neighbor < 0 || neighbor >= pixelCount) return;
      distance[index] = Math.min(distance[index], distance[neighbor] + cost);
    };
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (x > 0) update(index, index - 1, 3);
        if (y > 0) update(index, index - width, 3);
        if (x > 0 && y > 0) update(index, index - width - 1, 4);
        if (x + 1 < width && y > 0) update(index, index - width + 1, 4);
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const index = y * width + x;
        if (x + 1 < width) update(index, index + 1, 3);
        if (y + 1 < height) update(index, index + width, 3);
        if (x + 1 < width && y + 1 < height) update(index, index + width + 1, 4);
        if (x > 0 && y + 1 < height) update(index, index + width - 1, 4);
      }
    }
    return distance;
  }

  /**
   * Executes the reference `fp_kernel_04` 3-4-5 chamfer transform on a binary seed mask.
   * Non-zero mask cells are zero-distance seeds; all other cells start at 32767.
   * @param {Uint8Array} mask Binary seed mask.
   * @param {number} width Mask width.
   * @param {number} height Mask height.
   * @returns {Int16Array}
   */
  function chamfer345Distance(mask, width, height) {
    const pixelCount = width * height;
    const distance = new Int16Array(pixelCount);
    if (!mask || mask.length !== pixelCount || width <= 0 || height <= 0) {
      distance.fill(0x7fff);
      return distance;
    }
    for (let index = 0; index < pixelCount; index += 1) {
      distance[index] = mask[index] ? 0 : 0x7fff;
    }
    const update = (index, neighbor, cost) => {
      if (neighbor < 0 || neighbor >= pixelCount) return;
      distance[index] = Math.min(distance[index], distance[neighbor] + cost);
    };
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!distance[index]) continue;
        if (x > 0) update(index, index - 1, 3);
        if (y > 0) update(index, index - width, 3);
        if (x > 0 && y > 0) update(index, index - width - 1, 4);
        if (x + 1 < width && y > 0) update(index, index - width + 1, 4);
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const index = y * width + x;
        if (!distance[index]) continue;
        if (x + 1 < width) update(index, index + 1, 3);
        if (y + 1 < height) update(index, index + width, 3);
        if (x > 0 && y + 1 < height) update(index, index + width - 1, 4);
        if (x + 1 < width && y + 1 < height) update(index, index + width + 1, 4);
      }
    }
    return distance;
  }

  /**
   * Executes the reference `fp_kernel_03` connectivity proximity predicate.
   * @param {Uint8Array} mask Candidate mask.
   * @param {Int16Array} distance Reference chamfer distance plane.
   * @param {number} width Mask width.
   * @param {number} height Mask height.
   * @returns {boolean}
   */
  function isWithinConnectivityTolerance(mask, distance, width, height) {
    const pixelCount = width * height;
    if (!mask || !distance || mask.length !== pixelCount || distance.length !== pixelCount) return false;
    for (let index = 0; index < pixelCount; index += 1) {
      if (mask[index] && distance[index] < 10) return true;
    }
    return false;
  }

  /**
   * Builds the byte-scale YCbCr direction descriptor used by the reference
   * protection selector. Chroma values below three are treated as achromatic.
   * @param {number} red Red channel.
   * @param {number} green Green channel.
   * @param {number} blue Blue channel.
   * @returns {{r:number,g:number,b:number,y:number,chroma:number,dirCb:number,dirCr:number,achromatic:boolean}}
   */
  function referenceProtectionDescriptor(red, green, blue) {
    const color = rgbToReferenceYcbcr(red, green, blue);
    const centeredCb = color.cb - 128;
    const centeredCr = color.cr - 128;
    const chroma = Math.hypot(centeredCb, centeredCr);
    return {
      r: red & 255,
      g: green & 255,
      b: blue & 255,
      y: color.y,
      chroma,
      dirCb: chroma < 3 ? 0 : centeredCb / chroma,
      dirCr: chroma < 3 ? 0 : centeredCr / chroma,
      achromatic: chroma < 3,
    };
  }

  /**
   * Rebuilds the directional color-membership predicate shared by
   * `fp_kernel_07` and `fp_kernel_14`.
   * @param {ReturnType<referenceProtectionDescriptor>} background Background descriptor.
   * @param {ReturnType<referenceProtectionDescriptor>} candidate Candidate descriptor.
   * @param {number} red Pixel red channel.
   * @param {number} green Pixel green channel.
   * @param {number} blue Pixel blue channel.
   * @returns {boolean}
   */
  function referenceProtectionMatches(background, candidate, red, green, blue) {
    const directDistanceSquared = (
      (red - candidate.r) ** 2
      + (green - candidate.g) ** 2
      + (blue - candidate.b) ** 2
    );
    const pixel = referenceProtectionDescriptor(red, green, blue);
    if (pixel.achromatic) {
      if (!candidate.achromatic) return false;
      return directDistanceSquared < 145;
    }
    if (candidate.achromatic) {
      const candidateLinear = [
        srgbToLinear(candidate.r),
        srgbToLinear(candidate.g),
        srgbToLinear(candidate.b),
      ];
      const backgroundLinear = [
        srgbToLinear(background.r),
        srgbToLinear(background.g),
        srgbToLinear(background.b),
      ];
      const pixelLinear = [srgbToLinear(red), srgbToLinear(green), srgbToLinear(blue)];
      const axis = backgroundLinear.map((channel, index) => channel - candidateLinear[index]);
      const axisLengthSquared = axis.reduce((sum, channel) => sum + channel * channel, 0);
      if (axisLengthSquared < 0.0001) return false;
      const projection = pixelLinear.reduce((sum, channel, index) => (
        sum + (channel - candidateLinear[index]) * axis[index]
      ), 0) / axisLengthSquared;
      return projection <= 0.1 && directDistanceSquared < 301;
    }
    const directionDot = pixel.dirCb * candidate.dirCb + pixel.dirCr * candidate.dirCr;
    if (directionDot < 0.9) return false;
    if (
      directionDot >= 0.97
      && Math.abs(pixel.y - candidate.y) <= 5
      && Math.abs(pixel.chroma - candidate.chroma) <= 8
    ) {
      return true;
    }
    const crossAxis = background.chroma * (
      background.dirCb * candidate.dirCr - background.dirCr * candidate.dirCb
    );
    if (Math.abs(crossAxis) < 1) return false;
    const chromaPosition = pixel.chroma * (
      pixel.dirCb * candidate.dirCr - pixel.dirCr * candidate.dirCb
    ) / crossAxis;
    if (pixel.chroma > candidate.chroma * 1.3) return false;
    const lightnessAxis = background.y - candidate.y;
    if (
      Math.abs(lightnessAxis) > 2
      && chromaPosition + 0.2 < (pixel.y - candidate.y) / lightnessAxis
    ) {
      return false;
    }
    return chromaPosition <= 0.1;
  }

  /**
   * Selects protected colors with the reference direction-cluster and greedy
   * coverage semantics used by `fp_kernel_14`.
   * @param {Uint8ClampedArray|Uint8Array} data Source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{r:number,g:number,b:number}} backgroundColor Background/reference color.
   * @param {{
   *   coverageThreshold?:number,
   *   maximumColors?:number,
   *   existingColors?:Array<{r:number,g:number,b:number}|number[]>,
   *   previewData?:Uint8ClampedArray|Uint8Array|null,
   *   fullOriginalData?:Uint8ClampedArray|Uint8Array|null,
   *   fullPreviewData?:Uint8ClampedArray|Uint8Array|null,
   *   fullWidth?:number,
   *   fullHeight?:number
   * }} [options] Reference selection options.
   * @returns {{colors:Array<{r:number,g:number,b:number,count:number}>,count:number,coverage:number,status:number,sampleCount:number}}
   */
  function selectReferenceProtectedColors(data, width, height, backgroundColor, options = {}) {
    const pixelCount = width * height;
    if (width <= 0 || height <= 0 || !data || data.length !== pixelCount * 4) {
      throw new RangeError("Reference protection RGBA length does not match its dimensions.");
    }
    const previewData = options.previewData || null;
    if (previewData && previewData.length !== data.length) {
      throw new RangeError("Reference protection preview length does not match its source.");
    }
    const background = referenceProtectionDescriptor(
      backgroundColor.r,
      backgroundColor.g,
      backgroundColor.b,
    );
    const maximumColors = Math.max(1, Math.min(32, Math.trunc(options.maximumColors || 32)));
    const coverageThreshold = Math.max(0, Math.min(100, Math.trunc(options.coverageThreshold ?? 95)));
    const step = pixelCount >= 5001
      ? Math.max(1, Math.ceil(Math.sqrt(pixelCount / 5000)))
      : 1;
    const bucketCounts = new Uint32Array(4096);
    const samples = [];
    const centerX = width > 1 ? (width - 1) * 0.5 : 0;
    const centerY = height > 1 ? (height - 1) * 0.5 : 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        if (previewData && (previewData[offset + 3] === 0 || previewData[offset + 3] === 255)) continue;
        const descriptor = referenceProtectionDescriptor(data[offset], data[offset + 1], data[offset + 2]);
        const bucket = ((descriptor.r >> 4) << 8) | ((descriptor.g >> 4) << 4) | (descriptor.b >> 4);
        bucketCounts[bucket] += 1;
        samples.push({
          ...descriptor,
          sampleX: x,
          sampleY: y,
          radiusSquared: (x - centerX) ** 2 + (y - centerY) ** 2,
          bucket,
          weight: 0,
        });
      }
    }
    if (!samples.length) {
      return { colors: [], count: 0, coverage: 100, status: 0, sampleCount: 0 };
    }
    for (const sample of samples) {
      sample.weight = bucketCounts[sample.bucket] / samples.length;
      if (
        !sample.achromatic
        && sample.dirCb * background.dirCb + sample.dirCr * background.dirCr >= 0.9
      ) {
        sample.weight *= 0.1;
      }
    }
    samples.sort((left, right) => {
      if (left.achromatic !== right.achromatic) return left.achromatic ? 1 : -1;
      if (left.achromatic) return left.y - right.y;
      return Math.atan2(left.dirCr, left.dirCb) - Math.atan2(right.dirCr, right.dirCb);
    });
    const groups = [];
    let groupStart = 0;
    for (let index = 1; index <= samples.length; index += 1) {
      const previous = samples[index - 1];
      const current = samples[index];
      const sameDirection = current && (
        (previous.achromatic && current.achromatic)
        || (!previous.achromatic && !current.achromatic
          && previous.dirCb * current.dirCb + previous.dirCr * current.dirCr >= 0.9)
      );
      if (sameDirection) continue;
      groups.push(samples.slice(groupStart, index));
      groupStart = index;
    }
    const candidates = [];
    for (const group of groups) {
      const selected = [];
      if (group.length < 5) {
        const representative = [...group].sort((left, right) => (
          right.weight - left.weight || left.y - right.y || right.radiusSquared - left.radiusSquared
        ))[0];
        selected.push([...group]
          .filter((sample) => sample.bucket === representative.bucket)
          .sort((left, right) => left.r - right.r || left.g - right.g || left.b - right.b)[0]);
      } else {
        const weights = group.map((sample) => sample.weight);
        if (Math.max(...weights) < Math.min(...weights) * 3) {
          const byLightness = [...group].sort((left, right) => (
            left.y - right.y || right.radiusSquared - left.radiusSquared
          ));
          const neighborhood = Math.max(1, Math.trunc(group.length / 6));
          for (const quantile of [0.25, 0.5, 0.75]) {
            const center = Math.min(group.length - 1, Math.max(0, Math.trunc((group.length - 1) * quantile)));
            const start = Math.max(0, center - neighborhood);
            const end = Math.min(group.length - 1, center + neighborhood);
            let representative = byLightness[center];
            for (let index = start; index <= end; index += 1) {
              if (byLightness[index].weight > representative.weight) representative = byLightness[index];
            }
            selected.push(representative);
          }
        } else {
          const byWeight = [...group].sort((left, right) => (
            right.weight - left.weight || left.y - right.y || right.radiusSquared - left.radiusSquared
          ));
          selected.push(byWeight[0]);
          const separated = byWeight.find((sample) => Math.abs(sample.y - byWeight[0].y) >= 15);
          if (separated) selected.push(separated);
        }
      }
      const globalCoverage = (candidate) => samples.reduce((count, sample) => (
        count + (referenceProtectionMatches(
          background,
          candidate,
          sample.r,
          sample.g,
          sample.b,
        ) ? 1 : 0)
      ), 0);
      let bestCoverage = selected.reduce((maximum, candidate) => (
        Math.max(maximum, globalCoverage(candidate))
      ), 0);
      let bestRadiusSquared = Number.POSITIVE_INFINITY;
      let medoid = null;
      for (const sample of group) {
        const coverage = globalCoverage(sample);
        const separatedFromBest = selected
          .filter((candidate) => globalCoverage(candidate) === bestCoverage)
          .every((candidate) => Math.abs(candidate.y - sample.y) >= 15);
        if (
          coverage > bestCoverage
          || (coverage === bestCoverage
            && separatedFromBest
            && (!medoid || sample.radiusSquared < bestRadiusSquared))
        ) {
          medoid = sample;
          bestCoverage = coverage;
          bestRadiusSquared = sample.radiusSquared;
        }
      }
      if (medoid) selected.unshift(medoid);
      for (const sample of selected) {
        const alignedWithBackground = !sample.achromatic
          && sample.chroma >= 3
          && sample.dirCb * background.dirCb + sample.dirCr * background.dirCr >= 0.9;
        candidates.push({ ...sample, descriptor: sample, excluded: alignedWithBackground, fullCoverage: 0 });
      }
    }
    const fullOriginalData = options.fullOriginalData || null;
    const fullPreviewData = options.fullPreviewData || null;
    const fullWidth = Math.trunc(options.fullWidth || 0);
    const fullHeight = Math.trunc(options.fullHeight || 0);
    if (
      fullOriginalData
      && fullPreviewData
      && fullWidth > 0
      && fullHeight > 0
      && fullOriginalData.length === fullWidth * fullHeight * 4
      && fullPreviewData.length === fullOriginalData.length
    ) {
      let partialPixels = 0;
      for (let offset = 3; offset < fullPreviewData.length; offset += 4) {
        if (fullPreviewData[offset] > 0 && fullPreviewData[offset] < 255) partialPixels += 1;
      }
      const fullStep = partialPixels > 200000 ? 2 : 1;
      for (const candidate of candidates) {
        if (candidate.excluded) continue;
        let matches = 0;
        for (let y = 0; y < fullHeight; y += fullStep) {
          for (let x = 0; x < fullWidth; x += fullStep) {
            const offset = (y * fullWidth + x) * 4;
            const alpha = fullPreviewData[offset + 3];
            if (alpha === 0 || alpha === 255) continue;
            if (referenceProtectionMatches(
              background,
              candidate.descriptor,
              fullOriginalData[offset],
              fullOriginalData[offset + 1],
              fullOriginalData[offset + 2],
            )) matches += 1;
          }
        }
        candidate.fullCoverage = (matches * fullStep * fullStep) / (fullWidth * fullHeight);
      }
      const visibleCandidates = candidates.filter((candidate) => !candidate.excluded);
      const substantial = visibleCandidates.filter((candidate) => candidate.fullCoverage >= 0.0005);
      if (substantial.length >= 2) {
        for (const candidate of visibleCandidates) {
          if (candidate.fullCoverage < 0.0005) candidate.excluded = true;
        }
      } else {
        const retained = new Set(
          [...visibleCandidates]
            .sort((left, right) => right.fullCoverage - left.fullCoverage)
            .slice(0, 2),
        );
        for (const candidate of visibleCandidates) {
          if (!retained.has(candidate)) candidate.excluded = true;
        }
      }
    }
    const existingColors = Array.isArray(options.existingColors) ? options.existingColors.slice(0, 32) : [];
    const existingDescriptors = existingColors.map((color) => {
      const red = Array.isArray(color) ? color[0] : color.r;
      const green = Array.isArray(color) ? color[1] : color.g;
      const blue = Array.isArray(color) ? color[2] : color.b;
      return referenceProtectionDescriptor(red, green, blue);
    });
    const covered = new Uint8Array(samples.length);
    let coveredCount = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      if (existingDescriptors.some((descriptor) => referenceProtectionMatches(
        background,
        descriptor,
        sample.r,
        sample.g,
        sample.b,
      ))) {
        covered[index] = 1;
        coveredCount += 1;
      }
    }
    const selectedColors = [];
    while (
      selectedColors.length < maximumColors
      && coveredCount * 100 < samples.length * coverageThreshold
    ) {
      let bestCandidate = null;
      let bestCoverage = 0;
      for (const candidate of candidates) {
        if (candidate.excluded) continue;
        let candidateCoverage = 0;
        for (let index = 0; index < samples.length; index += 1) {
          if (covered[index]) continue;
          const sample = samples[index];
          if (referenceProtectionMatches(
            background,
            candidate.descriptor,
            sample.r,
            sample.g,
            sample.b,
          )) candidateCoverage += 1;
        }
        if (candidateCoverage > bestCoverage) {
          bestCandidate = candidate;
          bestCoverage = candidateCoverage;
        }
      }
      if (!bestCandidate || bestCoverage === 0) break;
      selectedColors.push({
        r: bestCandidate.r,
        g: bestCandidate.g,
        b: bestCandidate.b,
        count: bestCoverage,
      });
      for (let index = 0; index < samples.length; index += 1) {
        if (covered[index]) continue;
        const sample = samples[index];
        if (referenceProtectionMatches(
          background,
          bestCandidate.descriptor,
          sample.r,
          sample.g,
          sample.b,
        )) {
          covered[index] = 1;
          coveredCount += 1;
        }
      }
      bestCandidate.excluded = true;
    }
    const coverage = Math.trunc((coveredCount * 100) / samples.length);
    const status = coverage >= coverageThreshold
      ? 0
      : (selectedColors.length < maximumColors ? 2 : 1);
    return {
      colors: selectedColors,
      count: selectedColors.length,
      coverage,
      status,
      sampleCount: samples.length,
    };
  }

  /**
   * Samples representative protected colors inside a rectangle.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{x1:number,y1:number,x2:number,y2:number}} rectangle Selection rectangle.
   * @param {{
   *   maximumColors?:number,
   *   coverage?:number,
   *   excludeColors?:Array<{r:number,g:number,b:number}>,
   *   existingColors?:Array<{r:number,g:number,b:number}>
   * }} options Sampling options.
   * @returns {Array<{r:number,g:number,b:number,count:number}>}
   */
  function extractProtectedColors(data, width, height, rectangle, options = {}) {
    const startX = Math.max(0, Math.floor(Math.min(rectangle.x1, rectangle.x2)));
    const endX = Math.min(width - 1, Math.ceil(Math.max(rectangle.x1, rectangle.x2)));
    const startY = Math.max(0, Math.floor(Math.min(rectangle.y1, rectangle.y2)));
    const endY = Math.min(height - 1, Math.ceil(Math.max(rectangle.y1, rectangle.y2)));
    const regionWidth = Math.max(0, endX - startX + 1);
    const regionHeight = Math.max(0, endY - startY + 1);
    if (!regionWidth || !regionHeight) return [];
    const regionData = new Uint8ClampedArray(regionWidth * regionHeight * 4);
    let targetOffset = 0;
    for (let y = startY; y <= endY; y += 1) {
      const sourceOffset = (y * width + startX) * 4;
      const sourceEnd = sourceOffset + regionWidth * 4;
      regionData.set(data.subarray(sourceOffset, sourceEnd), targetOffset);
      targetOffset += regionWidth * 4;
    }
    const excludeColors = Array.isArray(options.excludeColors) ? options.excludeColors : [];
    const backgroundColor = excludeColors[0] || options.backgroundColor || { r: 0, g: 255, b: 0 };
    return selectReferenceProtectedColors(
      regionData,
      regionWidth,
      regionHeight,
      backgroundColor,
      {
        coverageThreshold: Math.round(clamp(options.coverage ?? 0.95, 0, 1) * 100),
        maximumColors: options.maximumColors,
        existingColors: options.existingColors,
      },
    ).colors;
  }

  /**
   * Applies the reference smooth-step curve.
   * @param {number} minimum Lower edge.
   * @param {number} maximum Upper edge.
   * @param {number} value Input value.
   * @returns {number}
   */
  function smoothstep(minimum, maximum, value) {
    const position = clamp((value - minimum) / (maximum - minimum), 0, 1);
    return position * position * (3 - 2 * position);
  }

  /**
   * Returns the reference chroma response around the sampled background magnitude.
   * @param {number} chroma Pixel OKLab chroma.
   * @param {number} referenceChroma Background OKLab chroma.
   * @returns {number}
   */
  function chromaResponse(chroma, referenceChroma) {
    if (chroma < 0.03) return 0;
    if (chroma <= referenceChroma) return chroma / referenceChroma;
    const upper = referenceChroma * 1.5;
    return chroma < upper ? 1 - smoothstep(referenceChroma, upper, chroma) : 0;
  }

  /**
   * Reduces contamination with the reference OKLab 15°/30° hue falloff.
   * @param {Uint8ClampedArray} data Mutable RGBA pixel data.
   * @param {number} offset Pixel byte offset.
   * @param {{r:number,g:number,b:number}} backgroundColor Sampled background.
   * @param {number} strength Normalized strength in the range 0-1.
   * @returns {void}
   */
  function applyReferenceDespillPixel(data, offset, backgroundColor, strength) {
    if (data[offset + 3] < 1 || strength <= 0) return;
    const reference = rgbToOklab(backgroundColor.r, backgroundColor.g, backgroundColor.b);
    if (reference.chroma < 0.02) return;
    const pixel = rgbToOklab(data[offset], data[offset + 1], data[offset + 2]);
    if (pixel.chroma < 0.03) return;
    const hueDifference = hueDistance(pixel.hue, reference.hue);
    const hueWeight = 1 - smoothstep(15, 30, hueDifference);
    if (hueWeight === 0) return;
    const magnitudeWeight = chromaResponse(pixel.chroma, reference.chroma);
    if (magnitudeWeight === 0) return;
    const chromaScale = 1 - hueWeight * magnitudeWeight * clamp(strength, 0, 1);
    const converted = oklabToRgb(pixel.l, pixel.a * chromaScale, pixel.b * chromaScale);
    data[offset] = converted.r;
    data[offset + 1] = converted.g;
    data[offset + 2] = converted.b;
  }

  /**
   * Reduces contamination from the sampled background color.
   * @param {Uint8ClampedArray} data Mutable RGBA pixel data.
   * @param {number} offset Pixel byte offset.
   * @param {{r:number,g:number,b:number}} backgroundColor Sampled background.
   * @param {number} strength Normalized strength in the range 0-1.
   * @param {"general"|"blend"|"chroma"} mode Despill strategy.
   * @returns {void}
   */
  function applyDespillPixel(data, offset, backgroundColor, strength, mode) {
    if (mode !== "blend") {
      applyReferenceDespillPixel(data, offset, backgroundColor, strength);
      return;
    }
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const foregroundAverage = (red + green + blue) / 3;
    const backgroundAverage = (backgroundColor.r + backgroundColor.g + backgroundColor.b) / 3;
    const backgroundVector = [
      backgroundColor.r - backgroundAverage,
      backgroundColor.g - backgroundAverage,
      backgroundColor.b - backgroundAverage,
    ];
    const channels = [red, green, blue];

    for (let channelIndex = 0; channelIndex < 3; channelIndex += 1) {
      const neutralTarget = foregroundAverage + (foregroundAverage - backgroundColor[["r", "g", "b"][channelIndex]]) * 0.2;
      channels[channelIndex] += (neutralTarget - channels[channelIndex]) * strength * 0.65;
    }

    data[offset] = Math.round(clamp(channels[0], 0, 255));
    data[offset + 1] = Math.round(clamp(channels[1], 0, 255));
    data[offset + 2] = Math.round(clamp(channels[2], 0, 255));
  }

  /**
   * Applies a separable Gaussian blur in premultiplied-alpha space.
   * @param {Uint8ClampedArray} data Mutable RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {number} radius Blur radius.
   * @param {Uint16Array|null} edgeDistance Optional chamfer distance.
   * @returns {void}
   */
  function blurPremultipliedEdges(data, width, height, radius, edgeDistance = null) {
    const safeRadius = Math.max(0, Math.min(6, Math.round(radius)));
    if (!safeRadius) return;
    const sigma = Math.max(0.7, safeRadius / 1.5);
    const kernel = [];
    let kernelTotal = 0;
    for (let offset = -safeRadius; offset <= safeRadius; offset += 1) {
      const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
      kernel.push(weight);
      kernelTotal += weight;
    }
    for (let index = 0; index < kernel.length; index += 1) kernel[index] /= kernelTotal;
    const pixelCount = width * height;
    const premultiplied = new Float32Array(pixelCount * 4);
    const horizontal = new Float32Array(pixelCount * 4);
    const vertical = new Float32Array(pixelCount * 4);
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      const alpha = data[offset + 3] / 255;
      premultiplied[offset] = srgbToLinear(data[offset]) * alpha;
      premultiplied[offset + 1] = srgbToLinear(data[offset + 1]) * alpha;
      premultiplied[offset + 2] = srgbToLinear(data[offset + 2]) * alpha;
      premultiplied[offset + 3] = alpha;
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const outputOffset = (y * width + x) * 4;
        for (let kernelIndex = 0; kernelIndex < kernel.length; kernelIndex += 1) {
          const sampleX = Math.max(0, Math.min(width - 1, x + kernelIndex - safeRadius));
          const inputOffset = (y * width + sampleX) * 4;
          const weight = kernel[kernelIndex];
          for (let channel = 0; channel < 4; channel += 1) {
            horizontal[outputOffset + channel] += premultiplied[inputOffset + channel] * weight;
          }
        }
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const outputOffset = (y * width + x) * 4;
        for (let kernelIndex = 0; kernelIndex < kernel.length; kernelIndex += 1) {
          const sampleY = Math.max(0, Math.min(height - 1, y + kernelIndex - safeRadius));
          const inputOffset = (sampleY * width + x) * 4;
          const weight = kernel[kernelIndex];
          for (let channel = 0; channel < 4; channel += 1) {
            vertical[outputOffset + channel] += horizontal[inputOffset + channel] * weight;
          }
        }
      }
    }
    for (let index = 0; index < pixelCount; index += 1) {
      if (edgeDistance && edgeDistance[index] > safeRadius * 6 + 4) continue;
      const offset = index * 4;
      const alpha = vertical[offset + 3];
      if (alpha <= 0.001) {
        data[offset + 3] = 0;
        continue;
      }
      data[offset] = linearToSrgb(vertical[offset] / alpha);
      data[offset + 1] = linearToSrgb(vertical[offset + 1] / alpha);
      data[offset + 2] = linearToSrgb(vertical[offset + 2] / alpha);
      data[offset + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    }
  }

  /**
   * Finds an opaque interior color near an edge pixel.
   * @param {Uint8ClampedArray} data RGBA pixels.
   * @param {Uint16Array} edgeDistance Chamfer distance.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {number} index Edge pixel index.
   * @param {number} radius Search radius.
   * @returns {{r:number,g:number,b:number}|null}
   */
  function findInteriorColor(data, edgeDistance, width, height, index, radius) {
    const centerX = index % width;
    const centerY = Math.floor(index / width);
    const safeRadius = Math.max(1, Math.min(16, Math.round(radius)));
    let bestIndex = -1;
    let bestScore = -1;
    for (let y = Math.max(0, centerY - safeRadius); y <= Math.min(height - 1, centerY + safeRadius); y += 1) {
      for (let x = Math.max(0, centerX - safeRadius); x <= Math.min(width - 1, centerX + safeRadius); x += 1) {
        const sampleIndex = y * width + x;
        const alpha = data[sampleIndex * 4 + 3];
        if (alpha < 192) continue;
        const score = edgeDistance[sampleIndex] * 2 - Math.hypot(x - centerX, y - centerY);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = sampleIndex;
        }
      }
    }
    if (bestIndex < 0) return null;
    const offset = bestIndex * 4;
    return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
  }

  /**
   * Recovers edge color by projecting pixels onto a foreground-to-background color axis.
   * @param {Uint8ClampedArray} data Mutable RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {Uint16Array} edgeDistance Chamfer distance.
   * @param {Array<{r:number,g:number,b:number}>} backgroundColors Background samples.
   * @param {{strength:number,edgeRadius:number,backgroundRadius:number,tolerance:number}} options Recovery options.
   * @returns {void}
   */
  function recoverEdgeColors(data, width, height, edgeDistance, backgroundColors, options) {
    const strength = clamp(options.strength, 0, 100) / 100;
    const edgeLimit = Math.max(1, options.edgeRadius) * 3 + 4;
    if (!strength) return;
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      if (data[offset + 3] === 0 || edgeDistance[index] > edgeLimit) continue;
      const foreground = findInteriorColor(
        data,
        edgeDistance,
        width,
        height,
        index,
        options.backgroundRadius,
      );
      if (!foreground) continue;
      const background = backgroundColors.reduce((closest, color) => (
        colorDistance(data[offset], data[offset + 1], data[offset + 2], color)
          < colorDistance(data[offset], data[offset + 1], data[offset + 2], closest)
          ? color
          : closest
      ), backgroundColors[0]);
      const pixelLinear = [srgbToLinear(data[offset]), srgbToLinear(data[offset + 1]), srgbToLinear(data[offset + 2])];
      const foregroundLinear = [srgbToLinear(foreground.r), srgbToLinear(foreground.g), srgbToLinear(foreground.b)];
      const backgroundLinear = [srgbToLinear(background.r), srgbToLinear(background.g), srgbToLinear(background.b)];
      const axis = backgroundLinear.map((channel, channelIndex) => channel - foregroundLinear[channelIndex]);
      const axisLengthSquared = axis.reduce((sum, channel) => sum + channel * channel, 0);
      if (axisLengthSquared < 0.00001) continue;
      const projection = pixelLinear.reduce((sum, channel, channelIndex) => (
        sum + (channel - foregroundLinear[channelIndex]) * axis[channelIndex]
      ), 0) / axisLengthSquared;
      if (projection <= 0 || projection >= 0.85) continue;
      const projected = foregroundLinear.map((channel, channelIndex) => channel + axis[channelIndex] * projection);
      const residual = Math.hypot(...pixelLinear.map((channel, channelIndex) => channel - projected[channelIndex]));
      if (residual * 100 > options.tolerance) continue;
      const recovered = pixelLinear.map((channel, channelIndex) => (
        clamp((channel - projection * backgroundLinear[channelIndex]) / (1 - projection), 0, 1)
      ));
      const edgeWeight = clamp(1 - edgeDistance[index] / Math.max(1, edgeLimit), 0.15, 1) * strength;
      data[offset] = linearToSrgb(pixelLinear[0] + (recovered[0] - pixelLinear[0]) * edgeWeight);
      data[offset + 1] = linearToSrgb(pixelLinear[1] + (recovered[1] - pixelLinear[1]) * edgeWeight);
      data[offset + 2] = linearToSrgb(pixelLinear[2] + (recovered[2] - pixelLinear[2]) * edgeWeight);
    }
  }

  /**
   * Executes the reference `fp_kernel_08` edge-color restoration algorithm.
   * @param {Uint8ClampedArray|Uint8Array} source Source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{r:number,g:number,b:number}} correctColor Desired uncontaminated edge color.
   * @param {{r:number,g:number,b:number}} contaminatedColor Observed polluted edge color.
   * @param {{tolerance?:number,edgeRadius?:number,backgroundRadius?:number,mask?:Uint8Array|null}} options Kernel options.
   * @returns {Uint8ClampedArray}
   */
  function applyReferenceEdgeColorRestore(
    source,
    width,
    height,
    correctColor,
    contaminatedColor,
    options = {},
  ) {
    const pixelCount = width * height;
    if (!source || source.length !== pixelCount * 4) {
      throw new RangeError("Reference edge restoration RGBA length does not match its dimensions.");
    }
    const mask = options.mask || null;
    if (mask && mask.length !== pixelCount) {
      throw new RangeError("Reference edge restoration mask length does not match its dimensions.");
    }
    const linear = (channel) => Math.fround(srgbToLinear(channel));
    const correct = [linear(correctColor.r), linear(correctColor.g), linear(correctColor.b)];
    const contaminated = [
      linear(contaminatedColor.r),
      linear(contaminatedColor.g),
      linear(contaminatedColor.b),
    ];
    const axis = contaminated.map((channel, index) => channel - correct[index]);
    const axisLengthSquared = axis.reduce((sum, channel) => sum + channel * channel, 0);
    if (axisLengthSquared < 0.0001) {
      throw new RangeError("Reference edge restoration colors are too similar.");
    }
    const edgeRadius = Math.trunc(options.edgeRadius ?? 0);
    const backgroundRadius = Math.trunc(options.backgroundRadius ?? 30);
    let edgeMask = null;
    if (edgeRadius > 0) {
      const candidates = new Uint8Array(pixelCount);
      const horizontal = new Uint8Array(pixelCount);
      edgeMask = new Uint8Array(pixelCount);
      const colorRadius = (backgroundRadius / 255) * 1.2;
      const colorRadiusSquared = colorRadius * colorRadius;
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const offset = pixel * 4;
        if (!source[offset + 3]) continue;
        const pixelLinear = [linear(source[offset]), linear(source[offset + 1]), linear(source[offset + 2])];
        const contaminatedDistance = pixelLinear.reduce((sum, channel, index) => (
          sum + (channel - contaminated[index]) ** 2
        ), 0);
        if (contaminatedDistance >= colorRadiusSquared) continue;
        const projection = pixelLinear.reduce((sum, channel, index) => (
          sum + (channel - correct[index]) * axis[index]
        ), 0) / axisLengthSquared;
        if (projection >= 0.7) candidates[pixel] = 1;
      }
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const minimumX = Math.max(0, x - edgeRadius);
          const maximumX = Math.min(width - 1, x + edgeRadius);
          for (let sampleX = minimumX; sampleX <= maximumX; sampleX += 1) {
            if (candidates[y * width + sampleX]) {
              horizontal[y * width + x] = 1;
              break;
            }
          }
        }
      }
      for (let x = 0; x < width; x += 1) {
        for (let y = 0; y < height; y += 1) {
          const minimumY = Math.max(0, y - edgeRadius);
          const maximumY = Math.min(height - 1, y + edgeRadius);
          for (let sampleY = minimumY; sampleY <= maximumY; sampleY += 1) {
            if (horizontal[sampleY * width + x]) {
              edgeMask[y * width + x] = 1;
              break;
            }
          }
        }
      }
    }
    const residualLimit = Math.trunc(options.tolerance ?? 30) / 1000;
    const residualLimitSquared = residualLimit * residualLimit;
    const output = new Uint8ClampedArray(source);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      if ((mask && !mask[pixel]) || (edgeMask && !edgeMask[pixel])) continue;
      const offset = pixel * 4;
      if (!source[offset + 3]) continue;
      const pixelLinear = [linear(source[offset]), linear(source[offset + 1]), linear(source[offset + 2])];
      const projection = pixelLinear.reduce((sum, channel, index) => (
        sum + (channel - correct[index]) * axis[index]
      ), 0) / axisLengthSquared;
      if (projection < 0 || projection >= 0.85) continue;
      const residualSquared = pixelLinear.reduce((sum, channel, index) => {
        const residual = channel - correct[index] - projection * axis[index];
        return sum + residual * residual;
      }, 0);
      if (residualSquared >= residualLimitSquared) continue;
      let red = correctColor.r;
      let green = correctColor.g;
      let blue = correctColor.b;
      if (projection > 0.5) {
        const correctionWeight = (0.9 - projection) / 0.4;
        if (correctionWeight <= 0) continue;
        if (correctionWeight < 1) {
          const sourceWeight = 1 - correctionWeight;
          red = Math.round(source[offset] * sourceWeight + correctColor.r * correctionWeight);
          green = Math.round(source[offset + 1] * sourceWeight + correctColor.g * correctionWeight);
          blue = Math.round(source[offset + 2] * sourceWeight + correctColor.b * correctionWeight);
        }
      }
      output[offset] = red;
      output[offset + 1] = green;
      output[offset + 2] = blue;
    }
    return output;
  }

  /**
   * Removes a sampled background from RGBA pixels.
   * @param {Uint8ClampedArray|Uint8Array} source RGBA pixel data.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{
   *   backgroundColor?:{r:number,g:number,b:number},
   *   backgroundColors?:Array<{r:number,g:number,b:number}>,
   *   tolerance?:number,
   *   feather?:number,
   *   alphaThreshold?:number,
   *   connected?:boolean,
   *   perceptual?:boolean,
   *   seedPoints?:Array<{x:number,y:number}>,
   *   selectionMask?:Uint8Array|null,
   *   maximumPixels?:number,
   *   edgeBoost?:number,
   *   alphaLow?:number,
   *   alphaHigh?:number,
   *   despillStrength?:number,
   *   despillMode?:"general"|"blend"|"chroma",
   *   edgeDespillRadius?:number,
   *   edgeRecoveryStrength?:number,
   *   edgeRecoveryTolerance?:number,
   *   backgroundRadius?:number,
   *   blurRadius?:number,
   *   protectedColors?:Array<{r:number,g:number,b:number}>,
   *   protectionTolerance?:number
   * }} options Processing options.
   * @returns {{data:Uint8ClampedArray,removedPixels:number,partialPixels:number}}
   */
  function applyCutout(source, width, height, options = {}) {
    const data = new Uint8ClampedArray(source);
    const estimatedBackground = options.backgroundColor || estimateBackgroundColor(data, width, height);
    const backgroundColors = Array.isArray(options.backgroundColors) && options.backgroundColors.length
      ? options.backgroundColors
      : [estimatedBackground];
    const backgroundColor = backgroundColors[0];
    if (options.referenceChromaKey === true) {
      const data = applyReferenceChromaKey(source, width, height, {
        backgroundColor,
        replacementColor: [0, 0, 0, 0],
        cleanup: options.chromaCleanup ?? 40,
        feather: options.chromaFeather ?? 30,
        mask: options.selectionMask || null,
      });
      const selectedMask = new Uint8Array(width * height);
      for (let pixel = 0; pixel < selectedMask.length; pixel += 1) {
        if (data[pixel * 4 + 3] < source[pixel * 4 + 3]) selectedMask[pixel] = 1;
      }
      const protectedMask = createReferenceProtectionMask(
        source,
        width,
        height,
        backgroundColor,
        options.protectedColors || [],
      );
      if (protectedMask) {
        for (let pixel = 0; pixel < protectedMask.length; pixel += 1) {
          if (!protectedMask[pixel]) continue;
          selectedMask[pixel] = 0;
          const offset = pixel * 4;
          data.set(source.subarray(offset, offset + 4), offset);
        }
      }
      applyReferenceAlphaThresholds(
        data,
        options.selectionMask || null,
        options.alphaHigh,
        options.alphaLow,
      );
      if ((options.edgeRecoveryStrength ?? 0) > 0) {
        restoreReferenceReplacementEdges(
          data,
          source,
          width,
          height,
          selectedMask,
          options.selectionMask || null,
          protectedMask,
          { ...backgroundColor, a: 255 },
          { r: 0, g: 0, b: 0, a: 0 },
          Math.max(1, Math.trunc(options.edgeDespillRadius || 2)),
          options.despillMode === "chroma" ? 2 : 1,
        );
      }
      applyReferenceDirectionalDespill(
        data,
        selectedMask,
        options.selectionMask || null,
        protectedMask,
        backgroundColor,
        options.despillStrength ?? 70,
      );
      let removedPixels = 0;
      let partialPixels = 0;
      for (let pixel = 0; pixel < selectedMask.length; pixel += 1) {
        const alphaOffset = pixel * 4 + 3;
        if (source[alphaOffset] > 0 && data[alphaOffset] === 0) removedPixels += 1;
        else if (data[alphaOffset] < source[alphaOffset]) partialPixels += 1;
      }
      return { data, removedPixels, partialPixels };
    }
    const tolerance = clamp(options.tolerance ?? 18, 0, 100);
    const feather = clamp(options.feather ?? 6, 0, 40);
    const alphaThreshold = clamp(options.alphaThreshold ?? 2, 0, 255);
    const edgeBoost = clamp(options.edgeBoost ?? 0, 0, 100);
    const alphaLow = clamp(options.alphaLow ?? 0, 0, 255);
    const alphaHigh = clamp(options.alphaHigh ?? 255, 0, 255);
    const despillStrength = clamp(options.despillStrength ?? 0, 0, 100) / 100;
    const despillMode = ["blend", "chroma"].includes(options.despillMode) ? options.despillMode : "general";
    const edgeDespillRadius = clamp(options.edgeDespillRadius ?? 0, 0, 12);
    const edgeRecoveryStrength = clamp(options.edgeRecoveryStrength ?? 0, 0, 100);
    const edgeRecoveryTolerance = clamp(options.edgeRecoveryTolerance ?? 30, 0, 100);
    const backgroundRadius = clamp(options.backgroundRadius ?? 8, 1, 30);
    const blurRadius = clamp(options.blurRadius ?? 0, 0, 6);
    const protectedColors = Array.isArray(options.protectedColors) ? options.protectedColors : [];
    const protectionTolerance = clamp(options.protectionTolerance ?? 8, 0, 100);
    // Edge enhancement widens only the connected candidate search. Keeping it
    // out of the opacity curve avoids turning similarly colored foreground
    // details semi-transparent.
    const keyTolerance = clamp(tolerance, 0, 100);
    const featherLimit = clamp(keyTolerance + feather, 0, 100);
    const maximumDistance = clamp(featherLimit + edgeBoost * 0.12, 0, 100);
    const perceptual = options.perceptual !== false;
    const connected = options.connected !== false;
    const candidateStrength = new Uint8Array(width * height);
    const candidates = new Uint8Array(width * height);
    const protectedMask = protectedColors.length ? new Uint8Array(width * height) : null;

    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const originalAlpha = data[offset + 3];
      if (!originalAlpha) continue;
      const protectedPixel = protectedColors.some((color) => (
        colorDistance(data[offset], data[offset + 1], data[offset + 2], color) <= protectionTolerance
      ));
      if (protectedPixel) {
        protectedMask[index] = 1;
        continue;
      }
      const distance = nearestBackgroundDistance(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        backgroundColors,
        perceptual,
      );
      const backgroundStrength = feather <= 0
        ? (distance <= keyTolerance ? 1 : 0)
        : clamp((featherLimit - distance) / Math.max(0.001, feather), 0, 1);
      candidateStrength[index] = Math.round(backgroundStrength * 255);
      candidates[index] = distance <= maximumDistance ? 1 : 0;
    }
    const mask = connected
      ? connectedCandidateMask(candidates, width, height, {
        seeds: options.seedPoints,
        selectionMask: options.selectionMask,
        maximumPixels: options.maximumPixels,
      })
      : candidates;

    for (let index = 0; index < width * height; index += 1) {
      if (!mask[index] || protectedMask?.[index]) continue;
      const offset = index * 4;
      const originalAlpha = data[offset + 3];
      const nextAlpha = Math.round(originalAlpha * (1 - candidateStrength[index] / 255));
      data[offset + 3] = nextAlpha <= alphaThreshold ? 0 : nextAlpha;
      if (alphaLow > 0 && data[offset + 3] < alphaLow) data[offset + 3] = 0;
      if (alphaHigh < 255 && data[offset + 3] > alphaHigh) data[offset + 3] = 255;
    }

    let edgeDistance = chamferDistanceToTransparent(data, width, height);
    if (blurRadius > 0) {
      blurPremultipliedEdges(data, width, height, blurRadius, edgeDistance);
      edgeDistance = chamferDistanceToTransparent(data, width, height);
    }
    if (edgeRecoveryStrength > 0) {
      recoverEdgeColors(data, width, height, edgeDistance, backgroundColors, {
        strength: edgeRecoveryStrength,
        edgeRadius: Math.max(1, edgeDespillRadius || 2),
        backgroundRadius,
        tolerance: edgeRecoveryTolerance,
      });
    }
    if (despillStrength > 0) {
      for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4;
        if (data[offset + 3] === 0 || protectedMask?.[index]) continue;
        const nearestBackground = backgroundColors.reduce((closest, color) => (
          colorDistance(data[offset], data[offset + 1], data[offset + 2], color)
            < colorDistance(data[offset], data[offset + 1], data[offset + 2], closest)
            ? color
            : closest
        ), backgroundColor);
        const distance = nearestBackgroundDistance(
          data[offset],
          data[offset + 1],
          data[offset + 2],
          backgroundColors,
          perceptual,
        );
        const nearEdge = edgeDespillRadius > 0
          && edgeDistance[index] <= edgeDespillRadius * 3 + 4;
        const eligibleForGlobalCleanup = distance <= maximumDistance + 18;
        if (!nearEdge && !eligibleForGlobalCleanup) continue;
        const edgeMultiplier = nearEdge ? 1 : 0.45;
        applyDespillPixel(data, offset, nearestBackground, despillStrength * edgeMultiplier, despillMode);
      }
    }

    let removedPixels = 0;
    let partialPixels = 0;
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      if (protectedMask?.[index]) {
        data[offset] = source[offset];
        data[offset + 1] = source[offset + 1];
        data[offset + 2] = source[offset + 2];
        data[offset + 3] = source[offset + 3];
      }
      if (source[offset + 3] > 0 && data[offset + 3] === 0) removedPixels += 1;
      else if (data[offset + 3] < source[offset + 3]) partialPixels += 1;
    }
    return { data, removedPixels, partialPixels };
  }

  return {
    applyCutout,
    applyReferenceChromaKey,
    applyReferenceChromaKeyClean,
    applyReferenceColorReplace,
    applyReferenceDespillPixel,
    applyReferenceEdgeColorRestore,
    applyReferenceFloodFillDespill,
    chamfer345Distance,
    chamferDistanceToTransparent,
    colorDistance,
    connectedCandidateMask,
    connectedRemovalMask,
    diffuseReferenceCandidateMask,
    diffuseReferenceGlobalCandidateMask,
    estimateBackgroundColor,
    extractProtectedColors,
    hexToRgb,
    isWithinConnectivityTolerance,
    perceptualColorDistance,
    referenceProtectionDescriptor,
    referenceProtectionMatches,
    selectReferenceProtectedColors,
    rgbToHex,
    rgbToOklab,
    rgbToYcbcr,
    oklabToRgb,
  };
}));
