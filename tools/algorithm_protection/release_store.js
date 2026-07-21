"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PROJECT_ROOT } = require("./config");
const { listFiles, resolveOutputAsset, sha256, writeArtifact } = require("./artifact_utils");

const RELEASE_ROOT = path.join(PROJECT_ROOT, ".protected-releases");
const RELEASE_INDEX_PATH = path.join(RELEASE_ROOT, "release-index.json");

/**
 * Validates a build identifier before using it as a directory name.
 * @param {string} buildId Candidate build identifier.
 * @returns {string} Validated identifier.
 */
function validateBuildId(buildId) {
  const normalized = String(buildId || "");
  if (!/^[a-f0-9]{20}$/.test(normalized)) throw new Error(`Invalid protected build id: ${normalized}`);
  return normalized;
}

/**
 * Reads a JSON file or returns a fallback when it does not exist.
 * @template T
 * @param {string} filename JSON filename.
 * @param {T} fallback Missing-file fallback.
 * @returns {T} Parsed JSON value.
 */
function readJson(filename, fallback) {
  if (!fs.existsSync(filename)) return fallback;
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

/**
 * Copies a symlink-free artifact tree into a new release directory.
 * @param {string} sourceRoot Source artifact root.
 * @param {string} destinationRoot Destination artifact root.
 * @returns {void}
 */
function copyArtifactTree(sourceRoot, destinationRoot) {
  for (const sourceFile of listFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, sourceFile);
    const destination = resolveOutputAsset(destinationRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(sourceFile, destination, fs.constants.COPYFILE_EXCL);
  }
}

/**
 * Creates the private release evidence needed for rollback and leak tracing.
 * @param {string} artifactRoot Completed public artifact tree.
 * @param {{seed:string,sourceFingerprint:string,customerId?:string,compilerVersion?:string}} metadata Private build metadata.
 * @returns {object} Stored private release record.
 */
function recordProtectedRelease(artifactRoot, metadata) {
  const manifestPath = path.join(artifactRoot, "asset-manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Cannot record a release without an asset manifest.");
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const buildId = validateBuildId(manifest.buildId);
  if (manifest.sourceFingerprint !== metadata.sourceFingerprint) {
    throw new Error("Private release fingerprint does not match the public manifest.");
  }

  const releaseRoot = path.join(RELEASE_ROOT, buildId);
  const archivedArtifacts = path.join(releaseRoot, "dist");
  if (fs.existsSync(releaseRoot)) {
    const existingManifest = path.join(archivedArtifacts, "asset-manifest.json");
    if (
      !fs.existsSync(existingManifest) ||
      sha256(fs.readFileSync(existingManifest)) !== sha256(manifestBytes)
    ) {
      throw new Error(`Protected release id collision: ${buildId}`);
    }
    return readJson(path.join(releaseRoot, "private-record.json"), {});
  }

  fs.mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
  copyArtifactTree(artifactRoot, archivedArtifacts);
  const record = {
    schemaVersion: 1,
    buildId,
    sourceFingerprint: metadata.sourceFingerprint,
    seed: String(metadata.seed),
    customerId: String(metadata.customerId || "generic"),
    compilerVersion: String(metadata.compilerVersion || "javascript-migration"),
    publicManifestSha256: sha256(manifestBytes),
    assetHashes: Object.fromEntries(
      (manifest.assets || []).map((asset) => [String(asset.role), String(asset.sha256)]),
    ),
  };
  writeArtifact(releaseRoot, "private-record.json", `${JSON.stringify(record, null, 2)}\n`);
  fs.chmodSync(path.join(releaseRoot, "private-record.json"), 0o600);

  const index = readJson(RELEASE_INDEX_PATH, { schemaVersion: 1, builds: [] });
  if (!Array.isArray(index.builds)) throw new Error("Protected release index is invalid.");
  index.builds.push(buildId);
  writeArtifact(RELEASE_ROOT, "release-index.json", `${JSON.stringify(index, null, 2)}\n`);
  fs.chmodSync(RELEASE_INDEX_PATH, 0o600);
  return record;
}

/**
 * Lists recorded builds in promotion order.
 * @returns {string[]} Recorded build identifiers.
 */
function listProtectedReleases() {
  const index = readJson(RELEASE_INDEX_PATH, { builds: [] });
  return Array.isArray(index.builds) ? index.builds.map(validateBuildId) : [];
}

/**
 * Resolves an archived artifact tree for a validated build.
 * @param {string} buildId Protected build identifier.
 * @returns {string} Archived dist directory.
 */
function resolveProtectedRelease(buildId) {
  const releaseRoot = path.join(RELEASE_ROOT, validateBuildId(buildId), "dist");
  if (!fs.existsSync(path.join(releaseRoot, "asset-manifest.json"))) {
    throw new Error(`Protected release is not available: ${buildId}`);
  }
  return releaseRoot;
}

module.exports = Object.freeze({
  RELEASE_ROOT,
  copyArtifactTree,
  listProtectedReleases,
  recordProtectedRelease,
  resolveProtectedRelease,
  validateBuildId,
});
