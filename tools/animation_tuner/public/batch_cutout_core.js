(function attachBatchCutoutCore(root, factory) {
  const productCore = typeof module === "object" && module.exports
    ? require("./batch_cutout_product_core")
    : root?.BatchCutoutProductCore;
  const protectionCore = typeof module === "object" && module.exports
    ? require("./batch_cutout_protection_core")
    : root?.BatchCutoutProtectionCore;
  const referenceRecoveryCore = typeof module === "object" && module.exports
    ? require("./batch_cutout_reference_recovery_core")
    : root?.BatchCutoutReferenceRecoveryCore;
  const referenceReplaceCore = typeof module === "object" && module.exports
    ? require("./batch_cutout_reference_replace_core")
    : root?.BatchCutoutReferenceReplaceCore;
  const api = factory(
    productCore,
    protectionCore,
    referenceRecoveryCore,
    referenceReplaceCore,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, (
  productCore,
  protectionCore,
  referenceRecoveryCore,
  referenceReplaceCore,
) => {
  "use strict";

  if (!productCore?.createProductPipeline) {
    throw new Error("BatchCutoutProductCore is required.");
  }
  if (!protectionCore?.createProtectionSelector) {
    throw new Error("BatchCutoutProtectionCore is required.");
  }
  if (!referenceRecoveryCore?.createReferenceRecoveryPipeline) {
    throw new Error("BatchCutoutReferenceRecoveryCore is required.");
  }
  if (!referenceReplaceCore?.createReferenceReplacementKernels) {
    throw new Error("BatchCutoutReferenceReplaceCore is required.");
  }

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

  const protectionSelector = protectionCore.createProtectionSelector({
    rgbToReferenceYcbcr,
    srgbToLinear,
  });
  const {
    createReferenceProtectionMask,
    extractProtectedColors,
    referenceProtectionDescriptor,
    referenceProtectionMatches,
    selectProtectedColorsInRectangle,
    selectReferenceProtectedColors,
  } = protectionSelector;
  const referenceRecoveryPipeline = referenceRecoveryCore.createReferenceRecoveryPipeline({
    clamp,
    referenceSrgbToLinear,
    referenceLinearToSrgb,
    rgbToReferenceYcbcr,
    referenceYcbcrToRgb,
    createReferenceProtectionMask,
  });
  const {
    applyReferenceAlphaThresholds,
    applyReferenceDirectionalDespill,
    applyReferenceReplacementPipeline,
  } = referenceRecoveryPipeline;
  const referenceReplacementKernels = referenceReplaceCore.createReferenceReplacementKernels({
    connectedCandidateMask,
    applyReferenceReplacementPipeline,
  });
  const {
    applyReferenceColorReplace,
    applyReferenceFloodFillDespill,
    diffuseReferenceCandidateMask,
    diffuseReferenceGlobalCandidateMask,
  } = referenceReplacementKernels;

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
   * Converts the product selection mask and protected-color tolerance into the
   * public reference-kernel mask convention where enabled pixels equal 255.
   * @param {Uint8ClampedArray|Uint8Array} source Source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {object} options Product processing options.
   * @returns {Uint8Array|null}
   */
  function createReferenceOperationMask(source, width, height, options) {
    const selectionMask = options.selectionMask || null;
    const protectedColors = Array.isArray(options.protectedColors) ? options.protectedColors : [];
    if (!selectionMask && !protectedColors.length) return null;
    const operationMask = new Uint8Array(width * height);
    const protectionTolerance = clamp(options.protectionTolerance ?? 8, 0, 100);
    for (let pixel = 0; pixel < operationMask.length; pixel += 1) {
      if (selectionMask && !selectionMask[pixel]) continue;
      const offset = pixel * 4;
      const protectedPixel = protectedColors.some((color) => (
        colorDistance(source[offset], source[offset + 1], source[offset + 2], color)
          <= protectionTolerance
      ));
      if (!protectedPixel) operationMask[pixel] = 255;
    }
    return operationMask;
  }

  /**
   * Maps product despill names to the complete reference reconstruction modes.
   * @param {string} mode Product despill mode.
   * @returns {number}
   */
  function referenceDespillMode(mode) {
    if (mode === "blend") return 1;
    if (mode === "chroma") return 2;
    return 0;
  }

  /**
   * Finds a border seed nearest to one background sample.
   * @param {Uint8ClampedArray|Uint8Array} source Source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{r:number,g:number,b:number}} backgroundColor Background sample.
   * @returns {{x:number,y:number}}
   */
  function findReferenceBorderSeed(source, width, height, backgroundColor) {
    let best = { x: 0, y: 0, distance: Number.POSITIVE_INFINITY };
    const inspect = (x, y) => {
      const offset = (y * width + x) * 4;
      const distance = colorDistance(
        source[offset],
        source[offset + 1],
        source[offset + 2],
        backgroundColor,
      );
      if (distance < best.distance) best = { x, y, distance };
    };
    for (let x = 0; x < width; x += 1) {
      inspect(x, 0);
      if (height > 1) inspect(x, height - 1);
    }
    for (let y = 1; y < height - 1; y += 1) {
      inspect(0, y);
      if (width > 1) inspect(width - 1, y);
    }
    return { x: best.x, y: best.y };
  }

  /**
   * Applies the rebuilt edge-color restoration kernel when product protection
   * samples provide a trustworthy uncontaminated foreground color.
   * @param {Uint8ClampedArray} data Mutable cutout pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {Array<{r:number,g:number,b:number}>} protectedColors Foreground samples.
   * @param {Array<{r:number,g:number,b:number}>} backgroundColors Contamination samples.
   * @param {Uint8Array|null} operationMask Optional public 255 mask.
   * @param {object} options Product processing options.
   * @returns {void}
   */
  function restoreReferenceProtectedEdges(
    data,
    width,
    height,
    protectedColors,
    backgroundColors,
    operationMask,
    options,
  ) {
    const strength = clamp(options.edgeRecoveryStrength ?? 0, 0, 100) / 100;
    if (!strength || !protectedColors.length || !backgroundColors.length) return;
    for (const correctColor of protectedColors.slice(0, 32)) {
      for (const contaminatedColor of backgroundColors) {
        let restored;
        try {
          restored = applyReferenceEdgeColorRestore(
            data,
            width,
            height,
            correctColor,
            contaminatedColor,
            {
              tolerance: clamp(options.edgeRecoveryTolerance ?? 30, 0, 100),
              edgeRadius: Math.max(0, Math.trunc(options.edgeDespillRadius || 0)),
              backgroundRadius: clamp(options.backgroundRadius ?? 8, 1, 30),
              mask: operationMask,
            },
          );
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          continue;
        }
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          if (operationMask && operationMask[pixel] !== 255) continue;
          const offset = pixel * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            data[offset + channel] = Math.round(
              data[offset + channel]
              + (restored[offset + channel] - data[offset + channel]) * strength,
            );
          }
        }
      }
    }
  }

  /**
   * Runs the rebuilt reference replacement kernels through the real product
   * entry point, including multi-sample and connected-background semantics.
   * @param {Uint8ClampedArray|Uint8Array} source Source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {object} options Product processing options.
   * @param {Array<{r:number,g:number,b:number}>} backgroundColors Background samples.
   * @returns {{data:Uint8ClampedArray,removedPixels:number,partialPixels:number}}
   */
  function applyReferenceCutout(source, width, height, options, backgroundColors) {
    const operationMask = createReferenceOperationMask(source, width, height, options);
    const baseTolerance = clamp(options.tolerance ?? 18, 0, 100);
    const cleanupAdjustment = (clamp(options.chromaCleanup ?? 40, 0, 100) - 40) * 0.25;
    const adjustedTolerance = Math.trunc(clamp(baseTolerance + cleanupAdjustment, 0, 100));
    const edgeEnhance = Math.trunc(clamp(options.edgeBoost ?? 0, 0, 100));
    const tolerance = Math.trunc(
      adjustedTolerance + (100 - adjustedTolerance) * edgeEnhance / 100,
    );
    const edgeRecoveryStrength = clamp(options.edgeRecoveryStrength ?? 0, 0, 100);
    const protectedColors = Array.isArray(options.protectedColors) ? options.protectedColors : [];
    const edgeRestoreRadius = Math.max(0, Math.trunc(options.edgeDespillRadius || 0));
    const mode = referenceDespillMode(options.despillMode);
    const seedPoints = Array.isArray(options.seedPoints) ? options.seedPoints : [];
    const connected = options.connected !== false;
    let data = new Uint8ClampedArray(source);
    for (let backgroundIndex = 0; backgroundIndex < backgroundColors.length; backgroundIndex += 1) {
      const backgroundColor = backgroundColors[backgroundIndex];
      const referenceColor = { ...backgroundColor, a: 255 };
      const pipelineOptions = {
        mask: operationMask,
        referenceColor,
        edgeEnhance: 0,
        blendStrength: edgeRecoveryStrength,
        despillMode: mode,
        despillRefColor: backgroundColor,
        despillStrength: clamp(options.despillStrength ?? 0, 0, 100),
        edgeRestoreRadius,
        edgeRestoreMode: mode,
        alphaThresholdHigh: clamp(options.alphaHigh ?? 255, 0, 255),
        alphaThresholdLow: clamp(options.alphaLow ?? 0, 0, 255),
      };
      if (connected) {
        const assignedSeeds = seedPoints.filter((seed) => {
          if (!Number.isFinite(seed?.x) || !Number.isFinite(seed?.y)) return false;
          const x = clamp(Math.round(seed.x), 0, width - 1);
          const y = clamp(Math.round(seed.y), 0, height - 1);
          const offset = (y * width + x) * 4;
          let closestIndex = 0;
          let closestDistance = Number.POSITIVE_INFINITY;
          for (let index = 0; index < backgroundColors.length; index += 1) {
            const distance = colorDistance(
              source[offset],
              source[offset + 1],
              source[offset + 2],
              backgroundColors[index],
            );
            if (distance < closestDistance) {
              closestDistance = distance;
              closestIndex = index;
            }
          }
          return closestIndex === backgroundIndex;
        });
        const activeSeeds = assignedSeeds.length
          ? assignedSeeds
          : [findReferenceBorderSeed(source, width, height, backgroundColor)];
        for (const seed of activeSeeds) {
          data = applyReferenceFloodFillDespill(
            data,
            width,
            height,
            seed,
            { r: 0, g: 0, b: 0, a: 0 },
            tolerance,
            pipelineOptions,
          );
        }
      } else {
        data = applyReferenceColorReplace(
          data,
          width,
          height,
          { x: 0, y: 0 },
          { r: 0, g: 0, b: 0, a: 0 },
          tolerance,
          pipelineOptions,
        );
      }
    }
    const selectedMask = new Uint8Array(width * height);
    for (let pixel = 0; pixel < selectedMask.length; pixel += 1) {
      if (data[pixel * 4 + 3] < source[pixel * 4 + 3]) selectedMask[pixel] = 1;
    }
    applyReferenceAlphaThresholds(
      data,
      operationMask,
      clamp(options.alphaHigh ?? 255, 0, 255),
      clamp(options.alphaLow ?? 0, 0, 255),
    );
    if (connected) {
      for (const backgroundColor of backgroundColors) {
        applyReferenceDirectionalDespill(
          data,
          selectedMask,
          operationMask,
          null,
          backgroundColor,
          clamp(options.despillStrength ?? 0, 0, 100),
        );
      }
    }
    const alphaThreshold = clamp(options.alphaThreshold ?? 2, 0, 255);
    for (let pixel = 0; pixel < selectedMask.length; pixel += 1) {
      if (!selectedMask[pixel]) continue;
      const alphaOffset = pixel * 4 + 3;
      if (data[alphaOffset] <= alphaThreshold) data[alphaOffset] = 0;
    }
    const featherRadius = clamp(Math.round((
      clamp(options.feather ?? 0, 0, 40)
      + clamp(options.chromaFeather ?? 0, 0, 100) * 0.25
    ) / 10), 0, 6);
    const blurRadius = Math.max(featherRadius, clamp(options.blurRadius ?? 0, 0, 6));
    let edgeDistance = chamferDistanceToTransparent(data, width, height);
    if (blurRadius > 0) {
      blurPremultipliedEdges(data, width, height, blurRadius, edgeDistance);
      edgeDistance = chamferDistanceToTransparent(data, width, height);
    }
    if (edgeRecoveryStrength > 0 && protectedColors.length) {
      restoreReferenceProtectedEdges(
        data,
        width,
        height,
        protectedColors,
        backgroundColors,
        operationMask,
        options,
      );
    } else if (edgeRecoveryStrength > 0) {
      recoverEdgeColors(data, width, height, edgeDistance, backgroundColors, {
        strength: edgeRecoveryStrength,
        edgeRadius: Math.max(1, edgeRestoreRadius || 2),
        backgroundRadius: clamp(options.backgroundRadius ?? 8, 1, 30),
        tolerance: clamp(options.edgeRecoveryTolerance ?? 30, 0, 100),
      });
    }
    if (operationMask) {
      for (let pixel = 0; pixel < operationMask.length; pixel += 1) {
        if (operationMask[pixel] === 255) continue;
        const offset = pixel * 4;
        data.set(source.subarray(offset, offset + 4), offset);
      }
    }
    let removedPixels = 0;
    let partialPixels = 0;
    for (let pixel = 0; pixel < selectedMask.length; pixel += 1) {
      const alphaOffset = pixel * 4 + 3;
      if (source[alphaOffset] > 0 && data[alphaOffset] === 0) removedPixels += 1;
      else if (data[alphaOffset] < source[alphaOffset]) partialPixels += 1;
    }
    return { data, removedPixels, partialPixels };
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
      return applyReferenceCutout(source, width, height, options, backgroundColors);
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

  const productPipeline = productCore.createProductPipeline({
    applyCutout,
    clamp,
    colorDistance,
    estimateBackgroundColor,
    perceptualColorDistance,
  });

  return {
    applyCutout,
    applyCutoutBrushStroke: productPipeline.applyCutoutBrushStroke,
    applyCutoutRepairs: productPipeline.applyCutoutRepairs,
    applyProductCutout: productPipeline.applyProductCutout,
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
    createReferenceProtectionMask,
    diffuseReferenceCandidateMask,
    diffuseReferenceGlobalCandidateMask,
    estimateBackgroundColor,
    extractProtectedColors,
    hexToRgb,
    isWithinConnectivityTolerance,
    perceptualColorDistance,
    referenceProtectionDescriptor,
    referenceProtectionMatches,
    selectProtectedColorsInRectangle,
    selectReferenceProtectedColors,
    rgbToHex,
    rgbToOklab,
    rgbToYcbcr,
    oklabToRgb,
  };
}));
