"use strict";

/**
 * Node-side loop-segment query that reuses the Tuner's FrameOrganizerCore
 * finder. The UI resamples to 256×256 via Canvas; MCP does the same size with
 * nearest-neighbor so the search can run without a browser.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  ORGANIZER_SIMILARITY_THRESHOLD,
  REFERENCE_SAMPLE_SIZE,
  analyzeDuplicateFrames,
  createSignature,
  findLoopCandidates,
} = require("./animation_tuner/public/frame_organizer_core");
const { PNG_NAME, listPngSequence, requireExistingFile } = require("./xsxb_mcp_arguments");
const { decodePngRgba } = require("./xsxb_mcp_cutout");

const MINIMUM_LOOP_FRAMES = 4;
const MINIMUM_DUPLICATE_FRAMES = 3;
const DEFAULT_DUPLICATE_THRESHOLD = ORGANIZER_SIMILARITY_THRESHOLD.fallback;

/**
 * Builds an inclusive integer range.
 * @param {number} start First index.
 * @param {number} end Last index.
 * @returns {number[]} Indexes from start through end.
 */
function inclusiveRange(start, end) {
  const order = [];
  for (let index = start; index <= end; index += 1) order.push(index);
  return order;
}

/**
 * Resamples RGBA to a square analysis sample.
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image Source pixels.
 * @param {number} sampleSize Destination edge length.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}} Signature sample.
 */
function downsampleRgba(image, sampleSize) {
  const size = Math.max(8, Math.round(sampleSize));
  if (image.width === size && image.height === size) {
    return createSignature(image.data, image.width, image.height);
  }
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(((y + 0.5) * image.height) / size));
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(((x + 0.5) * image.width) / size));
      const source = (sourceY * image.width + sourceX) * 4;
      const dest = (y * size + x) * 4;
      out[dest] = image.data[source];
      out[dest + 1] = image.data[source + 1];
      out[dest + 2] = image.data[source + 2];
      out[dest + 3] = image.data[source + 3];
    }
  }
  return createSignature(out, size, size);
}

/**
 * Decodes one PNG into a loop-finder signature.
 * @param {string} filePath Absolute PNG path.
 * @param {number} sampleSize Analysis sample edge.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}} Signature.
 */
function loadSignature(filePath, sampleSize) {
  if (!PNG_NAME.test(filePath)) throw new Error(`Loop frame must be a PNG: ${filePath}`);
  return downsampleRgba(decodePngRgba(filePath), sampleSize);
}

/**
 * Public fields copied off one core candidate.
 * @param {object} candidate Core loop candidate.
 * @returns {object} Agent-facing candidate.
 */
function summarizeCandidate(candidate) {
  const start = Number(candidate.start);
  const end = Number(candidate.end);
  return {
    start,
    end,
    length: Number(candidate.length),
    period: Number(candidate.period),
    score: Number(candidate.score),
    rankScore: Number(candidate.rankScore),
    similarity: Number(candidate.similarity),
    coverage: Number(candidate.coverage),
    smoothness: Number(candidate.smoothness),
    acfScore: Number(candidate.acfScore),
    order: inclusiveRange(start, end),
  };
}

/**
 * Ranks loop segments on an ordered PNG sequence.
 * @param {string[]} filePaths Absolute PNG paths in playback order.
 * @param {{minPeriod?:number,maxPeriod?:number,startFrame?:number,preference?:string,boundaryFactor?:number,sampleSize?:number}} [options] Search options.
 * @returns {{frameCount:number,sampleSize:number,candidates:object[],recommended:object|null}} Ranked loops.
 */
function findLoopInPngFiles(filePaths, options = {}) {
  if (!Array.isArray(filePaths) || filePaths.length < MINIMUM_LOOP_FRAMES) {
    throw new Error(
      `Loop search needs at least ${MINIMUM_LOOP_FRAMES} PNG frames; received ${filePaths?.length || 0}.`,
    );
  }
  const sampleSize = Math.max(8, Math.round(options.sampleSize || REFERENCE_SAMPLE_SIZE));
  const signatures = filePaths.map((filePath) => loadSignature(filePath, sampleSize));
  const candidates = findLoopCandidates(signatures, {
    minPeriod: options.minPeriod,
    maxPeriod: options.maxPeriod,
    startFrame: options.startFrame,
    preference: options.preference,
    boundaryFactor: options.boundaryFactor,
  }).map(summarizeCandidate);
  return {
    frameCount: filePaths.length,
    sampleSize,
    candidates,
    recommended: candidates[0] || null,
  };
}

