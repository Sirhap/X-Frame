"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { parsePng, unfilterPng } = require("./attachment_sequence_analysis");
const { applyProductCutout } = require("./animation_tuner/public/batch_cutout_core");
const {
  applySmartCutout,
  createSmartCutoutOptions,
  detectBackgroundColor,
} = require("./animation_tuner/public/scatter_slice_smart_cutout");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ALPHA_VISIBLE = 16;
/**
 * Share of border-ring pixels that must be transparent before a frame counts as
 * cut out. A frame that still carries its background leaves the ring almost
 * fully opaque, while an already-cut frame only touches the edge where a body
 * or an effect runs off it, so a simple majority separates the two with room to
 * spare in both directions.
 */
const CUT_BORDER_CLEAR_RATIO = 0.5;

/**
 * Computes a PNG CRC32 checksum.
 * @param {Buffer} buffer Input bytes.
 * @returns {number} Unsigned checksum.
 */
function crc32(buffer) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buffer) >>> 0;
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Encodes one PNG chunk.
 * @param {string} type Chunk type.
 * @param {Buffer} data Chunk payload.
 * @returns {Buffer} Length, type, payload, and CRC.
 */
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

/**
 * Encodes an 8-bit RGBA image as a PNG buffer.
 * @param {Uint8ClampedArray|Uint8Array} rgba Source pixels.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @returns {Buffer} PNG file bytes.
 */
