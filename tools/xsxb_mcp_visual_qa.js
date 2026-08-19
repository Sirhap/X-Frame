"use strict";

const { ALPHA_VISIBLE, decodePngRgba, subjectAnchor } = require("./xsxb_mcp_cutout");

const NEAR_WHITE_LUMA = 240;
const NEAR_WHITE_ALPHA = 200;

const DIGIT_GLYPHS = Object.freeze([
  ["111", "101", "101", "101", "111"],
  ["010", "110", "010", "010", "111"],
  ["111", "001", "111", "100", "111"],
  ["111", "001", "111", "001", "111"],
  ["101", "101", "111", "001", "001"],
  ["111", "100", "111", "001", "111"],
  ["111", "100", "111", "101", "111"],
  ["111", "001", "001", "001", "001"],
  ["111", "101", "111", "101", "111"],
  ["111", "101", "111", "001", "111"],
]);

const INDEX_BADGE = Object.freeze({
  inset: 1,
  pad: 1,
  ink: Object.freeze([255, 255, 255, 255]),
  plate: Object.freeze([8, 8, 12, 255]),
});

const MARK_BORDER = Object.freeze({
  color: Object.freeze([255, 220, 0, 255]),
  width: 2,
});

const GROUP_GRID = Object.freeze({
  axis: Object.freeze([255, 196, 74, 255]),
  line: Object.freeze([145, 215, 255, 72]),
  originInk: Object.freeze([255, 224, 150, 255]),
});

const HANDLE_FRACTIONS = Object.freeze([0, 0.5, 2 / 3, 1]);
const GROUP_GRID_MIN_CELL = 24;

/**
 * Parses a grip fraction. Accepts 0.666… or "2/3".
 * @param {unknown} value Raw t.
 * @param {number} [fallback=0.5] Default.
 * @returns {number} Fraction in 0–1, or NaN when unusable.
 */
