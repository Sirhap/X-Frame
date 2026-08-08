"use strict";

const path = require("node:path");

/**
 * Returns a required function dependency or rejects an incomplete adapter.
 * @param {object} owner Adapter containing the function.
 * @param {string} name Function property name.
 * @param {string} adapterName Adapter label used in diagnostics.
 * @returns {Function} Required function.
 */
function requiredFunction(owner, name, adapterName) {
  const value = owner?.[name];
  if (typeof value !== "function") {
    throw new TypeError(`Project save ${adapterName}.${name} must be a function.`);
  }
  return value;
}

/**
 * Restores every requested snapshot and returns all rollback failures.
 * @param {object[]} snapshots Filesystem snapshots to restore.
 * @returns {Promise<Error[]>} Rollback failures in snapshot order.
 */
async function restoreSnapshots(snapshots) {
  const errors = [];
  for (const snapshot of snapshots) {
    try {
      await snapshot.restore();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

/**
 * Disposes every transaction snapshot after it is no longer needed.
 * @param {object[]} snapshots Filesystem snapshots to dispose.
 * @returns {Promise<void>}
 */
async function disposeSnapshots(snapshots) {
  for (const snapshot of snapshots) await snapshot.dispose();
}

/**
 * Creates the revision-safe project save transaction.
 * @param {{root:string,projectStore:{projectPaths:Function},writeLock:Function,revisions:{current:Function},snapshots:{paths:Function,create:Function},persistence:{saveTuning:Function,saveFrameAudio:Function,saveFrameImages:Function,saveAttackTrails:Function,emptyAttackTrails:object},pets:{export:Function,clearTuning:Function,sync:Function},godot:{sync:Function,syncRuntimeProjectId:Function,handoffStatus:Function,markSyncFailed:Function},projectView:{readTuning:Function,tuningForClient:Function,readManifest:Function,validate:Function}}} dependencies Save transaction adapters.
 * @returns {{save:(project:object,payload:object)=>Promise<object>}} Project save operations.
 */
function createProjectSaveTransaction(dependencies = {}) {
  const {
    root = "",
    projectStore,
    writeLock,
    revisions = {},
    snapshots = {},
    persistence = {},
    pets = {},
    godot = {},
    projectView = {},
  } = dependencies;
  if (!projectStore || typeof projectStore.projectPaths !== "function") {
    throw new TypeError("Project save projectStore.projectPaths must be a function.");
  }
  if (typeof writeLock !== "function") throw new TypeError("Project save writeLock must be a function.");

  const currentRevision = requiredFunction(revisions, "current", "revisions");
  const transactionPaths = requiredFunction(snapshots, "paths", "snapshots");
  const createSnapshot = requiredFunction(snapshots, "create", "snapshots");
  const saveTuning = requiredFunction(persistence, "saveTuning", "persistence");
  const saveFrameAudio = requiredFunction(persistence, "saveFrameAudio", "persistence");
  const saveFrameImages = requiredFunction(persistence, "saveFrameImages", "persistence");
  const saveAttackTrails = requiredFunction(persistence, "saveAttackTrails", "persistence");
  const exportPet = requiredFunction(pets, "export", "pets");
  const clearPetTuning = requiredFunction(pets, "clearTuning", "pets");
  const syncPets = requiredFunction(pets, "sync", "pets");
  const syncGodot = requiredFunction(godot, "sync", "godot");
  const syncRuntimeProjectId = requiredFunction(godot, "syncRuntimeProjectId", "godot");
  const handoffStatus = requiredFunction(godot, "handoffStatus", "godot");
  const markSyncFailed = requiredFunction(godot, "markSyncFailed", "godot");
  const readTuning = requiredFunction(projectView, "readTuning", "projectView");
  const tuningForClient = requiredFunction(projectView, "tuningForClient", "projectView");
  const readManifest = requiredFunction(projectView, "readManifest", "projectView");
  const validateProject = requiredFunction(projectView, "validate", "projectView");

  /**
   * Performs one save while holding the project write lock.
   * @param {object} project Active project record.
   * @param {object} payload Validated save payload.
   * @returns {Promise<object>} Tagged save outcome.
   */
  async function saveLocked(project, payload) {
    const dataRevision = currentRevision(project);
    const baseRevision = String(payload.baseRevision || "");
    if (baseRevision && baseRevision !== dataRevision) {
      return { kind: "revision_conflict", dataRevision };
    }

    const projectPaths = projectStore.projectPaths(project);
    const localSavePaths = [
      projectPaths.tuning,
      projectPaths.frameAudio,
      projectPaths.frameImageAttachments,
      projectPaths.attackTrails,
    ].filter(Boolean);
    const localPathSet = new Set(localSavePaths.map((entry) => path.resolve(entry)));
    const externalSavePaths = transactionPaths(project).filter(
      (entry) => !localPathSet.has(path.resolve(entry)),
    );
    const localSnapshot = await createSnapshot(localSavePaths);
    let externalSnapshot;
    try {
      externalSnapshot = await createSnapshot(externalSavePaths);
    } catch (error) {
      await localSnapshot.dispose();
      throw error;
    }

    let localSaved = false;
    try {
      saveTuning(payload, project);
      let frameAudioBindings = null;
      if (
        Array.isArray(payload.frame_audio_bindings) ||
        Array.isArray(payload.frameAudioBindings) ||
        payload.frameAudioBindings
      ) {
        frameAudioBindings = saveFrameAudio(
          payload.frame_audio_bindings || payload.frameAudioBindings,
          project,
        );
      }
      let frameImageAttachments = null;
      if (Array.isArray(payload.frame_image_attachments) || Array.isArray(payload.frameImageAttachments)) {
        frameImageAttachments = saveFrameImages(
          payload.frame_image_attachments || payload.frameImageAttachments,
          project,
        );
      }
      const attackTrails = saveAttackTrails(
        payload.attack_trails || payload.attackTrails || persistence.emptyAttackTrails,
        project,
      );
      const codexPetExports = [];
      if (project.kind === "codex_pets") {
        for (const entry of Array.isArray(payload.codex_pet_exports) ? payload.codex_pet_exports : []) {
          codexPetExports.push(exportPet(projectStore, project, entry));
        }
        clearPetTuning(
          projectStore,
          project,
          codexPetExports.map((entry) => entry.profileId),
        );
        syncPets(root, projectStore, project);
      }
      localSaved = true;

      const godotSync = await syncGodot(project, {
        ...(frameAudioBindings ? { frameAudioBindings } : {}),
        ...(frameImageAttachments ? { frameImageAttachments } : {}),
        attackTrails,
      });
      const runtimeProjectIdFiles = syncRuntimeProjectId(project);
      const savedRevision = currentRevision(project);
      await disposeSnapshots([localSnapshot, externalSnapshot]);
      return {
        kind: "saved",
        payload: {
          ok: true,
          tuning: tuningForClient(readTuning(project)),
          godotSync,
          godotHandoff: handoffStatus(project),
          runtimeProjectIdFiles,
          codexPetExports,
          dataRevision: savedRevision,
          warnings: validateProject(project, readManifest(project)),
        },
      };
    } catch (error) {
      if (localSaved) {
        const rollbackErrors = await restoreSnapshots([externalSnapshot]);
        if (rollbackErrors.length > 0) {
          await disposeSnapshots([localSnapshot, externalSnapshot]);
          throw new AggregateError(
            [error, ...rollbackErrors],
            "Godot synchronization failed and external rollback was incomplete.",
          );
        }
        markSyncFailed(project, error);
        await disposeSnapshots([localSnapshot, externalSnapshot]);
        return {
          kind: "sync_failed",
          payload: {
            ok: false,
            localSaved: true,
            error: String(error?.message || error),
            godotSync: { ok: false, reason: String(error?.message || error) },
            godotHandoff: handoffStatus(project),
            dataRevision: currentRevision(project),
          },
        };
      }

      const rollbackErrors = await restoreSnapshots([localSnapshot, externalSnapshot]);
      await disposeSnapshots([localSnapshot, externalSnapshot]);
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Save failed and filesystem rollback was incomplete.",
        );
      }
      throw error;
    }
  }

  /**
   * Saves one project under its shared mutation lock.
   * @param {object} project Active project record.
   * @param {object} payload Validated save payload.
   * @returns {Promise<object>} Tagged save outcome.
   */
  function save(project, payload) {
    if (!project?.id) throw new TypeError("Project save requires a project id.");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("Project save payload must be an object.");
    }
    return writeLock(project.id, () => saveLocked(project, payload));
  }

  return { save };
}

module.exports = { createProjectSaveTransaction };
