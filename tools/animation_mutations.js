"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { EMPTY_MANIFEST, EMPTY_TUNING } = require("./project_store");

/**
 * Deep-clones JSON-compatible data.
 * @param {unknown} value JSON-compatible value.
 * @returns {any} Independent copy.
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Resolves a child path only when it remains inside its base directory.
 * @param {string} base Allowed base.
 * @param {string} requested Requested child.
 * @returns {string} Safe absolute path or an empty string.
 */
function safeResolve(base, requested) {
  const resolvedBase = path.resolve(base);
  const fullPath = path.resolve(resolvedBase, String(requested || ""));
  return fullPath === resolvedBase || fullPath.startsWith(`${resolvedBase}${path.sep}`) ? fullPath : "";
}

/**
 * Removes dictionary entries owned by one animation.
 * @param {object} dictionary Indexed override dictionary.
 * @param {string} prefix Animation key prefix.
 * @returns {object} Filtered copy.
 */
function withoutAnimationKeys(dictionary, prefix) {
  return Object.fromEntries(
    Object.entries(dictionary && typeof dictionary === "object" ? dictionary : {}).filter(
      ([key]) => !String(key).startsWith(prefix),
    ),
  );
}

/**
 * Returns whether a persisted binding belongs to one animation.
 * @param {object} binding Binding record.
 * @param {string} animationKey `<profile>/<animation>` key.
 * @returns {boolean} Whether the binding is owned by the animation.
 */
function bindingBelongsToAnimation(binding, animationKey) {
  const metadata = binding?.metadata && typeof binding.metadata === "object" ? binding.metadata : {};
  const profileId = String(metadata.profileId || binding?.profileId || "");
  let animation = String(metadata.animation || binding?.animation || binding?.animationId || "");
  if (animation && profileId && !animation.includes("/")) animation = `${profileId}/${animation}`;
  if (animation === animationKey) return true;
  const key = String(binding?.key || binding?.frameKey || "");
  return key === animationKey || key.startsWith(`${animationKey}:`);
}

/**
 * Normalizes legacy keyed bindings and current array bindings.
 * @param {unknown} value Persisted binding collection.
 * @returns {object[]} Normalized binding records.
 */
function normalizeBindings(value) {
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === "object");
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([key, entry]) => ({
    key,
    ...(entry && typeof entry === "object" ? entry : {}),
  }));
}

/**
 * Deletes an animation, its frame directory, overrides, and frame bindings.
 * The caller owns the surrounding filesystem transaction and Godot sync.
 * @param {{root:string,projectStore:object,project:object,profileId:string,animationId:string}} options Mutation options.
 * @returns {{manifest:object,tuning:object,frameAudioBindings:object[],frameImageAttachments:object[],attachmentAssets:object[],removedFrames:number,removedDirectory:string}}
 * Mutation result.
 */
function deleteAnimation(options) {
  const { root, projectStore, project } = options;
  const profileId = String(options.profileId || "");
  const animationId = String(options.animationId || "");
  const paths = projectStore.projectPaths(project);
  const manifest = clone(projectStore.readJson(paths.manifest, EMPTY_MANIFEST));
  const tuning = clone(projectStore.readJson(paths.tuning, EMPTY_TUNING));
  const audioBindings = projectStore.readJson(paths.frameAudio, []);
  const imageAttachments = projectStore.readJson(paths.frameImageAttachments, []);
  const attachmentAssets = projectStore.readJson(paths.attachmentAssets, []);
  const profileIndex = (manifest.profiles || []).findIndex((entry) => String(entry.id) === profileId);
  if (profileIndex < 0) throw new Error(`Profile not found: ${profileId}`);
  const profile = manifest.profiles[profileIndex];
  const animationIndex = (profile.animations || []).findIndex(
    (entry) => String(entry.id || entry.name) === animationId,
  );
  if (animationIndex < 0) throw new Error(`Animation not found: ${profileId}/${animationId}`);
  const [animation] = profile.animations.splice(animationIndex, 1);
  if (!profile.animations.length) manifest.profiles.splice(profileIndex, 1);

  const animationKey = `${profileId}/${animationId}`;
  const prefix = `${animationKey}:`;
  for (const field of ["frame_visual_overrides", "frame_playback_overrides", "frame_box_overrides"]) {
    tuning[field] = withoutAnimationKeys(tuning[field], prefix);
  }
  const nextAudio = normalizeBindings(audioBindings).filter(
    (binding) => !bindingBelongsToAnimation(binding, animationKey),
  );
  const nextAttachments = normalizeBindings(imageAttachments).filter(
    (binding) => !bindingBelongsToAnimation(binding, animationKey),
  );
  const nextAssets = normalizeBindings(attachmentAssets).filter(
    (asset) => String(asset.groupKey || "") !== animationKey,
  );

  const workspaceDir = projectStore.projectWorkspaceDir(project);
  const source = String(animation.source || path.dirname(animation.frames?.[0]?.path || ""));
  const removedDirectory = safeResolve(root, source);
  if (removedDirectory && removedDirectory.startsWith(`${workspaceDir}${path.sep}`)) {
    fs.rmSync(removedDirectory, { recursive: true, force: true });
  }
  projectStore.writeJson(paths.manifest, manifest);
  projectStore.writeJson(paths.tuning, tuning);
  projectStore.writeJson(paths.frameAudio, nextAudio);
  projectStore.writeJson(paths.frameImageAttachments, nextAttachments);
  projectStore.writeJson(paths.attachmentAssets, nextAssets);
  return {
    manifest,
    tuning,
    frameAudioBindings: nextAudio,
    frameImageAttachments: nextAttachments,
    attachmentAssets: nextAssets,
    removedFrames: Array.isArray(animation.frames) ? animation.frames.length : 0,
    removedDirectory,
  };
}

module.exports = {
  bindingBelongsToAnimation,
  deleteAnimation,
  normalizeBindings,
  withoutAnimationKeys,
};
