"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { listProtectedReleases, resolveProtectedRelease } = require("./release_store");

const ROTATED_ROLES = Object.freeze(["ui", "product-algorithm", "frame-analysis"]);

/**
 * Verifies that protected code roles rotate without perturbing unchanged public assets.
 * @param {string} leftBuild First build identifier.
 * @param {string} rightBuild Second build identifier.
 * @returns {object} Rotation evidence.
 */
function verifyProtectedRotation(leftBuild, rightBuild) {
  const readManifest = (buildId) =>
    JSON.parse(fs.readFileSync(path.join(resolveProtectedRelease(buildId), "asset-manifest.json"), "utf8"));
  const left = readManifest(leftBuild);
  const right = readManifest(rightBuild);
  if (left.sourceFingerprint !== right.sourceFingerprint) {
    throw new Error("Rotation comparison requires the same production source fingerprint.");
  }
  const leftHashes = new Map(left.assets.map((asset) => [asset.role, asset.sha256]));
  const unchanged = ROTATED_ROLES.filter(
    (role) => leftHashes.get(role) === right.assets.find((asset) => asset.role === role)?.sha256,
  );
  if (unchanged.length > 0) throw new Error(`Protected roles did not rotate: ${unchanged.join(", ")}`);
  return {
    sourceFingerprint: left.sourceFingerprint,
    leftBuild: left.buildId,
    rightBuild: right.buildId,
    rotatedRoles: ROTATED_ROLES,
  };
}

if (require.main === module) {
  try {
    const releases = listProtectedReleases();
    const leftBuild = process.argv[2] || releases.at(-2);
    const rightBuild = process.argv[3] || releases.at(-1);
    if (!leftBuild || !rightBuild) throw new Error("Two protected releases are required.");
    process.stdout.write(`${JSON.stringify(verifyProtectedRotation(leftBuild, rightBuild), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Protected rotation verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ ROTATED_ROLES, verifyProtectedRotation });
