"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const {
  DEFAULT_ATTACK_TRAIL_PRESET_TEXTURE,
  EMPTY_ATTACK_TRAILS,
  normalizeAttackTrails,
  pngInfo,
  validateAttackTrails,
} = require("./attack_trails");
const { deleteAnimation } = require("./animation_mutations");
const { frameBoxKey, upsertEstimatedFrameBoxes } = require("./box_estimator");
const { importAnimation, reorganizeAnimation } = require("./frame_organizer");
const { syncGodotProject, validGodotProjectRoot } = require("./godot_sync");
const { parseSpriteFrames } = require("./import_spriteframes");
const { createProjectStore, EMPTY_TUNING, reslash, slug } = require("./project_store");
const { validateImport } = require("./validate_import");
const { cutoutFrameFiles } = require("./xsxb_mcp_cutout");

const execFileAsync = promisify(execFile);
const DEFAULT_PROFILE_ID = "mcp_imports";
const DEFAULT_TUNER_HOST = "127.0.0.1";
const DEFAULT_TUNER_PORT = 5179;
const MCP_TOOL_NAMES = Object.freeze([
  "xsxb_list_projects",
  "xsxb_get_project",
  "xsxb_import_video",
  "xsxb_import_animation",
  "xsxb_get_animation",
  "xsxb_update_frame_boxes",
  "xsxb_estimate_boxes",
  "xsxb_update_timing",
  "xsxb_set_visual_transform",
  "xsxb_reorganize_frames",
  "xsxb_replace_frame",
  "xsxb_add_attack_trail",
  "xsxb_add_attachment",
  "xsxb_add_sfx",
  "xsxb_remove_binding",
  "xsxb_delete_animation",
  "xsxb_sync_godot",
  "xsxb_validate_project",
  "xsxb_set_active_project",
  "xsxb_bind_godot",
  "xsxb_cutout",
  "xsxb_export_gif",
  "xsxb_open_tuner",
]);
const BOX_NAMES = Object.freeze(["hurtbox", "collisionbox", "hitbox"]);
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
 * Extracts every source video frame without changing the source frame rate.
 * @param {string} videoPath Absolute input video path.
 * @param {string} outputDirectory Temporary output directory.
 * @param {{ffmpegBinary?:string}} [options] Optional binary override.
 * @returns {Promise<string[]>} Ordered PNG frame paths.
 */
