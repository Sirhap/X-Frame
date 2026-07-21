"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Calculates a lowercase SHA-256 digest.
 * @param {string|Buffer|Uint8Array} content Artifact content.
 * @returns {string} Hex digest.
 */
function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Produces a content-addressed filename.
 * @param {string} stem Stable artifact role.
 * @param {string} extension Extension without a leading dot.
 * @param {string|Buffer|Uint8Array} content Artifact content.
 * @returns {string} Hashed filename.
 */
function hashedFilename(stem, extension, content) {
  return `${stem}.${sha256(content).slice(0, 16)}.${extension}`;
}

/**
 * Resolves a root-relative public URL without permitting traversal.
 * @param {string} publicRoot Public source root.
 * @param {string} publicUrl Root-relative asset URL.
 * @returns {string} Safe absolute source path.
 */
function resolvePublicAsset(publicRoot, publicUrl) {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(publicUrl) || publicUrl.includes("..")) {
    throw new Error(`Unsafe public asset URL: ${publicUrl}`);
  }
  const resolved = path.resolve(publicRoot, publicUrl.slice(1));
  const relative = path.relative(publicRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Public asset escaped source root: ${publicUrl}`);
  }
  return resolved;
}

/**
 * Walks regular files below a directory in deterministic order.
 * @param {string} root Directory to walk.
 * @returns {string[]} Absolute file paths.
 */
function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Artifact tree contains a symlink: ${target}`);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  return files.sort();
}

/**
 * Resolves a generated relative path without permitting output-root escape.
 * @param {string} outputRoot Declared output root.
 * @param {string} relativePath Relative artifact path.
 * @returns {string} Safe absolute output path.
 */
function resolveOutputAsset(outputRoot, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Unsafe artifact path: ${relativePath}`);
  }
  const target = path.resolve(outputRoot, relativePath);
  const relative = path.relative(outputRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe artifact path: ${relativePath}`);
  }
  return target;
}

/**
 * Writes an artifact only below the declared output root.
 * @param {string} outputRoot Output root.
 * @param {string} relativePath Relative artifact path.
 * @param {string|Buffer|Uint8Array} content Artifact content.
 * @returns {string} Absolute output path.
 */
function writeArtifact(outputRoot, relativePath, content) {
  const target = resolveOutputAsset(outputRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

module.exports = Object.freeze({
  hashedFilename,
  listFiles,
  resolveOutputAsset,
  resolvePublicAsset,
  sha256,
  writeArtifact,
});
