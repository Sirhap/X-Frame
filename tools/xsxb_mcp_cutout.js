"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { parsePng, unfilterPng } = require("./attachment_sequence_analysis");
const { NUMERIC_PARAMETER_LIMITS } = require("./animation_tuner/public/batch_cutout_session_core");
const {
  REGULAR_AUTO_BACKGROUND_PARAMETERS,
  referenceChromaKeyFor,
} = require("./animation_tuner/public/smart_cutout_defaults");
const { applyProductCutout } = require("./animation_tuner/public/batch_cutout_core");
const {
  createSmartCutoutOptions,
  detectBackgroundColor,
} = require("./animation_tuner/public/scatter_slice_smart_cutout");

const REFERENCE_MODES = Object.freeze(["general", "blend", "chroma"]);

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
function encodePngRgba(rgba, width, height, options = {}) {
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
  const level =
    options && Number.isInteger(options.level) ? options.level : zlib.constants.Z_DEFAULT_COMPRESSION;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(filtered, { level })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Lossless-reencodes one PNG with max zlib. Pixels stay identical. Writes only
 * when the new file is strictly smaller.
 * @param {string} filePath PNG path.
 * @param {{dryRun?:boolean}} [options] When dryRun, skip the write.
 * @returns {{path:string,bytesBefore:number,bytesAfter:number,wrote:boolean,width:number,height:number}}
 */
function compressPngFile(filePath, options = {}) {
  const original = fs.readFileSync(filePath);
  const decoded = decodePngRgba(filePath);
  const recompressed = encodePngRgba(decoded.data, decoded.width, decoded.height, {
    level: zlib.constants.Z_BEST_COMPRESSION,
  });
  const smaller = recompressed.length < original.length;
  if (smaller && !options.dryRun) {
    const tempPath = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tempPath, recompressed);
    fs.renameSync(tempPath, filePath);
  }
  return {
    path: filePath,
    bytesBefore: original.length,
    bytesAfter: smaller ? recompressed.length : original.length,
    wrote: smaller && !options.dryRun,
    width: decoded.width,
    height: decoded.height,
  };
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
 * Converts a workbench camelCase slider key to the MCP snake_case argument.
 * @param {string} name Workbench parameter key.
 * @returns {string} MCP argument name.
 */
function toSnake(name) {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Reads a present argument that may arrive in camelCase or snake_case.
 * @param {object} source Argument bag.
 * @param {string} camel Workbench key.
 * @returns {unknown} Raw value, or undefined when omitted.
 */
function readAlias(source, camel) {
  const snake = toSnake(camel);
  if (Object.prototype.hasOwnProperty.call(source, camel) && source[camel] !== "") return source[camel];
  if (Object.prototype.hasOwnProperty.call(source, snake) && source[snake] !== "") return source[snake];
  return undefined;
}

/**
 * Parses an optional boolean the same way MCP handlers accept "true"/"1".
 * @param {unknown} value Raw argument.
 * @returns {boolean|undefined} Parsed flag, or undefined when omitted.
 */
function optionalBoolean(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "no") return false;
  }
  return undefined;
}

/**
 * Clamps one workbench slider to the tuner range.
 * @param {string} key Workbench parameter key.
 * @param {unknown} value Raw number.
 * @returns {number|undefined} Bounded value.
 */
function clampSlider(key, value) {
  const limits = NUMERIC_PARAMETER_LIMITS[key];
  const numeric = Number(value);
  if (!limits || !Number.isFinite(numeric)) return undefined;
  return Math.max(limits.minimum, Math.min(limits.maximum, numeric));
}

/**
 * Builds xsxb_cutout schema fields from the tuner slider table.
 * @returns {object} JSON schema properties.
 */
function workbenchSliderSchemaProperties() {
  const properties = {};
  for (const [key, limits] of Object.entries(NUMERIC_PARAMETER_LIMITS)) {
    properties[toSnake(key)] = {
      type: "number",
      minimum: limits.minimum,
      maximum: limits.maximum,
      description: `Same as the tuner ${key} slider. Omit to keep the shared smart-cutout profile.`,
    };
  }
  properties.connected = {
    type: "boolean",
    description:
      "Same as the tuner edge-only checkbox. Omit for the smart-cutout default (off; enclosed near-black plate pixels are keyed).",
  };
  properties.perceptual = {
    type: "boolean",
    description: "Same as the tuner OKLab / YCbCr checkbox.",
  };
  properties.blend_mode = {
    type: "string",
    enum: [...REFERENCE_MODES],
    default: REGULAR_AUTO_BACKGROUND_PARAMETERS.blendMode,
    description: "Same as the tuner blend-mode select.",
  };
  properties.despill_mode = {
    type: "string",
    enum: [...REFERENCE_MODES],
    default: REGULAR_AUTO_BACKGROUND_PARAMETERS.despillMode,
    description: "Same as the tuner despill-mode select.",
  };
  return properties;
}

