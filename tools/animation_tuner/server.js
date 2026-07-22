const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { Worker } = require("node:worker_threads");
const { EMPTY_MANIFEST, EMPTY_TUNING, createProjectStore, reslash } = require("../project_store");
const { importAnimation, reorganizeAnimation } = require("../frame_organizer");
const { deleteAnimation } = require("../animation_mutations");
const { checkForUpdates, performUpdate } = require("../updater");
const { createProjectInspection } = require("../project_inspection");
const { createHttpUtilities } = require("./server_http");
const { createProjectPersistence } = require("./server_project_persistence");
const { createProjectValidation } = require("./server_project_validation");
const { createProjectView } = require("./server_project_view");
const { createProjectRoutes } = require("./server_project_routes");
const { createMediaRoutes } = require("./server_media_routes");
const { createStaticHandler } = require("./server_static");
const { createServerIoOperations } = require("./server_io_operations");
const { createActivationService } = require("./server_activation");
const { createPremiumAuthorizer } = require("./server_premium_authorization");
const { segmentSubject } = require("./server_subject_segmentation");
const {
  decodeDataUrl,
  imageExtensionFromMime,
  isInside,
  normalizeManifest: normalizeManifestInput,
  normalizeTuningScaleValues,
  safeResolve,
  sanitizeSegment,
} = require("./server_validation");

const ROOT = path.resolve(process.env.XSXB_ROOT || path.resolve(__dirname, "..", ".."));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 5179);
const HOST = process.env.XSXB_HOST || process.env.HOST || "127.0.0.1";
const projectStore = createProjectStore(ROOT);
const UPDATE_TOKEN = crypto.randomBytes(24).toString("hex");
let restartScheduled = false;
const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;
const SAVE_BODY_LIMIT = 64 * 1024 * 1024;
const MEDIA_BODY_LIMIT = 96 * 1024 * 1024;
const MEDIA_ROUTES = new Set([
  "/api/segment-subject",
  "/api/attachment-assets",
  "/api/frame-attachment-image",
  "/api/import-animation",
  "/api/replace-animation",
  "/api/replace-frame",
  "/api/reorganize-animation",
]);
const WORKBENCH_ROUTES = new Set(["/workspace", "/tools/cutout", "/tools/import", "/tools/organizer"]);

const DEFAULT_SUPPORTS = [
  "character_transform",
  "group_transform",
  "frame_transform",
  "frame_playback",
  "frame_boxes",
  "reference_frame",
];

const { HttpError, readJsonBody, send, validateWriteRequest } = createHttpUtilities({
  port: PORT,
  mediaRoutes: MEDIA_ROUTES,
  defaultBodyLimit: DEFAULT_BODY_LIMIT,
  saveBodyLimit: SAVE_BODY_LIMIT,
  mediaBodyLimit: MEDIA_BODY_LIMIT,
});
const serveStatic = createStaticHandler({
  publicRoot: PUBLIC,
  workbenchRoutes: WORKBENCH_ROUTES,
  safeResolve,
  send,
});
const activationService = createActivationService({
  codeHashes: process.env.XSXB_ACTIVATION_CODE_HASHES || "",
  secret: process.env.XSXB_ACTIVATION_SECRET || "",
});
const premiumAuthorizer = createPremiumAuthorizer({ activationService, HttpError });
const {
  withProjectWrite,
  syncGodotProjectAsync,
  syncFrameAudioAsync,
  projectDataRevision,
  createFilesystemSnapshot,
  rollbackFilesystemSnapshot,
  saveTransactionPaths,
} = createServerIoOperations({
  root: ROOT,
  projectStore,
  fs,
  os,
  path,
  crypto,
  Worker,
});