function parseGripT(value, fallback = 0.5) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") {
    const fraction = value.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fraction) {
      const parsed = Number(fraction[1]) / Number(fraction[2]);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

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
 * Returns the source-canvas foot origin used by tuner/Godot.
 * @param {number} width Canvas width.
 * @param {number} height Canvas height.
 * @param {string} [anchorMode] Animation anchor.
 * @returns {{x:number,y:number}} Source pixel of group (0,0).
 */
function canvasAnchor(width, height, anchorMode = "canvas_bottom_center") {
  if (anchorMode === "canvas_left_bottom") return { x: 0, y: height };
  return { x: width / 2, y: height };
}

/**
 * Converts a source-canvas pixel into group/runtime coordinates.
 * @param {number} x Source column.
 * @param {number} y Source row.
 * @param {number} width Canvas width.
 * @param {number} height Canvas height.
 * @param {string} [anchorMode] Animation anchor.
 * @returns {{x:number,y:number}} Group point. +x right, +y down; body is negative y.
 */
function canvasToGroup(x, y, width, height, anchorMode = "canvas_bottom_center") {
  const origin = canvasAnchor(width, height, anchorMode);
  return { x: x - origin.x, y: y - origin.y };
}

/**
 * Converts a group/runtime point back onto the source canvas.
 * @param {number} x Group X.
 * @param {number} y Group Y.
 * @param {number} width Canvas width.
 * @param {number} height Canvas height.
 * @param {string} [anchorMode] Animation anchor.
 * @returns {{x:number,y:number}} Source pixel.
 */
function groupToCanvas(x, y, width, height, anchorMode = "canvas_bottom_center") {
  const origin = canvasAnchor(width, height, anchorMode);
  return { x: origin.x + x, y: origin.y + y };
}

/**
 * Maps a source pixel into a contact-sheet cell.
 * @param {number} x Source column.
 * @param {number} y Source row.
 * @param {number} sourceWidth Source width.
 * @param {number} sourceHeight Source height.
 * @param {number} cell Cell edge.
 * @returns {{x:number,y:number}} Cell-local pixel.
 */
function canvasToCell(x, y, sourceWidth, sourceHeight, cell) {
  return {
    x: (x * cell) / Math.max(1, sourceWidth),
    y: (y * cell) / Math.max(1, sourceHeight),
  };
}

/**
 * Maps the foot origin onto a painted cell pixel.
 * @param {number} sourceWidth Source width.
 * @param {number} sourceHeight Source height.
 * @param {number} cell Cell edge.
 * @param {string} [anchorMode] Animation anchor.
 * @returns {{x:number,y:number}} Clamped cell-local pixel.
 */
function paintedOriginCell(sourceWidth, sourceHeight, cell, anchorMode) {
  const raw = canvasToCell(
    canvasAnchor(sourceWidth, sourceHeight, anchorMode).x,
    canvasAnchor(sourceWidth, sourceHeight, anchorMode).y,
    sourceWidth,
    sourceHeight,
    cell,
  );
  return {
    x: Math.max(0, Math.min(cell - 1, Math.round(raw.x))),
    y: Math.max(0, Math.min(cell - 1, Math.round(raw.y))),
  };
}

/**
 * Chooses a readable group-grid step in source units.
 * @param {number} cell Cell edge.
 * @param {number} sourceWidth Source width.
 * @returns {number} Step.
 */
function groupGridStep(cell, sourceWidth) {
  const sourcePerPixel = Math.max(1, sourceWidth) / Math.max(1, cell);
  const raw = Math.max(1, (cell / 5) * sourcePerPixel);
  const base = 10 ** Math.floor(Math.log10(raw));
  for (const multiplier of [1, 2, 5, 10]) {
    const step = base * multiplier;
    if (step >= raw) return step;
  }
  return base * 10;
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
    if (alpha <= ALPHA_VISIBLE) continue;
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
  if (x < 0 || y < 0 || x >= width) return;
  const height = rgba.length / (width * 4);
  if (y >= height) return;
  const offset = (y * width + x) * 4;
  rgba[offset] = r;
  rgba[offset + 1] = g;
  rgba[offset + 2] = b;
  rgba[offset + 3] = a;
}

/**
 * Fills a rectangle clipped to a cell.
 * @param {Uint8ClampedArray} rgba Destination.
 * @param {number} width Sheet width.
 * @param {number} left Inclusive left.
 * @param {number} top Inclusive top.
 * @param {number} right Exclusive right.
 * @param {number} bottom Exclusive bottom.
 * @param {readonly number[]} color RGBA color.
 * @param {{x:number,y:number,size:number}} clip Cell clip.
 * @returns {void}
 */
function fillRect(rgba, width, left, top, right, bottom, color, clip) {
  const minX = Math.max(clip.x, left);
  const minY = Math.max(clip.y, top);
  const maxX = Math.min(clip.x + clip.size, right);
  const maxY = Math.min(clip.y + clip.size, bottom);
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1)
      writePixel(rgba, width, x, y, color[0], color[1], color[2], color[3]);
  }
}

/**
 * Paints a 0-based index badge into the top-left of one cell.
 * @param {Uint8ClampedArray} rgba Destination.
 * @param {number} width Sheet width.
 * @param {number} originX Cell left.
 * @param {number} originY Cell top.
 * @param {number} cell Cell edge.
 * @param {number} value Absolute frame index.
 * @returns {void}
 */
