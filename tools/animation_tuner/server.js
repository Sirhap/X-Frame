const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { EMPTY_MANIFEST, EMPTY_TUNING, createProjectStore, reslash } = require("../project_store");
const { importAnimation, reorganizeAnimation } = require("../frame_organizer");
const { deleteAnimation } = require("../animation_mutations");
const { createProjectInspection } = require("../project_inspection");
const { createGodotHandoffService } = require("../godot_handoff");
const {
  EMPTY_ATTACK_TRAILS,
  normalizeAttackTrails,
  pngInfo,
  saveAttackTrailTexture,
  validateAttackTrails,
} = require("../attack_trails");
const {
  clearExportedPetTuning,
  ensureCodexPetsProject,
  exportCodexPet,
  importCodexPet,
  removeCustomCodexPet,
  restoreCodexPetBackup,
  restoreRemovedCodexPet,
  syncCodexPetProject,
} = require("../codex_pets");
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
const { createMediaExportService } = require("./server_media_export");
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
const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;
const SAVE_BODY_LIMIT = 64 * 1024 * 1024;
const MEDIA_BODY_LIMIT = 96 * 1024 * 1024;
const MEDIA_ROUTES = new Set([
  "/api/segment-subject",
  "/api/attachment-assets",
  "/api/frame-attachment-image",
  "/api/attack-trail-texture",
  "/api/codex-pets/import",
  "/api/codex-pets/remove",
  "/api/codex-pets/restore",
  "/api/codex-pets/restore-backup",
  "/api/import-animation",
  "/api/replace-animation",
  "/api/replace-frame",
  "/api/reorganize-animation",
  "/api/media-export/jobs",
  "/api/media-export/frame",
  "/api/media-export/finish",
  "/api/media-export/cancel",
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
  landingDocument: "animation_factory.html",
  documentRoutes: Object.freeze({ "/tools/scatter-slice": "scatter-slice.html" }),
  safeResolve,
  send,
});
const mediaExportService = createMediaExportService({ root: ROOT });
const activationService = createActivationService({
  codeHashes: process.env.XSXB_ACTIVATION_CODE_HASHES || "",
  secret: process.env.XSXB_ACTIVATION_SECRET || "",
});
const premiumAuthorizer = createPremiumAuthorizer({ activationService, HttpError });
const {
  withProjectWrite,
  syncGodotProjectAsync: syncGodotProjectWorkerAsync,
  syncFrameAudioAsync,
  projectDataRevision,
  createFilesystemSnapshot,
  rollbackFilesystemSnapshot,
  runtimeProjectIdFiles,
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
let godotHandoffService;
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
  readAttackTrails,
  emptyAttackTrails: EMPTY_ATTACK_TRAILS,
  syncCodexPetProject,
  projectDataRevision,
  godotHandoffForProject: (project) => godotHandoffService.status(project),
  fs,
  path,
  relativeProjectPath,
});

godotHandoffService = createGodotHandoffService({
  root: ROOT,
  projectStore,
  projectDataRevision,
  syncGodotProjectAsync: syncGodotProjectWorkerAsync,
  syncGodotRuntimeProjectId,
  runtimeProjectIdFiles,
  createFilesystemSnapshot,
  validateProject,
  readManifest,
  fs,
  path,
});

/**
 * Synchronizes Godot and records a receipt for every mutation path using the shared worker.
 * @param {object} project Project record.
 * @param {object} [options] Synchronization inputs.
 * @returns {Promise<object>} Existing Godot synchronization response.
 */
async function syncGodotProjectAsync(project, options = {}) {
  try {
    const result = await syncGodotProjectWorkerAsync(project, options);
    godotHandoffService.markSynced(project, result);
    return result;
  } catch (error) {
    godotHandoffService.markSyncFailed(project, error);
    throw error;
  }
}

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
  godotHandoffService,
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
  godotHandoffService,
});

function ensureDataFiles() {
  ensureCodexPetsProject(projectStore);
}

const CODEX_PET_LIFECYCLE_ROUTES = new Map([
  ["/api/codex-pets/remove", { operation: removeCustomCodexPet, resultKey: "removed" }],
  ["/api/codex-pets/restore", { operation: restoreRemovedCodexPet, resultKey: "restored" }],
  ["/api/codex-pets/restore-backup", { operation: restoreCodexPetBackup, resultKey: "restoredBackup" }],
]);

/**
 * Handles recoverable custom-pet lifecycle mutations under the project write lock.
 * @param {import("node:http").IncomingMessage} request Incoming request.
 * @param {import("node:http").ServerResponse} response Outgoing response.
 * @param {URL} parsed Parsed request URL.
 * @returns {Promise<boolean>} Whether a lifecycle route handled the request.
 */