async function extractVideoFrames(videoPath, outputDirectory, options = {}) {
  const outputPattern = path.join(outputDirectory, "frame_%06d.png");
  try {
    await execFileAsync(
      options.ffmpegBinary || process.env.XSXB_FFMPEG || "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", videoPath, "-map", "0:v:0", "-vsync", "0", outputPattern],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (error) {
    throw new Error(`FFmpeg video extraction failed: ${error.stderr || error.message}`);
  }
  return fs
    .readdirSync(outputDirectory)
    .filter((name) => /^frame_\d+\.png$/i.test(name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .map((name) => path.join(outputDirectory, name));
}

/**
 * Encodes an animated GIF from PNG frames with per-frame durations via FFmpeg.
 * @param {{framePaths:string[],durations:number[],outputPath:string,ffmpegBinary?:string}} job Encode job.
 * @returns {Promise<void>}
 */
async function encodeGifWithFfmpeg(job) {
  const escapePath = (filePath) => filePath.replace(/'/g, "'\\''");
  const lines = ["ffconcat version 1.0"];
  job.framePaths.forEach((framePath, index) => {
    lines.push(`file '${escapePath(framePath)}'`);
    // A 1/100s image timebase matches GIF delay resolution; the default 1/25 rounds delays to 40ms.
    lines.push("option framerate 100");
    lines.push(`duration ${Math.max(0.001, job.durations[index]).toFixed(6)}`);
  });
  // The concat demuxer ignores the trailing duration unless the last frame repeats.
  lines.push(`file '${escapePath(job.framePaths[job.framePaths.length - 1])}'`);
  lines.push("option framerate 100");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-gif-"));
  const concatPath = path.join(tempDir, "frames.ffconcat");
  try {
    fs.writeFileSync(concatPath, `${lines.join("\n")}\n`);
    await execFileAsync(
      job.ffmpegBinary || process.env.XSXB_FFMPEG || "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatPath,
        "-filter_complex",
        "[0:v]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128",
        "-loop",
        "0",
        job.outputPath,
      ],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (error) {
    throw new Error(
      `FFmpeg GIF export failed (install ffmpeg or set XSXB_FFMPEG): ${error.stderr || error.message}`,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Encodes a short PCM WAV tone for deterministic SFX integration tests.
 * @param {{frequency?:number,durationMs?:number,sampleRate?:number}} [options] Tone properties.
 * @returns {Buffer} Complete mono 16-bit WAV file.
 */
function createTestWav(options = {}) {
  const sampleRate = Math.max(8000, Number(options.sampleRate || 22050));
  const durationMs = Math.max(20, Math.min(1000, Number(options.durationMs || 120)));
  const frequency = Math.max(20, Math.min(4000, Number(options.frequency || 440)));
  const sampleCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.max(0, 1 - index / sampleCount);
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 6000 * envelope);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }
  return buffer;
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
    enabled: patch.enabled === undefined ? current.enabled !== false : Boolean(patch.enabled),
    offset: {
      x: Number(patch.offset?.x ?? current.offset?.x ?? 0),
      y: Number(patch.offset?.y ?? current.offset?.y ?? 0),
    },
    size: {
      x: Number(patch.size?.x ?? current.size?.x ?? 0),
      y: Number(patch.size?.y ?? current.size?.y ?? 0),
    },
  };
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
 * @param {string} filePath Candidate path.
 * @param {string} label Error label.
 * @returns {string} Absolute path.
 */
function requireExistingFile(filePath, label) {
  const absolute = path.resolve(String(filePath || ""));
  if (!filePath || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`${label} not found: ${filePath || "(empty)"}`);
  }
  return absolute;
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

/**
 * Probes whether the Tuner HTTP port answers.
 * @param {string} url Workspace URL.
 * @returns {Promise<boolean>} True when the server responds.
 */
function probeTunerUrl(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 800 }, (response) => {
      response.resume();
      resolve(Number(response.statusCode) >= 200 && Number(response.statusCode) < 500);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

/**
 * Spawns the Tuner Node server detached.
 * @param {{root:string,port:number,host:string}} options Launch options.
 * @returns {{pid:number}} Child process id.
 */
function launchTunerProcess(options) {
  const preferred = path.join(options.root, "tools/animation_tuner/server.js");
  const script = fs.existsSync(preferred) ? preferred : path.join(__dirname, "animation_tuner/server.js");
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      XSXB_ROOT: options.root,
      PORT: String(options.port),
      HOST: options.host,
      XSXB_HOST: options.host,
    },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { pid: child.pid };
}

/**
 * Waits until the Tuner answers or the attempt budget runs out.
 * @param {Function} probe Probe function.
 * @param {string} url Workspace URL.
 * @param {number} [attempts=20] Poll count.
 * @returns {Promise<boolean>} True when ready.
 */
async function waitForTuner(probe, url, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    if (await probe(url)) return true;
    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });
  }
  return false;
}

function toolDefinitions() {
  const projectProperty = {
    type: "string",
    description: "XSXB project id. Defaults to the last selected/imported project.",
  };
  const animationProperties = {
    project_id: projectProperty,
    profile_id: { type: "string", description: "Animation profile id." },
    animation_id: { type: "string", description: "Animation id." },
  };
  return [
    {
      name: "xsxb_list_projects",
      description: "List every local XSXB project, its active state, Godot binding, and animation counts.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_get_project",
      description:
        "Return one project's registry record, Godot binding, animation list, frame counts, and last sync receipt.",
      inputSchema: {
        type: "object",
        properties: { project_id: projectProperty },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_import_video",
      description:
        "Extract every native frame from a local video, import it as an XSXB animation, optionally sync to Godot, and validate the result.",
      inputSchema: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Absolute local video path." },
          fps: { type: "number", minimum: 1, maximum: 120, default: 12 },
          start_frame: {
            type: "integer",
            minimum: 0,
            description: "Inclusive 0-based extracted frame index.",
          },
          end_frame: { type: "integer", minimum: 0, description: "Inclusive 0-based extracted frame index." },
          replace: {
            type: "boolean",
            default: false,
            description: "Replace an existing animation id atomically.",
          },
          sync: { type: "boolean", default: false },
          validate: { type: "boolean", default: false },
          project_id: projectProperty,
          profile_id: { type: "string", default: DEFAULT_PROFILE_ID },
          animation_id: { type: "string", description: "Defaults to a sanitized video filename." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: "xsxb_import_animation",
      description:
        "Import a video, PNG sequence, SpriteFrames file, or PNG data items as an XSXB animation. Video import remains available as xsxb_import_video.",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            enum: ["video", "png_sequence", "spriteframes", "items"],
            description: "Import kind. Inferred from file_path, directory, or items when omitted.",
          },
          file_path: { type: "string", description: "Absolute video or .spriteframes.tres path." },
          directory: { type: "string", description: "Absolute directory of PNG frames." },
          items: {
            type: "array",
            items: { type: "object" },
            description: "PNG data-URL items for source=items.",
          },
          fps: { type: "number", minimum: 1, maximum: 120, default: 12 },
          start_frame: { type: "integer", minimum: 0 },
          end_frame: { type: "integer", minimum: 0 },
          replace: { type: "boolean", default: false },
          sync: { type: "boolean", default: false },
          validate: { type: "boolean", default: false },
          project_id: projectProperty,
          profile_id: { type: "string", default: DEFAULT_PROFILE_ID },
          animation_id: { type: "string" },
          animation_name: { type: "string" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: "xsxb_get_animation",
      description:
        "Return animation metadata and frames. Pass frames=summary for a compact sample without animation.frames. Pass include to also read back current boxes, timing, sfx, attachments, or trails.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          frames: { type: "string", enum: ["summary", "full"], default: "full" },
          include: {
            type: "array",
            items: {
              type: "string",
              enum: ["boxes", "timing", "visual", "sfx", "attachments", "trails"],
            },
            description: "Extra sections to return: box overrides, playback timing, visual transforms, and bindings.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_update_frame_boxes",
      description:
        "Update hurtbox, collisionbox, and hitbox for one animation frame, or many frames at once via frames. Does not sync Godot.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          frame: { type: "integer", minimum: 0, default: 0 },
          hurtbox: { type: "object" },
          collisionbox: { type: "object" },
          hitbox: { type: "object" },
          frames: {
            type: "array",
            items: { type: "object" },
            description:
              "Batch mode: [{frame, hurtbox?, collisionbox?, hitbox?}, ...] applied in one write. Overrides the single-frame parameters.",
          },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_estimate_boxes",
      description:
        "Auto-estimate hurtbox, collisionbox, and hitbox overrides for every animation frame from opaque pixel bounds. Keeps existing overrides unless replace=true. Use dry_run to preview.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          replace: {
            type: "boolean",
            default: false,
            description: "Recompute frames that already have box overrides.",
          },
          dry_run: { type: "boolean", default: false },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_update_timing",
      description:
        "Update animation FPS and optional per-frame duration or disabled playback, or many frames at once via frames. Does not sync Godot.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          fps: { type: "number", minimum: 1, maximum: 120 },
          frame: { type: "integer", minimum: 0 },
          duration_ms: { type: "number", minimum: 1 },
          duration: {
            type: "number",
            minimum: 0.001,
            description: "Frame duration multiplier. 1 equals one FPS tick.",
          },
          disabled: { type: "boolean" },
          frames: {
            type: "array",
            items: { type: "object" },
            description:
              "Batch mode: [{frame, duration_ms?, duration?, disabled?}, ...] applied in one write. Overrides the single-frame parameters.",
          },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_set_visual_transform",
      description:
        "Set visual size, offset, and rotation at the character (profile), animation group, or single-frame level. Pass clear=true to remove overrides at that level. Does not sync Godot.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          level: {
            type: "string",
            enum: ["character", "group", "frame"],
            default: "group",
            description: "character applies to the whole profile; group to one animation; frame to one frame.",
          },
          frame: { type: "integer", minimum: 0, description: "Required when level=frame." },
          visual_size: {
            type: "number",
            exclusiveMinimum: 0,
            description: "Uniform visual scale multiplier.",
          },
          offset_x: { type: "number" },
          offset_y: { type: "number" },
          rotation: { type: "number", description: "Rotation in radians." },
          clear: {
            type: "boolean",
            default: false,
            description: "Remove all visual overrides at the selected level.",
          },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_reorganize_frames",
      description:
        "Atomically reorganize animation frames and remap frame-owned tuning, audio, attachment, and attack-trail state. Defaults to an identity organization test.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          order: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            description: "Source frame indexes in the desired output order. Defaults to the current order.",
          },
          sync: { type: "boolean", default: true },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_replace_frame",
      description:
        "Replace one workspace frame PNG with a new local PNG while keeping boxes, timing, and bindings. Updates the stored frame size when it changes.",
      inputSchema: {
        type: "object",
        required: ["frame", "file_path"],
        properties: {
          ...animationProperties,
          frame: { type: "integer", minimum: 0 },
          file_path: { type: "string", description: "Absolute replacement PNG path." },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: "xsxb_add_attack_trail",
      description:
        "Add or replace one attack-trail segment. Pass sticks and optional texture_path; omitting sticks writes a default two-stick trail.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          id: { type: "string", description: "Segment id. Defaults to the texture basename or trail." },
          name: { type: "string" },
          color: { type: "string", description: "#RRGGBB solid color." },
          color_mode: { type: "string", enum: ["solid", "original", "gradient"], default: "solid" },
          texture_path: {
            type: "string",
            description: "Absolute PNG trail texture. Defaults to the built-in luma preset.",
          },
          start_frame: { type: "integer", minimum: 0 },
          end_frame: { type: "integer", minimum: 0 },
          sticks: {
            type: "array",
            items: { type: "object" },
            description: "Trail sticks with frame, top, and bottom points.",
          },
          sync: { type: "boolean", default: true },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_add_attachment",
      description: "Bind a local PNG as a frame image attachment. file_path is required for a real asset.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          file_path: { type: "string", description: "Absolute PNG path to attach." },
          frame: { type: "integer", minimum: 0, default: 0 },
          id: { type: "string" },
          name: { type: "string" },
          layer: { type: "string", enum: ["above", "below"], default: "above" },
          layer_order: { type: "integer", default: 1 },
          offset_x: { type: "number", default: 0 },
          offset_y: { type: "number" },
          scale: { type: "number", default: 1 },
          rotation: { type: "number", default: 0 },
          sync: { type: "boolean", default: true },
        },
        required: ["file_path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_add_sfx",
      description: "Bind a local WAV/OGG/MP3 to one animation frame. file_path is required for a real clip.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          file_path: { type: "string", description: "Absolute audio path." },
          frame: { type: "integer", minimum: 0, default: 0 },
          id: { type: "string" },
          name: { type: "string" },
          sync: { type: "boolean", default: true },
        },
        required: ["file_path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_remove_binding",
      description:
        "Remove one SFX, attachment, or attack-trail binding by id from one animation. Use frame to disambiguate sfx/attachment bindings that share an id. Supports dry_run.",
      inputSchema: {
        type: "object",
        required: ["kind", "id"],
        properties: {
          ...animationProperties,
          kind: { type: "string", enum: ["sfx", "attachment", "trail"] },
          id: { type: "string", description: "Binding or trail segment id." },
          frame: {
            type: "integer",
            minimum: 0,
            description: "Only remove the binding on this frame. Not applicable to trails.",
          },
          dry_run: { type: "boolean", default: false },
          sync: { type: "boolean", default: true },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: "xsxb_delete_animation",
      description:
        "Delete one imported animation and its owned frames, tuning, and bindings. Supports dry_run.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          dry_run: { type: "boolean", default: false },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: "xsxb_sync_godot",
      description: "Synchronize the current project to its bound Godot root without changing animation data.",
      inputSchema: {
        type: "object",
        properties: { project_id: projectProperty, force: { type: "boolean", default: false } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_validate_project",
      description:
        "Validate standalone XSXB data, generated frames, Godot-synchronized data, assets, and runtime files.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectProperty,
          strict: { type: "boolean", default: false },
          require_gameplay: { type: "boolean", default: false },
          layer: {
            type: "string",
            enum: ["all", "standalone", "bind", "gameplay"],
            default: "all",
            description: "Report only one validation layer. Default all, bind errors listed first.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_set_active_project",
      description: "Set the registry active XSXB project used when project_id is omitted.",
      inputSchema: {
        type: "object",
        required: ["project_id"],
        properties: { project_id: projectProperty },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_bind_godot",
      description:
        "Point one XSXB project at an existing Godot root that contains project.godot. Does not sync files.",
      inputSchema: {
        type: "object",
        required: ["project_root"],
        properties: {
          project_id: projectProperty,
          project_root: { type: "string", description: "Absolute Godot project directory." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_cutout",
      description:
        "Run the tuner smart-cutout product path on every animation frame. Omitting the canvas keeps the source layout; an explicit canvas shares one scale and pins body feet to the bottom.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          key_color: {
            type: "string",
            description: "Optional #RRGGBB key. Omit to auto-detect the same background as the tuner.",
          },
          output_width: {
            type: "integer",
            minimum: 8,
            maximum: 4096,
            description: "Optional canvas width. Omit to keep each frame's source size.",
          },
          output_height: {
            type: "integer",
            minimum: 8,
            maximum: 4096,
            description: "Optional canvas height. Defaults to output_width when only width is set.",
          },
          protected_colors: {
            type: "array",
            items: { type: "string" },
            description: "Optional #RRGGBB colors to keep, same as the tuner protect-color list.",
          },
          protection_tolerance: { type: "number", minimum: 0, maximum: 100, default: 8 },
          force: {
            type: "boolean",
            default: false,
            description: "Re-cut frames whose borders are already transparent.",
          },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: "xsxb_export_gif",
      description:
        "Export one animation as an animated GIF preview via FFmpeg, honoring per-frame durations and skipping disabled frames. Returns the absolute output path.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          output_path: {
            type: "string",
            description: "Absolute .gif destination. Defaults to <workspace>/exports/<profile>_<animation>.gif.",
          },
          fps: { type: "number", minimum: 1, maximum: 120, description: "Defaults to the animation FPS." },
          start_frame: { type: "integer", minimum: 0, description: "Inclusive 0-based frame index." },
          end_frame: { type: "integer", minimum: 0, description: "Inclusive 0-based frame index." },
          include_disabled: {
            type: "boolean",
            default: false,
            description: "Also render frames whose playback is disabled.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_open_tuner",
      description:
        "Start the local Tuner if needed and return a workspace URL focused on one project, profile, and animation.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          start: {
            type: "boolean",
            default: true,
            description: "Start the Tuner process when it is not listening.",
          },
          port: { type: "integer", minimum: 1, maximum: 65535, default: 5179 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
  ];
}

/**
 * Creates the business service used by the XSXB MCP transport.
 * @param {{root?:string,extractVideoFramesImpl?:Function,cutoutPngFileImpl?:Function,probeTunerImpl?:Function,launchTunerImpl?:Function}} [options] Service dependencies.
 * @returns {{tools:object[],call:(name:string,args?:object)=>Promise<object>}} MCP-facing service.
 */
function createXsxbMcpService(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const projectStore = createProjectStore(root);
  const extractVideoFramesImpl = options.extractVideoFramesImpl || extractVideoFrames;
  const encodeGifImpl = options.encodeGifImpl || encodeGifWithFfmpeg;
  const cutoutPngFileImpl = options.cutoutPngFileImpl || null;
  const probeTunerImpl = options.probeTunerImpl || probeTunerUrl;
  const launchTunerImpl = options.launchTunerImpl || launchTunerProcess;
  const context = { projectId: "", profileId: "", animationId: "" };

  /**
   * Copies a local file into the project workspace and returns the repo-relative path.
   * @param {object} project Project record.
   * @param {string} subdir Workspace subdirectory.
   * @param {string} absolutePath Source file.
   * @returns {string} Relative POSIX path.
   */
  function copyIntoWorkspace(project, subdir, absolutePath) {
    const destDir = path.join(projectStore.projectWorkspaceDir(project), subdir);
    fs.mkdirSync(destDir, { recursive: true });
    const buffer = fs.readFileSync(absolutePath);
    const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    const extension = path.extname(absolutePath) || "";
    const destPath = path.join(destDir, `${hash}${extension}`);
    if (!fs.existsSync(destPath)) fs.writeFileSync(destPath, buffer);
    return reslash(path.relative(root, destPath));
  }

  function registryProject(projectId, syncRequested = false) {
    const registry = projectStore.readRegistry();
    const requested = String(projectId || context.projectId || "").trim();
    const project = requested
      ? registry.projects.find((entry) => entry.id === slug(requested))
      : projectStore.resolveProject(registry);
    if (!project && requested) throw new Error(`XSXB project not found: ${requested}`);
    if (!project) throw new Error("No XSXB project is available.");
    if (syncRequested && !validGodotProjectRoot(project)) {
      const boundPath = project.projectRoot || "(empty)";
      throw new Error(
        `XSXB project ${project.id} Godot binding does not exist: ${boundPath}. Use xsxb_bind_godot to retarget.`,
      );
    }
    context.projectId = project.id;
    return project;
  }

  function manifestFor(project) {
    const paths = projectStore.projectPaths(project);
    return projectStore.readJson(paths.manifest, { schemaVersion: 1, profiles: [] });
  }

  /**
   * Reads frame-audio bindings as an array regardless of the stored shape.
   * @param {object} paths Project data paths.
   * @returns {object[]} SFX bindings.
   */
  function readSfxBindings(paths) {
    const raw = projectStore.readJson(paths.frameAudio, []);
    return Array.isArray(raw)
      ? raw
      : Object.entries(raw || {}).map(([key, value]) => ({ key, ...(value || {}) }));
  }

  function animationFor(args = {}) {
    const project = registryProject(args.project_id || args.project, false);
    const manifest = manifestFor(project);
    const profileId = String(args.profile_id || args.profile || context.profileId || "").trim();
    const animationId = String(args.animation_id || args.animation || context.animationId || "").trim();
    const profiles = Array.isArray(manifest.profiles) ? manifest.profiles : [];
    const profile = profileId ? profiles.find((entry) => entry.id === profileId) : profiles[0];
    if (!profile) throw new Error(`Animation profile not found: ${profileId || "(default)"}`);
    const animations = Array.isArray(profile.animations) ? profile.animations : [];
    const animation = animationId
      ? animations.find((entry) => String(entry.id || entry.name) === animationId)
      : animations[0];
    if (!animation) throw new Error(`Animation not found: ${profile.id}/${animationId || "(default)"}`);
    context.projectId = project.id;
    context.profileId = profile.id;
    context.animationId = String(animation.id || animation.name);
    return { project, manifest, profile, animation };
  }

  /**
   * Resolves a manifest frame path only when it stays inside the project workspace
   * or the bound Godot root. Rejects repo-wide, absolute, and res://../ escapes.
   * @param {object} project Project record.
   * @param {unknown} rawPath Stored frame path.
   * @returns {string} Absolute path, or empty when the path is missing or unsafe.
   */
  function resolveAnimationFramePath(project, rawPath) {
    const raw = String(rawPath || "").trim();
    if (!raw) return "";
    if (raw.startsWith("res://")) {
      const projectRoot = String(project.projectRoot || "").trim();
      if (!projectRoot) return "";
      const resolved = path.resolve(projectRoot, raw.slice("res://".length));
      return isInsideDirectory(resolved, projectRoot) ? resolved : "";
    }
    const resolved = path.resolve(root, raw);
    const workspaceDir = projectStore.projectWorkspaceDir(project);
    if (isInsideDirectory(resolved, workspaceDir)) return resolved;
    const projectRoot = String(project.projectRoot || "").trim();
    if (projectRoot && isInsideDirectory(resolved, projectRoot)) return resolved;
    return "";
  }

  function animationResult(selection) {
    const { project, profile, animation } = selection;
    const frames = Array.from(animation.frames || []).map((frame, index) => {
      const rawPath = String(frame.path || "");
      const absolutePath = resolveAnimationFramePath(project, rawPath);
      return {
        index,
        ...frame,
        absolutePath,
        exists: Boolean(absolutePath && fs.existsSync(absolutePath)),
      };
    });
    return {
      project: projectStore.projectForClient(project),
      profile: { ...profile, animations: undefined },
      animation: { ...animation, frames },
      frameCount: frames.length,
      generatedFrameCount: frames.filter((frame) => frame.exists).length,
      allFramesGenerated: frames.length > 0 && frames.every((frame) => frame.exists),
    };
  }

  function synchronize(project, enabled, options = {}) {
    if (enabled === false) return { requested: false, ok: null };
    const result = syncGodotProject(root, projectStore, project, options);
    return { requested: true, ...result };
  }

  async function listProjects() {
    const registry = projectStore.readRegistry();
    return {
      activeProjectId: registry.activeProjectId,
      count: registry.projects.length,
      projects: registry.projects.map((project) => {
        const manifest = manifestFor(project);
        const profiles = Array.isArray(manifest.profiles) ? manifest.profiles : [];
        const animations = profiles.flatMap((profile) => profile.animations || []);
        return {
          ...projectStore.projectForClient(project),
          active: project.id === registry.activeProjectId,
          godotProjectValid: Boolean(validGodotProjectRoot(project)),
          profileCount: profiles.length,
          animationCount: animations.length,
          frameCount: animations.reduce((sum, animation) => sum + (animation.frames?.length || 0), 0),
        };
      }),
    };
  }

  async function importVideo(args = {}) {
    const videoPath = path.resolve(String(args.file_path || args.path || ""));
    if (!fs.existsSync(videoPath) || !fs.statSync(videoPath).isFile()) {
      throw new Error(`Video file not found: ${videoPath}`);
    }
    const syncRequested = booleanFlag(args.sync);
    const project = registryProject(args.project_id || args.project, syncRequested);
    const profileId = slug(args.profile_id || args.profile || DEFAULT_PROFILE_ID, DEFAULT_PROFILE_ID);
    const manifest = manifestFor(project);
    const profile = (manifest.profiles || []).find((entry) => entry.id === profileId);
    const baseAnimationId = slug(
      args.animation_id || args.animation || path.basename(videoPath, path.extname(videoPath)),
      "video_import",
    );
    const used = new Set((profile?.animations || []).map((entry) => String(entry.id || entry.name)));
    const replaced = booleanFlag(args.replace) && used.has(baseAnimationId);
    let animationId = baseAnimationId;
    if (!replaced) {
      let suffix = 2;
      while (used.has(animationId)) {
        animationId = `${baseAnimationId}_${suffix}`;
        suffix += 1;
      }
    }
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-video-"));
    try {
      const extracted = sliceExtractedFrames(
        await extractVideoFramesImpl(videoPath, temporaryDirectory, args),
        args,
      );
      if (!extracted.paths.length) throw new Error("Video extraction produced no PNG frames.");
      if (replaced) {
        deleteAnimation({ root, projectStore, project, profileId, animationId: baseAnimationId });
      }
      const items = extracted.paths.map((framePath) => ({
        name: path.basename(framePath),
        data: `data:image/png;base64,${fs.readFileSync(framePath).toString("base64")}`,
      }));
      const imported = importAnimation({
        root,
        projectStore,
        project,
        profileId,
        profileLabel: profileId,
        animationId,
        animationName: animationId,
        animationType: "actor",
        fps: requireFps(args.fps),
        items,
      });
      context.projectId = project.id;
      context.profileId = profileId;
      context.animationId = animationId;
      const sync = synchronize(project, syncRequested);
      const validation = booleanFlag(args.validate)
        ? validateImport({ project: project.id }, { root, projectStore })
        : { requested: false, ok: null, errors: [], warnings: [], summary: {} };
      return {
        projectId: project.id,
        profileId,
        animationId,
        sourceVideo: videoPath,
        fps: requireFps(args.fps),
        extractedFrameCount: extracted.extractedCount,
        importedFrameCount: imported.frameCount,
        startFrame: extracted.startFrame,
        endFrame: extracted.endFrame,
        replaced,
        targetDirectory: imported.targetDir,
        sync,
        validation: booleanFlag(args.validate) ? { requested: true, ...validation } : validation,
      };
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  function uniqueAnimationId(project, profileId, requestedId, fallback, replace = false) {
    const manifest = manifestFor(project);
    const profile = (manifest.profiles || []).find((entry) => entry.id === profileId);
    const used = new Set((profile?.animations || []).map((entry) => String(entry.id || entry.name)));
    const base = slug(requestedId || fallback, fallback);
    if (replace && used.has(base)) return base;
    let animationId = base;
    let suffix = 2;
    while (used.has(animationId)) {
      animationId = `${base}_${suffix}`;
      suffix += 1;
    }
    return animationId;
  }

  function importPngItems(args, items, sourceLabel) {
    if (!items.length) throw new Error(`No PNG frames provided for ${sourceLabel} import.`);
    const syncRequested = booleanFlag(args.sync);
    const project = registryProject(args.project_id || args.project, syncRequested);
    const profileId = slug(args.profile_id || args.profile || DEFAULT_PROFILE_ID, DEFAULT_PROFILE_ID);
    const requestedId = slug(
      args.animation_id || args.animation,
      sourceLabel === "png_sequence" ? "png_sequence" : "imported",
    );
    const replaced =
      booleanFlag(args.replace) &&
      (manifestFor(project).profiles || [])
        .find((entry) => entry.id === profileId)
        ?.animations?.some((entry) => String(entry.id || entry.name) === requestedId);
    const animationId = uniqueAnimationId(
      project,
      profileId,
      args.animation_id || args.animation,
      sourceLabel === "png_sequence" ? "png_sequence" : "imported",
      booleanFlag(args.replace),
    );
    if (replaced) {
      deleteAnimation({ root, projectStore, project, profileId, animationId });
    }
    const imported = importAnimation({
      root,
      projectStore,
      project,
      profileId,
      profileLabel: profileId,
      animationId,
      animationName: String(args.animation_name || animationId),
      animationType: "actor",
      fps: requireFps(args.fps),
      items,
    });
    context.projectId = project.id;
    context.profileId = profileId;
    context.animationId = animationId;
    const sync = synchronize(project, syncRequested);
    const validation = booleanFlag(args.validate)
      ? { requested: true, ...validateImport({ project: project.id }, { root, projectStore }) }
      : { requested: false, ok: null, errors: [], warnings: [], summary: {} };
    return {
      source: sourceLabel,
      projectId: project.id,
      profileId,
      animationId,
      fps: requireFps(args.fps),
      importedFrameCount: imported.frameCount,
      replaced: Boolean(replaced),
      targetDirectory: imported.targetDir,
      sync,
      validation,
    };
  }

  async function importUnified(args = {}) {
    const source = resolveImportSource(args);
    if (source === "video") {
      return { source, ...(await importVideo(args)) };
    }
    if (source === "png_sequence") {
      const directory = path.resolve(String(args.directory || args.file_path || args.path || ""));
      const sliced = sliceExtractedFrames(listPngSequence(directory), args);
      return {
        ...importPngItems(args, sliced.paths.map(pngFileToItem), "png_sequence"),
        startFrame: sliced.startFrame,
        endFrame: sliced.endFrame,
        sourceFrameCount: sliced.extractedCount,
      };
    }
    if (source === "items") {
      const items = Array.isArray(args.items) ? args.items : [];
      const normalized = items.map((item, index) => {
        if (item?.data) return { name: item.name || `frame_${index + 1}.png`, data: item.data };
        const filePath = path.resolve(String(item?.path || item?.file_path || ""));
        if (!filePath || !fs.existsSync(filePath)) {
          throw new Error(`Import item ${index + 1} needs PNG data or an existing file path.`);
        }
        return pngFileToItem(filePath);
      });
      const sliced = sliceExtractedFrames(normalized, args);
      return {
        ...importPngItems(args, sliced.paths, "items"),
        startFrame: sliced.startFrame,
        endFrame: sliced.endFrame,
        sourceFrameCount: sliced.extractedCount,
      };
    }
    if (source === "spriteframes") {
      const filePath = path.resolve(String(args.file_path || args.path || ""));
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`SpriteFrames file not found: ${filePath}`);
      }
      const syncRequested = booleanFlag(args.sync);
      const project = registryProject(args.project_id || args.project, syncRequested);
      const projectRoot = validGodotProjectRoot(project) || path.dirname(filePath);
      const animations = parseSpriteFrames(filePath, projectRoot);
      if (!animations.length) throw new Error(`No PNG animations found in ${filePath}`);
      const profileId = slug(args.profile_id || args.profile || DEFAULT_PROFILE_ID, DEFAULT_PROFILE_ID);
      const imported = [];
      for (const animation of animations) {
        const sliced = sliceExtractedFrames(
          animation.frames.map((frame) => pngFileToItem(frame.source)),
          args,
        );
        const items = sliced.paths;
        imported.push(
          importPngItems(
            {
              ...args,
              profile_id: profileId,
              animation_id: args.animation_id || animation.id,
              animation_name: args.animation_name || animation.name,
              fps: args.fps || animation.fps,
              sync: false,
              validate: false,
            },
            items,
            "spriteframes",
          ),
        );
      }
      const last = imported[imported.length - 1];
      const sync = synchronize(project, syncRequested);
      const validation = booleanFlag(args.validate)
        ? { requested: true, ...validateImport({ project: project.id }, { root, projectStore }) }
        : { requested: false, ok: null, errors: [], warnings: [], summary: {} };
      return {
        source: "spriteframes",
        projectId: project.id,
        profileId,
        animationId: last.animationId,
        importedAnimationCount: imported.length,
        importedFrameCount: imported.reduce((sum, entry) => sum + entry.importedFrameCount, 0),
        animations: imported.map((entry) => ({
          animationId: entry.animationId,
          importedFrameCount: entry.importedFrameCount,
        })),
        sync,
        validation,
      };
    }
    throw new Error(`Unsupported import source: ${source}`);
  }

  function projectSnapshot(args = {}) {
    const project = registryProject(args.project_id || args.project, false);
    const registry = projectStore.readRegistry();
    const manifest = manifestFor(project);
    const profiles = Array.isArray(manifest.profiles) ? manifest.profiles : [];
    const animations = profiles.flatMap((profile) =>
      (profile.animations || []).map((animation) => ({
        profileId: profile.id,
        id: String(animation.id || animation.name),
        name: String(animation.name || animation.id || ""),
        type: animation.type || "actor",
        fps: Number(animation.fps || 12),
        frameCount: Array.isArray(animation.frames) ? animation.frames.length : 0,
      })),
    );
    const handoff = projectStore.readJson(projectStore.projectPaths(project).godotHandoff, null);
    return {
      ...projectStore.projectForClient(project),
      projectId: project.id,
      active: project.id === registry.activeProjectId,
      godotProjectValid: Boolean(validGodotProjectRoot(project)),
      godotProjectRoot: project.projectRoot || "",
      profileCount: profiles.length,
      animationCount: animations.length,
      frameCount: animations.reduce((sum, animation) => sum + animation.frameCount, 0),
      profiles: profiles.map((profile) => ({
        id: profile.id,
        label: profile.label || profile.id,
        kind: profile.kind || "actor",
        animationCount: Array.isArray(profile.animations) ? profile.animations.length : 0,
      })),
      animations,
      sync: {
        godotProjectValid: Boolean(validGodotProjectRoot(project)),
        lastSync: handoff?.lastSync || null,
        lastFailure: handoff?.lastFailure || null,
      },
    };
  }

  function updateFrameBoxes(args = {}) {
    const { project, profile, animation } = animationFor(args);
    const frames = animation.frames || [];
    if (!frames.length) throw new Error("Cannot update boxes on an animation without frames.");
    const batch = Array.isArray(args.frames) && args.frames.length > 0;
    const requests = batch
      ? args.frames
      : [{ frame: args.frame || 0, hurtbox: args.hurtbox, collisionbox: args.collisionbox, hitbox: args.hitbox }];
    const paths = projectStore.projectPaths(project);
    const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
    tuning.frame_box_overrides =
      tuning.frame_box_overrides && typeof tuning.frame_box_overrides === "object"
        ? tuning.frame_box_overrides
        : {};
    const updates = requests.map((request) => {
      if (!request || typeof request !== "object") {
        throw new Error("Each frames item must be an object with frame and box patches.");
      }
      const frame = requireFrameIndex(request.frame ?? 0, frames.length - 1);
      const patches = BOX_NAMES.filter((name) => request[name] && typeof request[name] === "object");
      if (!patches.length) throw new Error("Provide at least one of hurtbox, collisionbox, or hitbox.");
      const key = frameBoxKey(profile.id, animation.id || animation.name, frame);
      const current =
        tuning.frame_box_overrides[key] && typeof tuning.frame_box_overrides[key] === "object"
          ? tuning.frame_box_overrides[key]
          : {};
      const boxes = { ...current };
      for (const name of patches) {
        boxes[name] = mergeBox(current[name], request[name], { ground: name === "collisionbox" });
      }
      tuning.frame_box_overrides[key] = boxes;
      return { frame, key, boxes };
    });
    projectStore.writeJson(paths.tuning, tuning);
    const base = {
      projectId: project.id,
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
      updatedFrames: updates.length,
      sync: synchronize(project, booleanFlag(args.sync)),
    };
    if (!batch) return { ...base, frame: updates[0].frame, key: updates[0].key, boxes: updates[0].boxes };
    return { ...base, updates };
  }

  function estimateBoxes(args = {}) {
    const { project, profile, animation } = animationFor(args);
    const frames = animation.frames || [];
    if (!frames.length) throw new Error("Cannot estimate boxes on an animation without frames.");
    const frameFiles = frames.map((frame, index) => {
      const absolute = resolveAnimationFramePath(project, frame.path);
      if (!absolute || !fs.existsSync(absolute)) {
        throw new Error(`Frame ${index} has no generated PNG on disk; import or regenerate frames first.`);
      }
      return absolute;
    });
    const replace = booleanFlag(args.replace);
    const dryRun = booleanFlag(args.dry_run);
    const animationId = String(animation.id || animation.name);
    const paths = projectStore.projectPaths(project);
    const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
    tuning.frame_box_overrides =
      tuning.frame_box_overrides && typeof tuning.frame_box_overrides === "object"
        ? tuning.frame_box_overrides
        : {};
    const keyFor = (index) => frameBoxKey(profile.id, animationId, index);
    const existing = new Set(
      frames.map((_, index) => keyFor(index)).filter((key) => tuning.frame_box_overrides[key]),
    );
    upsertEstimatedFrameBoxes(tuning, profile.id, { ...animation, id: animationId }, frameFiles, {
      replace,
    });
    const results = frames.map((_, index) => {
      const key = keyFor(index);
      const had = existing.has(key);
      const skippedExisting = !replace && had;
      return {
        frame: index,
        estimated: !skippedExisting && Boolean(tuning.frame_box_overrides[key]),
        skippedExisting,
        boxes: tuning.frame_box_overrides[key] || null,
      };
    });
    if (!dryRun) projectStore.writeJson(paths.tuning, tuning);
    return {
      projectId: project.id,
      profileId: profile.id,
      animationId,
      frameCount: frames.length,
      estimatedFrames: results.filter((entry) => entry.estimated).length,
      skippedExistingFrames: results.filter((entry) => entry.skippedExisting).length,
      replace,
      dryRun,
      frames: results,
      sync: synchronize(project, dryRun ? false : booleanFlag(args.sync)),
    };
  }

  function updateTiming(args = {}) {
    const { project, profile, animation } = animationFor(args);
    const frames = animation.frames || [];
    const paths = projectStore.projectPaths(project);
    const manifest = manifestFor(project);
    const target = (manifest.profiles || [])
      .find((entry) => entry.id === profile.id)
      ?.animations?.find(
        (entry) => String(entry.id || entry.name) === String(animation.id || animation.name),
      );
    if (!target) throw new Error(`Animation not found: ${profile.id}/${animation.id || animation.name}`);
    const fps = requireFps(args.fps === undefined ? target.fps : args.fps, Number(target.fps || 12));
    target.fps = fps;
    projectStore.writeJson(paths.manifest, manifest);
    const batch = Array.isArray(args.frames) && args.frames.length > 0;
    const singleRequested =
      args.frame !== undefined ||
      args.duration_ms !== undefined ||
      args.duration !== undefined ||
      args.disabled !== undefined;
    let playback = null;
    let playbackUpdates = null;
    if (batch || singleRequested) {
      if (!frames.length) throw new Error("Cannot update frame timing on an animation without frames.");
      const requests = batch
        ? args.frames
        : [
            {
              frame: args.frame,
              duration_ms: args.duration_ms,
              duration: args.duration,
              disabled: args.disabled,
            },
          ];
      const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
      tuning.frame_playback_overrides =
        tuning.frame_playback_overrides && typeof tuning.frame_playback_overrides === "object"
          ? tuning.frame_playback_overrides
          : {};
      const applied = requests.map((request) => {
        if (!request || typeof request !== "object") {
          throw new Error("Each frames item must be an object with frame and timing fields.");
        }
        const frame = requireFrameIndex(request.frame ?? 0, frames.length - 1);
        const key = frameBoxKey(profile.id, animation.id || animation.name, frame);
        const current = tuning.frame_playback_overrides[key] || {};
        let duration = Number(current.duration || 1);
        if (request.duration_ms !== undefined) duration = (Number(request.duration_ms) * fps) / 1000;
        else if (request.duration !== undefined) duration = Number(request.duration);
        duration = Math.max(0.001, duration);
        const disabled =
          request.disabled === undefined ? current.disabled === true : Boolean(request.disabled);
        if (disabled || duration !== 1) tuning.frame_playback_overrides[key] = { duration, disabled };
        else delete tuning.frame_playback_overrides[key];
        return {
          frame,
          key,
          duration,
          durationMs: Math.round((duration * 1000) / fps),
          disabled,
        };
      });
      projectStore.writeJson(paths.tuning, tuning);
      if (batch) playbackUpdates = applied;
      else playback = applied[0];
    }
    const result = {
      projectId: project.id,
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
      fps,
      playback,
      sync: synchronize(project, booleanFlag(args.sync)),
    };
    if (playbackUpdates) result.playbackUpdates = playbackUpdates;
    return result;
  }

  function setVisualTransform(args = {}) {
    const level = String(args.level || "group")
      .trim()
      .toLowerCase();
    if (!["character", "group", "frame"].includes(level)) {
      throw new Error('level must be one of "character", "group", or "frame".');
    }
    const clear = booleanFlag(args.clear);
    const fields = ["visual_size", "offset_x", "offset_y", "rotation"].filter(
      (name) => args[name] !== undefined,
    );
    if (!fields.length && !clear) {
      throw new Error("Provide at least one of visual_size, offset_x, offset_y, rotation, or clear=true.");
    }
    let visualSize = null;
    if (args.visual_size !== undefined) {
      visualSize = Number(args.visual_size);
      if (!Number.isFinite(visualSize) || visualSize <= 0) {
        throw new Error("visual_size must be a finite number greater than 0.");
      }
    }
    const selection = animationFor(args);
    const { project, profile, animation } = selection;
    const animationId = String(animation.id || animation.name);
    const paths = projectStore.projectPaths(project);
    const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
    tuning.values = tuning.values && typeof tuning.values === "object" ? tuning.values : {};
    let applied;
    if (level === "frame") {
      const frames = animation.frames || [];
      if (!frames.length) throw new Error("Cannot set frame visuals on an animation without frames.");
      if (args.frame === undefined) throw new Error("frame is required when level=frame.");
      const frame = requireFrameIndex(args.frame, frames.length - 1);
      tuning.frame_visual_overrides =
        tuning.frame_visual_overrides && typeof tuning.frame_visual_overrides === "object"
          ? tuning.frame_visual_overrides
          : {};
      const key = frameBoxKey(profile.id, animationId, frame);
      if (clear) {
        delete tuning.frame_visual_overrides[key];
        applied = { frame, key, cleared: true };
      } else {
        const current =
          tuning.frame_visual_overrides[key] && typeof tuning.frame_visual_overrides[key] === "object"
            ? tuning.frame_visual_overrides[key]
            : {};
        const next = { ...current };
        if (visualSize !== null) {
          next.visual_size = visualSize;
          delete next.visual_scale;
        }
        if (args.offset_x !== undefined || args.offset_y !== undefined) {
          const offset = current.offset && typeof current.offset === "object" ? current.offset : {};
          next.offset = {
            x: args.offset_x === undefined ? Number(offset.x || 0) : Number(args.offset_x),
            y: args.offset_y === undefined ? Number(offset.y || 0) : Number(args.offset_y),
          };
        }
        if (args.rotation !== undefined) next.rotation = Number(args.rotation);
        tuning.frame_visual_overrides[key] = next;
        applied = { frame, key, override: next };
      }
    } else {
      const base =
        level === "character"
          ? `profiles.${profile.id}.character`
          : `profiles.${profile.id}.groups.${animationId}`;
      if (clear) {
        for (const suffix of ["visual_size", "visual_scale", "offset", "rotation"]) {
          delete tuning.values[`${base}.${suffix}`];
        }
        applied = { base, cleared: true };
      } else {
        if (visualSize !== null) {
          tuning.values[`${base}.visual_size`] = visualSize;
          delete tuning.values[`${base}.visual_scale`];
        }
        if (args.offset_x !== undefined || args.offset_y !== undefined) {
          const offsetKey = `${base}.offset`;
          const current =
            tuning.values[offsetKey] && typeof tuning.values[offsetKey] === "object"
              ? tuning.values[offsetKey]
              : {};
          tuning.values[offsetKey] = {
            x: args.offset_x === undefined ? Number(current.x || 0) : Number(args.offset_x),
            y: args.offset_y === undefined ? Number(current.y || 0) : Number(args.offset_y),
          };
        }
        if (args.rotation !== undefined) tuning.values[`${base}.rotation`] = Number(args.rotation);
        applied = {
          base,
          values: Object.fromEntries(
            ["visual_size", "visual_scale", "offset", "rotation"]
              .map((suffix) => [`${base}.${suffix}`, tuning.values[`${base}.${suffix}`]])
              .filter(([, value]) => value !== undefined),
          ),
        };
      }
    }
    projectStore.writeJson(paths.tuning, tuning);
    return {
      projectId: project.id,
      profileId: profile.id,
      animationId,
      level,
      ...applied,
      sync: synchronize(project, booleanFlag(args.sync)),
    };
  }

  function removeAnimation(args = {}) {
    const { project, profile, animation } = animationFor(args);
    const frames = animation.frames || [];
    const preview = {
      projectId: project.id,
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
      removedFrames: frames.length,
      removedDirectory: String(animation.source || ""),
    };
    if (booleanFlag(args.dry_run)) {
      return { ...preview, dryRun: true, deleted: false };
    }
    const result = deleteAnimation({
      root,
      projectStore,
      project,
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
    });
    if (context.animationId === preview.animationId) context.animationId = "";
    return {
      ...preview,
      dryRun: false,
      deleted: true,
      removedFrames: result.removedFrames,
      removedDirectory: result.removedDirectory,
      sync: synchronize(project, booleanFlag(args.sync)),
    };
  }

  async function syncGodot(args = {}) {
    const project = registryProject(args.project_id || args.project, true);
    return {
      projectId: project.id,
      force: booleanFlag(args.force),
      ...synchronize(project, true, { force: booleanFlag(args.force) }),
    };
  }

  /**
   * Reads back tuning overrides and bindings owned by one animation.
   * @param {{project:object,profile:object,animation:object}} selection Animation selection.
   * @param {string[]} sections Requested include sections.
   * @returns {object} Extra sections keyed by name.
   */
  function animationExtras(selection, sections) {
    const { project, profile, animation } = selection;
    const animationId = String(animation.id || animation.name);
    const bindingKey = `${profile.id}/${animationId}`;
    const framePrefix = `${bindingKey}:`;
    const frameFromKey = (key) => Number(String(key).slice(framePrefix.length));
    const paths = projectStore.projectPaths(project);
    const wanted = new Set(sections);
    const extras = {};
    if (wanted.has("boxes") || wanted.has("timing") || wanted.has("visual")) {
      const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
      if (wanted.has("boxes")) {
        const overrides = tuning.frame_box_overrides || {};
        extras.boxes = Object.fromEntries(
          Object.keys(overrides)
            .filter((key) => key.startsWith(framePrefix))
            .map((key) => [frameFromKey(key), overrides[key]]),
        );
      }
      if (wanted.has("timing")) {
        const fps = Number(animation.fps || 12);
        const overrides = tuning.frame_playback_overrides || {};
        const frameOverrides = {};
        for (const key of Object.keys(overrides)) {
          if (!key.startsWith(framePrefix)) continue;
          const entry = overrides[key] && typeof overrides[key] === "object" ? overrides[key] : {};
          const duration = Number(entry.duration || 1);
          frameOverrides[frameFromKey(key)] = {
            duration,
            durationMs: Math.round((duration * 1000) / fps),
            disabled: entry.disabled === true,
          };
        }
        extras.timing = { fps, frameOverrides };
      }
      if (wanted.has("visual")) {
        const values = tuning.values && typeof tuning.values === "object" ? tuning.values : {};
        const pick = (base) => ({
          visual_size: values[`${base}.visual_size`],
          visual_scale: values[`${base}.visual_scale`],
          offset: values[`${base}.offset`],
          rotation: values[`${base}.rotation`],
        });
        const overrides =
          tuning.frame_visual_overrides && typeof tuning.frame_visual_overrides === "object"
            ? tuning.frame_visual_overrides
            : {};
        const frameOverrides = {};
        for (const key of Object.keys(overrides)) {
          if (key.startsWith(framePrefix)) frameOverrides[frameFromKey(key)] = overrides[key];
        }
        extras.visual = {
          character: pick(`profiles.${profile.id}.character`),
          group: pick(`profiles.${profile.id}.groups.${animationId}`),
          frameOverrides,
        };
      }
    }
    if (wanted.has("sfx")) {
      extras.sfx = readSfxBindings(paths)
        .filter((entry) => String(entry?.key || "").startsWith(framePrefix))
        .map((entry) => {
          const { data, ...rest } = entry;
          return { ...rest, frame: frameFromKey(entry.key), hasData: Boolean(data) };
        });
    }
    if (wanted.has("attachments")) {
      const raw = projectStore.readJson(paths.frameImageAttachments, []);
      extras.attachments = (Array.isArray(raw) ? raw : [])
        .filter((entry) => String(entry?.key || entry?.frameKey || "").startsWith(framePrefix))
        .map((entry) => ({ ...entry, frame: frameFromKey(entry.key || entry.frameKey) }));
    }
    if (wanted.has("trails")) {
      const trails = normalizeAttackTrails(projectStore.readJson(paths.attackTrails, EMPTY_ATTACK_TRAILS));
      extras.trails = trails.bindings[bindingKey] || [];
    }
    return extras;
  }

  async function getAnimation(args = {}) {
    const selection = animationFor(args);
    const result = animationResult(selection);
    const includeRaw = Array.isArray(args.include)
      ? args.include
      : typeof args.include === "string" && args.include.trim()
        ? args.include.split(",")
        : [];
    const include = includeRaw.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
    const allowed = ["boxes", "timing", "visual", "sfx", "attachments", "trails"];
    const unknown = include.filter((entry) => !allowed.includes(entry));
    if (unknown.length) {
      throw new Error(`Unknown include section(s): ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}.`);
    }
    if (include.length) Object.assign(result, animationExtras(selection, include));
    const framesMode = String(args.frames || "full").toLowerCase();
    if (framesMode !== "summary") return { ...result, summary: false };
    const samples = (result.animation.frames || []).slice(0, 3).map((frame) => ({
      index: frame.index,
      width: frame.width,
      height: frame.height,
      exists: frame.exists,
      absolutePath: frame.absolutePath,
    }));
    return {
      ...result,
      summary: true,
      sampleFrames: samples,
      animation: { ...result.animation, frames: undefined },
    };
  }

  function layerValidation(raw, layer = "all") {
    const requested = ["standalone", "bind", "gameplay"].includes(layer) ? layer : "all";
    const layers = { standalone: [], bind: [], gameplay: [] };
    const warningLayers = { standalone: [], bind: [], gameplay: [] };
    for (const message of raw.errors || []) layers[classifyValidationMessage(message)].push(message);
    for (const message of raw.warnings || []) warningLayers[classifyValidationMessage(message)].push(message);
    const selectedErrors = requested === "all" ? raw.errors : layers[requested];
    const selectedWarnings = requested === "all" ? raw.warnings : warningLayers[requested];
    return {
      ...raw,
      layer: requested,
      errors: selectedErrors,
      warnings: selectedWarnings,
      layers: {
        standalone: { errors: layers.standalone, warnings: warningLayers.standalone },
        bind: { errors: layers.bind, warnings: warningLayers.bind },
        gameplay: { errors: layers.gameplay, warnings: warningLayers.gameplay },
      },
      ok: selectedErrors.length === 0 && (!raw.strict || selectedWarnings.length === 0),
    };
  }

  async function validateProject(args = {}) {
    const project = registryProject(args.project_id || args.project, false);
    const raw = validateImport(
      {
        project: project.id,
        strict: args.strict === true,
        "require-gameplay": args.require_gameplay === true,
      },
      { root, projectStore },
    );
    return layerValidation({ ...raw, strict: args.strict === true }, args.layer || "all");
  }

  function setActiveProject(args = {}) {
    const project = registryProject(args.project_id || args.project, false);
    projectStore.setActiveProject(project.id);
    context.projectId = project.id;
    return { activeProjectId: project.id, project: projectStore.projectForClient(project) };
  }

  function bindGodot(args = {}) {
    const project = registryProject(args.project_id || args.project, false);
    const previousRoot = project.projectRoot || "";
    const projectRoot = path.resolve(String(args.project_root || args.root || ""));
    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
      throw new Error(`Godot project folder not found: ${projectRoot}`);
    }
    if (!fs.existsSync(path.join(projectRoot, "project.godot"))) {
      throw new Error(`Godot project.godot not found in ${projectRoot}`);
    }
    const updated = projectStore.setProjectRoot(project.id, projectRoot).project;
    context.projectId = updated.id;
    return {
      projectId: updated.id,
      projectRoot: updated.projectRoot,
      previousRoot,
      godotProjectValid: Boolean(validGodotProjectRoot(updated)),
    };
  }

  async function cutoutAnimation(args = {}) {
    const selection = animationFor(args);
    const { project, profile, animation } = selection;
    const explicitCanvas = Number.isInteger(Number(args.output_width || args.canvas))
      ? Math.max(8, Number(args.output_width || args.canvas))
      : Number.isInteger(Number(args.output_height))
        ? Math.max(8, Number(args.output_height))
        : 0;
    const outputWidth = explicitCanvas
      ? Math.max(8, Number(args.output_width || args.canvas || explicitCanvas))
      : undefined;
    const outputHeight = explicitCanvas
      ? Math.max(8, Number(args.output_height || args.canvas || explicitCanvas))
      : undefined;
    const keyColor = args.key_color || args.color || undefined;
    const frames = Array.from(animation.frames || []);
    if (!frames.length) throw new Error("Cannot cut out an animation without frames.");
    const jobs = [];
    const unsafePaths = [];
    for (const [index, frame] of frames.entries()) {
      const rawPath = String(frame.path || "");
      if (!rawPath) continue;
      const absolutePath = resolveAnimationFramePath(project, rawPath);
      if (!absolutePath) {
        unsafePaths.push(rawPath);
        continue;
      }
      if (!fs.existsSync(absolutePath)) continue;
      jobs.push({ index, absolutePath });
    }
    if (unsafePaths.length) {
      throw new Error(
        `Cutout refused frame paths outside the project workspace or Godot root: ${unsafePaths.join(", ")}`,
      );
    }
    if (!jobs.length) throw new Error("Cutout found no on-disk frames to process.");
    const paths = projectStore.projectPaths(project);
    const manifest = manifestFor(project);
    const stored = (manifest.profiles || [])
      .find((entry) => entry.id === profile.id)
      ?.animations?.find(
        (entry) => String(entry.id || entry.name) === String(animation.id || animation.name),
      );
    let processedFrameCount = 0;
    let receipt = {
      pipeline: "smart_product",
      rematched: Boolean(explicitCanvas),
      backgroundColor: keyColor || "",
      outputWidth: outputWidth || 0,
      outputHeight: outputHeight || 0,
    };
    if (cutoutPngFileImpl) {
      for (const job of jobs) {
        const temporaryPath = `${job.absolutePath}.cutout-tmp.png`;
        await cutoutPngFileImpl(job.absolutePath, temporaryPath, {
          keyColor,
          outputWidth,
          outputHeight,
        });
        if (!fs.existsSync(temporaryPath)) {
          throw new Error(`Cutout produced no file for frame ${job.index}: ${job.absolutePath}`);
        }
        fs.renameSync(temporaryPath, job.absolutePath);
        processedFrameCount += 1;
        if (stored?.frames?.[job.index] && outputWidth && outputHeight) {
          stored.frames[job.index].width = outputWidth;
          stored.frames[job.index].height = outputHeight;
        }
      }
    } else {
      receipt = cutoutFrameFiles(
        jobs.map((job) => job.absolutePath),
        {
          keyColor,
          outputWidth,
          outputHeight,
          protectedColors: args.protected_colors || args.protectedColors,
          protectionTolerance: args.protection_tolerance,
          force: booleanFlag(args.force),
        },
      );
      processedFrameCount = receipt.processedFrameCount;
      jobs.forEach((job, order) => {
        if (!stored?.frames?.[job.index]) return;
        const size = receipt.frameSizes?.[order];
        if (!size) return;
        stored.frames[job.index].width = size.width;
        stored.frames[job.index].height = size.height;
      });
    }
    projectStore.writeJson(paths.manifest, manifest);
    return {
      projectId: project.id,
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
      pipeline: receipt.pipeline,
      rematched: receipt.rematched,
      backgroundColor: receipt.backgroundColor,
      keyColor: keyColor || receipt.backgroundColor,
      outputWidth: receipt.outputWidth || outputWidth || 0,
      outputHeight: receipt.outputHeight || outputHeight || 0,
      frameCount: frames.length,
      processedFrameCount,
      skippedFrameCount: Number(receipt.skippedFrameCount || 0),
      sync: synchronize(project, booleanFlag(args.sync)),
    };
  }

  async function openTuner(args = {}) {
    const requestedAnimation = Boolean(args.animation_id || args.animation);
    let project;
    let profileId = String(args.profile_id || args.profile || "").trim();
    let animationId = String(args.animation_id || args.animation || "").trim();
    if (requestedAnimation) {
      const selection = animationFor(args);
      project = selection.project;
      profileId = selection.profile.id;
      animationId = String(selection.animation.id || selection.animation.name);
    } else {
      project = registryProject(args.project_id || args.project, false);
    }
    const port = Math.max(1, Number(args.port || process.env.PORT || DEFAULT_TUNER_PORT));
    const host = DEFAULT_TUNER_HOST;
    const url = new URL(`http://${host}:${port}/workspace`);
    url.searchParams.set("project", project.id);
    if (profileId) url.searchParams.set("profile", profileId);
    if (animationId) url.searchParams.set("animation", animationId);
    const workspaceUrl = url.toString();
    const shouldStart = args.start !== false;
    let reused = await probeTunerImpl(workspaceUrl);
    let launched = false;
    let pid = null;
    if (!reused && shouldStart) {
      const spawned = (await launchTunerImpl({ root, port, host, url: workspaceUrl })) || {};
      pid = spawned.pid || null;
      launched = true;
      reused = options.launchTunerImpl
        ? Boolean(await probeTunerImpl(workspaceUrl))
        : await waitForTuner(probeTunerImpl, workspaceUrl);
      if (!reused && !options.launchTunerImpl) {
        throw new Error(`Tuner did not start at http://${host}:${port}.`);
      }
    }
    return {
      projectId: project.id,
      profileId,
      animationId,
      url: workspaceUrl,
      launched,
      reused: Boolean(reused && !launched),
      started: Boolean(reused || launched),
      pid,
    };
  }

  async function addAttackTrail(args = {}) {
    const selection = animationFor(args);
    const { project, profile, animation } = selection;
    const paths = projectStore.projectPaths(project);
    const trails = normalizeAttackTrails(projectStore.readJson(paths.attackTrails, EMPTY_ATTACK_TRAILS));
    const bindingKey = `${profile.id}/${animation.id || animation.name}`;
    const frames = animation.frames || [];
    if (!frames.length) throw new Error("Cannot add an attack trail to an animation without frames.");
    const lastFrame = frames.length - 1;
    const width = Number(frames[0]?.width || 320);
    const height = Number(frames[0]?.height || 320);
    const startFrame = Number.isInteger(Number(args.start_frame))
      ? Math.min(lastFrame, Math.max(0, Number(args.start_frame)))
      : 0;
    const endFrame = Number.isInteger(Number(args.end_frame))
      ? Math.min(lastFrame, Math.max(startFrame, Number(args.end_frame)))
      : lastFrame;
    let texture = DEFAULT_ATTACK_TRAIL_PRESET_TEXTURE;
    if (args.texture_path) {
      const absolute = requireExistingFile(args.texture_path, "Trail texture");
      const buffer = fs.readFileSync(absolute);
      const info = pngInfo(buffer);
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const destDir = path.join(
        projectStore.projectWorkspaceDir(project),
        "attack_trails",
        profile.id,
        String(animation.id || animation.name),
      );
      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, `${hash}.png`);
      fs.writeFileSync(destPath, buffer);
      texture = {
        path: reslash(path.relative(root, destPath)),
        assetHash: hash,
        name: path.basename(absolute),
        type: "image/png",
        width: info.width,
        height: info.height,
        hasEffectiveAlpha: info.hasEffectiveAlpha,
      };
    }
    const defaultSticks = [
      {
        frame: startFrame,
        top: { x: -width * 0.15, y: -height * 0.3 },
        bottom: { x: width * 0.15, y: height * 0.1 },
      },
      {
        frame: endFrame,
        top: { x: width * 0.15, y: -height * 0.3 },
        bottom: { x: -width * 0.15, y: height * 0.1 },
      },
    ];
    const sticks = Array.isArray(args.sticks) && args.sticks.length ? args.sticks : defaultSticks;
    const segmentId = slug(
      args.id ||
        (args.texture_path ? path.basename(args.texture_path, path.extname(args.texture_path)) : "trail"),
      "trail",
    );
    const segment = {
      id: segmentId,
      name: String(args.name || segmentId),
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
      texture,
      colorMode: args.color_mode || args.colorMode || "solid",
      color: args.color || "#d9364a",
      sticks,
    };
    trails.bindings[bindingKey] = [
      ...(trails.bindings[bindingKey] || []).filter((entry) => entry.id !== segment.id),
      segment,
    ];
    const normalized = normalizeAttackTrails(trails);
    const warnings = validateAttackTrails(normalized, selection.manifest);
    projectStore.writeJson(paths.attackTrails, normalized);
    return {
      projectId: project.id,
      bindingKey,
      segment: normalized.bindings[bindingKey].find((entry) => entry.id === segment.id),
      warnings,
      sync: synchronize(project, booleanFlag(args.sync, true)),
    };
  }

  async function addAttachment(args = {}) {
    const { project, profile, animation } = animationFor(args);
    const frames = animation.frames || [];
    if (!frames.length) throw new Error("Cannot attach an image to an animation without frames.");
    const frame = requireFrameIndex(args.frame || 0, frames.length - 1);
    const absolute = requireExistingFile(args.file_path, "Attachment image");
    if (!/\.png$/i.test(absolute)) throw new Error("Attachment image must be a PNG.");
    const paths = projectStore.projectPaths(project);
    const bindings = projectStore.readJson(paths.frameImageAttachments, []);
    const key = `${profile.id}/${animation.id || animation.name}:${frame}`;
    const source = frames[frame] || frames[0];
    const relativePath = copyIntoWorkspace(
      project,
      path.join("attachments", profile.id, String(animation.id || animation.name)),
      absolute,
    );
    const name = String(args.name || path.basename(absolute));
    const id = slug(args.id || path.basename(absolute, path.extname(absolute)), "attachment");
    const scale = Number(args.scale ?? 1);
    const requestedOrder = args.layer_order ?? args.layerOrder;
    const layerOrder =
      requestedOrder === undefined || requestedOrder === null || requestedOrder === ""
        ? 1
        : Number(requestedOrder);
    if (!Number.isFinite(layerOrder)) throw new Error("layer_order must be a finite number.");
    const attachment = {
      id,
      key,
      frameKey: key,
      name,
      path: relativePath,
      type: "image/png",
      layer: String(args.layer || "above") === "below" ? "below" : "above",
      layerOrder,
      transform: {
        offset: {
          x: Number(args.offset_x || 0),
          y: args.offset_y === undefined ? -Number(source.height || 100) * 0.2 : Number(args.offset_y),
        },
        scale: { x: scale, y: scale },
        rotation: Number(args.rotation || 0),
      },
      metadata: {
        profileId: profile.id,
        animation: `${profile.id}/${animation.id || animation.name}`,
        frame,
      },
    };
    const next = [
      ...(Array.isArray(bindings) ? bindings : []).filter((entry) => entry.id !== id || entry.key !== key),
      attachment,
    ];
    projectStore.writeJson(paths.frameImageAttachments, next);
    return {
      projectId: project.id,
      binding: attachment,
      bindingCount: next.length,
      sync: synchronize(project, booleanFlag(args.sync, true)),
    };
  }

  async function addSfx(args = {}) {
    const { project, profile, animation } = animationFor(args);
    const frames = animation.frames || [];
    if (!frames.length) throw new Error("Cannot bind SFX to an animation without frames.");
    const frame = requireFrameIndex(args.frame || 0, frames.length - 1);
    const paths = projectStore.projectPaths(project);
    const bindings = readSfxBindings(paths);
    const key = `${profile.id}/${animation.id || animation.name}:${frame}`;
    const absolute = requireExistingFile(args.file_path, "SFX file");
    const mime = audioMimeType(absolute);
    const buffer = fs.readFileSync(absolute);
    const name = String(args.name || path.basename(absolute));
    const id = slug(args.id || path.basename(absolute, path.extname(absolute)), "sfx");
    const relativePath = copyIntoWorkspace(project, path.join("audio", profile.id), absolute);
    const binding = {
      id,
      key,
      name,
      type: mime,
      size: buffer.length,
      path: relativePath,
      data: `data:${mime};base64,${buffer.toString("base64")}`,
      metadata: {
        profileId: profile.id,
        animation: `${profile.id}/${animation.id || animation.name}`,
        frame,
      },
    };
    const next = [...bindings.filter((entry) => entry.key !== key || entry.id !== binding.id), binding];
    projectStore.writeJson(paths.frameAudio, next);
    return {
      projectId: project.id,
      binding: { ...binding, data: `[${mime} omitted]` },
      bindingCount: next.length,
      sync: synchronize(project, booleanFlag(args.sync, true)),
    };
  }

  function removeBinding(args = {}) {
    const { project, profile, animation } = animationFor(args);
    const kind = String(args.kind || "")
      .trim()
      .toLowerCase();
    if (!["sfx", "attachment", "trail"].includes(kind)) {
      throw new Error('kind must be one of "sfx", "attachment", or "trail".');
    }
    const id = String(args.id || "").trim();
    if (!id) throw new Error("id is required.");
    const animationId = String(animation.id || animation.name);
    const bindingKey = `${profile.id}/${animationId}`;
    const framePrefix = `${bindingKey}:`;
    const dryRun = booleanFlag(args.dry_run);
    const paths = projectStore.projectPaths(project);
    let frameFilter = null;
    if (args.frame !== undefined) {
      if (kind === "trail") throw new Error("frame is not applicable to trail bindings.");
      frameFilter = requireFrameIndex(args.frame, Math.max(0, (animation.frames || []).length - 1));
    }
    const summarize = (entry) => {
      const { data, ...rest } = entry;
      return rest;
    };
    let removed;
    let remainingCount;
    let write;
    if (kind === "trail") {
      const trails = normalizeAttackTrails(projectStore.readJson(paths.attackTrails, EMPTY_ATTACK_TRAILS));
      const segments = trails.bindings[bindingKey] || [];
      removed = segments.filter((segment) => String(segment.id) === id);
      const kept = segments.filter((segment) => String(segment.id) !== id);
      if (!removed.length) {
        const available = segments.map((segment) => String(segment.id));
        throw new Error(
          `Trail segment not found: ${id}. Available: ${available.join(", ") || "(none)"}`,
        );
      }
      remainingCount = kept.length;
      write = () => {
        if (kept.length) trails.bindings[bindingKey] = kept;
        else delete trails.bindings[bindingKey];
        projectStore.writeJson(paths.attackTrails, normalizeAttackTrails(trails));
      };
    } else {
      const file = kind === "sfx" ? paths.frameAudio : paths.frameImageAttachments;
      const bindings =
        kind === "sfx"
          ? readSfxBindings(paths)
          : (() => {
              const raw = projectStore.readJson(file, []);
              return Array.isArray(raw) ? raw : [];
            })();
      const matches = (entry) => {
        const key = String(entry?.key || entry?.frameKey || "");
        if (!key.startsWith(framePrefix)) return false;
        if (String(entry?.id) !== id) return false;
        if (frameFilter !== null && key !== `${framePrefix}${frameFilter}`) return false;
        return true;
      };
      removed = bindings.filter(matches);
      const kept = bindings.filter((entry) => !matches(entry));
      if (!removed.length) {
        const available = [
          ...new Set(
            bindings
              .filter((entry) => String(entry?.key || entry?.frameKey || "").startsWith(framePrefix))
              .map((entry) => String(entry?.id)),
          ),
        ];
        throw new Error(
          `${kind} binding not found: ${id}${frameFilter !== null ? ` on frame ${frameFilter}` : ""}. Available: ${available.join(", ") || "(none)"}`,
        );
      }
      remainingCount = kept.length;
      write = () => projectStore.writeJson(file, kept);
    }
    if (!dryRun) write();
    return {
      projectId: project.id,
      profileId: profile.id,
      animationId,
      kind,
      id,
      frame: frameFilter,
      dryRun,
      removed: removed.map(summarize),
      removedCount: removed.length,
      remainingCount,
      sync: synchronize(project, dryRun ? false : booleanFlag(args.sync, true)),
    };
  }

  async function reorganizeFrames(args = {}) {
    const { project, profile, animation } = animationFor(args);
    const frames = animation.frames || [];
    const order = Array.isArray(args.order) ? args.order.map(Number) : frames.map((_, index) => index);
    if (
      !order.length ||
      order.some((index) => !Number.isInteger(index) || index < 0 || index >= frames.length)
    ) {
      throw new Error(
        `Frame order must contain valid source indexes between 0 and ${Math.max(0, frames.length - 1)}.`,
      );
    }
    const result = reorganizeAnimation({
      root,
      projectStore,
      project,
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
      items: order.map((sourceIndex) => ({
        sourceIndex,
        sourcePath: frames[sourceIndex].path,
        frameId: frames[sourceIndex].id,
      })),
    });
    return {
      projectId: project.id,
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
      inputFrameCount: frames.length,
      outputFrameCount: result.frameCount,
      order,
      identityOrder: order.every((sourceIndex, index) => sourceIndex === index),
      fps: Number(animation.fps || 0),
      targetDirectory: result.targetDir,
      sync: synchronize(project, booleanFlag(args.sync, true)),
    };
  }

  function replaceFrame(args = {}) {
    const selection = animationFor(args);
    const { project, manifest, profile, animation } = selection;
    const frames = animation.frames || [];
    if (!frames.length) throw new Error("Cannot replace a frame on an animation without frames.");
    if (args.frame === undefined) throw new Error("frame is required.");
    const frame = requireFrameIndex(args.frame, frames.length - 1);
    const absolute = requireExistingFile(args.file_path, "Replacement frame");
    if (!PNG_NAME.test(absolute)) throw new Error("Replacement frame must be a PNG.");
    const buffer = fs.readFileSync(absolute);
    let info;
    try {
      info = pngInfo(buffer);
    } catch {
      throw new Error("Replacement frame must be a valid PNG file.");
    }
    const target = resolveAnimationFramePath(project, frames[frame].path);
    const workspaceDir = projectStore.projectWorkspaceDir(project);
    if (!target || !isInsideDirectory(target, workspaceDir)) {
      throw new Error(
        "Only workspace-managed frames can be replaced; this frame lives outside the project workspace.",
      );
    }
    const previousSize = {
      width: Number(frames[frame].width || 0),
      height: Number(frames[frame].height || 0),
    };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tempPath = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, target);
    const newSize = { width: info.width, height: info.height };
    const sizeChanged = newSize.width !== previousSize.width || newSize.height !== previousSize.height;
    if (sizeChanged) {
      frames[frame].width = newSize.width;
      frames[frame].height = newSize.height;
      projectStore.writeJson(projectStore.projectPaths(project).manifest, manifest);
    }
    return {
      projectId: project.id,
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
      frame,
      path: reslash(path.relative(root, target)),
      previousSize,
      newSize,
      sizeChanged,
      warnings: sizeChanged
        ? ["Frame size changed; existing boxes, attachments, and trails keep their old coordinates."]
        : [],
      sync: synchronize(project, booleanFlag(args.sync)),
    };
  }

  async function exportGif(args = {}) {
    const { project, profile, animation } = animationFor(args);
    const frames = animation.frames || [];
    if (!frames.length) throw new Error("Cannot export an animation without frames.");
    const lastIndex = frames.length - 1;
    const startFrame = args.start_frame === undefined ? 0 : requireFrameIndex(args.start_frame, lastIndex);
    const endFrame = args.end_frame === undefined ? lastIndex : requireFrameIndex(args.end_frame, lastIndex);
    if (endFrame < startFrame) throw new Error("end_frame must be greater than or equal to start_frame.");
    const fps = requireFps(args.fps === undefined ? animation.fps : args.fps, 12);
    const includeDisabled = booleanFlag(args.include_disabled);
    const animationId = String(animation.id || animation.name);
    const paths = projectStore.projectPaths(project);
    const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
    const playbackOverrides =
      tuning.frame_playback_overrides && typeof tuning.frame_playback_overrides === "object"
        ? tuning.frame_playback_overrides
        : {};
    const framePaths = [];
    const durations = [];
    let skippedDisabledFrames = 0;
    for (let index = startFrame; index <= endFrame; index += 1) {
      const key = frameBoxKey(profile.id, animationId, index);
      const override =
        playbackOverrides[key] && typeof playbackOverrides[key] === "object" ? playbackOverrides[key] : {};
      if (override.disabled === true && !includeDisabled) {
        skippedDisabledFrames += 1;
        continue;
      }
      const absolute = resolveAnimationFramePath(project, frames[index].path);
      if (!absolute || !fs.existsSync(absolute)) {
        throw new Error(`Frame ${index} has no generated PNG on disk; import or regenerate frames first.`);
      }
      framePaths.push(absolute);
      durations.push(Math.max(0.001, Number(override.duration || 1)) / fps);
    }
    if (!framePaths.length) {
      throw new Error("No exportable frames in the selected range (all frames are disabled).");
    }
    let outputPath;
    if (args.output_path) {
      outputPath = path.resolve(String(args.output_path));
      if (!/\.gif$/i.test(outputPath)) throw new Error("output_path must end with .gif.");
    } else {
      outputPath = path.join(
        projectStore.projectWorkspaceDir(project),
        "exports",
        `${profile.id}_${animationId}.gif`,
      );
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await encodeGifImpl({ framePaths, durations, fps, outputPath });
    if (!fs.existsSync(outputPath)) throw new Error("GIF export produced no output file.");
    return {
      projectId: project.id,
      profileId: profile.id,
      animationId,
      outputPath,
      frameCount: framePaths.length,
      skippedDisabledFrames,
      startFrame,
      endFrame,
      fps,
      totalDurationMs: Math.round(durations.reduce((sum, value) => sum + value, 0) * 1000),
      bytes: fs.statSync(outputPath).size,
    };
  }

  const handlers = {
    xsxb_list_projects: listProjects,
    xsxb_get_project: projectSnapshot,
    xsxb_import_video: importVideo,
    xsxb_import_animation: importUnified,
    xsxb_get_animation: getAnimation,
    xsxb_update_frame_boxes: updateFrameBoxes,
    xsxb_estimate_boxes: estimateBoxes,
    xsxb_update_timing: updateTiming,
    xsxb_set_visual_transform: setVisualTransform,
    xsxb_replace_frame: replaceFrame,
    xsxb_export_gif: exportGif,
    xsxb_validate_project: validateProject,
    xsxb_add_attack_trail: addAttackTrail,
    xsxb_add_attachment: addAttachment,
    xsxb_add_sfx: addSfx,
    xsxb_remove_binding: removeBinding,
    xsxb_reorganize_frames: reorganizeFrames,
    xsxb_delete_animation: removeAnimation,
    xsxb_sync_godot: syncGodot,
    xsxb_set_active_project: setActiveProject,
    xsxb_bind_godot: bindGodot,
    xsxb_cutout: cutoutAnimation,
    xsxb_open_tuner: openTuner,
  };

  return {
    tools: toolDefinitions(),
    async call(name, args = {}) {
      if (!MCP_TOOL_NAMES.includes(name) || !handlers[name])
        throw new Error(`Unknown XSXB MCP tool: ${name}`);
      return handlers[name](args && typeof args === "object" ? args : {});
    },
  };
}

module.exports = {
  MCP_TOOL_NAMES,
  booleanFlag,
  classifyValidationMessage,
  createTestWav,
  createXsxbMcpService,
  extractVideoFrames,
  requireFps,
  requireFrameIndex,
  toolDefinitions,
};
