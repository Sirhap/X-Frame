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
  return {
    mime: String(match[1] || "").toLowerCase(),
    buffer: match[2]
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3] || ""), "utf8"),
  };
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

module.exports = {
  decodeDataUrl,
  imageExtensionFromMime,
  isInside,
  normalizeManifest,
  normalizeTuningScaleValues,
  safeResolve,
  sanitizeSegment,
};
