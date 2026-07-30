"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DIST_ROOT, PROJECT_ROOT } = require("./config");
const { copyArtifactTree, listProtectedReleases, resolveProtectedRelease } = require("./release_store");

const RESTORE_ROOT = path.join(PROJECT_ROOT, `.dist-restore-${process.pid}`);
const BACKUP_ROOT = path.join(PROJECT_ROOT, `.dist-restore-backup-${process.pid}`);

/**
 * Restores a previously archived protected artifact without exposing source fallback files.
 * @param {string} buildId Protected build identifier.
 * @returns {void}
 */
function restoreProtectedRelease(buildId) {
  const archivedRoot = resolveProtectedRelease(buildId);
  fs.rmSync(RESTORE_ROOT, { force: true, recursive: true });
  fs.rmSync(BACKUP_ROOT, { force: true, recursive: true });
  fs.mkdirSync(RESTORE_ROOT, { recursive: true });
  copyArtifactTree(archivedRoot, RESTORE_ROOT);

  const hadCurrent = fs.existsSync(DIST_ROOT);
  if (hadCurrent) fs.renameSync(DIST_ROOT, BACKUP_ROOT);
  try {
    fs.renameSync(RESTORE_ROOT, DIST_ROOT);
    fs.rmSync(BACKUP_ROOT, { force: true, recursive: true });
  } catch (error) {
    if (hadCurrent && fs.existsSync(BACKUP_ROOT) && !fs.existsSync(DIST_ROOT)) {
      fs.renameSync(BACKUP_ROOT, DIST_ROOT);
    }
    throw error;
  }
}

if (require.main === module) {
  const requestedBuild = process.argv[2];
  const releases = listProtectedReleases();
  const buildId = requestedBuild || releases.at(-2);
  if (!buildId) {
    process.stderr.write("No previous protected release is available.\n");
    process.exitCode = 1;
  } else {
    try {
      restoreProtectedRelease(buildId);
      process.stdout.write(`Restored protected release ${buildId}.\n`);
    } catch (error) {
      process.stderr.write(`Protected rollback failed: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}

module.exports = Object.freeze({ restoreProtectedRelease });
