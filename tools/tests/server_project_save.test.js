"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createProjectSaveTransaction } = require("../animation_tuner/server_project_save");

/**
 * Creates deterministic save-transaction adapters and call records.
 * @param {object} [overrides] Adapter overrides for one behavior test.
 * @returns {{saveTransaction:object,project:object,payload:object,calls:object,localSnapshot:object,externalSnapshot:object}}
 */
function createHarness(overrides = {}) {
  const project = { id: "project-a", kind: overrides.projectKind || "godot" };
  const payload = {
    baseRevision: "revision-a",
    frame_audio_bindings: [{ key: "walk:0" }],
    frame_image_attachments: [{ key: "walk:0:fx" }],
    attack_trails: { schemaVersion: 1, bindings: {} },
    codex_pet_exports: [{ profileId: "pet-a" }],
  };
  const calls = {
    lockIds: [],
    snapshotPaths: [],
    saves: [],
    syncOptions: [],
    clearedProfiles: [],
    petSyncs: 0,
    handoffFailures: [],
  };
  const localSnapshot = {
    disposed: 0,
    restored: 0,
    async dispose() {
      this.disposed += 1;
    },
    async restore() {
      this.restored += 1;
      if (overrides.localRestoreError) throw overrides.localRestoreError;
    },
  };
  const externalSnapshot = {
    disposed: 0,
    restored: 0,
    async dispose() {
      this.disposed += 1;
    },
    async restore() {
      this.restored += 1;
      if (overrides.externalRestoreError) throw overrides.externalRestoreError;
    },
  };
  const snapshotQueue = [localSnapshot, externalSnapshot];
  const saveTransaction = createProjectSaveTransaction({
    root: "/tmp/xsxb-root",
    projectStore: {
      projectPaths: () => ({
        tuning: "/tmp/xsxb-root/data/tuning.json",
        frameAudio: "/tmp/xsxb-root/data/frame-audio.json",
        frameImageAttachments: "/tmp/xsxb-root/data/frame-images.json",
        attackTrails: "/tmp/xsxb-root/data/attack-trails.json",
      }),
    },
    writeLock: async (projectId, operation) => {
      calls.lockIds.push(projectId);
      return operation();
    },
    revisions: {
      current: () => overrides.currentRevision || "revision-a",
    },
    snapshots: {
      paths: () => ["/tmp/xsxb-root/data/tuning.json", "/tmp/godot/runtime.gd"],
      create: async (paths) => {
        calls.snapshotPaths.push(paths);
        return snapshotQueue.shift();
      },
    },
    persistence: {
      saveTuning: (value, savedProject) => {
        calls.saves.push(["tuning", value, savedProject]);
        if (overrides.saveTuningError) throw overrides.saveTuningError;
      },
      saveFrameAudio: (value) => {
        calls.saves.push(["audio", value]);
        return [{ key: "saved-audio" }];
      },
      saveFrameImages: (value) => {
        calls.saves.push(["images", value]);
        return [{ key: "saved-image" }];
      },
      saveAttackTrails: (value) => {
        calls.saves.push(["trails", value]);
        return { schemaVersion: 1, bindings: { saved: [] } };
      },
      emptyAttackTrails: { schemaVersion: 1, bindings: {} },
    },
    pets: {
      export: (_projectStore, _project, entry) => ({ profileId: entry.profileId, exported: true }),
      clearTuning: (_projectStore, _project, profileIds) => calls.clearedProfiles.push(profileIds),
      sync: () => {
        calls.petSyncs += 1;
      },
    },
    godot: {
      sync: async (_project, options) => {
        calls.syncOptions.push(options);
        if (overrides.syncError) throw overrides.syncError;
        return { ok: true };
      },
      syncRuntimeProjectId: () => ["runtime.gd"],
      handoffStatus: () => ({ state: overrides.syncError ? "sync_failed" : "synced" }),
      markSyncFailed: (_project, error) => calls.handoffFailures.push(error),
    },
    projectView: {
      readTuning: () => ({ values: { saved: true } }),
      tuningForClient: (value) => value,
      readManifest: () => ({ profiles: [] }),
      validate: () => ["warning-a"],
    },
  });
  return { saveTransaction, project, payload, calls, localSnapshot, externalSnapshot };
}

