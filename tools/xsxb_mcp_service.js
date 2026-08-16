"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  DEFAULT_ATTACK_TRAIL_PRESET_TEXTURE,
  EMPTY_ATTACK_TRAILS,
  normalizeAttackTrails,
  validateAttackTrails,
} = require("./attack_trails");
const { deleteAnimation } = require("./animation_mutations");
const { frameBoxKey } = require("./box_estimator");
const { importAnimation, reorganizeAnimation } = require("./frame_organizer");
const { syncGodotProject, validGodotProjectRoot } = require("./godot_sync");
const { parseSpriteFrames } = require("./import_spriteframes");
const { createProjectStore, EMPTY_TUNING, reslash, slug } = require("./project_store");
const { validateImport } = require("./validate_import");

const execFileAsync = promisify(execFile);
const DEFAULT_PROFILE_ID = "mcp_imports";
const MCP_TOOL_NAMES = Object.freeze([
  "xsxb_list_projects",
  "xsxb_get_project",
  "xsxb_import_video",
  "xsxb_import_animation",
  "xsxb_get_animation",
  "xsxb_update_frame_boxes",
  "xsxb_update_timing",
  "xsxb_reorganize_frames",
  "xsxb_add_attack_trail",
  "xsxb_add_attachment",
  "xsxb_add_sfx",
  "xsxb_delete_animation",
  "xsxb_sync_godot",
  "xsxb_validate_project",
]);
const BOX_NAMES = Object.freeze(["hurtbox", "collisionbox", "hitbox"]);
const PNG_NAME = /\.png$/i;

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
      description: "Return complete metadata and on-disk generation status for an XSXB animation.",
      inputSchema: { type: "object", properties: animationProperties, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_update_frame_boxes",
      description: "Update hurtbox, collisionbox, and hitbox for one animation frame. Does not sync Godot.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          frame: { type: "integer", minimum: 0, default: 0 },
          hurtbox: { type: "object" },
          collisionbox: { type: "object" },
          hitbox: { type: "object" },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_update_timing",
      description:
        "Update animation FPS and optional per-frame duration or disabled playback. Does not sync Godot.",
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
    ...[
      ["xsxb_add_attack_trail", "Add a deterministic attack-trail test segment to an animation."],
      ["xsxb_add_attachment", "Add a deterministic image-attachment test binding to an animation frame."],
      ["xsxb_add_sfx", "Add a generated WAV test SFX binding to an animation frame."],
    ].map(([name, description]) => ({
      name,
      description,
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          frame: { type: "integer", minimum: 0, default: 0 },
          sync: { type: "boolean", default: true },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    })),
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
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

/**
 * Creates the business service used by the XSXB MCP transport.
 * @param {{root?:string,extractVideoFramesImpl?:typeof extractVideoFrames}} [options] Service dependencies.
 * @returns {{tools:object[],call:(name:string,args?:object)=>Promise<object>}} MCP-facing service.
 */
function createXsxbMcpService(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const projectStore = createProjectStore(root);
  const extractVideoFramesImpl = options.extractVideoFramesImpl || extractVideoFrames;
  const context = { projectId: "", profileId: "", animationId: "" };

  function registryProject(projectId, syncRequested = false) {
    const registry = projectStore.readRegistry();
    const requested = String(projectId || context.projectId || "").trim();
    let project = requested
      ? registry.projects.find((entry) => entry.id === slug(requested))
      : projectStore.resolveProject(registry);
    if (!project && requested) throw new Error(`XSXB project not found: ${requested}`);
    if (syncRequested && !validGodotProjectRoot(project)) {
      project = registry.projects.find((entry) => validGodotProjectRoot(entry));
    }
    if (!project) throw new Error("No XSXB project is available.");
    if (syncRequested && !validGodotProjectRoot(project)) {
      throw new Error("No XSXB project is bound to an existing Godot project.godot.");
    }
    context.projectId = project.id;
    return project;
  }

  function manifestFor(project) {
    const paths = projectStore.projectPaths(project);
    return projectStore.readJson(paths.manifest, { schemaVersion: 1, profiles: [] });
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

  function animationResult(selection) {
    const { project, profile, animation } = selection;
    const frames = Array.from(animation.frames || []).map((frame, index) => {
      const rawPath = String(frame.path || "");
      const absolutePath = rawPath.startsWith("res://")
        ? path.join(project.projectRoot || "", rawPath.slice(6))
        : path.resolve(root, rawPath);
      return {
        index,
        ...frame,
        absolutePath,
        exists: Boolean(rawPath && fs.existsSync(absolutePath)),
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

  function synchronize(project, enabled) {
    if (enabled === false) return { requested: false, ok: null };
    const result = syncGodotProject(root, projectStore, project);
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
    const syncRequested = args.sync === true;
    const project = registryProject(args.project_id || args.project, syncRequested);
    const profileId = slug(args.profile_id || args.profile || DEFAULT_PROFILE_ID, DEFAULT_PROFILE_ID);
    const manifest = manifestFor(project);
    const profile = (manifest.profiles || []).find((entry) => entry.id === profileId);
    const baseAnimationId = slug(
      args.animation_id || args.animation || path.basename(videoPath, path.extname(videoPath)),
      "video_import",
    );
    const used = new Set((profile?.animations || []).map((entry) => String(entry.id || entry.name)));
    let animationId = baseAnimationId;
    let suffix = 2;
    while (used.has(animationId)) {
      animationId = `${baseAnimationId}_${suffix}`;
      suffix += 1;
    }
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-video-"));
    try {
      const extractedPaths = await extractVideoFramesImpl(videoPath, temporaryDirectory, args);
      if (!extractedPaths.length) throw new Error("Video extraction produced no PNG frames.");
      const items = extractedPaths.map((framePath) => ({
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
        fps: Number(args.fps || 12),
        items,
      });
      context.projectId = project.id;
      context.profileId = profileId;
      context.animationId = animationId;
      const sync = synchronize(project, syncRequested);
      const validation =
        args.validate === true
          ? validateImport({ project: project.id }, { root, projectStore })
          : { requested: false, ok: null, errors: [], warnings: [], summary: {} };
      return {
        projectId: project.id,
        profileId,
        animationId,
        sourceVideo: videoPath,
        fps: Math.max(1, Math.min(120, Number(args.fps || 12))),
        extractedFrameCount: extractedPaths.length,
        importedFrameCount: imported.frameCount,
        targetDirectory: imported.targetDir,
        sync,
        validation: args.validate === true ? { requested: true, ...validation } : validation,
      };
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  function uniqueAnimationId(project, profileId, requestedId, fallback) {
    const manifest = manifestFor(project);
    const profile = (manifest.profiles || []).find((entry) => entry.id === profileId);
    const used = new Set((profile?.animations || []).map((entry) => String(entry.id || entry.name)));
    const base = slug(requestedId || fallback, fallback);
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
    const syncRequested = args.sync === true;
    const project = registryProject(args.project_id || args.project, syncRequested);
    const profileId = slug(args.profile_id || args.profile || DEFAULT_PROFILE_ID, DEFAULT_PROFILE_ID);
    const animationId = uniqueAnimationId(
      project,
      profileId,
      args.animation_id || args.animation,
      sourceLabel === "png_sequence" ? "png_sequence" : "imported",
    );
    const imported = importAnimation({
      root,
      projectStore,
      project,
      profileId,
      profileLabel: profileId,
      animationId,
      animationName: String(args.animation_name || animationId),
      animationType: "actor",
      fps: Number(args.fps || 12),
      items,
    });
    context.projectId = project.id;
    context.profileId = profileId;
    context.animationId = animationId;
    const sync = synchronize(project, syncRequested);
    const validation =
      args.validate === true
        ? { requested: true, ...validateImport({ project: project.id }, { root, projectStore }) }
        : { requested: false, ok: null, errors: [], warnings: [], summary: {} };
    return {
      source: sourceLabel,
      projectId: project.id,
      profileId,
      animationId,
      fps: Math.max(1, Math.min(120, Number(args.fps || 12))),
      importedFrameCount: imported.frameCount,
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
      return importPngItems(args, listPngSequence(directory).map(pngFileToItem), "png_sequence");
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
      return importPngItems(args, normalized, "items");
    }
    if (source === "spriteframes") {
      const filePath = path.resolve(String(args.file_path || args.path || ""));
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`SpriteFrames file not found: ${filePath}`);
      }
      const syncRequested = args.sync === true;
      const project = registryProject(args.project_id || args.project, syncRequested);
      const projectRoot = validGodotProjectRoot(project) || path.dirname(filePath);
      const animations = parseSpriteFrames(filePath, projectRoot);
      if (!animations.length) throw new Error(`No PNG animations found in ${filePath}`);
      const profileId = slug(args.profile_id || args.profile || DEFAULT_PROFILE_ID, DEFAULT_PROFILE_ID);
      const imported = [];
      for (const animation of animations) {
        const items = animation.frames.map((frame) => pngFileToItem(frame.source));
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
      const validation =
        args.validate === true
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
    const frame = Math.min(frames.length - 1, Math.max(0, Number(args.frame || 0)));
    const patches = BOX_NAMES.filter((name) => args[name] && typeof args[name] === "object");
    if (!patches.length) throw new Error("Provide at least one of hurtbox, collisionbox, or hitbox.");
    const paths = projectStore.projectPaths(project);
    const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
    tuning.frame_box_overrides =
      tuning.frame_box_overrides && typeof tuning.frame_box_overrides === "object"
        ? tuning.frame_box_overrides
        : {};
    const key = frameBoxKey(profile.id, animation.id || animation.name, frame);
    const current =
      tuning.frame_box_overrides[key] && typeof tuning.frame_box_overrides[key] === "object"
        ? tuning.frame_box_overrides[key]
        : {};
    const boxes = { ...current };
    for (const name of patches) {
      boxes[name] = mergeBox(current[name], args[name], { ground: name === "collisionbox" });
    }
    tuning.frame_box_overrides[key] = boxes;
    projectStore.writeJson(paths.tuning, tuning);
    return {
      projectId: project.id,
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
      frame,
      key,
      boxes,
      sync: synchronize(project, args.sync === true),
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
    const fps = Math.max(1, Math.min(120, Number(args.fps || target.fps || 12)));
    target.fps = fps;
    projectStore.writeJson(paths.manifest, manifest);
    let playback = null;
    if (
      args.frame !== undefined ||
      args.duration_ms !== undefined ||
      args.duration !== undefined ||
      args.disabled !== undefined
    ) {
      if (!frames.length) throw new Error("Cannot update frame timing on an animation without frames.");
      const frame = Math.min(frames.length - 1, Math.max(0, Number(args.frame || 0)));
      const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
      tuning.frame_playback_overrides =
        tuning.frame_playback_overrides && typeof tuning.frame_playback_overrides === "object"
          ? tuning.frame_playback_overrides
          : {};
      const key = frameBoxKey(profile.id, animation.id || animation.name, frame);
      const current = tuning.frame_playback_overrides[key] || {};
      let duration = Number(current.duration || 1);
      if (args.duration_ms !== undefined) duration = (Number(args.duration_ms) * fps) / 1000;
      else if (args.duration !== undefined) duration = Number(args.duration);
      duration = Math.max(0.001, duration);
      const disabled = args.disabled === undefined ? current.disabled === true : Boolean(args.disabled);
      if (disabled || duration !== 1) tuning.frame_playback_overrides[key] = { duration, disabled };
      else delete tuning.frame_playback_overrides[key];
      projectStore.writeJson(paths.tuning, tuning);
      playback = {
        frame,
        key,
        duration,
        durationMs: Math.round((duration * 1000) / fps),
        disabled,
      };
    }
    return {
      projectId: project.id,
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
      fps,
      playback,
      sync: synchronize(project, args.sync === true),
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
    if (args.dry_run === true) {
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
      sync: synchronize(project, args.sync === true),
    };
  }

  async function syncGodot(args = {}) {
    const project = registryProject(args.project_id || args.project, true);
    return {
      projectId: project.id,
      ...synchronize(project, true),
    };
  }

  async function getAnimation(args = {}) {
    return animationResult(animationFor(args));
  }

  async function validateProject(args = {}) {
    const project = registryProject(args.project_id || args.project, false);
    return validateImport(
      {
        project: project.id,
        strict: args.strict === true,
        "require-gameplay": args.require_gameplay === true,
      },
      { root, projectStore },
    );
  }

  async function addAttackTrail(args = {}) {
    const selection = animationFor(args);
    const { project, profile, animation } = selection;
    const paths = projectStore.projectPaths(project);
    const trails = normalizeAttackTrails(projectStore.readJson(paths.attackTrails, EMPTY_ATTACK_TRAILS));
    const bindingKey = `${profile.id}/${animation.id || animation.name}`;
    const frames = animation.frames || [];
    const lastFrame = Math.max(1, frames.length - 1);
    const width = Number(frames[0]?.width || 320);
    const height = Number(frames[0]?.height || 320);
    const segment = {
      id: "mcp_test_trail",
      name: "MCP Test Trail",
      profileId: profile.id,
      animationId: String(animation.id || animation.name),
      texture: DEFAULT_ATTACK_TRAIL_PRESET_TEXTURE,
      colorMode: "solid",
      color: "#d9364a",
      sticks: [
        {
          frame: 0,
          top: { x: -width * 0.15, y: -height * 0.3 },
          bottom: { x: width * 0.15, y: height * 0.1 },
        },
        {
          frame: lastFrame,
          top: { x: width * 0.15, y: -height * 0.3 },
          bottom: { x: -width * 0.15, y: height * 0.1 },
        },
      ],
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
      sync: synchronize(project, args.sync !== false),
    };
  }

  async function addAttachment(args = {}) {
    const { project, profile, animation } = animationFor(args);
    const frames = animation.frames || [];
    if (!frames.length) throw new Error("Cannot attach an image to an animation without frames.");
    const frame = Math.min(frames.length - 1, Math.max(0, Number(args.frame || 0)));
    const paths = projectStore.projectPaths(project);
    const bindings = projectStore.readJson(paths.frameImageAttachments, []);
    const key = `${profile.id}/${animation.id || animation.name}:${frame}`;
    const id = "mcp_test_attachment";
    const source = frames[0];
    const attachment = {
      id,
      key,
      frameKey: key,
      name: "MCP Test Attachment",
      path: source.path,
      type: "image/png",
      layer: "above",
      layerOrder: 1,
      transform: {
        offset: { x: 0, y: -Number(source.height || 100) * 0.2 },
        scale: { x: 0.25, y: 0.25 },
        rotation: 0,
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
      sync: synchronize(project, args.sync !== false),
    };
  }

  async function addSfx(args = {}) {
    const { project, profile, animation } = animationFor(args);
    const frames = animation.frames || [];
    if (!frames.length) throw new Error("Cannot bind SFX to an animation without frames.");
    const frame = Math.min(frames.length - 1, Math.max(0, Number(args.frame || 0)));
    const paths = projectStore.projectPaths(project);
    const raw = projectStore.readJson(paths.frameAudio, []);
    const bindings = Array.isArray(raw)
      ? raw
      : Object.entries(raw || {}).map(([key, value]) => ({ key, ...(value || {}) }));
    const key = `${profile.id}/${animation.id || animation.name}:${frame}`;
    const wav = createTestWav();
    const binding = {
      id: "mcp_test_sfx",
      key,
      name: "mcp_test_sfx.wav",
      type: "audio/wav",
      size: wav.length,
      data: `data:audio/wav;base64,${wav.toString("base64")}`,
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
      binding: { ...binding, data: "[base64 WAV omitted]" },
      bindingCount: next.length,
      sync: synchronize(project, args.sync !== false),
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
      targetDirectory: result.targetDir,
      sync: synchronize(project, args.sync !== false),
    };
  }

  const handlers = {
    xsxb_list_projects: listProjects,
    xsxb_get_project: projectSnapshot,
    xsxb_import_video: importVideo,
    xsxb_import_animation: importUnified,
    xsxb_get_animation: getAnimation,
    xsxb_update_frame_boxes: updateFrameBoxes,
    xsxb_update_timing: updateTiming,
    xsxb_validate_project: validateProject,
    xsxb_add_attack_trail: addAttackTrail,
    xsxb_add_attachment: addAttachment,
    xsxb_add_sfx: addSfx,
    xsxb_reorganize_frames: reorganizeFrames,
    xsxb_delete_animation: removeAnimation,
    xsxb_sync_godot: syncGodot,
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
  createTestWav,
  createXsxbMcpService,
  extractVideoFrames,
  toolDefinitions,
};