const {
  saveTuningPayload,
  saveFrameImageAttachments,
  saveAttachmentAssets,
  saveFrameAudioBindings,
  saveFrameAttachmentImage,
  replaceFrameImage,
  replaceAnimationImages,
} = createProjectPersistence({
  fs,
  path,
  crypto,
  root: ROOT,
  projectStore,
  decodeDataUrl,
  imageExtensionFromMime,
  isInside,
  safeResolve,
  reslash,
  getPngSize,
  normalizeTuningScaleValues,
  withFrameAttachmentHash,
  HttpError,
});
const {
  relativeProjectPath,
  listSceneFiles,
  validateGdscriptTypeInference,
  manifestHasRuntimeAnimations,
  validateRuntimeSceneUsage,
  validateRuntimeBindingReaders,
  validateGameLocalBindingKeys,
} = createProjectValidation({
  fs,
  path,
  projectStore,
  reslash,
  createProjectInspection,
});
const { syncGodotRuntimeProjectId, configResponse, projectsResponse } = createProjectView({
  root: ROOT,
  projectStore,
  projectFromRequest,
  emptyTuning: EMPTY_TUNING,
  tuningForClient,
  readManifest,
  readTuningFile,
  buildGroups,
  validateProject,
  profileForClient,
  listSceneFiles,
  readFrameAudioBindings,
  readFrameImageAttachments,
  readAttachmentAssets,
  projectDataRevision,
  fs,
  path,
  relativeProjectPath,
});

const { handleProjectRoute } = createProjectRoutes({
  send,
  readJsonBody,
  withProjectWrite,
  projectStore,
  requiredProjectFromRequest,
  projectDataRevision,
  createFilesystemSnapshot,
  managedProjectPaths,
  clearProjectContent,
  rollbackFilesystemSnapshot,
  projectsResponse,
  fs,
});

const { handleMediaRoute } = createMediaRoutes({
  send,
  readJsonBody,
  assertPremiumAccess: premiumAuthorizer.assertAuthorized,
  withProjectWrite,
  projectStore,
  projectFromRequest,
  requiredProjectFromRequest,
  projectDataRevision,
  createFilesystemSnapshot,
  managedProjectPaths,
  rollbackFilesystemSnapshot,
  fs,
  path,
  root: ROOT,
  decodeDataUrl,
  saveFrameAudioBindings,
  saveFrameAttachmentImage,
  saveAttachmentAssets,
  replaceFrameImage,
  replaceAnimationImages,
  deleteAnimation,
  importAnimation,
  reorganizeAnimation,
  syncGodotProjectAsync,
  syncFrameAudioAsync,
  syncGodotRuntimeProjectId,
  godotMirrorPath,
  validateProject,
});

function ensureDataFiles() {
  projectStore.readRegistry();
}

function round(value) {
  return Number(value || 0)
    .toFixed(4)
    .replace(/\.?0+$/, "");
}

function vector(value, fallback = { x: 0, y: 0 }) {
  if (!value || typeof value !== "object") return { ...fallback };
  return {
    x: Number(value.x ?? fallback.x ?? 0),
    y: Number(value.y ?? fallback.y ?? 0),
  };
}

function scaleVector(value, fallbackScale = 1) {
  if (!value || typeof value !== "object") {
    return { x: Number(fallbackScale || 1), y: Number(fallbackScale || 1) };
  }
  return {
    x: Number(value.x ?? fallbackScale ?? 1),
    y: Number(value.y ?? fallbackScale ?? 1),
  };
}

function getPngSize(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
      return { width: 0, height: 0 };
    }
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

function contentHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function attachmentImageSourcePath(project, attachment) {
  const raw = String(attachment?.path || "");
  if (!raw) return "";
  if (path.isAbsolute(raw)) return fs.existsSync(raw) ? raw : "";
  if (raw.startsWith("res://")) {
    const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
    const fullPath = projectRoot ? path.join(projectRoot, raw.slice("res://".length)) : "";
    return fullPath && fs.existsSync(fullPath) ? fullPath : "";
  }
  const fullPath = safeResolve(ROOT, raw);
  return fullPath && fs.existsSync(fullPath) ? fullPath : "";
}

function withFrameAttachmentHash(project, attachment) {
  const next = { ...attachment };
  if (!next.assetHash) {
    const source = attachmentImageSourcePath(project, next);
    if (source) next.assetHash = contentHash(fs.readFileSync(source));
  }
  return next;
}

