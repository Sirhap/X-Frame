"use strict";

/**
 * Normalization and validation of the arguments MCP tools receive, plus the
 * small filesystem lookups the import paths depend on.
 *
 * These helpers hold no service state: they turn whatever an agent sent into a
 * value the handlers can trust, or throw an error the agent can act on.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Largest agent-supplied file accepted by the binding tools. They take single
 * frames, trail textures and sound effects, none of which come close, so the
 * limit only catches a mistyped path pointing at something enormous.
 */
const MAX_AGENT_FILE_BYTES = 64 * 1024 * 1024;
const PNG_NAME = /\.png$/i;

/**
 * Parses MCP JSON flags. Hosts often send the strings "true"/"false".
 * @param {unknown} value Raw argument.
 * @param {boolean} [fallback=false] Default when the value is omitted.
 * @returns {boolean} Resolved flag.
 */
function booleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "no") return false;
  }
  return fallback;
}

/**
 * Parses a 0-based frame index or throws.
 * @param {unknown} value Raw frame argument.
 * @param {number} last Inclusive last valid index.
 * @returns {number} Integer frame index.
 */
function requireFrameIndex(value, last) {
  const frame = Number(value);
  if (!Number.isInteger(frame) || frame < 0 || frame > last) {
    throw new Error(`Frame must be an integer between 0 and ${Math.max(0, last)}.`);
  }
  return frame;
}

/**
 * Parses animation FPS in the inclusive 1–120 range.
 * @param {unknown} value Raw FPS.
 * @param {number} [fallback=12] Default FPS.
 * @returns {number} Sanitized FPS.
 */
function requireFps(value, fallback = 12) {
  const fps = Number(value === undefined || value === null || value === "" ? fallback : value);
  if (!Number.isFinite(fps) || fps < 1 || fps > 120) {
    throw new Error("fps must be a finite number between 1 and 120.");
  }
  return fps;
}

/**
 * Converts a local PNG file into the organizer import item shape.
 * @param {string} filePath Absolute PNG path.
 * @returns {{name:string,data:string}} Import item.
 */
function pngFileToItem(filePath) {
  return {
    name: path.basename(filePath),
    data: `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`,
  };
}

/**
 * Lists PNG files in a directory using numeric filename order.
 * @param {string} directory Absolute directory.
 * @returns {string[]} Absolute PNG paths.
 */
