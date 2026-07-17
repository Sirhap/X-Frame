const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { estimateFrameBoxes, upsertEstimatedFrameBoxes } = require("./box_estimator");
const { ensureInitialCharacterScale } = require("./import_scale");

/**
 * Deep-clones JSON-compatible project data.
 * @param {unknown} value JSON-compatible value.
 * @returns {any}
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Resolves a path only when it remains inside the requested base.
 * @param {string} base Allowed base directory.
 * @param {string} requested Requested path.
 * @returns {string|null}
 */
function safeResolve(base, requested) {
  const fullPath = path.resolve(base, String(requested || ""));
  return fullPath === base || fullPath.startsWith(`${base}${path.sep}`) ? fullPath : null;
}

/**
 * Converts platform separators into manifest separators.
 * @param {string} value Path value.
 * @returns {string}
 */
function reslash(value) {
  return String(value || "").replaceAll("\\", "/");
}

/**
 * Reads dimensions from a PNG header.
 * @param {Buffer} buffer PNG data.
 * @returns {{width:number,height:number}}
 */
function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("Frame organizer only accepts PNG image data.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

/**
 * Decodes a PNG data URL.
 * @param {string} value PNG data URL.
 * @returns {Buffer|null}
 */
function decodePngDataUrl(value) {
  const match = /^data:image\/png;base64,(.+)$/i.exec(String(value || ""));
  return match ? Buffer.from(match[1], "base64") : null;
}

/**
 * Mirrors saved box offsets and rotations for a horizontally flipped frame.
 * @param {object} boxes Frame box entry.
 * @returns {object}
 */
function mirrorBoxes(boxes) {
  const result = clone(boxes);
  for (const box of Object.values(result)) {
    if (!box || typeof box !== "object") continue;
    if (box.offset && typeof box.offset === "object") box.offset.x = -Number(box.offset.x || 0);
    if (box.rotation !== undefined) box.rotation = -Number(box.rotation || 0);
  }
  return result;
}

/**
 * Remaps one indexed tuning dictionary to a new frame order.
 * @param {object} source Original tuning dictionary.
 * @param {string} prefix Stable animation key prefix.
 * @param {Array<{sourceIndex:number|null,flipped?:boolean}>} items New frame plan.
 * @param {boolean} mirrorFrameBoxes Whether mirrored frame boxes require X inversion.
 * @returns {object}
 */
function remapIndexedDictionary(source, prefix, items, mirrorFrameBoxes = false) {
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!key.startsWith(prefix) || key === `${prefix}__group`) result[key] = clone(value);
  }
  items.forEach((item, newIndex) => {
    if (!Number.isInteger(item.sourceIndex)) return;
    const oldKey = `${prefix}${item.sourceIndex}`;
    if (!(oldKey in (source || {}))) return;
    const value = mirrorFrameBoxes && item.flipped
      ? mirrorBoxes(source[oldKey])
      : clone(source[oldKey]);
    result[`${prefix}${newIndex}`] = value;
  });
  return result;
}

/**
 * Returns a binding's stable animation and frame metadata.
 * @param {object} binding Audio or image attachment binding.
 * @returns {{animation:string,frame:number|null}}
 */
function bindingInfo(binding) {
  const metadata = binding?.metadata && typeof binding.metadata === "object" ? binding.metadata : {};
  let animation = String(metadata.animation || binding?.animation || "");
  const profileId = String(metadata.profileId || binding?.profileId || "");
  if (animation && profileId && !animation.includes("/")) animation = `${profileId}/${animation}`;
  const keyMatch = /^(.*):(\d+)$/.exec(String(binding?.key || binding?.frameKey || ""));
  if (!animation && keyMatch) animation = keyMatch[1];
  const frame = Number(metadata.frame ?? binding?.frame ?? keyMatch?.[2]);
  return { animation, frame: Number.isFinite(frame) ? frame : null };
}

/**
 * Replaces the numeric frame suffix in a binding key.
 * @param {string} value Existing key.
 * @param {number} frame New frame index.
 * @returns {string}
 */
function rekeyBindingValue(value, frame) {
  const text = String(value || "");
  return /:\d+$/.test(text) ? text.replace(/:\d+$/, `:${frame}`) : text;
}

/**
 * Remaps frame audio or attachment bindings to the new frame plan.
 * @param {object[]|object} bindings Existing bindings, including the legacy keyed format.
 * @param {string} animationKey Stable animation key.
 * @param {Array<{sourceIndex:number|null}>} items New frame plan.
 * @returns {object[]}
 */