async function handleCodexPetLifecycleRoute(request, response, parsed) {
  const route = request.method === "POST" ? CODEX_PET_LIFECYCLE_ROUTES.get(parsed.pathname) : null;
  if (!route) return false;
  const payload = await readJsonBody(request, parsed.pathname);
  const { project } = requiredProjectFromRequest(payload.projectId || parsed.searchParams.get("project"));
  await withProjectWrite(project.id, async () => {
    try {
      const result = await route.operation(projectStore, project, payload);
      let petSync;
      try {
        petSync = syncCodexPetProject(ROOT, projectStore, project);
      } catch (error) {
        return send(response, 500, {
          ok: false,
          operationApplied: true,
          [route.resultKey]: result,
          error: `The pet lifecycle operation completed, but project refresh failed: ${String(error?.message || error)}`,
          code: "codex_pet_sync_failed",
        });
      }
      return send(response, 200, {
        ok: true,
        [route.resultKey]: result,
        petCount: petSync.pets.length,
        warnings: petSync.warnings,
      });
    } catch (error) {
      if (!Number.isInteger(error?.status)) throw error;
      return send(response, Number(error.status), {
        ok: false,
        error: String(error.message || error),
        ...(error.code ? { code: String(error.code) } : {}),
      });
    }
  });
  return true;
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
    path.join(syncRoot, "attack_trails", "projects", project.id),
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
  projectStore.writeJson(paths.attackTrails, EMPTY_ATTACK_TRAILS);
  return syncGodotProjectAsync(project, {
    manifest: EMPTY_MANIFEST,
    tuning: EMPTY_TUNING,
    frameAudioBindings: [],
    frameImageAttachments: [],
    attackTrails: EMPTY_ATTACK_TRAILS,
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
 * Reads normalized attack-trail bindings for a Godot project.
 * @param {object} project Project descriptor.
 * @returns {object} Canonical attack-trail document.
 */
function readAttackTrails(project) {
  if (project?.kind === "codex_pets") return EMPTY_ATTACK_TRAILS;
  projectStore.ensureProjectFiles(project);
  return normalizeAttackTrails(
    projectStore.readJson(projectStore.projectPaths(project).attackTrails, EMPTY_ATTACK_TRAILS),
  );
}

/**
 * Validates and persists attack-trail bindings.
 * @param {unknown} payload Client trail document.
 * @param {object} project Project descriptor.
 * @returns {object} Persisted canonical trail document.
 */
function saveAttackTrails(payload, project) {
  if (project?.kind === "codex_pets") return EMPTY_ATTACK_TRAILS;
  const trails = normalizeAttackTrails(payload);
  for (const [key, segments] of Object.entries(trails.bindings)) {
    for (const segment of segments) {
      const texturePath = safeResolve(ROOT, segment.texture?.path || "");
      if (texturePath && fs.existsSync(texturePath)) {
        const info = pngInfo(fs.readFileSync(texturePath));
        Object.assign(segment.texture, info);
      }
      if (segment.colorMode === "original" && !segment.texture?.hasEffectiveAlpha) {
        throw new HttpError(
          400,
          `${key}/${segment.id}: original-color trails require a PNG with effective alpha.`,
        );
      }
    }
  }
  projectStore.writeJson(projectStore.projectPaths(project).attackTrails, trails);
  return trails;
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
    pet: profile.pet && typeof profile.pet === "object" ? profile.pet : null,
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
    crop: frame.crop && typeof frame.crop === "object" ? { ...frame.crop } : null,
    assetVersion: String(frame.assetVersion || ""),
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
        profilePet: profile.pet || null,
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
  if (project?.kind === "codex_pets") return validateManifest(manifest);
  const inspection = createProjectInspection(project?.projectRoot);
  return [
    ...validateManifest(manifest),
    ...validateAttackTrails(readAttackTrails(project), manifest),
    ...validateCharacterScaleValues(project, manifest),
    ...validateGdscriptTypeInference(project?.projectRoot, inspection),
    ...validateRuntimeBindingReaders(project, manifest, inspection),
    ...validateRuntimeSceneUsage(project, manifest, inspection),
    ...validateGameLocalBindingKeys(project),
  ];
}

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST") {
      validateWriteRequest(req);
    }
    if (req.method === "GET" && parsed.pathname === "/api/media-export/capabilities") {
      return send(res, 200, await mediaExportService.capabilities());
    }
    if (req.method === "GET" && parsed.pathname === "/api/media-export/status") {
      return send(res, 200, mediaExportService.status(parsed.searchParams.get("job")));
    }
    if (req.method === "GET" && parsed.pathname === "/api/media-export/file") {
      const output = mediaExportService.outputFile(
        parsed.searchParams.get("job"),
        parsed.searchParams.get("name"),
      );
      res.writeHead(200, {
        "content-type": output.contentType,
        "content-length": output.size,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(output.filename))}`,
        "cache-control": "no-store",
      });
      const outputStream = fs.createReadStream(output.filename);
      outputStream.on("error", (error) => {
        console.error("Media export download failed:", error);
        if (!res.destroyed) res.destroy(error);
      });
      res.on("close", () => outputStream.destroy());
      return outputStream.pipe(res);
    }
    if (req.method === "POST" && parsed.pathname === "/api/media-export/jobs") {
      return send(res, 201, mediaExportService.createJob(await readJsonBody(req, parsed.pathname)));
    }
    if (req.method === "POST" && parsed.pathname === "/api/media-export/frame") {
      return send(res, 200, mediaExportService.uploadFrame(await readJsonBody(req, parsed.pathname)));
    }
    if (req.method === "POST" && parsed.pathname === "/api/media-export/finish") {
      return send(res, 202, mediaExportService.finishJob(await readJsonBody(req, parsed.pathname)));
    }
    if (req.method === "POST" && parsed.pathname === "/api/media-export/cancel") {
      return send(res, 200, mediaExportService.cancel(await readJsonBody(req, parsed.pathname)));
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
    if (await handleProjectRoute(req, res, parsed)) return;
    if (req.method === "POST" && parsed.pathname === "/api/codex-pets/import") {
      const payload = await readJsonBody(req, parsed.pathname);
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      const imported = importCodexPet(project, payload);
      syncCodexPetProject(ROOT, projectStore, project);
      return send(res, 200, { ok: true, imported });
    }
    if (await handleCodexPetLifecycleRoute(req, res, parsed)) return;
    if (req.method === "POST" && parsed.pathname === "/api/attack-trail-texture") {
      const payload = await readJsonBody(req, parsed.pathname);
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      if (project?.kind === "codex_pets")
        throw new HttpError(400, "Codex Pets projects do not support attack trails.");
      return send(res, 200, {
        ok: true,
        texture: saveAttackTrailTexture(ROOT, projectStore, project, payload),
      });
    }
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
        const projectPaths = projectStore.projectPaths(project);
        const localSavePaths = [
          projectPaths.tuning,
          projectPaths.frameAudio,
          projectPaths.frameImageAttachments,
          projectPaths.attackTrails,
        ].filter(Boolean);
        const localPathSet = new Set(localSavePaths.map((entry) => path.resolve(entry)));
        const externalSavePaths = saveTransactionPaths(project).filter(
          (entry) => !localPathSet.has(path.resolve(entry)),
        );
        const localTransaction = await createFilesystemSnapshot(localSavePaths);
        const externalTransaction = await createFilesystemSnapshot(externalSavePaths);
        let localSaved = false;
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
          const attackTrails = saveAttackTrails(
            payload.attack_trails || payload.attackTrails || EMPTY_ATTACK_TRAILS,
            project,
          );
          const codexPetExports = [];
          if (project.kind === "codex_pets") {
            for (const entry of Array.isArray(payload.codex_pet_exports) ? payload.codex_pet_exports : []) {
              codexPetExports.push(exportCodexPet(projectStore, project, entry));
            }
            clearExportedPetTuning(
              projectStore,
              project,
              codexPetExports.map((entry) => entry.profileId),
            );
            syncCodexPetProject(ROOT, projectStore, project);
          }
          localSaved = true;
          const godotSync = await syncGodotProjectAsync(project, {
            ...(frameAudioBindings ? { frameAudioBindings } : {}),
            ...(frameImageAttachments ? { frameImageAttachments } : {}),
            attackTrails,
          });
          const changedRuntimeProjectIdFiles = syncGodotRuntimeProjectId(project);
          const dataRevision = projectDataRevision(project);
          await localTransaction.dispose();
          await externalTransaction.dispose();
          return send(res, 200, {
            ok: true,
            tuning: tuningForClient(readTuningFile(project)),
            godotSync,
            godotHandoff: godotHandoffService.status(project),
            runtimeProjectIdFiles: changedRuntimeProjectIdFiles,
            codexPetExports,
            dataRevision,
            warnings: validateProject(project, readManifest(project)),
          });
        } catch (error) {
          if (localSaved) {
            try {
              await externalTransaction.restore();
            } catch (rollbackError) {
              await localTransaction.dispose();
              await externalTransaction.dispose();
              throw new AggregateError(
                [error, rollbackError],
                "Godot synchronization failed and external rollback was incomplete.",
              );
            }
            godotHandoffService.markSyncFailed(project, error);
            await localTransaction.dispose();
            await externalTransaction.dispose();
            return send(res, 500, {
              ok: false,
              localSaved: true,
              error: String(error?.message || error),
              godotSync: { ok: false, reason: String(error?.message || error) },
              godotHandoff: godotHandoffService.status(project),
              dataRevision: projectDataRevision(project),
            });
          }
          try {
            await localTransaction.restore();
            await externalTransaction.restore();
          } catch (rollbackError) {
            await localTransaction.dispose();
            await externalTransaction.dispose();
            throw new AggregateError(
              [error, rollbackError],
              "Save failed and filesystem rollback was incomplete.",
            );
          }
          await localTransaction.dispose();
          await externalTransaction.dispose();
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

server.on("close", () => mediaExportService.dispose());

server.listen(PORT, HOST, () => {
  console.log(`XSXB Frame Tuner running at http://${HOST}:${PORT}`);
  console.log(`Workspace root: ${ROOT}`);
});