function normalizeManifest(raw) {
  return normalizeManifestInput(raw, DEFAULT_SUPPORTS);
}

function projectFromRequest(projectId, options = {}) {
  let registry = projectStore.readRegistry();
  const requestedId = projectId ? projectStore.slug(projectId) : "";
  if (
    options.activate &&
    requestedId &&
    registry.projects.some((entry) => entry.id === requestedId) &&
    registry.activeProjectId !== requestedId
  ) {
    registry.activeProjectId = requestedId;
    registry = projectStore.writeRegistry(registry);
  }
  return {
    registry,
    project: projectStore.resolveProject(registry, projectId),
  };
}

/**
 * Resolves exactly the requested project instead of falling back to the active one.
 * @param {string} projectId Required project id.
 * @returns {{registry:object,project:object}} Registry and exact project.
 */
function requiredProjectFromRequest(projectId) {
  if (!String(projectId || "").trim()) throw new HttpError(400, "A project id is required.");
  const registry = projectStore.readRegistry();
  const requestedId = projectStore.slug(projectId);
  const project = registry.projects.find((entry) => entry.id === requestedId);
  if (!project) throw new HttpError(404, `Project not found: ${projectId || "missing id"}`);
  return { registry, project };
}

/**
 * Returns local and Godot paths owned exclusively by one tuner project.
 * @param {object} project Project record.
 * @returns {string[]} Managed paths.
 */
function managedProjectPaths(project) {
  const paths = projectStore.projectPaths(project);
  const result = [paths.dataDir, paths.workspaceDir];
  const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
  if (!projectRoot) return result;
  const syncRoot = path.join(projectRoot, "xsxb_frame_tuner");
  result.push(
    path.join(syncRoot, "data", "projects", project.id),
    path.join(syncRoot, "workspace", "projects", project.id),
    path.join(syncRoot, "audio", "projects", project.id),
    path.join(syncRoot, "attachments", "projects", project.id),
  );
  return result;
}

/**
 * Maps a tuner workspace path to its synchronized Godot mirror.
 * @param {object} project Project record.
 * @param {string} localPath Absolute tuner path.
 * @returns {string} Safe Godot mirror path or an empty string.
 */
function godotMirrorPath(project, localPath) {
  const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
  if (!projectRoot || !localPath) return "";
  const relative = path.relative(ROOT, path.resolve(localPath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return path.join(projectRoot, "xsxb_frame_tuner", relative);
}

/**
 * Clears all local project content while preserving its registry entry and Godot binding.
 * @param {object} project Project record.
 * @returns {Promise<object>} Empty-project synchronization result.
 */
async function clearProjectContent(project) {
  const paths = projectStore.projectPaths(project);
  for (const targetPath of managedProjectPaths(project)) {
    await fs.promises.rm(targetPath, { recursive: true, force: true });
  }
  projectStore.ensureProjectFiles(project);
  projectStore.writeJson(paths.manifest, EMPTY_MANIFEST);
  projectStore.writeJson(paths.tuning, EMPTY_TUNING);
  projectStore.writeJson(paths.frameAudio, []);
  projectStore.writeJson(paths.frameImageAttachments, []);
  projectStore.writeJson(paths.attachmentAssets, []);
  return syncGodotProjectAsync(project, {
    manifest: EMPTY_MANIFEST,
    tuning: EMPTY_TUNING,
    frameAudioBindings: [],
    frameImageAttachments: [],
  });
}

function readManifest(project) {
  projectStore.ensureProjectFiles(project);
  const paths = projectStore.projectPaths(project);
  return normalizeManifest(projectStore.readJson(paths.manifest, EMPTY_MANIFEST));
}

function readTuningFile(project) {
  projectStore.ensureProjectFiles(project);
  const paths = projectStore.projectPaths(project);
  const raw = projectStore.readJson(paths.tuning, EMPTY_TUNING);
  return {
    schemaVersion: Number(raw.schemaVersion || 1),
    values: raw.values && typeof raw.values === "object" ? raw.values : {},
    scene_settings: raw.scene_settings && typeof raw.scene_settings === "object" ? raw.scene_settings : {},
    frame_visual_overrides:
      raw.frame_visual_overrides && typeof raw.frame_visual_overrides === "object"
        ? raw.frame_visual_overrides
        : {},
    frame_playback_overrides:
      raw.frame_playback_overrides && typeof raw.frame_playback_overrides === "object"
        ? raw.frame_playback_overrides
        : {},
    frame_box_overrides:
      raw.frame_box_overrides && typeof raw.frame_box_overrides === "object" ? raw.frame_box_overrides : {},
  };
}

function readFrameAudioBindings(project) {
  projectStore.ensureProjectFiles(project);
  const raw = projectStore.readJson(projectStore.projectPaths(project).frameAudio, []);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([key, value]) => ({
      key,
      ...(value && typeof value === "object" ? value : {}),
    }));
  }
  return [];
}

