"use strict";

const defaultFs = require("node:fs");
const defaultPath = require("node:path");

const RECEIPT_SCHEMA_VERSION = 1;
const SYNC_ROOT = "x_frame";
const REQUIRED_RUNTIME_FILES = [
  "runtime/xsxb_frame_actor.gd",
  "runtime/xsxb_frame_actor.tscn",
  "runtime/xsxb_runtime_test.tscn",
  "runtime/xsxb_attack_trail_renderer.gd",
  "runtime/xsxb_attack_trail.gdshader",
];
const REQUIRED_DATA_FILES = [
  "animation_manifest.json",
  "animation_tuning.json",
  "frame_audio_bindings.json",
  "frame_image_attachments.json",
  "attack_trails.json",
];

/** HTTP-safe error emitted by Godot handoff validation and conflicts. */
class GodotHandoffError extends Error {
  /**
   * @param {number} status HTTP status.
   * @param {string} code Stable machine-readable code.
   * @param {string} message User-facing message.
   * @param {object} [details] Additional response fields.
   */
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "GodotHandoffError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** @param {string} left First path. @param {string} right Second path. @returns {boolean} */
function samePath(left, right) {
  if (!left || !right) return false;
  return defaultPath.resolve(left).toLowerCase() === defaultPath.resolve(right).toLowerCase();
}

/**
 * Creates Godot binding, synchronization receipt, and readiness operations.
 * @param {object} dependencies Service dependencies.
 * @returns {{execute:Function,status:Function,markSynced:Function,markSyncFailed:Function,validateRoot:Function}}
 */
function createGodotHandoffService(dependencies = {}) {
  const {
    root,
    projectStore,
    projectDataRevision,
    syncGodotProjectAsync,
    syncGodotRuntimeProjectId = () => [],
    runtimeProjectIdFiles = () => [],
    createFilesystemSnapshot,
    validateProject = () => [],
    readManifest = () => ({ profiles: [] }),
    fs: fsApi = defaultFs,
    path: pathApi = defaultPath,
    now = () => new Date(),
  } = dependencies;
  if (
    !root ||
    !projectStore ||
    typeof projectDataRevision !== "function" ||
    typeof syncGodotProjectAsync !== "function" ||
    typeof createFilesystemSnapshot !== "function"
  ) {
    throw new TypeError("Godot handoff requires project storage, revision, sync, and snapshot services.");
  }
  const fs = fsApi;
  const path = pathApi;

  /** @param {object} project Project record. @returns {string} Receipt file path. */
  function receiptPath(project) {
    return projectStore.projectPaths(project).godotHandoff;
  }

  /** @param {object} project Project record. @returns {object|null} Normalized receipt. */
  function readReceipt(project) {
    const filePath = receiptPath(project);
    if (!filePath || !fs.existsSync(filePath)) return null;
    const receipt = projectStore.readJson(filePath, null);
    if (!receipt || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) return null;
    if (String(receipt.projectId || "") !== String(project.id || "")) return null;
    return receipt;
  }

  /** @param {object} project Project record. @param {object} receipt Receipt document. */
  function writeReceipt(project, receipt) {
    projectStore.writeJson(receiptPath(project), {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      projectId: String(project.id || ""),
      projectRoot: String(project.projectRoot || ""),
      lastSync: receipt.lastSync || null,
      lastFailure: receipt.lastFailure || null,
    });
  }

  /**
   * Validates a user-provided Godot directory without normalizing relative paths.
   * @param {unknown} rawRoot Candidate root.
   * @returns {string} Canonical absolute root.
   */
  function validateRoot(rawRoot) {
    const requested = String(rawRoot || "")
      .trim()
      .replace(/^(["'])|(["'])$/g, "");
    if (!requested || !path.isAbsolute(requested)) {
      throw new GodotHandoffError(
        400,
        "invalid_project_root",
        "Godot project root must be an absolute path.",
      );
    }
    const projectRoot = path.resolve(requested);
    let stat;
    try {
      stat = fs.statSync(projectRoot);
    } catch (_error) {
      throw new GodotHandoffError(
        400,
        "project_root_not_found",
        `Godot project root does not exist: ${projectRoot}`,
      );
    }
    if (!stat.isDirectory()) {
      throw new GodotHandoffError(
        400,
        "project_root_not_directory",
        `Godot project root is not a directory: ${projectRoot}`,
      );
    }
    const projectFile = path.join(projectRoot, "project.godot");
    if (!fs.existsSync(projectFile) || !fs.statSync(projectFile).isFile()) {
      throw new GodotHandoffError(
        400,
        "project_godot_missing",
        `project.godot was not found under: ${projectRoot}`,
      );
    }
    try {
      fs.accessSync(projectRoot, fs.constants.R_OK | fs.constants.W_OK);
      fs.accessSync(projectFile, fs.constants.R_OK);
    } catch (_error) {
      throw new GodotHandoffError(
        400,
        "project_root_not_writable",
        `Godot project root must be readable and writable: ${projectRoot}`,
      );
    }
    return projectRoot;
  }

  /** @param {object} project Project record. @returns {string[]} Missing synchronized output paths. */
  function missingOutputs(project) {
    const projectRoot = path.resolve(String(project.projectRoot || ""));
    const base = path.join(projectRoot, SYNC_ROOT);
    const required = [
      ...REQUIRED_RUNTIME_FILES.map((entry) => path.join(base, entry)),
      ...REQUIRED_DATA_FILES.map((entry) => path.join(base, "data", "projects", project.id, entry)),
    ];
    return required
      .filter((entry) => !fs.existsSync(entry))
      .map((entry) => path.relative(projectRoot, entry));
  }

  /**
   * Computes client-facing handoff state from binding, receipt, outputs, and strict gameplay validation.
   * @param {object|null|undefined} project Project record.
   * @returns {object} Stable handoff status.
   */
  function status(project) {
    const projectRoot = String(project?.projectRoot || "");
    const base = {
      state: "local_only",
      projectRoot,
      message: projectRoot ? "" : "Project is not bound to a Godot project.",
      blockers: [],
      warnings: [],
      lastSync: null,
    };
    if (!project || !projectRoot || project.kind === "codex_pets") return base;
    try {
      validateRoot(projectRoot);
    } catch (error) {
      return {
        ...base,
        state: "invalid_root",
        message: error.message,
        blockers: [error.message],
      };
    }

    const receipt = readReceipt(project);
    if (receipt?.lastFailure) {
      return {
        ...base,
        state: "sync_failed",
        message: String(receipt.lastFailure.message || "Godot synchronization failed."),
        blockers: [String(receipt.lastFailure.message || "Godot synchronization failed.")],
        lastSync: receipt.lastSync || null,
      };
    }
    const currentRevision = projectDataRevision(project);
    const outputGaps = missingOutputs(project);
    if (
      !receipt?.lastSync ||
      !samePath(receipt.projectRoot, projectRoot) ||
      receipt.lastSync.revision !== currentRevision ||
      outputGaps.length
    ) {
      const blockers = [];
      if (!receipt?.lastSync) blockers.push("Godot project has not been synchronized.");
      else if (receipt.lastSync.revision !== currentRevision)
        blockers.push("Local project data changed after the last Godot synchronization.");
      if (outputGaps.length) blockers.push(`Missing synchronized outputs: ${outputGaps.join(", ")}`);
      return {
        ...base,
        state: "sync_required",
        message: blockers[0] || "Godot synchronization is required.",
        blockers,
        lastSync: receipt?.lastSync || null,
      };
    }

    const manifest = readManifest(project);
    const hasAnimations = (Array.isArray(manifest?.profiles) ? manifest.profiles : []).some(
      (profile) => Array.isArray(profile?.animations) && profile.animations.length > 0,
    );
    const gameplayBlockers = hasAnimations
      ? validateProject(project, manifest)
      : ["No animation is available for gameplay validation."];
    return {
      ...base,
      state: gameplayBlockers.length ? "synced" : "gameplay_ready",
      message: gameplayBlockers.length
        ? "Godot data is synchronized; gameplay integration still needs attention."
        : "Godot gameplay integration is ready.",
      blockers: gameplayBlockers,
      warnings: gameplayBlockers,
      lastSync: receipt.lastSync,
    };
  }

  /**
   * Records a successful synchronization after local project data is stable.
   * @param {object} project Project record.
   * @param {object} godotSync Synchronization result.
   * @returns {object} Updated client status.
   */
  function markSynced(project, godotSync) {
    if (!godotSync?.ok || !project?.projectRoot) return status(project);
    writeReceipt(project, {
      lastSync: {
        revision: projectDataRevision(project),
        completedAt: now().toISOString(),
      },
      lastFailure: null,
    });
    return status(project);
  }

  /**
   * Records a retryable synchronization failure while retaining any previous successful receipt.
   * @param {object} project Project record.
   * @param {unknown} cause Failure cause.
   * @returns {object} Updated client status.
   */
  function markSyncFailed(project, cause) {
    const previous = readReceipt(project);
    writeReceipt(project, {
      lastSync: previous?.lastSync || null,
      lastFailure: {
        message: String(cause?.message || cause || "Godot synchronization failed."),
        failedAt: now().toISOString(),
      },
    });
    return status(project);
  }

  /** @param {object} project Project record. @param {string} requestedRoot Candidate binding. */
  function assertNoConflict(project, requestedRoot) {
    const registry = projectStore.readRegistry();
    const conflict = registry.projects.find(
      (entry) => entry.id !== project.id && samePath(entry.projectRoot, requestedRoot),
    );
    if (conflict) {
      throw new GodotHandoffError(
        409,
        "project_root_conflict",
        `Godot project root is already bound to ${conflict.label || conflict.id}.`,
        { conflictingProjectId: conflict.id },
      );
    }
  }

  /** @param {object} project Project record. @param {string} baseRevision Client revision. */
  function assertRevision(project, baseRevision) {
    const currentRevision = projectDataRevision(project);
    if (baseRevision && baseRevision !== currentRevision) {
      throw new GodotHandoffError(
        409,
        "revision_conflict",
        "Project data changed in another window. Reload before updating the Godot binding.",
        { dataRevision: currentRevision },
      );
    }
  }

  /** @param {object} project Project record. @returns {Promise<{godotSync:object,godotHandoff:object}>} */
  async function synchronize(project) {
    const outputRoot = path.join(path.resolve(project.projectRoot), SYNC_ROOT);
    const transaction = await createFilesystemSnapshot([outputRoot, ...runtimeProjectIdFiles(project)]);
    try {
      const godotSync = await syncGodotProjectAsync(project);
      if (!godotSync?.ok) throw new Error(godotSync?.reason || "Godot synchronization failed.");
      syncGodotRuntimeProjectId(project);
      const godotHandoff = markSynced(project, godotSync);
      await transaction.dispose();
      return { godotSync, godotHandoff };
    } catch (error) {
      try {
        await transaction.restore();
      } catch (rollbackError) {
        await transaction.dispose();
        const aggregate = new AggregateError(
          [error, rollbackError],
          "Godot synchronization failed and external rollback was incomplete.",
        );
        markSyncFailed(project, aggregate);
        throw aggregate;
      }
      await transaction.dispose();
      markSyncFailed(project, error);
      throw error;
    }
  }

  /**
   * Executes bind, sync, or unbind against an already serialized project write.
   * @param {object} project Current project record.
   * @param {object} payload Request payload.
   * @returns {Promise<object>} Handoff result.
   */
  async function execute(project, payload = {}) {
    const action = String(payload.action || "")
      .trim()
      .toLowerCase();
    if (!["bind", "sync", "unbind"].includes(action)) {
      throw new GodotHandoffError(400, "invalid_handoff_action", "Expected action bind, sync, or unbind.");
    }
    assertRevision(project, String(payload.baseRevision || ""));
    if (action === "unbind") {
      const updated = projectStore.setProjectRoot(project.id, "").project;
      const filePath = receiptPath(updated);
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      return {
        godotSync: { ok: false, reason: "No bound Godot project root" },
        godotHandoff: status(updated),
        dataRevision: projectDataRevision(updated),
      };
    }

    let boundProject = project;
    if (action === "bind") {
      const requestedRoot = validateRoot(payload.projectRoot);
      assertNoConflict(project, requestedRoot);
      if (project.projectRoot && !samePath(project.projectRoot, requestedRoot) && !payload.confirmRebind) {
        throw new GodotHandoffError(
          409,
          "rebind_confirmation_required",
          "This project is already bound. Confirm rebind to preserve the old Godot output and use the new root.",
          { currentProjectRoot: project.projectRoot, requestedProjectRoot: requestedRoot },
        );
      }
      boundProject = projectStore.setProjectRoot(project.id, requestedRoot).project;
    } else {
      validateRoot(project.projectRoot);
    }

    try {
      const result = await synchronize(boundProject);
      return { ...result, dataRevision: projectDataRevision(boundProject) };
    } catch (error) {
      throw new GodotHandoffError(500, "godot_sync_failed", String(error.message || error), {
        godotSync: { ok: false, reason: String(error.message || error) },
        godotHandoff: status(boundProject),
        dataRevision: projectDataRevision(boundProject),
      });
    }
  }

  return { execute, markSynced, markSyncFailed, status, validateRoot };
}

module.exports = {
  GodotHandoffError,
  RECEIPT_SCHEMA_VERSION,
  createGodotHandoffService,
};