function drawIndexBadge(rgba, width, originX, originY, cell, value) {
  const scale = Math.max(1, Math.floor(cell / 40));
  const digits = String(Math.max(0, Math.floor(Number(value) || 0)));
  const glyphWidth = 3 * scale;
  const glyphHeight = 5 * scale;
  const gap = scale;
  const plateWidth = INDEX_BADGE.pad * 2 + digits.length * glyphWidth + Math.max(0, digits.length - 1) * gap;
  const plateHeight = INDEX_BADGE.pad * 2 + glyphHeight;
  const plateX = originX + INDEX_BADGE.inset;
  const plateY = originY + INDEX_BADGE.inset;
  const clip = { x: originX, y: originY, size: cell };
  fillRect(rgba, width, plateX, plateY, plateX + plateWidth, plateY + plateHeight, INDEX_BADGE.plate, clip);
  let cursorX = plateX + INDEX_BADGE.pad;
  const glyphY = plateY + INDEX_BADGE.pad;
  for (const character of digits) {
    const glyph = DIGIT_GLYPHS[Number(character)] || DIGIT_GLYPHS[0];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        fillRect(
          rgba,
          width,
          cursorX + column * scale,
          glyphY + row * scale,
          cursorX + (column + 1) * scale,
          glyphY + (row + 1) * scale,
          INDEX_BADGE.ink,
          clip,
        );
      }
    }
    cursorX += glyphWidth + gap;
  }
}

/**
 * Projects opaque pixels onto their longest axis. The pommel is the end closer
 * to the widest cross-section (guard or forte); the far end is the tip.
 * @param {Uint8ClampedArray|Uint8Array} rgba Pixels.
 * @param {number} width Width.
 * @param {number} height Height.
 * @param {{t?:number}} [options] Grip fraction from pommel (0) to tip (1).
 * @returns {object} Axis, fractions, and the requested grip.
 */
function measureLongAxis(rgba, width, height, options = {}) {
  const points = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] <= ALPHA_VISIBLE) continue;
      points.push({ x, y });
    }
  }
  if (points.length < 8) {
    throw new Error("Image has too few opaque pixels to measure a weapon axis.");
  }
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const extentX = maxX - minX;
  const extentY = maxY - minY;
  let axisX;
  let axisY;
  if (extentY >= extentX * 1.15) {
    axisX = 0;
    axisY = 1;
  } else if (extentX >= extentY * 1.15) {
    axisX = 1;
    axisY = 0;
  } else {
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (const point of points) {
      const dx = point.x - meanX;
      const dy = point.y - meanY;
      xx += dx * dx;
      xy += dx * dy;
      yy += dy * dy;
    }
    const trace = xx + yy;
    const det = xx * yy - xy * xy;
    const eigenvalue = trace / 2 + Math.sqrt(Math.max(0, (trace / 2) ** 2 - det));
    axisX = xy === 0 && yy >= xx ? 0 : eigenvalue - yy;
    axisY = xy === 0 && yy >= xx ? 1 : xy;
    if (xy === 0 && xx >= yy) {
      axisX = 1;
      axisY = 0;
    }
  }
  const axisLength = Math.max(0.0001, Math.hypot(axisX, axisY));
  axisX /= axisLength;
  axisY /= axisLength;
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const point of points) {
    const projection = (point.x - meanX) * axisX + (point.y - meanY) * axisY;
    if (projection < minProj) minProj = projection;
    if (projection > maxProj) maxProj = projection;
  }
  const minEnd = { x: meanX + minProj * axisX, y: meanY + minProj * axisY };
  const maxEnd = { x: meanX + maxProj * axisX, y: meanY + maxProj * axisY };
  const span = Math.max(0.0001, maxProj - minProj);
  const binCount = 24;
  const binMin = new Array(binCount).fill(Infinity);
  const binMax = new Array(binCount).fill(-Infinity);
  for (const point of points) {
    const projection = (point.x - meanX) * axisX + (point.y - meanY) * axisY;
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor(((projection - minProj) / span) * binCount)));
    const perp = (point.x - meanX) * -axisY + (point.y - meanY) * axisX;
    if (perp < binMin[bin]) binMin[bin] = perp;
    if (perp > binMax[bin]) binMax[bin] = perp;
  }
  let maxWidth = -1;
  let maxBin = 0;
  for (let bin = 0; bin < binCount; bin += 1) {
    if (!Number.isFinite(binMin[bin])) continue;
    const widthAt = binMax[bin] - binMin[bin];
    if (widthAt > maxWidth) {
      maxWidth = widthAt;
      maxBin = bin;
    }
  }
  const maxStation = minProj + ((maxBin + 0.5) / binCount) * span;
  const minIsPommel = Math.abs(minProj - maxStation) <= Math.abs(maxProj - maxStation);
  const pommel = minIsPommel ? minEnd : maxEnd;
  const tip = minIsPommel ? maxEnd : minEnd;
  /**
   * Interpolates along the pommel→tip axis.
   * @param {number} t Fraction from pommel.
   * @returns {{x:number,y:number}} Pixel.
   */
  function along(t) {
    const phase = Math.min(1, Math.max(0, Number(t) || 0));
    return {
      x: pommel.x + (tip.x - pommel.x) * phase,
      y: pommel.y + (tip.y - pommel.y) * phase,
    };
  }
  const gripT = parseGripT(options.t);
  if (!Number.isFinite(gripT) || gripT < 0 || gripT > 1) {
    throw new Error("t must be a number between 0 and 1.");
  }
  const at = along(gripT);
  const fractions = {};
  for (const fraction of HANDLE_FRACTIONS) {
    fractions[fraction === 2 / 3 ? "2/3" : String(fraction)] = along(fraction);
  }
  return {
    width,
    height,
    center: { x: width / 2, y: height / 2 },
    pommel: { x: pommel.x, y: pommel.y },
    tip: { x: tip.x, y: tip.y },
    length: Math.hypot(tip.x - pommel.x, tip.y - pommel.y),
    direction: {
      x: (tip.x - pommel.x) / Math.max(0.0001, Math.hypot(tip.x - pommel.x, tip.y - pommel.y)),
      y: (tip.y - pommel.y) / Math.max(0.0001, Math.hypot(tip.x - pommel.x, tip.y - pommel.y)),
    },
    t: gripT,
    at,
    localFromCenter: { x: at.x - width / 2, y: at.y - height / 2 },
    fractions,
  };
}

