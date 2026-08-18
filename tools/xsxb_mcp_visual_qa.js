"use strict";

const { decodePngRgba, subjectAnchor } = require("./xsxb_mcp_cutout");

const NEAR_WHITE_LUMA = 240;
const NEAR_WHITE_ALPHA = 200;

/**
 * Returns the median of finite numbers.
 * @param {number[]} values Sample.
 * @returns {number} Median, or 0 when empty.
 */
function median(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Builds an inclusive index range.
 * @param {number} start First index.
 * @param {number} end Last index.
 * @returns {number[]} Indexes.
 */
function inclusiveRange(start, end) {
  const order = [];
  for (let index = start; index <= end; index += 1) order.push(index);
  return order;
}

/**
 * Estimates group and per-frame visual scales that match a target standing height.
 * Frames shorter than the native median are treated as camera zoom-out.
 * Taller frames (VFX, poses) keep the group scale.
 * @param {number[]} frameHeights Body heights in pixels.
 * @param {number} targetHeight Desired standing height.
 * @param {{zoomRatio?:number}} [options] Zoom detection ratio.
 * @returns {{targetHeight:number,nativeHeight:number,groupScale:number,frames:object[]}}
 */
function estimateVisualScales(frameHeights, targetHeight, options = {}) {
  const heights = (Array.isArray(frameHeights) ? frameHeights : []).map((value) =>
    Math.max(1, Number(value) || 1),
  );
  const nativeHeight = median(heights) || 1;
  const target = Math.max(1, Number(targetHeight) || nativeHeight);
  const zoomRatio = Math.max(1, Number(options.zoomRatio || 1.12));
  const groupScale = Number((target / nativeHeight).toFixed(3));
  const frames = heights.map((height, index) => {
    if (height * zoomRatio < nativeHeight) {
      return {
        index,
        bodyHeight: height,
        scale: Number((target / height).toFixed(3)),
        reason: "zoom",
      };
    }
    return { index, bodyHeight: height, scale: groupScale, reason: "group" };
  });
  return { targetHeight: target, nativeHeight, groupScale, frames };
}

/**
 * True when a frame still looks like the opening rest pose.
 * @param {{opaque:number,height:number,cy:number}} frame Frame metrics.
 * @param {{opaque:number,height:number,cy:number}} rest Opening pose.
 * @returns {boolean} Whether the frame matches rest.
 */
function matchesRest(frame, rest) {
  const opaqueSlop = Math.max(1, Math.max(Number(rest.opaque || 0), Number(frame.opaque || 0)) * 0.08);
  const heightSlop = Math.max(1, Math.max(Number(rest.height || 0), Number(frame.height || 0)) * 0.08);
  const cySlop = Math.max(
    1,
    Math.max(Math.abs(Number(rest.cy || 0)), Math.abs(Number(frame.cy || 0))) * 0.08,
  );
  return (
    Math.abs(Number(frame.opaque || 0) - Number(rest.opaque || 0)) <= opaqueSlop &&
    Math.abs(Number(frame.height || 0) - Number(rest.height || 0)) <= heightSlop &&
    Math.abs(Number(frame.cy || 0) - Number(rest.cy || 0)) <= cySlop
  );
}

/**
 * Finds the interior motion window by trimming a leading rest hold and, when
 * the clip returns to that rest, the trailing hold.
 * @param {Array<{opaque:number,height:number,cy:number}>} series Per-frame metrics.
 * @returns {{start:number,end:number,order:number[],activity:number[]}} Window.
 */
function findMotionWindow(series) {
  const frames = Array.isArray(series) ? series : [];
  if (frames.length < 2) {
    return {
      start: 0,
      end: Math.max(0, frames.length - 1),
      order: inclusiveRange(0, frames.length - 1),
      activity: [],
    };
  }
  const rest = frames[0];
  const active = frames.map((frame) => !matchesRest(frame, rest));
  const activity = frames.map((frame, index) => {
    if (index === 0) return 0;
    const previous = frames[index - 1];
    return (
      Math.abs(Number(frame.opaque || 0) - Number(previous.opaque || 0)) +
      Math.abs(Number(frame.height || 0) - Number(previous.height || 0)) +
      Math.abs(Number(frame.cy || 0) - Number(previous.cy || 0))
    );
  });
  let start = active.indexOf(true);
  if (start < 0) {
    return { start: 0, end: frames.length - 1, order: inclusiveRange(0, frames.length - 1), activity };
  }
  let end = frames.length - 1;
  if (matchesRest(frames[frames.length - 1], rest)) {
    end = active.lastIndexOf(true);
  }
  return { start, end, order: inclusiveRange(start, end), activity };
}

/**
 * Measures the standing body and leftover studio white on one RGBA frame.
 * @param {Uint8ClampedArray|Uint8Array} rgba Pixels.
 * @param {number} width Width.
 * @param {number} height Height.
 * @returns {{bodyHeight:number,bodyWidth:number,feetY:number,cy:number,opaque:number,nearWhite:number}}
 */
function measureFrame(rgba, width, height) {
  const anchor = subjectAnchor(rgba, width, height);
  let opaque = 0;
  let nearWhite = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3];
    if (alpha < 8) continue;
    opaque += 1;
    const luma = 0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1] + 0.0722 * rgba[offset + 2];
    if (luma >= NEAR_WHITE_LUMA && alpha >= NEAR_WHITE_ALPHA) nearWhite += 1;
  }
  return {
    bodyHeight: anchor ? anchor.height : 0,
    bodyWidth: anchor ? anchor.width : 0,
    feetY: anchor ? anchor.feetY : 0,
    cy: anchor ? (anchor.minY + anchor.feetY) / 2 : 0,
    opaque,
    nearWhite,
  };
}