test("project save rejects a stale revision before creating snapshots", async () => {
  const fixture = createHarness({ currentRevision: "revision-new" });
  const result = await fixture.saveTransaction.save(fixture.project, fixture.payload);
  assert.deepEqual(result, { kind: "revision_conflict", dataRevision: "revision-new" });
  assert.deepEqual(fixture.calls.snapshotPaths, []);
  assert.deepEqual(fixture.calls.saves, []);
});

test("project save commits local data, synchronizes Godot, and disposes snapshots", async () => {
  const fixture = createHarness();
  const result = await fixture.saveTransaction.save(fixture.project, fixture.payload);

  assert.equal(result.kind, "saved");
  assert.equal(result.payload.ok, true);
  assert.deepEqual(result.payload.godotSync, { ok: true });
  assert.deepEqual(result.payload.runtimeProjectIdFiles, ["runtime.gd"]);
  assert.deepEqual(result.payload.warnings, ["warning-a"]);
  assert.deepEqual(fixture.calls.lockIds, ["project-a"]);
  assert.deepEqual(fixture.calls.snapshotPaths, [
    [
      "/tmp/xsxb-root/data/tuning.json",
      "/tmp/xsxb-root/data/frame-audio.json",
      "/tmp/xsxb-root/data/frame-images.json",
      "/tmp/xsxb-root/data/attack-trails.json",
    ],
    ["/tmp/godot/runtime.gd"],
  ]);
  assert.deepEqual(fixture.calls.syncOptions, [
    {
      frameAudioBindings: [{ key: "saved-audio" }],
      frameImageAttachments: [{ key: "saved-image" }],
      attackTrails: { schemaVersion: 1, bindings: { saved: [] } },
    },
  ]);
  assert.equal(fixture.localSnapshot.restored, 0);
  assert.equal(fixture.externalSnapshot.restored, 0);
  assert.equal(fixture.localSnapshot.disposed, 1);
  assert.equal(fixture.externalSnapshot.disposed, 1);
});

test("Codex Pet save exports profiles and clears exported tuning", async () => {
  const fixture = createHarness({ projectKind: "codex_pets" });
  const result = await fixture.saveTransaction.save(fixture.project, fixture.payload);
  assert.deepEqual(result.payload.codexPetExports, [{ profileId: "pet-a", exported: true }]);
  assert.deepEqual(fixture.calls.clearedProfiles, [["pet-a"]]);
  assert.equal(fixture.calls.petSyncs, 1);
});

test("project save restores both snapshots when local persistence fails", async () => {
  const saveError = new Error("local persistence failed");
  const fixture = createHarness({ saveTuningError: saveError });
  await assert.rejects(fixture.saveTransaction.save(fixture.project, fixture.payload), saveError);
  assert.equal(fixture.localSnapshot.restored, 1);
  assert.equal(fixture.externalSnapshot.restored, 1);
  assert.equal(fixture.localSnapshot.disposed, 1);
  assert.equal(fixture.externalSnapshot.disposed, 1);
});

test("project save preserves local data and restores external files when Godot sync fails", async () => {
  const syncError = new Error("Godot sync failed");
  const fixture = createHarness({ syncError });
  const result = await fixture.saveTransaction.save(fixture.project, fixture.payload);

  assert.equal(result.kind, "sync_failed");
  assert.equal(result.payload.localSaved, true);
  assert.equal(result.payload.error, "Godot sync failed");
  assert.equal(fixture.localSnapshot.restored, 0);
  assert.equal(fixture.externalSnapshot.restored, 1);
  assert.deepEqual(fixture.calls.handoffFailures, [syncError]);
  assert.equal(fixture.localSnapshot.disposed, 1);
  assert.equal(fixture.externalSnapshot.disposed, 1);
});

test("project save exposes an incomplete external rollback as an AggregateError", async () => {
  const syncError = new Error("Godot sync failed");
  const rollbackError = new Error("external rollback failed");
  const fixture = createHarness({ syncError, externalRestoreError: rollbackError });
  await assert.rejects(
    fixture.saveTransaction.save(fixture.project, fixture.payload),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === syncError &&
      error.errors[1] === rollbackError &&
      /external rollback was incomplete/u.test(error.message),
  );
  assert.equal(fixture.localSnapshot.disposed, 1);
  assert.equal(fixture.externalSnapshot.disposed, 1);
});
