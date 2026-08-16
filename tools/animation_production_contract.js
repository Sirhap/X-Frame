const fs = require("node:fs");
const path = require("node:path");

const { slug } = require("./project_store");

const CONTRACT_VERSION = 1;
const DEFAULTS = Object.freeze({
  anchor: "canvas_bottom_center",
  direction: "auto",
  fps: 12,
  loop: true,
  replace: false,
  rootMotion: "in-place",
  type: "actor",
});
const CLI_SOURCE_KINDS = new Set(["generated", "png-sequence"]);
const SUPPORTED_SOURCE_KINDS = new Set(["generated", "png-sequence", "spriteframes", "video"]);

/**
 * Resolve a user-supplied path relative to the contract file or working directory.
 * @param {unknown} value Path value from the contract.
 * @param {string} baseDir Base directory for relative paths.
 * @returns {string} Normalized absolute path, or an empty string for an empty input.
 */
function resolvePath(value, baseDir) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("\0")) throw new Error("Path contains a null byte.");
  return path.normalize(path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw));
}

/**
 * Normalize one animation clip into the shape consumed by the workflow CLI.
 * @param {unknown} rawClip Raw clip or motion object.
 * @param {string} baseDir Base directory for relative source paths.
 * @param {number} index Clip index used for diagnostics and fallback ids.
 * @returns {object} Normalized clip.
 */
function normalizeClip(rawClip, baseDir, index) {
  const source = rawClip && typeof rawClip === "object" ? rawClip.source : null;
  const sourceObject = source && typeof source === "object" ? source : {};
  const sourceKind = String(sourceObject.kind || "png-sequence")
    .trim()
    .toLowerCase();
  const clipId = String(rawClip?.id || rawClip?.name || `clip_${index + 1}`).trim();
  const fps = Number(rawClip?.fps ?? DEFAULTS.fps);
  const frameCount = rawClip?.frameCount === undefined ? null : Number(rawClip.frameCount);

  return {
    id: slug(clipId, `clip_${index + 1}`),
    name: String(rawClip?.name || clipId),
    source: {
      kind: sourceKind,
      path: resolvePath(sourceObject.path, baseDir),
    },
    frameCount,
    fps,
    type: String(rawClip?.type || DEFAULTS.type),
    anchor: String(rawClip?.anchor || DEFAULTS.anchor),
    loop: rawClip?.loop === undefined ? DEFAULTS.loop : Boolean(rawClip.loop),
    rootMotion: String(rawClip?.rootMotion || DEFAULTS.rootMotion),
    direction: String(rawClip?.direction || DEFAULTS.direction),
    replace: rawClip?.replace === undefined ? DEFAULTS.replace : Boolean(rawClip.replace),
    execution: CLI_SOURCE_KINDS.has(sourceKind) ? "cli-import" : "browser-required",
  };
}

/**
 * Normalize an animation production contract without touching project data.
 * @param {unknown} rawContract Contract object read from JSON or supplied by a caller.
 * @param {{baseDir?:string}} [options] Resolution options.
 * @returns {object} Normalized version-1 contract.
 */
function normalizeContract(rawContract, options = {}) {
  const raw = rawContract && typeof rawContract === "object" ? rawContract : {};
  const baseDir = path.resolve(String(options.baseDir || process.cwd()));
  const rawClips = Array.isArray(raw.clips) ? raw.clips : raw.motion ? [raw.motion] : [];
  const clips = rawClips.map((clip, index) => normalizeClip(clip, baseDir, index));
  const artifacts = raw.artifacts && typeof raw.artifacts === "object" ? raw.artifacts : {};

  return {
    version: Number(raw.version),
    projectRoot: resolvePath(raw.projectRoot, baseDir),
    profile: slug(raw.profile, ""),
    identity: raw.identity && typeof raw.identity === "object" ? { ...raw.identity } : {},
    clips,
    artifacts: {
      directory: resolvePath(artifacts.directory || artifacts.path, baseDir),
    },
  };
}

/**
 * Validate the contract shape and report all actionable errors without throwing.
 * @param {unknown} rawContract Contract object read from JSON or supplied by a caller.
 * @param {{baseDir?:string}} [options] Resolution options.
 * @returns {{ok:boolean,errors:string[],warnings:string[],contract?:object}} Validation result.
 */
function validateContract(rawContract, options = {}) {
  const errors = [];
  const warnings = [];
  let contract;
  try {
    contract = normalizeContract(rawContract, options);
  } catch (error) {
    return { ok: false, errors: [error.message], warnings };
  }

  if (contract.version !== CONTRACT_VERSION) {
    errors.push(
      `Unsupported contract version: ${contract.version || "missing"}. Expected ${CONTRACT_VERSION}.`,
    );
  }
  if (!contract.projectRoot) errors.push("projectRoot is required.");
  if (!contract.profile) errors.push("profile is required.");
  if (!contract.clips.length) errors.push("At least one motion or clip is required.");

  const ids = new Set();
  contract.clips.forEach((clip, index) => {
    const label = `clips[${index}]`;
    if (!clip.id || clip.id.startsWith("clip_")) errors.push(`${label}.id is required.`);
    if (ids.has(clip.id)) errors.push(`${label}.id is duplicated: ${clip.id}.`);
    ids.add(clip.id);
    if (!SUPPORTED_SOURCE_KINDS.has(clip.source.kind)) {
      errors.push(`${label}.source.kind is unsupported: ${clip.source.kind || "missing"}.`);
    }
    if (!clip.source.path) errors.push(`${label}.source.path is required.`);
    if (!Number.isFinite(clip.fps) || clip.fps <= 0) errors.push(`${label}.fps must be greater than zero.`);
    if (clip.frameCount !== null && (!Number.isInteger(clip.frameCount) || clip.frameCount < 1)) {
      errors.push(`${label}.frameCount must be a positive integer when provided.`);
    }
    if (clip.source.kind === "video" || clip.source.kind === "spriteframes") {
      warnings.push(`${label} requires the existing browser or specialized importer workflow.`);
    }
  });

  return { ok: errors.length === 0, errors, warnings, contract };
}

/**
 * Load and validate a JSON contract from disk.
 * @param {string} filePath Contract JSON path.
 * @param {{baseDir?:string}} [options] Resolution options.
 * @returns {object} Normalized contract.
 */
function loadContract(filePath, options = {}) {
  const absolutePath = path.resolve(String(filePath || ""));
  if (!absolutePath || !fs.existsSync(absolutePath))
    throw new Error(`Contract file not found: ${absolutePath}`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid contract JSON at ${absolutePath}: ${error.message}`);
  }
  const result = validateContract(raw, { baseDir: options.baseDir || path.dirname(absolutePath) });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.contract;
}

module.exports = {
  CONTRACT_VERSION,
  DEFAULTS,
  loadContract,
  normalizeContract,
  validateContract,
};
