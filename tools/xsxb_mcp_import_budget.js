"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_MCP_IMPORT_FRAMES = 512;
const MAX_MCP_IMPORT_BYTES = 128 * 1024 * 1024;
const MAX_MCP_IMPORT_PIXELS = 64 * 1024 * 1024;

function pngDimensions(buffer, label) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error(`${label} is not PNG image data.`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) throw new Error(`${label} has invalid PNG dimensions.`);
  return { width, height };
}

function fileHeader(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  const header = Buffer.alloc(24);
  try {
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead < header.length) throw new Error(`PNG header is truncated: ${filePath}`);
  } finally {
    fs.closeSync(descriptor);
  }
  return header;
}

function assertBudget(budget) {
  if (budget.frames > MAX_MCP_IMPORT_FRAMES) {
    throw new Error(`MCP animation imports are limited to ${MAX_MCP_IMPORT_FRAMES} frames.`);
  }
  if (budget.bytes > MAX_MCP_IMPORT_BYTES) {
    throw new Error(`MCP animation import bytes exceed the ${MAX_MCP_IMPORT_BYTES}-byte budget.`);
  }
  if (budget.pixels > MAX_MCP_IMPORT_PIXELS) {
    throw new Error(`MCP animation import pixels exceed the ${MAX_MCP_IMPORT_PIXELS}-pixel budget.`);
  }
}

function consume(budget, bytes, dimensions) {
  budget.frames += 1;
  budget.bytes += bytes;
  budget.pixels += dimensions.width * dimensions.height;
  assertBudget(budget);
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new Error("MCP request cancelled.");
}

async function yieldForCancellation(signal) {
  await new Promise((resolve) => setImmediate(resolve));
  abortIfNeeded(signal);
}

/** @returns {{frames:number,bytes:number,pixels:number}} Empty cumulative import budget. */
function createImportBudget() {
  return { frames: 0, bytes: 0, pixels: 0 };
}

/**
 * Preflights and materializes PNG files without retaining decoded pixel buffers.
 * @param {string[]} filePaths Ordered source files.
 * @param {{signal?:AbortSignal,budget?:object,onProgress?:Function}} [options] Operation options.
 * @returns {Promise<object[]>} Frame-organizer data items.
 */
async function materializePngFiles(filePaths, options = {}) {
  const paths = Array.from(filePaths || []).map((filePath) => path.resolve(filePath));
  const budget = options.budget || createImportBudget();
  for (const [index, filePath] of paths.entries()) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Import PNG not found: ${filePath}`);
    }
    consume(
      budget,
      fs.statSync(filePath).size,
      pngDimensions(fileHeader(filePath), `Import frame ${index + 1}`),
    );
  }
  const items = [];
  for (const [index, filePath] of paths.entries()) {
    if (index % 8 === 0) await yieldForCancellation(options.signal);
    const buffer = fs.readFileSync(filePath);
    items.push({
      name: path.basename(filePath),
      data: `data:image/png;base64,${buffer.toString("base64")}`,
    });
    options.onProgress?.(index + 1, paths.length);
  }
  abortIfNeeded(options.signal);
  return items;
}

/**
 * Preflights inline/file-backed MCP items and yields while materializing paths.
 * @param {object[]} sourceItems Caller items.
 * @param {{signal?:AbortSignal,budget?:object,onProgress?:Function}} [options] Operation options.
 * @returns {Promise<object[]>} Normalized PNG data items.
 */
async function materializeImportItems(sourceItems, options = {}) {
  const items = Array.from(sourceItems || []);
  const budget = options.budget || createImportBudget();
  const descriptors = items.map((item, index) => {
    if (item?.data) {
      const match = /^data:image\/png;base64,(.+)$/iu.exec(String(item.data));
      if (!match) throw new Error(`Import item ${index + 1} is not PNG image data.`);
      const bytes = Buffer.byteLength(match[1], "base64");
      const header = Buffer.from(match[1].slice(0, 40), "base64");
      consume(budget, bytes, pngDimensions(header, `Import item ${index + 1}`));
      return { item, inline: true };
    }
    const filePath = path.resolve(String(item?.path || item?.file_path || ""));
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Import item ${index + 1} needs PNG data or an existing file path.`);
    }
    consume(
      budget,
      fs.statSync(filePath).size,
      pngDimensions(fileHeader(filePath), `Import item ${index + 1}`),
    );
    return { item, inline: false, filePath };
  });
  const normalized = [];
  for (const [index, descriptor] of descriptors.entries()) {
    if (index % 8 === 0) await yieldForCancellation(options.signal);
    if (descriptor.inline) {
      normalized.push({
        ...descriptor.item,
        name: descriptor.item.name || `frame_${index + 1}.png`,
      });
    } else {
      const buffer = fs.readFileSync(descriptor.filePath);
      normalized.push({
        ...descriptor.item,
        name: descriptor.item.name || path.basename(descriptor.filePath),
        data: `data:image/png;base64,${buffer.toString("base64")}`,
      });
    }
    options.onProgress?.(index + 1, descriptors.length);
  }
  abortIfNeeded(options.signal);
  return normalized;
}

module.exports = {
  MAX_MCP_IMPORT_BYTES,
  MAX_MCP_IMPORT_FRAMES,
  MAX_MCP_IMPORT_PIXELS,
  createImportBudget,
  materializeImportItems,
  materializePngFiles,
  yieldForCancellation,
};