/**
 * Finds near-duplicate holds with the same Tuner duplicate finder.
 * Does not mutate frames; apply the keep-order with xsxb_reorganize_frames.
 * @param {string[]} filePaths Absolute PNG paths in playback order.
 * @param {{threshold?:number,sampleSize?:number}} [options] Search options.
 * @returns {{frameCount:number,sampleSize:number,threshold:number,autoAdjustedThreshold:number|null,drop:number[],order:number[],matches:object[],applied:boolean}}
 */
function findDuplicatesInPngFiles(filePaths, options = {}) {
  if (!Array.isArray(filePaths) || filePaths.length < MINIMUM_DUPLICATE_FRAMES) {
    throw new Error(
      `Duplicate search needs at least ${MINIMUM_DUPLICATE_FRAMES} PNG frames; received ${filePaths?.length || 0}.`,
    );
  }
  const sampleSize = Math.max(8, Math.round(options.sampleSize || REFERENCE_SAMPLE_SIZE));
  const threshold = options.threshold === undefined ? DEFAULT_DUPLICATE_THRESHOLD : Number(options.threshold);
  if (
    !Number.isFinite(threshold) ||
    threshold < ORGANIZER_SIMILARITY_THRESHOLD.min ||
    threshold > ORGANIZER_SIMILARITY_THRESHOLD.max
  ) {
    throw new Error(
      `threshold must be a number between ${ORGANIZER_SIMILARITY_THRESHOLD.min} and ${ORGANIZER_SIMILARITY_THRESHOLD.max}.`,
    );
  }
  const signatures = filePaths.map((filePath) => loadSignature(filePath, sampleSize));
  const analyzed = analyzeDuplicateFrames(signatures, threshold);
  const suggestedDrop = analyzed.matches.map((entry) => Number(entry.index));
  const applyAuto = Boolean(options.autoAdjust) && analyzed.autoAdjustedThreshold != null;
  const drop = analyzed.autoAdjustedThreshold == null || applyAuto ? suggestedDrop : [];
  const dropped = new Set(drop);
  const order = filePaths.map((_, index) => index).filter((index) => !dropped.has(index));
  const suggestedDropped = new Set(suggestedDrop);
  return {
    frameCount: filePaths.length,
    sampleSize,
    threshold,
    autoAdjustedThreshold: analyzed.autoAdjustedThreshold,
    drop,
    order,
    suggestedDrop,
    suggestedOrder: filePaths.map((_, index) => index).filter((index) => !suggestedDropped.has(index)),
    matches: analyzed.matches,
    applied: false,
  };
}

/**
 * Resolves PNG paths from explicit files or a directory of numbered frames.
 * @param {{file_paths?:string[],directory?:string}} args Tool arguments.
 * @returns {{source:string,filePaths:string[]}|null} Resolved files, or null when neither source is set.
 */
function resolveExternalLoopFrames(args = {}) {
  if (Array.isArray(args.file_paths) && args.file_paths.length) {
    return {
      source: "files",
      filePaths: args.file_paths.map((filePath) => requireExistingFile(filePath, "Loop frame")),
    };
  }
  if (args.directory) {
    const directory = path.resolve(String(args.directory));
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw new Error(`PNG sequence directory not found: ${args.directory}`);
    }
    return { source: "directory", filePaths: listPngSequence(directory) };
  }
  return null;
}

module.exports = {
  DEFAULT_DUPLICATE_THRESHOLD,
  ORGANIZER_SIMILARITY_THRESHOLD,
  MINIMUM_DUPLICATE_FRAMES,
  MINIMUM_LOOP_FRAMES,
  downsampleRgba,
  findDuplicatesInPngFiles,
  findLoopInPngFiles,
  resolveExternalLoopFrames,
};