/**
 * Writes one RGBA pixel.
 * @param {Uint8ClampedArray} rgba Destination.
 * @param {number} width Width.
 * @param {number} x Column.
 * @param {number} y Row.
 * @param {number} r Red.
 * @param {number} g Green.
 * @param {number} b Blue.
 * @param {number} a Alpha.
 * @returns {void}
 */
function writePixel(rgba, width, x, y, r, g, b, a) {
  const offset = (y * width + x) * 4;
  rgba[offset] = r;
  rgba[offset + 1] = g;
  rgba[offset + 2] = b;
  rgba[offset + 3] = a;
}

/**
 * Renders a contact sheet that scales every source canvas into a shared cell.
 * @param {Array<{data:Uint8ClampedArray,width:number,height:number}>} frames Source frames.
 * @param {{cell?:number,pad?:number,columns?:number}} [options] Layout.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}} Sheet.
 */
function renderContactSheet(frames, options = {}) {
  const items = Array.isArray(frames) ? frames : [];
  const cell = Math.max(8, Number(options.cell || 220));
  const pad = Math.max(1, Number(options.pad || 8));
  const columns = Math.max(1, Number(options.columns || Math.min(items.length || 1, 8)));
  const rows = Math.max(1, Math.ceil((items.length || 1) / columns));
  const width = columns * cell + (columns + 1) * pad;
  const height = rows * cell + (rows + 1) * pad;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) writePixel(rgba, width, x, y, 40, 40, 44, 255);
  }
  items.forEach((frame, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const originX = pad + column * (cell + pad);
    const originY = pad + row * (cell + pad);
    for (let y = 0; y < cell; y += 1) {
      for (let x = 0; x < cell; x += 1) {
        const checker = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? 200 : 150;
        writePixel(rgba, width, originX + x, originY + y, checker, checker, checker, 255);
        if (!frame?.width || !frame?.height) continue;
        const sourceX = Math.min(frame.width - 1, Math.floor(((x + 0.5) * frame.width) / cell));
        const sourceY = Math.min(frame.height - 1, Math.floor(((y + 0.5) * frame.height) / cell));
        const source = (sourceY * frame.width + sourceX) * 4;
        const alpha = frame.data[source + 3];
        if (alpha <= 16) continue;
        writePixel(
          rgba,
          width,
          originX + x,
          originY + y,
          frame.data[source],
          frame.data[source + 1],
          frame.data[source + 2],
          255,
        );
      }
    }
  });
  return { data: rgba, width, height };
}

/**
 * Measures every PNG path in order.
 * @param {string[]} filePaths Absolute PNG paths.
 * @returns {Array<object>} Per-frame metrics with index.
 */
function measureFrameFiles(filePaths) {
  return (Array.isArray(filePaths) ? filePaths : []).map((filePath, index) => {
    const image = decodePngRgba(filePath);
    return { index, ...measureFrame(image.data, image.width, image.height) };
  });
}

/**
 * Summarizes a list of frame metrics.
 * @param {Array<{bodyHeight:number,nearWhite:number}>} frames Measured frames.
 * @returns {{bodyHeight:{min:number,max:number,median:number},nearWhiteTotal:number,frames:object[]}}
 */
function summarizeMetrics(frames) {
  const heights = frames.map((frame) => Number(frame.bodyHeight || 0));
  return {
    bodyHeight: {
      min: heights.length ? Math.min(...heights) : 0,
      max: heights.length ? Math.max(...heights) : 0,
      median: median(heights),
    },
    nearWhiteTotal: frames.reduce((sum, frame) => sum + Number(frame.nearWhite || 0), 0),
    frames,
  };
}

module.exports = {
  estimateVisualScales,
  findMotionWindow,
  inclusiveRange,
  measureFrame,
  measureFrameFiles,
  median,
  renderContactSheet,
  summarizeMetrics,
};