/**
 * Paints workbench-style group axes into one sheet cell.
 * @param {Uint8ClampedArray} rgba Destination.
 * @param {number} width Sheet width.
 * @param {number} originX Cell left.
 * @param {number} originY Cell top.
 * @param {number} cell Cell edge.
 * @param {number} sourceWidth Source width.
 * @param {number} sourceHeight Source height.
 * @param {string} anchorMode Animation anchor.
 * @returns {void}
 */
function drawGroupGrid(rgba, width, originX, originY, cell, sourceWidth, sourceHeight, anchorMode) {
  if (cell < GROUP_GRID_MIN_CELL) return;
  const clip = { x: originX, y: originY, size: cell };
  const step = groupGridStep(cell, sourceWidth);
  const groupOrigin = canvasToCell(
    canvasAnchor(sourceWidth, sourceHeight, anchorMode).x,
    canvasAnchor(sourceWidth, sourceHeight, anchorMode).y,
    sourceWidth,
    sourceHeight,
    cell,
  );
  const axisX = originX + Math.max(0, Math.min(cell - 1, Math.round(groupOrigin.x)));
  const axisY = originY + Math.max(0, Math.min(cell - 1, Math.round(groupOrigin.y)));
  const reachX = Math.max(sourceWidth, sourceHeight);
  for (let group = -reachX; group <= reachX; group += step) {
    if (group === 0) continue;
    const canvas = groupToCanvas(group, 0, sourceWidth, sourceHeight, anchorMode);
    const cellPoint = canvasToCell(canvas.x, canvas.y, sourceWidth, sourceHeight, cell);
    const x = originX + Math.round(cellPoint.x);
    if (x < originX || x >= originX + cell) continue;
    fillRect(rgba, width, x, originY, x + 1, originY + cell, GROUP_GRID.line, clip);
  }
  for (let group = -reachX; group <= reachX; group += step) {
    if (group === 0) continue;
    const canvas = groupToCanvas(0, group, sourceWidth, sourceHeight, anchorMode);
    const cellPoint = canvasToCell(canvas.x, canvas.y, sourceWidth, sourceHeight, cell);
    const y = originY + Math.round(cellPoint.y);
    if (y < originY || y >= originY + cell) continue;
    fillRect(rgba, width, originX, y, originX + cell, y + 1, GROUP_GRID.line, clip);
  }
  fillRect(rgba, width, axisX, originY, axisX + 1, originY + cell, GROUP_GRID.axis, clip);
  fillRect(rgba, width, originX, axisY, originX + cell, axisY + 1, GROUP_GRID.axis, clip);
  writePixel(
    rgba,
    width,
    axisX,
    axisY,
    GROUP_GRID.originInk[0],
    GROUP_GRID.originInk[1],
    GROUP_GRID.originInk[2],
    GROUP_GRID.originInk[3],
  );
}