function readFrameImageAttachments(project) {
  projectStore.ensureProjectFiles(project);
  const raw = projectStore.readJson(projectStore.projectPaths(project).frameImageAttachments, []);
  return Array.isArray(raw)
    ? raw
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => withFrameAttachmentHash(project, entry))
    : [];
}

/**
 * Reads reusable attachment assets for the active project.
 * @param {object} project Project record.
 * @returns {object[]} Persisted image assets.
 */
function readAttachmentAssets(project) {
  projectStore.ensureProjectFiles(project);
  const raw = projectStore.readJson(projectStore.projectPaths(project).attachmentAssets, []);
  return Array.isArray(raw) ? raw.filter((entry) => entry && typeof entry === "object" && entry.path) : [];
}

function tuningForClient(tuningFile) {
  return {
    ...tuningFile.values,
    scene_settings: tuningFile.scene_settings,
    frame_visual_overrides: tuningFile.frame_visual_overrides,
    frame_playback_overrides: tuningFile.frame_playback_overrides,
    frame_box_overrides: tuningFile.frame_box_overrides,
  };
}

function profileForClient(profile) {
  return {
    id: profile.id,
    label: profile.label,
    kind: profile.kind,
    scale_semantic: "character_group_frame",
    anchor_mode: "manifest_anchor_mode",
    supports: profile.supports,
  };
}

function frameForClient(frame, index) {
  const relPath = reslash(frame.path || "");
  const fullPath = safeResolve(ROOT, relPath);
  const size = fullPath && fs.existsSync(fullPath) ? getPngSize(fullPath) : {};
  return {
    id: String(frame.id || `frame_${String(index + 1).padStart(4, "0")}`),
    name: String(frame.name || path.basename(relPath) || `frame_${index + 1}.png`),
    path: relPath,
    duration: Number(frame.duration || 1),
    width: Number(frame.width || size.width || 0),
    height: Number(frame.height || size.height || 0),
  };
}