function encodePngRgba(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("PNG dimensions must be positive integers.");
  }
  if (rgba.length !== width * height * 4) throw new RangeError("RGBA length does not match the PNG size.");
  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    filtered[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + rowStart, stride).copy(filtered, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(filtered)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Copies one packed pixel into an RGBA buffer.
 * @param {Uint8Array} packed Decoded PNG samples.
 * @param {number} colorType PNG color type.
 * @param {number} index Pixel index.
 * @param {Uint8ClampedArray} rgba Destination RGBA.
 * @returns {void}
 */
function writeRgbaPixel(packed, colorType, index, rgba) {
  const dest = index * 4;
  if (colorType === 6) {
    rgba.set(packed.subarray(index * 4, index * 4 + 4), dest);
    return;
  }
  if (colorType === 2) {
    rgba[dest] = packed[index * 3];
    rgba[dest + 1] = packed[index * 3 + 1];
    rgba[dest + 2] = packed[index * 3 + 2];
    rgba[dest + 3] = 255;
    return;
  }
  if (colorType === 4) {
    rgba[dest] = packed[index * 2];
    rgba[dest + 1] = packed[index * 2];
    rgba[dest + 2] = packed[index * 2];
    rgba[dest + 3] = packed[index * 2 + 1];
    return;
  }
  rgba[dest] = packed[index];
  rgba[dest + 1] = packed[index];
  rgba[dest + 2] = packed[index];
  rgba[dest + 3] = 255;
}

/**
 * Reads one PNG file into 8-bit RGBA pixels.
 * @param {string} filePath PNG path.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}} Decoded image.
 */
function decodePngRgba(filePath) {
  const parsed = parsePng(fs.readFileSync(filePath));
  const packed = unfilterPng(parsed);
  const pixelCount = parsed.width * parsed.height;
  const data = new Uint8ClampedArray(pixelCount * 4);
  for (let index = 0; index < pixelCount; index += 1) {
    writeRgbaPixel(packed, parsed.colorType, index, data);
  }
  return { data, width: parsed.width, height: parsed.height };
}

/**
 * Parses an optional #RRGGBB or 0xRRGGBB color.
 * @param {string|undefined} value Color string.
 * @returns {{r:number,g:number,b:number}|null} RGB color, or null when omitted.
 */
function parseHexColor(value) {
  if (value == null || value === "") return null;
  const hex = String(value).trim().replace(/^#/, "").replace(/^0x/i, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`Cutout key_color must be a 6-digit hex color: ${value}`);
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

/**
 * Formats an RGB color as #rrggbb.
 * @param {{r:number,g:number,b:number}} color RGB color.
 * @returns {string} Hex color.
 */
function formatHexColor(color) {
  return `#${[color.r, color.g, color.b]
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Parses one or many #RRGGBB protect-color values.
 * @param {unknown} value Hex string or array.
 * @returns {Array<{r:number,g:number,b:number}>} RGB colors.
 */
function parseProtectedColors(value) {
  const items = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  return items.map((item) => parseHexColor(item)).filter(Boolean);
}

/**
 * True when the image border is already transparent, so a second cutout would chew the subject.
 *
 * The whole border ring is sampled rather than the four corners: a frame that
 * still carries its background but happens to have transparent corners would
 * otherwise be skipped, and the receipt would report the frame as done while
 * nothing was removed. A minority of opaque ring pixels is still accepted so a
 * subject standing on the bottom edge does not trigger a second destructive cut.
 * @param {Uint8ClampedArray|Uint8Array} rgba RGBA pixels.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @returns {boolean} Whether the frame looks already cut out.
 */
function alreadyCutOut(rgba, width, height) {
  if (width < 2 || height < 2) return false;
  let ringPixels = 0;
  let clearPixels = 0;
  for (let y = 0; y < height; y += 1) {
    const edgeRow = y === 0 || y === height - 1;
    for (let x = 0; x < width; x += 1) {
      if (!edgeRow && x !== 0 && x !== width - 1) continue;
      ringPixels += 1;
      if (rgba[(y * width + x) * 4 + 3] <= ALPHA_VISIBLE) clearPixels += 1;
    }
  }
  return ringPixels > 0 && clearPixels / ringPixels >= CUT_BORDER_CLEAR_RATIO;
}

/**
 * Builds tuner smart-cutout options, plus optional color protection.
 * @param {{r:number,g:number,b:number}} backgroundColor Background sample.
 * @param {{protectedColors?:unknown,protectionTolerance?:number}} [extras] Optional protect colors.
 * @returns {object} Product cutout options.
 */
function buildCutoutOptions(backgroundColor, extras = {}) {
  const options = createSmartCutoutOptions(backgroundColor);
  const protectedColors = parseProtectedColors(extras.protectedColors);
  if (protectedColors.length) {
    options.protectedColors = protectedColors;
    options.protectionTolerance = Math.max(0, Number(extras.protectionTolerance || 8));
  }
  return options;
}

/**
 * Runs the product smart-cutout path on one frame.
 * @param {Uint8ClampedArray} rgba Source pixels.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @param {{r:number,g:number,b:number}} backgroundColor Shared background.
 * @param {object} [extras] Optional protect colors.
 * @returns {Uint8ClampedArray} Cutout pixels.
 */
function applyProtectedSmartCutout(rgba, width, height, backgroundColor, extras = {}) {
  const options = buildCutoutOptions(backgroundColor, extras);
  if (!options.protectedColors?.length) {
    return applySmartCutout(rgba, width, height, backgroundColor);
  }
  return applyProductCutout(rgba, width, height, options, []).data;
}

/**
 * Collects 4-connected opaque regions.
 * @param {Uint8ClampedArray|Uint8Array} rgba RGBA pixels.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @param {number} threshold Visible alpha threshold.
 * @returns {Array<{minX:number,maxX:number,minY:number,maxY:number,count:number,width:number,height:number,centerX:number}>}
 */
function opaqueComponents(rgba, width, height, threshold) {
  const visited = new Uint8Array(width * height);
  const components = [];
  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || rgba[start * 4 + 3] <= threshold) continue;
    const stack = [start];
    visited[start] = 1;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let count = 0;
    let sumX = 0;
    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = Math.floor(index / width);
      count += 1;
      sumX += x;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const neighbors = [];
      if (x > 0) neighbors.push(index - 1);
      if (x + 1 < width) neighbors.push(index + 1);
      if (y > 0) neighbors.push(index - width);
      if (y + 1 < height) neighbors.push(index + width);
      for (const neighbor of neighbors) {
        if (visited[neighbor] || rgba[neighbor * 4 + 3] <= threshold) continue;
        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }
    components.push({
      minX,
      maxX,
      minY,
      maxY,
      count,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      centerX: sumX / count,
    });
  }
  return components;
}

/**
 * Prefers a standing character over a wide slash or leftover island.
 * @param {Array<object>} components Opaque regions.
 * @param {number} width Image width.
 * @returns {object|null} Chosen body region.
 */
function pickBodyComponent(components, width) {
  if (!components.length) return null;
  const largest = Math.max(...components.map((entry) => entry.count));
  const candidates = components.filter((entry) => entry.count >= largest * 0.25);
  return candidates.slice().sort((left, right) => {
    const leftTall = left.height - left.width;
    const rightTall = right.height - right.width;
    if (leftTall !== rightTall) return rightTall - leftTall;
    if (left.height !== right.height) return right.height - left.height;
    const leftCenter = Math.abs(left.centerX - (width - 1) / 2);
    const rightCenter = Math.abs(right.centerX - (width - 1) / 2);
    if (leftCenter !== rightCenter) return leftCenter - rightCenter;
    return right.count - left.count;
  })[0];
}

/**
 * Finds the standing subject. Disconnected slash / glow below the feet is ignored.
 * @param {Uint8ClampedArray|Uint8Array} rgba RGBA pixels.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @param {number} [threshold=16] Visible alpha threshold.
 * @returns {{minX:number,minY:number,maxX:number,feetY:number,width:number,height:number,centerX:number}|null}
 */
function subjectAnchor(rgba, width, height, threshold = ALPHA_VISIBLE) {
  const body = pickBodyComponent(opaqueComponents(rgba, width, height, threshold), width);
  if (!body) return null;
  return {
    minX: body.minX,
    minY: body.minY,
    maxX: body.maxX,
    feetY: body.maxY,
    width: body.width,
    height: body.height,
    centerX: body.centerX,
  };
}

/**
 * Places every frame with one shared scale and the body feet on the canvas bottom.
 * @param {Array<{data:Uint8ClampedArray,width:number,height:number}>} frames Cutout frames.
 * @param {number} canvasWidth Destination width.
 * @param {number} canvasHeight Destination height.
 * @returns {Array<{data:Uint8ClampedArray,width:number,height:number}>} Rematched frames.
 */
function placeFramesOnCanvas(frames, canvasWidth, canvasHeight, options = {}) {
  const anchors = frames.map((frame) => subjectAnchor(frame.data, frame.width, frame.height));
  const usable = anchors.filter(Boolean);
  const maxWidth = Math.max(1, ...usable.map((anchor) => anchor.width));
  const maxHeight = Math.max(1, ...usable.map((anchor) => anchor.height));
  const sharedScale = Math.min(canvasWidth / maxWidth, canvasHeight / maxHeight);
  const destFeetX = (canvasWidth - 1) / 2;
  const destFeetY = canvasHeight - 1;
  const frameScales = Array.isArray(options.frameScales) ? options.frameScales : null;
  return frames.map((frame, index) => {
    const dest = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
    const anchor = anchors[index];
    const requested = Number(frameScales?.[index]);
    const scale = Number.isFinite(requested) && requested > 0 ? requested : sharedScale;
    if (!anchor || scale <= 0) return { data: dest, width: canvasWidth, height: canvasHeight };
    for (let y = 0; y < canvasHeight; y += 1) {
      const sourceY = Math.round(anchor.feetY + (y - destFeetY) / scale);
      if (sourceY < 0 || sourceY >= frame.height) continue;
      for (let x = 0; x < canvasWidth; x += 1) {
        const sourceX = Math.round(anchor.centerX + (x - destFeetX) / scale);
        if (sourceX < 0 || sourceX >= frame.width) continue;
        const sourceOffset = (sourceY * frame.width + sourceX) * 4;
        if (frame.data[sourceOffset + 3] <= ALPHA_VISIBLE) continue;
        dest.set(frame.data.subarray(sourceOffset, sourceOffset + 4), (y * canvasWidth + x) * 4);
      }
    }
    return { data: dest, width: canvasWidth, height: canvasHeight };
  });
}

/**
 * Runs the tuner smart-cutout path on every PNG and optionally rematches a shared canvas.
 * @param {string[]} filePaths Frame files written in place.
 * @param {{keyColor?:string,outputWidth?:number,outputHeight?:number,protectedColors?:unknown,protectionTolerance?:number,force?:boolean,frameScales?:number[]}} [options] Cutout options.
 * @returns {{
 *   pipeline:string,
 *   rematched:boolean,
 *   backgroundColor:string,
 *   outputWidth:number,
 *   outputHeight:number,
 *   processedFrameCount:number,
 *   skippedFrameCount:number,
 *   options:object
 * }} Receipt.
 */
function cutoutFrameFiles(filePaths, options = {}) {
  const paths = (Array.isArray(filePaths) ? filePaths : []).filter((filePath) => fs.existsSync(filePath));
  if (!paths.length) throw new Error("Cutout found no on-disk frames to process.");
  const frames = paths.map((filePath) => decodePngRgba(filePath));
  const requestedBackground = parseHexColor(options.keyColor);
  const firstLive =
    frames.find((frame) => !alreadyCutOut(frame.data, frame.width, frame.height)) || frames[0];
  const backgroundColor =
    requestedBackground || detectBackgroundColor(firstLive.data, firstLive.width, firstLive.height);
  const cutoutOptions = buildCutoutOptions(backgroundColor, options);
  let skippedFrameCount = 0;
  const cutFrames = frames.map((frame) => {
    if (!options.force && alreadyCutOut(frame.data, frame.width, frame.height)) {
      skippedFrameCount += 1;
      return frame;
    }
    return {
      data: applyProtectedSmartCutout(frame.data, frame.width, frame.height, backgroundColor, options),
      width: frame.width,
      height: frame.height,
    };
  });
  const canvasWidth = Number.isInteger(Number(options.outputWidth))
    ? Math.max(8, Number(options.outputWidth))
    : 0;
  const canvasHeight = Number.isInteger(Number(options.outputHeight))
    ? Math.max(8, Number(options.outputHeight))
    : canvasWidth;
  const frameScales = Array.isArray(options.frameScales) ? options.frameScales : [];
  const applyVisual = frameScales.some((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  const rematched = (canvasWidth > 0 && canvasHeight > 0) || applyVisual;
  const destWidth = canvasWidth || cutFrames[0].width;
  const destHeight = canvasHeight || cutFrames[0].height;
  const outputFrames = rematched
    ? placeFramesOnCanvas(cutFrames, destWidth, destHeight, applyVisual ? { frameScales } : {})
    : cutFrames;
  outputFrames.forEach((frame, index) => {
    fs.writeFileSync(paths[index], encodePngRgba(frame.data, frame.width, frame.height));
  });
  return {
    pipeline: "smart_product",
    rematched,
    rematchMode: applyVisual ? "visual" : rematched ? "shared" : "none",
    frameScales: applyVisual ? frameScales : undefined,
    backgroundColor: formatHexColor(backgroundColor),
    outputWidth: outputFrames[0].width,
    outputHeight: outputFrames[0].height,
    frameSizes: outputFrames.map((frame) => ({ width: frame.width, height: frame.height })),
    processedFrameCount: outputFrames.length - skippedFrameCount,
    skippedFrameCount,
    options: cutoutOptions,
  };
}

/**
 * Applies the product cutout to one PNG. Used when a caller still processes files one at a time.
 * @param {string} inputPath Source PNG.
 * @param {string} outputPath Destination PNG.
 * @param {{keyColor?:string,outputWidth?:number,outputHeight?:number}} [options] Cutout options.
 * @returns {object} Cutout receipt.
 */
function cutoutPngFile(inputPath, outputPath, options = {}) {
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    return cutoutFrameFiles([inputPath], options);
  }
  const image = decodePngRgba(inputPath);
  const requestedBackground = parseHexColor(options.keyColor);
  const backgroundColor = requestedBackground || detectBackgroundColor(image.data, image.width, image.height);
  const cut = {
    data: applyProtectedSmartCutout(image.data, image.width, image.height, backgroundColor, options),
    width: image.width,
    height: image.height,
  };
  const canvasWidth = Number.isInteger(Number(options.outputWidth))
    ? Math.max(8, Number(options.outputWidth))
    : 0;
  const canvasHeight = Number.isInteger(Number(options.outputHeight))
    ? Math.max(8, Number(options.outputHeight))
    : canvasWidth;
  const rematched = canvasWidth > 0 && canvasHeight > 0;
  const output = rematched ? placeFramesOnCanvas([cut], canvasWidth, canvasHeight)[0] : cut;
  fs.writeFileSync(outputPath, encodePngRgba(output.data, output.width, output.height));
  return {
    pipeline: "smart_product",
    rematched,
    backgroundColor: formatHexColor(backgroundColor),
    outputWidth: output.width,
    outputHeight: output.height,
    processedFrameCount: 1,
    options: createSmartCutoutOptions(backgroundColor),
  };
}

module.exports = {
  alreadyCutOut,
  cutoutFrameFiles,
  cutoutPngFile,
  decodePngRgba,
  encodePngRgba,
  parseHexColor,
  parseProtectedColors,
  placeFramesOnCanvas,
  subjectAnchor,
};