function drawMarkBorder(rgba, width, originX, originY, cell) {
  const thickness = Math.max(1, Math.min(MARK_BORDER.width, Math.floor(cell / 4)));
  const color = MARK_BORDER.color;
  for (let t = 0; t < thickness; t += 1) {
    for (let x = 0; x < cell; x += 1) {
      writePixel(rgba, width, originX + x, originY + t, color[0], color[1], color[2], color[3]);
      writePixel(rgba, width, originX + x, originY + cell - 1 - t, color[0], color[1], color[2], color[3]);
    }
    for (let y = 0; y < cell; y += 1) {
      writePixel(rgba, width, originX + t, originY + y, color[0], color[1], color[2], color[3]);
      writePixel(rgba, width, originX + cell - 1 - t, originY + y, color[0], color[1], color[2], color[3]);
    }
  }
}

/**
 * Renders a contact sheet that scales every source canvas into a shared cell.
 * @param {Array<{data:Uint8ClampedArray,width:number,height:number}>} frames Source frames.
 * @param {{cell?:number,pad?:number,columns?:number,startIndex?:number,markFrame?:number,labels?:boolean}} [options] Layout.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}} Sheet.
 */
function renderContactSheet(frames, options = {}) {
  const items = Array.isArray(frames) ? frames : [];
  const cell = Math.max(8, Number(options.cell || 220));
  const pad = Math.max(1, Number(options.pad || 8));
  const columns = Math.max(1, Number(options.columns || Math.min(items.length || 1, 8)));
  const startIndex = Math.max(0, Math.floor(Number(options.startIndex || 0)));
  const labels = options.labels !== false;
  const grid = options.grid !== false;
  const anchorMode = String(options.anchorMode || "canvas_bottom_center");
  const markFrame = options.markFrame === undefined ? startIndex : Number(options.markFrame);
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
    const absoluteIndex = startIndex + index;
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
    if (grid && frame?.width && frame?.height) {
      drawGroupGrid(rgba, width, originX, originY, cell, frame.width, frame.height, anchorMode);
    }
    if (labels) drawIndexBadge(rgba, width, originX, originY, cell, absoluteIndex);
    if (Number.isInteger(markFrame) && markFrame === absoluteIndex) {
      drawMarkBorder(rgba, width, originX, originY, cell);
    }
    if (grid && frame?.width && frame?.height && cell >= GROUP_GRID_MIN_CELL) {
      const origin = paintedOriginCell(frame.width, frame.height, cell, anchorMode);
      writePixel(
        rgba,
        width,
        originX + origin.x,
        originY + origin.y,
        GROUP_GRID.originInk[0],
        GROUP_GRID.originInk[1],
        GROUP_GRID.originInk[2],
        GROUP_GRID.originInk[3],
      );
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
  DIGIT_GLYPHS,
  GROUP_GRID,
  GROUP_GRID_MIN_CELL,
  HANDLE_FRACTIONS,
  INDEX_BADGE,
  MARK_BORDER,
  canvasAnchor,
  canvasToCell,
  canvasToGroup,
  estimateVisualScales,
  findMotionWindow,
  groupGridStep,
  groupToCanvas,
  inclusiveRange,
  measureFrame,
  measureFrameFiles,
  measureLongAxis,
  median,
  paintedOriginCell,
  parseGripT,
  renderContactSheet,
  summarizeMetrics,
};