function buildGroups(manifest, tuningFile) {
  const groups = [];
  for (const profile of manifest.profiles) {
    for (const animation of profile.animations) {
      const animationId = String(animation.id || animation.name || "animation");
      const groupName = String(animation.name || animationId);
      const characterKeyBase = `profiles.${profile.id}.character`;
      const keyBase = `profiles.${profile.id}.groups.${animationId}`;
      const defaultScale = Number(animation.defaultScale ?? 1);
      const frames = (Array.isArray(animation.frames) ? animation.frames : [])
        .map(frameForClient)
        .filter((frame) => frame.path);
      if (!frames.length) continue;
      const characterBaseScale = profile.bodyScale * profile.runtimeScale;
      const characterBaseScaleVector =
        tuningFile.values[`${characterKeyBase}.visual_scale`] ?? profile.defaultScaleVector ?? null;
      groups.push({
        name: groupName,
        animationId,
        runtimeAnimation: `${profile.id}/${animationId}`,
        profileId: profile.id,
        profileLabel: profile.label,
        profileKind: profile.kind,
        profileScaleSemantic: "character_group_frame",
        profileAnchorMode: String(animation.anchorMode || "canvas_bottom_center"),
        profileSupports: Array.isArray(animation.supports) ? animation.supports : profile.supports,
        type: String(animation.type || "actor"),
        tuningTarget: "",
        anchorMode: String(animation.anchorMode || "canvas_bottom_center"),
        sourceAnchor: animation.sourceAnchor ? vector(animation.sourceAnchor) : null,
        scaleSemantic: String(animation.scaleSemantic || ""),
        source: reslash(animation.source || path.dirname(frames[0]?.path || "")),
        speed: Number(animation.fps || animation.defaultFps || 12),
        frames,
        characterScale: `${characterKeyBase}.visual_size`,
        characterScaleVector: `${characterKeyBase}.visual_scale`,
        characterOffset: `${characterKeyBase}.offset`,
        characterRotation: `${characterKeyBase}.rotation`,
        characterBaseScale,
        characterBaseScaleVector,
        characterBaseOffset: tuningFile.values[`${characterKeyBase}.offset`] ??
          profile.defaultOffset ?? { x: 0, y: 0 },
        characterBaseRotation: Number(
          tuningFile.values[`${characterKeyBase}.rotation`] ?? profile.defaultRotation ?? 0,
        ),
        characterBaseSource: profile.runtimeScale !== 1 ? "bodyScale * runtimeScale" : "bodyScale",
        runtimeScale: profile.runtimeScale,
        bodyScale: profile.bodyScale,
        scale: `${keyBase}.visual_size`,
        scaleVector: `${keyBase}.visual_scale`,
        offset: `${keyBase}.offset`,
        rotation: `${keyBase}.rotation`,
        defaultScale,
        defaultScaleVector: animation.defaultScaleVector
          ? scaleVector(animation.defaultScaleVector, defaultScale)
          : null,
        defaultOffset: vector(animation.defaultOffset),
        defaultRotation: Number(animation.defaultRotation || 0),
        baseScale: tuningFile.values[`${keyBase}.visual_size`] ?? defaultScale,
        baseScaleVector: tuningFile.values[`${keyBase}.visual_scale`] ?? animation.defaultScaleVector ?? null,
        baseOffset: tuningFile.values[`${keyBase}.offset`] ?? animation.defaultOffset ?? { x: 0, y: 0 },
        baseRotation: Number(tuningFile.values[`${keyBase}.rotation`] ?? animation.defaultRotation ?? 0),
      });
    }
  }
  return groups;
}

function validateManifest(manifest) {
  const warnings = [];
  for (const profile of Array.isArray(manifest?.profiles) ? manifest.profiles : []) {
    for (const animation of Array.isArray(profile?.animations) ? profile.animations : []) {
      const anchorMode = String(animation.anchorMode || "canvas_bottom_center");
      if (String(profile.kind || "actor").toLowerCase() === "actor" && anchorMode === "canvas_left_bottom") {
        warnings.push(
          `${profile.id}/${animation.id || animation.name}: actor animation uses canvas_left_bottom; use canvas_bottom_center so the character enters tuner/game at the foot-center origin.`,
        );
      }
      for (const [index, frame] of (animation.frames || []).entries()) {
        const relPath = reslash(frame.path || "");
        const fullPath = safeResolve(ROOT, relPath);
        if (!relPath || !fullPath || !fs.existsSync(fullPath)) {
          warnings.push(
            `${profile.id}/${animation.id || animation.name}: missing frame ${index + 1}: ${relPath || "(empty)"}`,
          );
        }
      }
    }
  }
  return warnings;
}

