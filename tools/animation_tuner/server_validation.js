"use strict";

const path = require("node:path");

/**
 * Resolves a user-provided path while preventing traversal outside its base.
 * @param {string} base Absolute base directory.
 * @param {unknown} requested User-provided relative path.
 * @returns {string|null} Resolved path, or null when it escapes the base.
 */
function safeResolve(base, requested) {
  const fullPath = path.resolve(base, String(requested || ""));
  return fullPath === base || fullPath.startsWith(`${base}${path.sep}`) ? fullPath : null;
}

/**
 * Checks whether a filesystem path belongs to a parent directory.
 * @param {string} childPath Candidate child path.
 * @param {string} parentPath Expected parent path.
 * @returns {boolean} True when the child stays inside the parent.
 */
function isInside(childPath, parentPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

/**
 * Produces a filesystem-safe path segment from user input.
 * @param {unknown} value Candidate segment.
 * @param {string} [fallback="asset"] Segment used when input is empty or unsafe.
 * @returns {string} Sanitized segment.
 */
function sanitizeSegment(value, fallback = "asset") {
  const text = String(value || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.\./g, "_")
    .replace(/^_+|_+$/g, "");
  return text && !/^\.+$/.test(text) ? text : fallback;
}

/**
 * Decodes a data URL accepted by media upload routes.
 * @param {unknown} dataUrl Candidate data URL.
 * @returns {{mime:string,buffer:Buffer}|null} Decoded media, or null for invalid syntax.
 */
function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  let decodedText = "";
  if (!match[2]) {
    try {
      decodedText = decodeURIComponent(match[3] || "");
    } catch (error) {
      throw Object.assign(new Error("Invalid data URL encoding."), { status: 400, cause: error });
    }
  }
  return {
    mime: String(match[1] || "").toLowerCase(),
    buffer: match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodedText, "utf8"),
  };
}

/**
 * Checks whether an asset path belongs to one of the registered project workspaces.
 * @param {string} candidatePath Absolute candidate asset path.
 * @param {object[]} projects Project records with absolute workspace directories.
 * @returns {boolean} True when the asset is inside a managed workspace.
 */
function isManagedWorkspaceAsset(candidatePath, projects) {
  const candidate = path.resolve(String(candidatePath || ""));
  return Array.from(projects || []).some((project) => {
    const workspace = String(project?.workspaceDir || "").trim();
    return workspace && isInside(candidate, path.resolve(workspace));
  });
}

/**
 * Checks whether an absolute path may be served by the asset endpoint. Built-in
 * public assets (for example attack-trail preset textures) are always allowed,
 * while user-authored assets must live inside a registered project workspace.
 * @param {string} candidatePath Absolute candidate asset path.
 * @param {{publicRoot?:string,projects?:object[]}} options Public asset root and managed project records.
 * @returns {boolean} True when the asset is servable.
 */
function isServableAsset(candidatePath, options = {}) {
  const full = path.resolve(String(candidatePath || ""));
  const publicRoot = String(options.publicRoot || "").trim();
  if (publicRoot && isInside(full, path.resolve(publicRoot))) return true;
  return isManagedWorkspaceAsset(full, options.projects);
}

/**
 * Resolves a supported image extension from a filename or MIME type.
 * @param {unknown} mime Candidate MIME type.
 * @param {unknown} name Candidate filename.
 * @returns {string} Supported lowercase extension, or an empty string.
 */
function imageExtensionFromMime(mime, name) {
  const extension = path.extname(String(name || "")).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) return extension;
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return "";
}

/**
 * Normalizes a persisted manifest into the server's stable project shape.
 * @param {unknown} raw Candidate manifest.
 * @param {string[]} defaultSupports Default feature support identifiers.
 * @returns {{schemaVersion:number,profiles:object[]}} Normalized manifest.
 */
function normalizeManifest(raw, defaultSupports) {
  const manifest = raw && typeof raw === "object" ? raw : {};
  const profiles = Array.isArray(manifest.profiles) ? manifest.profiles : [];
  return {
    schemaVersion: Number(manifest.schemaVersion || 1),
    profiles: profiles.map((profile) => ({
      id: String(profile.id || profile.name || "profile"),
      label: String(profile.label || profile.id || profile.name || "Profile"),
      kind: String(profile.kind || "actor"),
      bodyScale: Math.max(0.001, Number(profile.bodyScale ?? 1)),
      runtimeScale: Math.max(0.001, Number(profile.runtimeScale ?? 1)),
      supports: Array.isArray(profile.supports) ? profile.supports : defaultSupports,
      animations: Array.isArray(profile.animations) ? profile.animations : [],
    })),
  };
}

/**
 * Removes redundant uniform character scale vectors from tuning values.
 * @param {unknown} values Candidate tuning values map.
 * @returns {object} Normalized tuning values map.
 */
function normalizeTuningScaleValues(values) {
  const normalizedValues = values && typeof values === "object" ? values : {};
  for (const key of Object.keys(normalizedValues)) {
    if (!/\.character\.visual_scale$/.test(key)) continue;
    const scaleVector = normalizedValues[key];
    if (!scaleVector || typeof scaleVector !== "object") continue;
    const x = Number(scaleVector.x);
    const y = Number(scaleVector.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - y) > 0.0001) continue;
    const scaleKey = key.replace(/\.visual_scale$/, ".visual_size");
    const scale = Number(normalizedValues[scaleKey]);
    if (Number.isFinite(scale) && scale > 0) delete normalizedValues[key];
  }
  return normalizedValues;
}

/**
 * Normalizes a JSON-safe reference-frame descriptor and strips unknown fields.
 * @param {unknown} value Candidate persisted descriptor.
 * @returns {object|null} Safe descriptor or null when identity/index is invalid.
 */
function normalizeReferenceFrameDescriptor(value) {
  if (!value || typeof value !== "object") return null;
  const profileId = String(value.profile_id || "")
    .trim()
    .slice(0, 80);
  const animationId = String(value.animation_id || "")
    .trim()
    .slice(0, 80);
  const frameIndex = Number(value.frame_index);
  if (
    !profileId ||
    !animationId ||
    !Number.isInteger(frameIndex) ||
    frameIndex < 0 ||
    frameIndex > 1_000_000
  ) {
    return null;
  }
  const candidateTransform = value.transform && typeof value.transform === "object" ? value.transform : {};
  const transform = {};
  for (const key of ["scale", "scaleX", "scaleY", "rotation"]) {
    const number = Number(candidateTransform[key]);
    if (Number.isFinite(number)) transform[key] = number;
  }
  const offsetX = Number(candidateTransform.offset?.x);
  const offsetY = Number(candidateTransform.offset?.y);
  if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) transform.offset = { x: offsetX, y: offsetY };
  return { profile_id: profileId, animation_id: animationId, frame_index: frameIndex, transform };
}

module.exports = {
  decodeDataUrl,
  imageExtensionFromMime,
  isInside,
  isManagedWorkspaceAsset,
  isServableAsset,
  normalizeManifest,
  normalizeReferenceFrameDescriptor,
  normalizeTuningScaleValues,
  safeResolve,
  sanitizeSegment,
};