/**
 * Collects workbench slider overrides from MCP or camelCase callers.
 * @param {object} [args] Tool arguments.
 * @returns {object} Cutout extras.
 */
function collectWorkbenchExtras(args = {}) {
  const extras = {};
  const keyColor = args.key_color || args.color || args.keyColor;
  if (keyColor) extras.keyColor = keyColor;
  const protectedColors = args.protected_colors ?? args.protectedColors;
  if (protectedColors != null && protectedColors !== "") extras.protectedColors = protectedColors;
  for (const key of Object.keys(NUMERIC_PARAMETER_LIMITS)) {
    const raw = readAlias(args, key);
    if (raw === undefined) continue;
    const clamped = clampSlider(key, raw);
    if (clamped !== undefined) extras[key] = clamped;
  }
  const connected = optionalBoolean(args.connected);
  if (connected !== undefined) extras.connected = connected;
  const perceptual = optionalBoolean(args.perceptual);
  if (perceptual !== undefined) extras.perceptual = perceptual;
  const blendMode = args.blend_mode ?? args.blendMode;
  if (REFERENCE_MODES.includes(String(blendMode || ""))) extras.blendMode = String(blendMode);
  const despillMode = args.despill_mode ?? args.despillMode;
  if (REFERENCE_MODES.includes(String(despillMode || ""))) extras.despillMode = String(despillMode);
  return extras;
}

/**
 * Builds tuner smart-cutout options, plus optional workbench slider overrides.
 * @param {{r:number,g:number,b:number}} backgroundColor Background sample.
 * @param {object} [extras] Optional protect colors and slider overrides.
 * @returns {object} Product cutout options.
 */
function buildCutoutOptions(backgroundColor, extras = {}) {
  const options = createSmartCutoutOptions(backgroundColor);
  const overrides = collectWorkbenchExtras(extras);
  for (const key of Object.keys(NUMERIC_PARAMETER_LIMITS)) {
    if (overrides[key] !== undefined) options[key] = overrides[key];
  }
  if (overrides.connected !== undefined) options.connected = overrides.connected;
  if (overrides.perceptual !== undefined) {
    options.perceptual = overrides.perceptual;
    options.referenceChromaKey = referenceChromaKeyFor(backgroundColor, overrides.perceptual);
  }
  if (overrides.blendMode) options.blendMode = overrides.blendMode;
  if (overrides.despillMode) options.despillMode = overrides.despillMode;
  const protectedColors = parseProtectedColors(overrides.protectedColors ?? extras.protectedColors);
  if (protectedColors.length && overrides.protectionTolerance !== 0) {
    options.protectedColors = protectedColors;
  }
  return options;
}

/**
 * Runs the product smart-cutout path on one frame.
 * @param {Uint8ClampedArray} rgba Source pixels.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @param {{r:number,g:number,b:number}} backgroundColor Shared background.
 * @param {object} [extras] Optional protect colors and slider overrides.
 * @returns {Uint8ClampedArray} Cutout pixels.
 */
/**
 * Drops leftover chroma fog. The product keyer can leave the plate at alpha 13,
 * which still looks keyed-out and trips alreadyCutOut, but counts as opaque in
 * metrics and rematch unless it is actually zeroed.
 * @param {Uint8ClampedArray|Uint8Array} rgba Cutout pixels.
 * @returns {Uint8ClampedArray} Same buffer with invisible pixels hard-cleared.
 */
function flattenResidualAlpha(rgba) {
  const pixels = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] > ALPHA_VISIBLE) continue;
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 0;
  }
  return pixels;
}