function listPngSequence(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`PNG sequence directory not found: ${directory}`);
  }
  const files = fs
    .readdirSync(directory)
    .filter((name) => PNG_NAME.test(name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .map((name) => path.join(directory, name));
  if (!files.length) throw new Error(`No PNG frames found in ${directory}`);
  return files;
}

/**
 * Resolves the unified import source from explicit or inferred arguments.
 * @param {object} args Tool arguments.
 * @returns {string} Source kind.
 */
function resolveImportSource(args = {}) {
  const explicit = String(args.source || args.kind || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (explicit) return explicit;
  if (Array.isArray(args.items) && args.items.length) return "items";
  const filePath = String(args.file_path || args.path || "");
  if (/\.spriteframes\.tres$/i.test(filePath)) return "spriteframes";
  if (args.directory) return "png_sequence";
  if (filePath) return "video";
  throw new Error("Provide source=video|png_sequence|spriteframes|items and a matching path or items.");
}

/**
 * Merges one collision/hurt/hit box patch onto the saved box.
 * @param {object|undefined} existing Current box.
 * @param {object} patch Requested fields.
 * @param {{ground?:boolean}} [options] Collision grounding.
 * @returns {object} Merged box.
 */
function mergeBox(existing, patch, options = {}) {
  const current = existing && typeof existing === "object" ? existing : {};
  const next = {
    enabled: patch.enabled === undefined ? current.enabled !== false : booleanFlag(patch.enabled),
    offset: {
      x: Number(patch.offset?.x ?? current.offset?.x ?? 0),
      y: Number(patch.offset?.y ?? current.offset?.y ?? 0),
    },
    size: {
      x: Number(patch.size?.x ?? current.size?.x ?? 0),
      y: Number(patch.size?.y ?? current.size?.y ?? 0),
    },
    rotation: Number(patch.rotation ?? current.rotation ?? 0),
  };
  const numericValues = [next.offset.x, next.offset.y, next.size.x, next.size.y, next.rotation];
  if (!numericValues.every(Number.isFinite)) throw new Error("Box geometry must contain finite numbers.");
  if (options.ground && patch.offset?.y === undefined && next.size.y > 0) {
    next.offset.y = -next.size.y * 0.5;
  }
  return next;
}

/**
 * Classifies one validate_import message into standalone, bind, or gameplay.
 * @param {string} message Validation message.
 * @returns {"standalone"|"bind"|"gameplay"} Layer name.
 */
function classifyValidationMessage(message) {
  const text = String(message || "");
  if (/Generated runtime|gameplay scene|xsxb_frame_actor|animation_duration|scene_scale/i.test(text)) {
    return "gameplay";
  }
  if (
    /project\.godot not found|Game-local|game-local|bound game asset|res:\/\/|Unstable frame binding key/i.test(
      text,
    )
  ) {
    return "bind";
  }
  return "standalone";
}

/**
 * Slices extracted video frames by inclusive start/end indexes.
 * @param {string[]} extractedPaths Extracted PNG paths.
 * @param {{start_frame?:number,end_frame?:number}} [args] Inclusive indexes.
 * @returns {{paths:string[],extractedCount:number,startFrame:number,endFrame:number}} Sliced paths.
 */
function sliceExtractedFrames(extractedPaths, args = {}) {
  const paths = Array.isArray(extractedPaths) ? extractedPaths : [];
  const last = Math.max(0, paths.length - 1);
  const start = Number.isInteger(Number(args.start_frame))
    ? Math.max(0, Math.min(last, Number(args.start_frame)))
    : 0;
  const end = Number.isInteger(Number(args.end_frame))
    ? Math.max(start, Math.min(last, Number(args.end_frame)))
    : last;
  return {
    paths: paths.slice(start, end + 1),
    extractedCount: paths.length,
    startFrame: start,
    endFrame: end,
  };
}

/**
 * Resolves an existing local file or throws.
 *
 * Every caller reads the whole file into memory, so the size is checked from
 * the stat that already proves the file exists. Without it one mistyped path to
 * a disk image would be loaded in full before anything noticed.
 * @param {string} filePath Candidate path.
 * @param {string} label Error label.
 * @param {number} [maxBytes] Largest accepted file size.
 * @returns {string} Absolute path.
 */
function requireExistingFile(filePath, label, maxBytes = MAX_AGENT_FILE_BYTES) {
  const absolute = path.resolve(String(filePath || ""));
  if (!filePath || !fs.existsSync(absolute)) {
    throw new Error(`${label} not found: ${filePath || "(empty)"}`);
  }
  const stats = fs.statSync(absolute);
  if (!stats.isFile()) throw new Error(`${label} not found: ${filePath}`);
  if (stats.size > maxBytes) {
    throw new Error(
      `${label} is too large: ${formatMegabytes(stats.size)} exceeds the ` +
        `${formatMegabytes(maxBytes)} limit for a single file.`,
    );
  }
  return absolute;
}

/**
 * Renders a byte count as megabytes for operator-facing messages.
 * @param {number} bytes Byte count.
 * @returns {string} Human-readable size.
 */
function formatMegabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Checks whether a filesystem path stays inside a parent directory.
 * @param {string} childPath Candidate child path.
 * @param {string} parentPath Expected parent path.
 * @returns {boolean} True when the child stays inside the parent.
 */
function isInsideDirectory(childPath, parentPath) {
  if (!parentPath) return false;
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

/**
 * Resolves an output under one managed directory and rejects lexical or symlink escapes.
 * @param {string} baseDirectory Managed output root.
 * @param {string} requested Relative or absolute requested path.
 * @param {string} label Argument label.
 * @returns {string} Safe absolute output path.
 */
function resolveManagedOutputPath(baseDirectory, requested, label = "output_path") {
  const base = path.resolve(baseDirectory);
  fs.mkdirSync(base, { recursive: true });
  if (fs.lstatSync(base).isSymbolicLink()) {
    throw new Error(`${label} project exports directory must not be a symlink (${base}).`);
  }
  const candidate = path.isAbsolute(String(requested || ""))
    ? path.resolve(String(requested))
    : path.resolve(base, String(requested || ""));
  if (!isInsideDirectory(candidate, base)) {
    throw new Error(`${label} must stay inside the managed output directory (${base}).`);
  }
  const realBase = fs.realpathSync(base);
  let ancestor = candidate;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if (!isInsideDirectory(fs.realpathSync(ancestor), realBase)) {
    throw new Error(`${label} resolves through a symlink outside the managed output directory (${base}).`);
  }
  return candidate;
}

/**
 * Preserves legacy workspace-relative output paths while denying mutable project asset stores.
 * @param {string} workspaceDirectory Selected project workspace.
 * @param {string} requested Relative or absolute output path.
 * @param {string} label Argument label.
 * @returns {string} Safe output path.
 */
function resolveProjectOutputPath(workspaceDirectory, requested, label = "output_path") {
  const workspace = path.resolve(workspaceDirectory);
  const candidate = resolveManagedOutputPath(workspace, requested, label);
  for (const protectedName of [".xsxb", "assets", "attachments", "audio", "attack_trails"]) {
    if (isInsideDirectory(candidate, path.join(workspace, protectedName))) {
      throw new Error(`${label} targets a protected project workspace path: ${protectedName}.`);
    }
  }
  return candidate;
}

/**
 * MIME type for a supported SFX file.
 * @param {string} filePath Audio path.
 * @returns {string} MIME type.
 */
function audioMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".wav") return "audio/wav";
  if (extension === ".ogg") return "audio/ogg";
  if (extension === ".mp3") return "audio/mpeg";
  throw new Error(`Unsupported SFX type ${extension || "(none)"}. Use .wav, .ogg, or .mp3.`);
}
module.exports = {
  MAX_AGENT_FILE_BYTES,
  PNG_NAME,
  audioMimeType,
  booleanFlag,
  classifyValidationMessage,
  formatMegabytes,
  isInsideDirectory,
  listPngSequence,
  mergeBox,
  pngFileToItem,
  requireExistingFile,
  requireFps,
  requireFrameIndex,
  resolveManagedOutputPath,
  resolveProjectOutputPath,
  resolveImportSource,
  sliceExtractedFrames,
};