function validateCharacterScaleValues(project, manifest) {
  const warnings = [];
  if (!manifestHasRuntimeAnimations(manifest)) return warnings;
  const paths = projectStore.projectPaths(project);
  const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
  const values = tuning?.values && typeof tuning.values === "object" ? tuning.values : {};
  for (const profile of Array.isArray(manifest?.profiles) ? manifest.profiles : []) {
    const scaleKey = `profiles.${profile.id}.character.visual_size`;
    const vectorKey = `profiles.${profile.id}.character.visual_scale`;
    const scale = Number(values[scaleKey] ?? profile.bodyScale ?? 1);
    const vector = values[vectorKey];
    if (vector && typeof vector === "object") {
      const x = Number(vector.x);
      const y = Number(vector.y);
      if (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Math.abs(x - y) <= 0.0001 &&
        Number.isFinite(scale) &&
        Math.abs(x - scale) > 0.0001
      ) {
        warnings.push(
          `${profile.id}: uniform character visual_scale (${x}) overrides visual_size (${scale}); remove visual_scale or make it match visual_size.`,
        );
      }
    }
    const firstFrame = (profile.animations || []).flatMap((animation) => animation.frames || [])[0];
    const frameHeight = Number(firstFrame?.height || 0);
    if (frameHeight >= 512 && Number.isFinite(scale) && scale >= 0.75) {
      warnings.push(
        `${profile.id}: imported actor uses a large source canvas (${frameHeight}px high) with character visual_size ${scale}; initialize it from the scene actor/viewport height instead of 1:1 pixels.`,
      );
    }
  }
  return warnings;
}

function validateProject(project, manifest) {
  const inspection = createProjectInspection(project?.projectRoot);
  return [
    ...validateManifest(manifest),
    ...validateCharacterScaleValues(project, manifest),
    ...validateGdscriptTypeInference(project?.projectRoot, inspection),
    ...validateRuntimeBindingReaders(project, manifest, inspection),
    ...validateRuntimeSceneUsage(project, manifest, inspection),
    ...validateGameLocalBindingKeys(project),
  ];
}