function remapBindings(bindings, animationKey, items) {
  const untouched = [];
  const indexed = new Map();
  const normalizedBindings = Array.isArray(bindings)
    ? bindings
    : Object.entries(bindings && typeof bindings === "object" ? bindings : {}).map(([key, value]) => ({
        key,
        ...(value && typeof value === "object" ? value : {}),
      }));
  for (const binding of normalizedBindings) {
    const info = bindingInfo(binding);
    if (info.animation === animationKey && Number.isInteger(info.frame)) {
      if (!indexed.has(info.frame)) indexed.set(info.frame, []);
      indexed.get(info.frame).push(binding);
    } else {
      untouched.push(clone(binding));
    }
  }
  const remapped = [];
  items.forEach((item, newIndex) => {
    if (!Number.isInteger(item.sourceIndex)) return;
    for (const binding of indexed.get(item.sourceIndex) || []) {
      const next = clone(binding);
      if (next.metadata && typeof next.metadata === "object") {
        next.metadata.frame = newIndex;
        next.metadata.displayFrame = newIndex;
      }
      if (next.frame !== undefined) next.frame = newIndex;
      if (next.key) next.key = rekeyBindingValue(next.key, newIndex);
      if (next.frameKey) next.frameKey = rekeyBindingValue(next.frameKey, newIndex);
      remapped.push(next);
    }
  });
  return [...untouched, ...remapped];
}

/**
 * Locates a manifest animation.
 * @param {object} manifest Animation manifest.
 * @param {string} profileId Profile identifier.
 * @param {string} animationId Animation identifier.
 * @returns {{profile:object,animation:object}}
 */
