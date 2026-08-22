"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createProjectStore, reslash, slug } = require("./project_store");
const { syncGodotProject, validGodotProjectRoot } = require("./godot_sync");
const {
  buildOneToOneSequencePlan,
  sortSequenceAssets,
} = require("./animation_tuner/public/app_attachment_sequence");
const {
  analyzePngAlpha,
  recommendSpatialTransform,
  selectSequenceAssets,
} = require("./attachment_sequence_analysis");

const PLAN_SCHEMA_VERSION = 1;
const DEFAULT_TRANSFORM = Object.freeze({
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  offset: Object.freeze({ x: 0, y: 0 }),
  rotation: 0,
});

/**
 * Creates a detached JSON-compatible copy.
 * @param {unknown} value Source value.
 * @returns {unknown} Cloned value.
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Computes a SHA-256 digest for bytes or text.
 * @param {Buffer|string} value Source value.
 * @returns {string} Hex digest.
 */
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Computes a file content digest.
 * @param {string} filePath Source file.
 * @returns {string} Hex digest.
 */
function fileHash(filePath) {
  return sha256(fs.readFileSync(filePath));
}

/**
 * Reads PNG dimensions without decoding pixel data.
 * @param {string} filePath PNG path.
 * @returns {{width:number,height:number}} Dimensions.
 */
function pngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error(`Invalid PNG attachment: ${filePath}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1) throw new Error(`Invalid PNG dimensions: ${filePath}`);
  return { width, height };
}

/**
 * Resolves a child path while preventing directory traversal.
 * @param {string} base Allowed base directory.
 * @param {string} requested Requested child path.
 * @returns {string|null} Safe path or null.
 */
function safeResolve(base, requested) {
  const resolvedBase = path.resolve(base);
  const candidate = path.resolve(resolvedBase, String(requested || ""));
  return candidate === resolvedBase || candidate.startsWith(`${resolvedBase}${path.sep}`) ? candidate : null;
}

/**
 * Resolves a persisted attachment path to an existing local file.
 * @param {string} root Tuner root.
 * @param {object} project Project descriptor.
 * @param {string} assetPath Persisted or absolute path.
 * @returns {string} Existing absolute path.
 */
function resolveAssetFile(root, project, assetPath) {
  const raw = String(assetPath || "");
  const candidates = [];
  if (raw.startsWith("res://") && project.projectRoot) {
    candidates.push(path.resolve(project.projectRoot, raw.slice("res://".length)));
  } else if (path.isAbsolute(raw)) {
    candidates.push(path.resolve(raw));
  } else {
    const tunerPath = safeResolve(root, raw);
    if (tunerPath) candidates.push(tunerPath);
    if (project.projectRoot) candidates.push(path.resolve(project.projectRoot, raw));
  }
  const resolved = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
  if (!resolved) throw new Error(`Attachment file not found: ${assetPath}`);
  return resolved;
}

/**
 * Computes the same project JSON revision boundary used for optimistic saves.
 * @param {object} projectStore Project store.
 * @param {object} project Project descriptor.
 * @returns {string} Revision digest.
 */
function projectDataRevision(projectStore, project) {
  projectStore.ensureProjectFiles(project);
  const paths = projectStore.projectPaths(project);
  const hash = crypto.createHash("sha256");
  for (const filePath of [
    paths.manifest,
    paths.tuning,
    paths.frameAudio,
    paths.frameImageAttachments,
    paths.attachmentAssets,
  ]) {
    hash.update(path.basename(filePath));
    hash.update(fs.readFileSync(filePath));
  }
  return hash.digest("hex");
}

/**
 * Resolves an exact project instead of silently falling back to the active project.
 * @param {object} projectStore Project store.
 * @param {string} requestedId Requested project id, or empty for active.
 * @returns {object} Project descriptor.
 */
function resolveProject(projectStore, requestedId) {
  const registry = projectStore.readRegistry();
  const projectId = requestedId ? slug(requestedId) : registry.activeProjectId;
  const project = registry.projects.find((entry) => entry.id === projectId);
  if (!project) throw new Error(`Project not found: ${projectId || "(active project)"}`);
  projectStore.ensureProjectFiles(project);
  return project;
}

/**
 * Resolves an exact profile and animation from a manifest.
 * @param {object} manifest Animation manifest.
 * @param {string} profileId Profile id.
 * @param {string} animationId Animation id or name.
 * @returns {{profile:object,animation:object,animationId:string,frames:object[]}} Target records.
 */
function resolveAnimation(manifest, profileId, animationId) {
  const profiles = Array.isArray(manifest?.profiles) ? manifest.profiles : [];
  const profile = profiles.find((entry) => String(entry.id) === String(profileId));
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  const animations = Array.isArray(profile.animations) ? profile.animations : [];
  const animation = animations.find(
    (entry) =>
      String(entry.id || entry.name) === String(animationId) || String(entry.name) === String(animationId),
  );
  if (!animation) throw new Error(`Animation not found: ${profileId}/${animationId}`);
  const frames = Array.isArray(animation.frames) ? animation.frames : [];
  if (!frames.length) throw new Error(`Animation has no frames: ${profileId}/${animationId}`);
  return {
    profile,
    animation,
    animationId: String(animation.id || animation.name || animationId),
    frames,
  };
}

/**
 * Parses a one-based frame selection such as "1-4,7".
 * @param {string|number[]|undefined} value Selection value.
 * @param {number} frameCount Available frame count.
 * @returns {number[]} Sorted zero-based frame indexes.
 */
function parseFrameSelection(value, frameCount) {
  if (Array.isArray(value)) {
    const indexes = Array.from(new Set(value.map(Number))).sort((left, right) => left - right);
    if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= frameCount)) {
      throw new Error(`Frame selection must stay between 1 and ${frameCount}.`);
    }
    return indexes;
  }
  const text = String(value || "all")
    .trim()
    .toLowerCase();
  if (text === "all") return Array.from({ length: frameCount }, (_, index) => index);
  const indexes = new Set();
  for (const segment of text.split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(segment.trim());
    if (!match) throw new Error(`Invalid frame selection: ${value}`);
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > frameCount) {
      throw new Error(`Frame selection must stay between 1 and ${frameCount}.`);
    }
    for (let frame = start; frame <= end; frame += 1) indexes.add(frame - 1);
  }
  return [...indexes].sort((left, right) => left - right);
}

/**
 * Creates a normalized asset descriptor backed by a local file.
 * @param {object} asset Persisted or planned asset.
 * @param {string} sourcePath Absolute source path.
 * @param {string} groupKey Target group key.
 * @param {boolean} registered Whether the asset already exists in the library.
 * @returns {object} Planned asset descriptor.
 */
function plannedAsset(asset, sourcePath, groupKey, registered) {
  const digest = fileHash(sourcePath);
  const size = pngSize(sourcePath);
  if (asset.assetHash && String(asset.assetHash) !== digest) {
    throw new Error(`Attachment hash mismatch: ${asset.name || sourcePath}`);
  }
  return {
    id: String(asset.id || `asset_${sha256(`${groupKey}:${digest}`).slice(0, 32)}`),
    name: String(asset.name || path.basename(sourcePath)),
    path: String(asset.path || ""),
    sourcePath,
    assetHash: digest,
    type: "image/png",
    width: size.width,
    height: size.height,
    groupKey,
    registered,
  };
}

/**
 * Selects existing library assets or discovers a local PNG folder.
 * @param {object} input Asset selection input.
 * @returns {object[]} Naturally ordered planned assets.
 */
function selectAssets({ root, projectStore, project, selector, groupKey }) {
  const paths = projectStore.projectPaths(project);
  const library = projectStore.readJson(paths.attachmentAssets, []);
  const assets = Array.isArray(library) ? library.filter((entry) => entry?.path) : [];
  const requested = String(selector || "group").trim();
  const folder = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root, requested);
  if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
    const byHash = new Map(
      assets
        .filter((asset) => asset.assetHash && asset.groupKey === groupKey)
        .map((asset) => [asset.assetHash, asset]),
    );
    const files = fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".png")
      .map((entry) => path.join(folder, entry.name));
    if (!files.length) throw new Error(`No PNG attachment assets found in ${folder}`);
    return sortSequenceAssets(
      files.map((sourcePath) => {
        const digest = fileHash(sourcePath);
        const existing = byHash.get(digest);
        const targetPath =
          existing?.path ||
          reslash(
            path.relative(
              root,
              path.join(projectStore.projectWorkspaceDir(project), "attachments", `${digest}.png`),
            ),
          );
        return plannedAsset(
          { ...(existing || {}), name: path.basename(sourcePath), path: targetPath, assetHash: digest },
          sourcePath,
          groupKey,
          Boolean(existing),
        );
      }),
    );
  }

  let selected = [];
  if (requested === "group") selected = assets.filter((asset) => asset.groupKey === groupKey);
  else if (requested === "all") selected = assets;
  else if (requested.startsWith("group:")) {
    selected = assets.filter((asset) => asset.groupKey === requested.slice("group:".length));
  } else if (requested.startsWith("ids:")) {
    const ids = new Set(
      requested
        .slice("ids:".length)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    selected = assets.filter((asset) => ids.has(String(asset.id)));
    if (selected.length !== ids.size)
      throw new Error("One or more requested attachment asset IDs were not found.");
  } else {
    throw new Error(`Unknown asset selector or folder: ${requested}`);
  }
  if (!selected.length) throw new Error(`No attachment assets matched: ${requested}`);
  return sortSequenceAssets(
    selected.map((asset) => plannedAsset(asset, resolveAssetFile(root, project, asset.path), groupKey, true)),
  );
}

/**
 * Builds the browser-compatible attachment key and metadata for one frame.
 * @param {object} project Project descriptor.
 * @param {object} profile Profile record.
 * @param {object} animation Animation record.
 * @param {string} animationId Stable animation id.
 * @param {number} frameIndex Zero-based frame index.
 * @returns {{key:string,metadata:object}} Binding identity.
 */
function frameBinding(project, profile, animation, animationId, frameIndex) {
  const source = reslash(animation.source || path.dirname(animation.frames?.[0]?.path || ""));
  const groupName = String(animation.name || animationId);
  const groupType = String(animation.type || "actor");
  const metadata = {
    projectId: project.id,
    tuningTarget: "player",
    profileId: String(profile.id),
    groupType,
    animation: `${profile.id}/${animationId}`,
    source,
    frame: frameIndex,
    displayFrame: frameIndex,
  };
  return {
    key: [project.id, "player", profile.id, groupType, groupName, source, frameIndex].join(":"),
    metadata,
  };
}

/**
 * Finds the next positive attachment layer for one frame.
 * @param {object[]} attachments Existing attachments.
 * @param {string} key Target frame key.
 * @returns {number} Positive layer order.
 */
function nextLayerOrder(attachments, key) {
  return (
    attachments
      .filter((attachment) => String(attachment.key || attachment.frameKey || "") === key)
      .reduce((maximum, attachment) => Math.max(maximum, Number(attachment.layerOrder) || 0), 0) + 1
  );
}

/**
 * Builds a deterministic, non-mutating attachment plan.
 * Strict mapping remains the default; resampling and spatial recommendations
 * must be explicitly requested and always require visual review.
 * @param {{root:string,projectId?:string,profileId:string,animationId:string,assets?:string,frames?:string|number[],strategy?:string,spatial?:string,direction?:string}} options Plan options.
 * @returns {object} Serializable alignment plan.
 */
function createAlignmentPlan(options) {
  const root = path.resolve(options.root);
  const projectStore = createProjectStore(root);
  const project = resolveProject(projectStore, options.projectId);
  const paths = projectStore.projectPaths(project);
  const manifest = projectStore.readJson(paths.manifest, { profiles: [] });
  const { profile, animation, animationId, frames } = resolveAnimation(
    manifest,
    options.profileId,
    options.animationId,
  );
  const groupKey = `${profile.id}/${animationId}`;
  const frameIndexes = parseFrameSelection(options.frames, frames.length);
  const assets = selectAssets({
    root,
    projectStore,
    project,
    selector: options.assets,
    groupKey,
  });
  const mappingStrategy = String(options.strategy || "strict").toLowerCase();
  const spatialMode = String(options.spatial || "identity").toLowerCase();
  const direction = String(options.direction || "auto").toLowerCase();
  if (!new Set(["identity", "auto"]).has(spatialMode)) {
    throw new Error(`Unknown attachment spatial mode: ${spatialMode}`);
  }
  const selection = selectSequenceAssets({
    assets,
    targetCount: frameIndexes.length,
    strategy: mappingStrategy,
  });
  const sequence = buildOneToOneSequencePlan({
    assets: selection.assets,
    frameIndexes,
    ownerFrames: frames,
  });
  if (!sequence.ok) {
    throw new Error(
      `Unsafe one-to-one mapping (${sequence.code}): ${sequence.assetCount} assets for ${sequence.frameCount} frames.`,
    );
  }
  const attachments = projectStore.readJson(paths.frameImageAttachments, []);
  const baseRevision = projectDataRevision(projectStore, project);
  const identity = {
    projectId: project.id,
    profileId: String(profile.id),
    animationId,
    groupKey,
  };
  const planSeed = {
    identity,
    baseRevision,
    mappingStrategy,
    spatialMode,
    direction,
    sourceIndexes: selection.sourceIndexes,
    mappings: sequence.entries.map((entry) => [entry.frameIndex, entry.asset.assetHash]),
  };
  const planId = `align_${sha256(JSON.stringify(planSeed)).slice(0, 24)}`;
  const entries = sequence.entries.map((entry) => {
    const binding = frameBinding(project, profile, animation, animationId, entry.frameIndex);
    const entryId = `${planId}:${entry.sequenceIndex}`;
    let transform = clone(DEFAULT_TRANSFORM);
    let spatialRecommendation = null;
    if (spatialMode === "auto") {
      const ownerPath = resolveAssetFile(root, project, frames[entry.frameIndex]?.path);
      spatialRecommendation = recommendSpatialTransform({
        owner: analyzePngAlpha(ownerPath),
        attachment: analyzePngAlpha(entry.asset.sourcePath),
        direction,
      });
      transform = clone(spatialRecommendation.transform);
    }
    return {
      entryId,
      instanceId: `layer_auto_${sha256(entryId).slice(0, 24)}`,
      sequenceIndex: entry.sequenceIndex,
      frameIndex: entry.frameIndex,
      displayFrame: entry.frameIndex + 1,
      frameId: String(frames[entry.frameIndex]?.id || ""),
      framePath: String(frames[entry.frameIndex]?.path || ""),
      key: binding.key,
      metadata: binding.metadata,
      asset: clone(entry.asset),
      canvasCompatibility: entry.canvasCompatibility,
      layer: "above",
      layerOrder: nextLayerOrder(Array.isArray(attachments) ? attachments : [], binding.key),
      transform,
      alignment: {
        mappingStrategy,
        sourceAssetFrame: selection.sourceIndexes[entry.sequenceIndex] + 1,
        mappingConfidence: selection.analysis.confidence,
        ...(spatialRecommendation
          ? {
              spatialMode,
              spatialConfidence: spatialRecommendation.confidence,
              direction: spatialRecommendation.direction,
              diagnostics: spatialRecommendation.diagnostics,
            }
          : { spatialMode }),
      },
    };
  });
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "xsxb-attachment-alignment-plan",
    planId,
    createdAt: new Date().toISOString(),
    root,
    ...identity,
    baseRevision,
    assetSelector: String(options.assets || "group"),
    frameSelection: String(options.frames || "all"),
    mappingStrategy,
    spatialMode,
    direction,
    sequenceAnalysis: selection.analysis,
    canvas: sequence.canvas,
    requiresVisualReview:
      sequence.canvas.mode !== "shared" || mappingStrategy !== "strict" || spatialMode !== "identity",
    entries,
  };
}

/**
 * Validates transform and layer values.
 * @param {object} attachment Attachment or planned entry.
 * @param {string} label Diagnostic label.
 * @returns {string[]} Validation errors.
 */
function validateGeometry(attachment, label) {
  const transform = attachment.transform || {};
  const values = [
    transform.scale,
    transform.scaleX,
    transform.scaleY,
    transform.offset?.x,
    transform.offset?.y,
    transform.rotation,
    attachment.layerOrder,
  ].map(Number);
  const errors = [];
  if (!values.every(Number.isFinite)) errors.push(`${label}: transform and layer values must be finite.`);
  if ([transform.scale, transform.scaleX, transform.scaleY].map(Number).some((value) => value <= 0)) {
    errors.push(`${label}: attachment scale must be greater than zero.`);
  }
  if (!Number.isFinite(Number(attachment.layerOrder)) || Number(attachment.layerOrder) === 0) {
    errors.push(`${label}: layerOrder must be a finite non-zero number.`);
  }
  return errors;
}

/**
 * Validates attachment records for a target animation or plan.
 * @param {{root:string,projectId?:string,profileId:string,animationId:string,plan?:object}} options Validation options.
 * @returns {{ok:boolean,errors:string[],warnings:string[],checked:number,projectId:string,profileId:string,animationId:string,planId:string}} Validation report.
 */
function validateAlignment(options) {
  const root = path.resolve(options.root);
  const projectStore = createProjectStore(root);
  const project = resolveProject(projectStore, options.projectId || options.plan?.projectId);
  const paths = projectStore.projectPaths(project);
  const manifest = projectStore.readJson(paths.manifest, { profiles: [] });
  const profileId = options.profileId || options.plan?.profileId;
  const requestedAnimationId = options.animationId || options.plan?.animationId;
  const { profile, animation, animationId, frames } = resolveAnimation(
    manifest,
    profileId,
    requestedAnimationId,
  );
  const assets = projectStore.readJson(paths.attachmentAssets, []);
  const attachments = projectStore.readJson(paths.frameImageAttachments, []);
  const planId = String(options.plan?.planId || "");
  const expectedIds = new Set((options.plan?.entries || []).map((entry) => String(entry.instanceId)));
  const target = (Array.isArray(attachments) ? attachments : []).filter((attachment) => {
    if (planId) return attachment.automation?.planId === planId || expectedIds.has(String(attachment.id));
    return (
      String(attachment.metadata?.profileId || "") === String(profileId) &&
      String(attachment.metadata?.animation || "") === `${profileId}/${animationId}`
    );
  });
  const errors = [];
  const warnings = [];
  const seenIds = new Set();
  const seenEntries = new Set();
  const hashCache = new Map();
  for (const attachment of target) {
    const label = attachment.id || attachment.name || "attachment";
    if (seenIds.has(String(attachment.id))) errors.push(`${label}: duplicate attachment id.`);
    seenIds.add(String(attachment.id));
    const automationEntry = String(attachment.automation?.entryId || "");
    if (automationEntry && seenEntries.has(automationEntry)) errors.push(`${label}: duplicate plan entry.`);
    if (automationEntry) seenEntries.add(automationEntry);
    const frameIndex = Number(attachment.metadata?.frame);
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= frames.length) {
      errors.push(`${label}: frame index is outside ${profileId}/${animationId}.`);
    }
    if (String(attachment.metadata?.animation || "") !== `${profileId}/${animationId}`) {
      errors.push(`${label}: animation metadata does not match ${profileId}/${animationId}.`);
    }
    if (!String(attachment.key || attachment.frameKey || "")) {
      errors.push(`${label}: frame key is missing.`);
    } else if (
      Number.isInteger(frameIndex) &&
      frameIndex >= 0 &&
      frameIndex < frames.length &&
      String(attachment.key || attachment.frameKey) !==
        frameBinding(project, profile, animation, animationId, frameIndex).key
    ) {
      errors.push(`${label}: frame key does not belong to ${profileId}/${animationId}.`);
    }
    errors.push(...validateGeometry(attachment, label));
    try {
      const sourcePath = resolveAssetFile(root, project, attachment.path);
      let digest = hashCache.get(sourcePath);
      if (!digest) {
        digest = fileHash(sourcePath);
        hashCache.set(sourcePath, digest);
      }
      if (attachment.assetHash && digest !== String(attachment.assetHash)) {
        errors.push(`${label}: attachment content hash does not match assetHash.`);
      }
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
    if (attachment.assetId) {
      const asset = (Array.isArray(assets) ? assets : []).find(
        (entry) => String(entry.id) === String(attachment.assetId),
      );
      if (!asset) errors.push(`${label}: assetId does not exist in attachment_assets.json.`);
      else if (String(asset.assetHash || "") !== String(attachment.assetHash || "")) {
        errors.push(`${label}: assetId and assetHash refer to different assets.`);
      }
    }
  }
  for (const expectedId of expectedIds) {
    if (!target.some((attachment) => String(attachment.id) === expectedId)) {
      errors.push(`${expectedId}: planned attachment instance is missing.`);
    }
  }
  if (!target.length) warnings.push(`No attachments found for ${profileId}/${animationId}.`);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checked: target.length,
    projectId: project.id,
    profileId: String(profileId),
    animationId,
    planId,
  };
}

/**
 * Creates an immutable sibling backup for a JSON file.
 * @param {string} filePath Source JSON path.
 * @param {string} revision Project revision.
 * @returns {string} Backup path.
 */
function backupJson(filePath, revision) {
  const backupPath = `${filePath}.backup-${revision.slice(0, 12)}`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

/**
 * Converts one plan entry into a persisted frame attachment.
 * @param {object} plan Alignment plan.
 * @param {object} entry Plan entry.
 * @returns {object} Persisted attachment.
 */
function attachmentFromEntry(plan, entry) {
  return {
    id: String(entry.instanceId),
    key: String(entry.key),
    frameKey: String(entry.key),
    metadata: clone(entry.metadata),
    name: String(entry.asset.name || "image"),
    path: String(entry.asset.path),
    assetId: String(entry.asset.id),
    assetHash: String(entry.asset.assetHash),
    type: String(entry.asset.type || "image/png"),
    width: Number(entry.asset.width || 0),
    height: Number(entry.asset.height || 0),
    layer: entry.layer === "below" ? "below" : "above",
    layerOrder: Number(entry.layerOrder),
    transform: clone(entry.transform),
    automation: {
      planId: String(plan.planId),
      entryId: String(entry.entryId),
      assetId: String(entry.asset.id),
      logicalId: String(entry.logicalId || plan.logicalId || ""),
      attachmentKind: String(plan.attachmentKind || ""),
      gripT: Number(entry.alignment?.gripT ?? plan.gripT),
    },
  };
}

/**
 * Validates a plan before any project mutation.
 * @param {object} plan Alignment plan.
 * @returns {void}
 */
function assertPlan(plan) {
  if (plan?.kind !== "xsxb-attachment-alignment-plan" || plan.schemaVersion !== PLAN_SCHEMA_VERSION) {
    throw new Error("Unsupported attachment alignment plan.");
  }
  if (!plan.planId || !plan.projectId || !plan.profileId || !plan.animationId) {
    throw new Error("Attachment alignment plan identity is incomplete.");
  }
  if (!Array.isArray(plan.entries) || !plan.entries.length)
    throw new Error("Attachment alignment plan is empty.");
  const entryIds = new Set();
  const instanceIds = new Set();
  for (const entry of plan.entries) {
    const errors = validateGeometry(entry, entry.entryId || "plan entry");
    if (errors.length) throw new Error(errors.join(" "));
    if (
      !entry.asset?.id ||
      !entry.asset?.path ||
      !entry.asset?.sourcePath ||
      !entry.asset?.assetHash ||
      !entry.key
    ) {
      throw new Error(`Incomplete attachment plan entry: ${entry.entryId || "unknown"}`);
    }
    if (entryIds.has(String(entry.entryId)) || instanceIds.has(String(entry.instanceId))) {
      throw new Error("Attachment alignment plan contains duplicate entry identities.");
    }
    entryIds.add(String(entry.entryId));
    instanceIds.add(String(entry.instanceId));
  }
}

/**
 * Applies a confirmed plan with revision, backup, rollback, and idempotence guards.
 * @param {{root:string,plan:object,confirmed?:boolean,syncGodot?:boolean}} options Apply options.
 * @returns {object} Apply summary.
 */
function applyAlignmentPlan(options) {
  const root = path.resolve(options.root);
  const plan = options.plan;
  assertPlan(plan);
  if (path.resolve(String(plan.root || "")) !== root) {
    throw new Error("Alignment plan belongs to a different tuner root.");
  }
  const projectStore = createProjectStore(root);
  const project = resolveProject(projectStore, plan.projectId);
  const paths = projectStore.projectPaths(project);
  const originalAttachments = projectStore.readJson(paths.frameImageAttachments, []);
  const attachments = Array.isArray(originalAttachments) ? originalAttachments : [];
  const plannedIds = new Set(plan.entries.map((entry) => String(entry.instanceId)));
  const existingPlanned = attachments.filter((attachment) => plannedIds.has(String(attachment.id)));
  if (existingPlanned.length === plannedIds.size) {
    const validation = validateAlignment({ root, plan });
    if (!validation.ok)
      throw new Error(`Existing plan application is invalid: ${validation.errors.join(" ")}`);
    return { ok: true, status: "already_applied", applied: 0, validation, godotSync: null, backups: [] };
  }
  if (existingPlanned.length)
    throw new Error("Plan was only partially applied; refusing to create duplicate instances.");
  if (!options.confirmed) throw new Error("Applying a plan requires explicit confirmation (--confirm). ");
  const currentRevision = projectDataRevision(projectStore, project);
  if (currentRevision !== plan.baseRevision) {
    throw new Error("Project data changed after planning. Generate and review a new plan before applying.");
  }
  const manifest = projectStore.readJson(paths.manifest, { profiles: [] });
  const target = resolveAnimation(manifest, plan.profileId, plan.animationId);
  for (const entry of plan.entries) {
    const frame = target.frames[entry.frameIndex];
    if (
      !frame ||
      String(frame.id || "") !== String(entry.frameId || "") ||
      String(frame.path || "") !== String(entry.framePath || "")
    ) {
      throw new Error(`Target frame changed after planning: ${entry.displayFrame}`);
    }
    const digest = fileHash(entry.asset.sourcePath);
    if (digest !== String(entry.asset.assetHash))
      throw new Error(`Attachment source changed: ${entry.asset.sourcePath}`);
  }
  const originalAssets = projectStore.readJson(paths.attachmentAssets, []);
  const nextAssets = Array.isArray(originalAssets) ? clone(originalAssets) : [];
  for (const entry of plan.entries) {
    const asset = entry.asset;
    const targetPath = safeResolve(root, asset.path);
    const workspaceDir = projectStore.projectWorkspaceDir(project);
    if (!targetPath || !safeResolve(workspaceDir, path.relative(workspaceDir, targetPath))) {
      throw new Error(`Planned attachment path is outside the project workspace: ${asset.path}`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (fs.existsSync(targetPath)) {
      if (fileHash(targetPath) !== asset.assetHash)
        throw new Error(`Attachment target hash mismatch: ${asset.path}`);
    } else {
      fs.copyFileSync(asset.sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    }
    const existingAsset = nextAssets.find((candidate) => String(candidate.id) === String(asset.id));
    if (existingAsset && String(existingAsset.assetHash || "") !== String(asset.assetHash)) {
      throw new Error(`Attachment asset id collision: ${asset.id}`);
    }
    if (!existingAsset) {
      nextAssets.push({
        id: String(asset.id),
        name: String(asset.name),
        path: String(asset.path),
        assetHash: String(asset.assetHash),
        type: String(asset.type || "image/png"),
        width: Number(asset.width || 0),
        height: Number(asset.height || 0),
        groupKey: String(plan.groupKey),
      });
    }
  }
  const nextAttachments = [...attachments, ...plan.entries.map((entry) => attachmentFromEntry(plan, entry))];
  const backups = [backupJson(paths.frameImageAttachments, currentRevision)];
  if (JSON.stringify(nextAssets) !== JSON.stringify(originalAssets)) {
    backups.push(backupJson(paths.attachmentAssets, currentRevision));
  }
  try {
    projectStore.writeJson(paths.attachmentAssets, nextAssets);
    projectStore.writeJson(paths.frameImageAttachments, nextAttachments);
    const validation = validateAlignment({ root, plan });
    if (!validation.ok) throw new Error(`Post-apply validation failed: ${validation.errors.join(" ")}`);
  } catch (error) {
    projectStore.writeJson(paths.attachmentAssets, originalAssets);
    projectStore.writeJson(paths.frameImageAttachments, originalAttachments);
    throw error;
  }
  const validation = validateAlignment({ root, plan });
  const godotSync =
    options.syncGodot !== false && validGodotProjectRoot(project)
      ? syncGodotProject(root, projectStore, project, { frameImageAttachments: nextAttachments })
      : null;
  return {
    ok: true,
    status: "applied",
    applied: plan.entries.length,
    validation,
    godotSync,
    backups,
    revision: projectDataRevision(projectStore, project),
  };
}

module.exports = {
  PLAN_SCHEMA_VERSION,
  applyAlignmentPlan,
  createAlignmentPlan,
  parseFrameSelection,
  projectDataRevision,
  validateAlignment,
};