function scheduleServerRestart() {
  if (restartScheduled) return;
  restartScheduled = true;
  const timer = setTimeout(() => {
    server.close(() => {
      const child = spawn(process.execPath, [__filename], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT) },
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      process.exit(0);
    });
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
    const forceClose = setTimeout(() => {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    }, 2500);
    forceClose.unref();
  }, 600);
  timer.unref();
}

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST") {
      validateWriteRequest(req);
    }
    if (req.method === "GET" && parsed.pathname === "/api/activation") {
      return send(res, 200, activationService.status(req));
    }
    if (req.method === "POST" && parsed.pathname === "/api/activation") {
      const payload = await readJsonBody(req, parsed.pathname);
      const result = activationService.activate(payload.code);
      if (!result.ok) {
        return send(res, result.status, {
          activated: false,
          configured: activationService.status(req).configured,
          error: result.error,
        });
      }
      res.setHeader("set-cookie", activationService.cookieHeader(result.token, req));
      return send(res, 200, {
        activated: true,
        configured: true,
        expiresAt: result.expiresAt,
      });
    }
    if (req.method === "GET" && parsed.pathname === "/api/update-status") {
      return send(res, 200, {
        ...(await checkForUpdates(ROOT)),
        token: UPDATE_TOKEN,
        restarting: restartScheduled,
      });
    }
    if (req.method === "POST" && parsed.pathname === "/api/update") {
      if (req.headers["x-xsxb-update-token"] !== UPDATE_TOKEN) {
        return send(res, 403, { error: "Invalid update token." });
      }
      if (restartScheduled) return send(res, 409, { error: "A tuner restart is already scheduled." });
      const update = await performUpdate(ROOT);
      res.setHeader("connection", "close");
      send(res, 200, { ok: true, update });
      scheduleServerRestart();
      return;
    }
    if (await handleProjectRoute(req, res, parsed)) return;
    if (req.method === "POST" && parsed.pathname === "/api/segment-subject") {
      const payload = await readJsonBody(req, parsed.pathname);
      try {
        return send(res, 200, { imageDataUrl: await segmentSubject(payload.imageDataUrl) });
      } catch (error) {
        return send(res, 422, { error: error?.message || "Subject segmentation failed." });
      }
    }
    if (req.method === "GET" && parsed.pathname === "/api/config") {
      return send(res, 200, configResponse(parsed.searchParams.get("project")));
    }
    if (req.method === "POST" && parsed.pathname === "/api/save") {
      const payload = await readJsonBody(req, parsed.pathname);
      premiumAuthorizer.assertAuthorized(req, parsed.pathname, payload);
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      return await withProjectWrite(project.id, async () => {
        const currentRevision = projectDataRevision(project);
        const baseRevision = String(payload.baseRevision || "");
        if (baseRevision && baseRevision !== currentRevision) {
          return send(res, 409, {
            error:
              "Project data changed in another window. Reload before saving to avoid overwriting newer work.",
            code: "revision_conflict",
            dataRevision: currentRevision,
          });
        }
        const transaction = await createFilesystemSnapshot(saveTransactionPaths(project));
        try {
          saveTuningPayload(payload, project);
          let frameAudioBindings = null;
          if (
            Array.isArray(payload.frame_audio_bindings) ||
            Array.isArray(payload.frameAudioBindings) ||
            payload.frameAudioBindings
          ) {
            frameAudioBindings = saveFrameAudioBindings(
              payload.frame_audio_bindings || payload.frameAudioBindings,
              project,
            );
          }
          let frameImageAttachments = null;
          if (
            Array.isArray(payload.frame_image_attachments) ||
            Array.isArray(payload.frameImageAttachments)
          ) {
            frameImageAttachments = saveFrameImageAttachments(
              payload.frame_image_attachments || payload.frameImageAttachments,
              project,
            );
          }
          const godotSync = await syncGodotProjectAsync(project, {
            ...(frameAudioBindings ? { frameAudioBindings } : {}),
            ...(frameImageAttachments ? { frameImageAttachments } : {}),
          });
          const changedRuntimeProjectIdFiles = syncGodotRuntimeProjectId(project);
          const dataRevision = projectDataRevision(project);
          await transaction.dispose();
          return send(res, 200, {
            ok: true,
            tuning: tuningForClient(readTuningFile(project)),
            godotSync,
            runtimeProjectIdFiles: changedRuntimeProjectIdFiles,
            dataRevision,
            warnings: validateProject(project, readManifest(project)),
          });
        } catch (error) {
          try {
            await transaction.restore();
          } catch (rollbackError) {
            await transaction.dispose();
            throw new AggregateError(
              [error, rollbackError],
              "Save failed and filesystem rollback was incomplete.",
            );
          }
          await transaction.dispose();
          throw error;
        }
      });
    }
    if (await handleMediaRoute(req, res, parsed)) return;
    if (req.method === "GET" && parsed.pathname === "/asset") {
      const relPath = parsed.searchParams.get("path");
      const full = safeResolve(ROOT, relPath);
      const ext = path.extname(full || "").toLowerCase();
      const imageTypes = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
      };
      if (!full || !fs.existsSync(full) || !imageTypes[ext]) {
        return send(res, 404, "Not found", "text/plain");
      }
      res.writeHead(200, { "content-type": imageTypes[ext], "cache-control": "no-store" });
      return fs.createReadStream(full).pipe(res);
    }
    return serveStatic(req, res, parsed.pathname);
  } catch (error) {
    console.error(error);
    send(res, Number(error.status || 500), { error: String(error.message || error) });
    return undefined;
  }
});

server.on("clientError", (error, socket) => {
  console.error("HTTP client connection error:", error.message);
  if (socket.destroyed) return;
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

/**
 * Reports startup failures without emitting Node's unhandled EventEmitter stack trace.
 * @param {NodeJS.ErrnoException} error Server startup error.
 * @returns {void}
 */
function handleServerStartupError(error) {
  if (error.code === "EADDRINUSE") {
    console.error(`XSXB Frame Tuner is already running, or port ${PORT} is occupied.`);
    console.error(`Open http://127.0.0.1:${PORT}, or start another instance with PORT=5180 npm start.`);
    process.exitCode = 1;
    return;
  }
  console.error(`Unable to start XSXB Frame Tuner on ${HOST}:${PORT}:`, error.message);
  process.exitCode = 1;
}

server.on("error", handleServerStartupError);

server.listen(PORT, HOST, () => {
  console.log(`XSXB Frame Tuner running at http://${HOST}:${PORT}`);
  console.log(`Workspace root: ${ROOT}`);
});