function applyProtectedSmartCutout(rgba, width, height, backgroundColor, extras = {}) {
  return flattenResidualAlpha(
    applyProductCutout(rgba, width, height, buildCutoutOptions(backgroundColor, extras), []).data,
  );
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
 * Connected FX on the same island still counts toward maxY; inspect the feet sheet
 * and plant with xsxb_shift_frames instead of guessing boot colors.
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
 * Integer-translates one RGBA frame. Positive dy moves pixels down (toward canvas feet).
 * Pixels that leave the canvas are clipped; vacated area is transparent.
 * @param {Uint8ClampedArray|Uint8Array} rgba Source pixels.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @param {number} dx Horizontal shift in pixels.
 * @param {number} dy Vertical shift in pixels.
 * @returns {Uint8ClampedArray} Shifted copy.
 */
function shiftFrameRgba(rgba, width, height, dx, dy) {
  const dest = new Uint8ClampedArray(width * height * 4);
  const shiftX = Math.trunc(Number(dx) || 0);
  const shiftY = Math.trunc(Number(dy) || 0);
  if (shiftX === 0 && shiftY === 0) return new Uint8ClampedArray(rgba);
  for (let y = 0; y < height; y += 1) {
    const sourceY = y - shiftY;
    if (sourceY < 0 || sourceY >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - shiftX;
      if (sourceX < 0 || sourceX >= width) continue;
      const sourceOffset = (sourceY * width + sourceX) * 4;
      dest.set(rgba.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
    }
  }
  return dest;
}

/**
 * Runs the tuner smart-cutout path on every PNG and optionally rematches a shared canvas.
 * @param {string[]} filePaths Frame files written in place.
 * @param {{keyColor?:string,outputWidth?:number,outputHeight?:number,protectedColors?:unknown,protectionTolerance?:number,force?:boolean,frameScales?:number[]}} [options] Cutout options.
 * @returns {{
 *   pipeline:string,
 *   rematched:boolean,
 *   keyed:boolean,
 *   backgroundColor:string|null,
 *   outputWidth:number,
 *   outputHeight:number,
 *   processedFrameCount:number,
 *   skippedFrameCount:number,
 *   options:object
 * }} Receipt.
 */
function cutoutFrameFiles(filePaths, options = {}) {
  const requested = Array.isArray(filePaths) ? filePaths : [];
  const missing = requested.find((filePath) => !fs.existsSync(filePath));
  if (missing) throw new Error(`Cutout refused missing on-disk frame: ${missing}`);
  const paths = requested;
  if (!paths.length) throw new Error("Cutout found no on-disk frames to process.");
  const frames = paths.map((filePath) => decodePngRgba(filePath));
  const requestedBackground = parseHexColor(options.keyColor);
  const uncut = frames.filter((frame) => !alreadyCutOut(frame.data, frame.width, frame.height));
  const shouldKey = uncut.length > 0 || (Boolean(options.force) && Boolean(requestedBackground));
  const sample = uncut[0] || frames[0];
  const backgroundColor = shouldKey
    ? requestedBackground || detectBackgroundColor(sample.data, sample.width, sample.height)
    : null;
  const cutoutOptions = backgroundColor ? buildCutoutOptions(backgroundColor, options) : {};
  let skippedFrameCount = 0;
  const cutFrames = frames.map((frame) => {
    const already = alreadyCutOut(frame.data, frame.width, frame.height);
    if (!shouldKey || (!options.force && already)) {
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
  const processedFrameCount = outputFrames.length - skippedFrameCount;
  return {
    pipeline: "smart_product",
    rematched,
    rematchMode: applyVisual ? "visual" : rematched ? "shared" : "none",
    frameScales: applyVisual ? frameScales : undefined,
    keyed: shouldKey && processedFrameCount > 0,
    backgroundColor: backgroundColor ? formatHexColor(backgroundColor) : null,
    outputWidth: outputFrames[0].width,
    outputHeight: outputFrames[0].height,
    frameSizes: outputFrames.map((frame) => ({ width: frame.width, height: frame.height })),
    processedFrameCount,
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
  ALPHA_VISIBLE,
  alreadyCutOut,
  collectWorkbenchExtras,
  compressPngFile,
  cutoutFrameFiles,
  cutoutPngFile,
  decodePngRgba,
  encodePngRgba,
  parseHexColor,
  parseProtectedColors,
  placeFramesOnCanvas,
  shiftFrameRgba,
  subjectAnchor,
  workbenchSliderSchemaProperties,
};