function findAnimation(manifest, profileId, animationId) {
  const profile = (manifest.profiles || []).find((entry) => String(entry.id) === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  const animation = (profile.animations || []).find((entry) => String(entry.id || entry.name) === animationId);
  if (!animation) throw new Error(`Animation not found: ${profileId}/${animationId}`);
  return { profile, animation };
}

/**
 * Returns an existing profile or creates a manifest profile for a new import.
 * @param {object} manifest Animation manifest.
 * @param {string} profileId Stable profile identifier.
 * @param {string} profileLabel User-facing profile label.
 * @param {string} profileKind Runtime profile kind.
 * @returns {object}
 */
function ensureImportProfile(manifest, profileId, profileLabel, profileKind) {
  manifest.profiles = Array.isArray(manifest.profiles) ? manifest.profiles : [];
  let profile = manifest.profiles.find((entry) => String(entry.id) === profileId);
  if (!profile) {
    profile = {
      id: profileId,
      label: profileLabel || profileId,
      kind: profileKind || "actor",
      bodyScale: 1,
      runtimeScale: 1,
      animations: [],
    };
    manifest.profiles.push(profile);
  }
  profile.animations = Array.isArray(profile.animations) ? profile.animations : [];
  return profile;
}

/**
 * Imports a new browser-created PNG sequence into one project atomically.
 * @param {{
 *   root:string,
 *   projectStore:object,
 *   project:object,
 *   profileId:string,
 *   profileLabel?:string,
 *   profileKind?:string,
 *   animationId:string,
 *   animationName?:string,
 *   animationType?:string,
 *   anchorMode?:string,
 *   fps?:number,
 *   items:Array<{data:string,name?:string}>
 * }} options Import operation.
 * @returns {{manifest:object,tuning:object,frameCount:number,targetDir:string,profileId:string,animationId:string}}
 */
function importAnimation(options) {
  const {
    root,
    projectStore,
    project,
    profileId,
    animationId,
  } = options;
  const items = Array.isArray(options.items) ? options.items : [];
  if (!project) throw new Error("An active project is required.");
  if (!profileId || !animationId) throw new Error("Profile and animation names are required.");
  if (!items.length) throw new Error("Import at least one animation frame.");
  if (items.length > 5000) throw new Error("Animation import limit is 5000 frames.");

  const buffers = items.map((item, index) => {
    const buffer = decodePngDataUrl(item.data);
    if (!buffer) throw new Error(`Frame ${index + 1} is not PNG image data.`);
    pngSize(buffer);
    return buffer;
  });
  const paths = projectStore.projectPaths(project);
  const manifest = projectStore.readJson(paths.manifest, { schemaVersion: 1, profiles: [] });
  const tuning = projectStore.readJson(paths.tuning, {
    schemaVersion: 1,
    values: {},
    scene_settings: {},
    frame_visual_overrides: {},
    frame_playback_overrides: {},
    frame_box_overrides: {},
  });
  const originals = {
    manifest: clone(manifest),
    tuning: clone(tuning),
  };
  const profile = ensureImportProfile(
    manifest,
    profileId,
    String(options.profileLabel || profileId),
    String(options.profileKind || "actor"),
  );
  if (profile.animations.some((entry) => String(entry.id || entry.name) === animationId)) {
    throw new Error(`Animation already exists: ${profileId}/${animationId}`);
  }

  const workspaceDir = projectStore.projectWorkspaceDir(project);
  const targetDir = path.join(workspaceDir, "assets", profileId, animationId);
  if (!targetDir.startsWith(`${workspaceDir}${path.sep}`)) {
    throw new Error("Animation assets must stay inside the active project workspace.");
  }
  if (fs.existsSync(targetDir)) {
    throw new Error(`Animation asset folder already exists: ${profileId}/${animationId}`);
  }

  const operationId = crypto.randomBytes(8).toString("hex");
  const stagingDir = `${targetDir}.import-${operationId}`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  let frames = [];
  let animation = null;
  try {
    const frameFiles = [];
    frames = buffers.map((buffer, index) => {
      const frameName = `frame_${String(index + 1).padStart(4, "0")}.png`;
      const stagingPath = path.join(stagingDir, frameName);
      fs.writeFileSync(stagingPath, buffer);
      frameFiles.push(stagingPath);
      return {
        id: `frame_${String(index + 1).padStart(4, "0")}`,
        name: frameName,
        path: reslash(path.relative(root, path.join(targetDir, frameName))),
        duration: 1,
        ...pngSize(buffer),
      };
    });
    const animationType = ["actor", "boss", "vfx", "prop", "scene_prop_attachment"]
      .includes(String(options.animationType || "actor"))
      ? String(options.animationType || "actor")
      : "actor";
    animation = {
      id: animationId,
      name: String(options.animationName || animationId),
      type: animationType,
      anchorMode: String(options.anchorMode || "canvas_bottom_center"),
      fps: Math.max(1, Math.min(120, Number(options.fps || 12))),
      source: reslash(path.relative(root, targetDir)),
      frames,
    };
    profile.animations.push(animation);
    ensureInitialCharacterScale(
      tuning,
      profileId,
      project.projectRoot,
      frameFiles.map((filePath) => ({
        filePath,
        animationId,
        animationName: animation.name,
      })),
    );
    upsertEstimatedFrameBoxes(tuning, profileId, animation, frameFiles, { replace: true });
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }

  let directoryInstalled = false;
  try {
    fs.renameSync(stagingDir, targetDir);
    directoryInstalled = true;
    projectStore.writeJson(paths.manifest, manifest);
    projectStore.writeJson(paths.tuning, tuning);
  } catch (error) {
    if (directoryInstalled) fs.rmSync(targetDir, { recursive: true, force: true });
    fs.rmSync(stagingDir, { recursive: true, force: true });
    projectStore.writeJson(paths.manifest, originals.manifest);
    projectStore.writeJson(paths.tuning, originals.tuning);
    throw error;
  }

  return {
    manifest,
    tuning,
    frameCount: frames.length,
    targetDir,
    profileId,
    animationId,
  };
}

/**
 * Applies an organizer frame plan to one project animation using atomic directory replacement.
 * @param {{
 *   root:string,
 *   projectStore:object,
 *   project:object,
 *   profileId:string,
 *   animationId:string,
 *   items:Array<{sourceIndex?:number|null,sourcePath?:string,data?:string,name?:string,flipped?:boolean}>
 * }} options Organizer operation.
 * @returns {{manifest:object,tuning:object,frameAudioBindings:object[],frameImageAttachments:object[],frameCount:number,targetDir:string}}
 */
function reorganizeAnimation(options) {
  const {
    root,
    projectStore,
    project,
    profileId,
    animationId,
  } = options;
  const items = Array.isArray(options.items) ? options.items : [];
  if (!items.length) throw new Error("An animation must keep at least one frame.");
  if (items.length > 5000) throw new Error("Frame organizer limit is 5000 frames per animation.");

  const paths = projectStore.projectPaths(project);
  const manifest = projectStore.readJson(paths.manifest, { schemaVersion: 1, profiles: [] });
  const tuning = projectStore.readJson(paths.tuning, {
    schemaVersion: 1,
    values: {},
    frame_visual_overrides: {},
    frame_playback_overrides: {},
    frame_box_overrides: {},
  });
  const frameAudioBindings = projectStore.readJson(paths.frameAudio, []);
  const frameImageAttachments = projectStore.readJson(paths.frameImageAttachments, []);
  const originals = {
    manifest: clone(manifest),
    tuning: clone(tuning),
    frameAudioBindings: clone(frameAudioBindings),
    frameImageAttachments: clone(frameImageAttachments),
  };
  const { animation } = findAnimation(manifest, profileId, animationId);
  const workspaceDir = projectStore.projectWorkspaceDir(project);
  const sourceDirectory = reslash(animation.source || path.dirname(animation.frames?.[0]?.path || ""));
  const targetDir = safeResolve(root, sourceDirectory);
  if (!targetDir || !targetDir.startsWith(`${workspaceDir}${path.sep}`)) {
    throw new Error("Animation assets must stay inside the active project workspace.");
  }

  const buffers = items.map((item) => {
    const inlineBuffer = decodePngDataUrl(item.data);
    if (inlineBuffer) return inlineBuffer;
    const sourcePath = safeResolve(root, item.sourcePath);
    if (!sourcePath || !sourcePath.startsWith(`${workspaceDir}${path.sep}`) || path.extname(sourcePath).toLowerCase() !== ".png") {
      throw new Error(`Invalid organizer source frame: ${item.sourcePath || "missing path"}`);
    }
    return fs.readFileSync(sourcePath);
  });
  const operationId = crypto.randomBytes(8).toString("hex");
  const stagingDir = `${targetDir}.organize-${operationId}`;
  const backupDir = `${targetDir}.backup-${operationId}`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const nextFrames = buffers.map((buffer, index) => {
    const size = pngSize(buffer);
    const frameName = `frame_${String(index + 1).padStart(4, "0")}.png`;
    fs.writeFileSync(path.join(stagingDir, frameName), buffer);
    return {
      id: `frame_${String(index + 1).padStart(4, "0")}`,
      name: frameName,
      path: reslash(path.relative(root, path.join(targetDir, frameName))),
      duration: Number(
        Number.isInteger(items[index].sourceIndex)
          ? animation.frames?.[items[index].sourceIndex]?.duration || 1
          : 1,
      ),
      ...size,
    };
  });

  const animationKey = `${profileId}/${animationId}`;
  const prefix = `${animationKey}:`;
  tuning.frame_visual_overrides = remapIndexedDictionary(tuning.frame_visual_overrides, prefix, items);
  tuning.frame_playback_overrides = remapIndexedDictionary(tuning.frame_playback_overrides, prefix, items);
  tuning.frame_box_overrides = remapIndexedDictionary(tuning.frame_box_overrides, prefix, items, true);
  items.forEach((item, index) => {
    if (Number.isInteger(item.sourceIndex)) return;
    const boxes = estimateFrameBoxes(path.join(stagingDir, nextFrames[index].name), {
      type: animation.type,
      anchorMode: animation.anchorMode,
      animationId,
      animationName: animation.name,
      frameIndex: index,
      frameCount: items.length,
      groupCanvasWidth: nextFrames[index].width,
      groupCanvasHeight: nextFrames[index].height,
    });
    if (Object.keys(boxes).length) tuning.frame_box_overrides[`${prefix}${index}`] = boxes;
  });
  const nextAudioBindings = remapBindings(frameAudioBindings, animationKey, items);
  const nextImageAttachments = remapBindings(frameImageAttachments, animationKey, items);
  animation.frames = nextFrames;
  animation.source = reslash(path.relative(root, targetDir));

  let backupCreated = false;
  let directorySwapped = false;
  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir);
      backupCreated = true;
    }
    fs.renameSync(stagingDir, targetDir);
    directorySwapped = true;
    projectStore.writeJson(paths.manifest, manifest);
    projectStore.writeJson(paths.tuning, tuning);
    projectStore.writeJson(paths.frameAudio, nextAudioBindings);
    projectStore.writeJson(paths.frameImageAttachments, nextImageAttachments);
    fs.rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (directorySwapped) fs.rmSync(targetDir, { recursive: true, force: true });
    if (backupCreated && fs.existsSync(backupDir)) fs.renameSync(backupDir, targetDir);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    projectStore.writeJson(paths.manifest, originals.manifest);
    projectStore.writeJson(paths.tuning, originals.tuning);
    projectStore.writeJson(paths.frameAudio, originals.frameAudioBindings);
    projectStore.writeJson(paths.frameImageAttachments, originals.frameImageAttachments);
    throw error;
  }

  return {
    manifest,
    tuning,
    frameAudioBindings: nextAudioBindings,
    frameImageAttachments: nextImageAttachments,
    frameCount: nextFrames.length,
    targetDir,
  };
}

module.exports = {
  importAnimation,
  mirrorBoxes,
  remapBindings,
  remapIndexedDictionary,
  reorganizeAnimation,
};
