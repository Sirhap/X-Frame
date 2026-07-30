"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createGodotHandoffService, GodotHandoffError } = require("../godot_handoff");
const { createProjectStore } = require("../project_store");
const { createServerIoOperations } = require("../animation_tuner/server_io_operations");

const RUNTIME_FILES = [
  "runtime/xsxb_frame_actor.gd",
  "runtime/xsxb_frame_actor.tscn",
  "runtime/xsxb_runtime_test.tscn",
  "runtime/xsxb_attack_trail_renderer.gd",
  "runtime/xsxb_attack_trail.gdshader",
];
const DATA_FILES = [
  "animation_manifest.json",
  "animation_tuning.json",
  "frame_audio_bindings.json",
  "frame_image_attachments.json",
  "attack_trails.json",
];

/** @returns {object} Isolated handoff fixture. */
function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-handoff-"));
  const projectStore = createProjectStore(root);
  projectStore.addProject({ id: "demo", label: "Demo" });
  let project = projectStore.activeProject("demo");
  projectStore.writeJson(projectStore.projectPaths(project).manifest, {
    schemaVersion: 1,
    profiles: [{ id: "hero", animations: [{ id: "idle", frames: [] }] }],
  });
  const { projectDataRevision, createFilesystemSnapshot } = createServerIoOperations({
    root,
    projectStore,
    Worker: function UnusedWorker() {},
  });
  let syncFailure = null;
  const syncGodotProjectAsync = async (boundProject) => {
    const outputRoot = path.join(boundProject.projectRoot, "xsxb_frame_tuner");
    fs.mkdirSync(outputRoot, { recursive: true });
    fs.writeFileSync(path.join(outputRoot, "partial.txt"), "partial", "utf8");
    if (syncFailure) throw syncFailure;
    for (const relative of RUNTIME_FILES) {
      const target = path.join(outputRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, relative, "utf8");
    }
    for (const fileName of DATA_FILES) {
      const target = path.join(outputRoot, "data", "projects", boundProject.id, fileName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "{}\n", "utf8");
    }
    return { ok: true, projectRoot: boundProject.projectRoot };
  };
  const service = createGodotHandoffService({
    root,
    projectStore,
    projectDataRevision,
    syncGodotProjectAsync,
    createFilesystemSnapshot,
    readManifest: (entry) => projectStore.readJson(projectStore.projectPaths(entry).manifest, {}),
    validateProject: () => [],
    now: () => new Date("2026-07-28T12:00:00.000Z"),
  });
  return {
    root,
    projectStore,
    projectDataRevision,
    service,
    project: () => {
      project = projectStore.activeProject("demo");
      return project;
    },
    createGodotRoot(name) {
      const godotRoot = path.join(root, name);
      fs.mkdirSync(godotRoot, { recursive: true });
      fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Demo"\n');
      return godotRoot;
    },
    failSync(error) {
      syncFailure = error;
    },
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("handoff validates roots and binds with immediate strict synchronization", async () => {
  const fixture = createFixture();
  try {
    assert.equal(fixture.service.status(fixture.project()).state, "local_only");
    assert.throws(
      () => fixture.service.validateRoot("relative/project"),
      (error) => error instanceof GodotHandoffError && error.code === "invalid_project_root",
    );
    const missingProjectFile = path.join(fixture.root, "not-godot");
    fs.mkdirSync(missingProjectFile);
    assert.throws(
      () => fixture.service.validateRoot(missingProjectFile),
      (error) => error.code === "project_godot_missing",
    );

    const godotRoot = fixture.createGodotRoot("game");
    const result = await fixture.service.execute(fixture.project(), {
      action: "bind",
      projectId: "demo",
      projectRoot: godotRoot,
      baseRevision: fixture.projectDataRevision(fixture.project()),
    });
    assert.equal(result.godotSync.ok, true);
    assert.equal(result.godotHandoff.state, "gameplay_ready");
    assert.equal(result.godotHandoff.lastSync.revision, result.dataRevision);
    assert.equal(fixture.project().projectRoot, godotRoot);
    assert.equal(
      fixture.projectStore.readJson(fixture.projectStore.projectPaths(fixture.project()).godotHandoff, {})
        .schemaVersion,
      1,
    );

    const manifestPath = fixture.projectStore.projectPaths(fixture.project()).manifest;
    fixture.projectStore.writeJson(manifestPath, { schemaVersion: 1, profiles: [] });
    assert.equal(fixture.service.status(fixture.project()).state, "sync_required");
  } finally {
    fixture.dispose();
  }
});

test("handoff rejects revision, root conflicts, and unconfirmed rebinds", async () => {
  const fixture = createFixture();
  try {
    const firstRoot = fixture.createGodotRoot("first-game");
    await fixture.service.execute(fixture.project(), { action: "bind", projectRoot: firstRoot });
    const secondRoot = fixture.createGodotRoot("second-game");
    await assert.rejects(
      fixture.service.execute(fixture.project(), {
        action: "bind",
        projectRoot: secondRoot,
        baseRevision: "stale",
      }),
      (error) => error.code === "revision_conflict" && error.status === 409,
    );
    await assert.rejects(
      fixture.service.execute(fixture.project(), { action: "bind", projectRoot: secondRoot }),
      (error) => error.code === "rebind_confirmation_required" && error.status === 409,
    );

    fixture.projectStore.addProject({ id: "other", label: "Other", projectRoot: secondRoot });
    await assert.rejects(
      fixture.service.execute(fixture.project(), {
        action: "bind",
        projectRoot: secondRoot,
        confirmRebind: true,
      }),
      (error) => error.code === "project_root_conflict" && error.details.conflictingProjectId === "other",
    );
  } finally {
    fixture.dispose();
  }
});

test("handoff keeps old external output on rebind and unbind", async () => {
  const fixture = createFixture();
  try {
    const firstRoot = fixture.createGodotRoot("first-game");
    await fixture.service.execute(fixture.project(), { action: "bind", projectRoot: firstRoot });
    const oldOutput = path.join(firstRoot, "xsxb_frame_tuner", "partial.txt");
    assert.equal(fs.existsSync(oldOutput), true);

    const secondRoot = fixture.createGodotRoot("second-game");
    await fixture.service.execute(fixture.project(), {
      action: "bind",
      projectRoot: secondRoot,
      confirmRebind: true,
    });
    assert.equal(fs.existsSync(oldOutput), true);

    const result = await fixture.service.execute(fixture.project(), { action: "unbind" });
    assert.equal(result.godotHandoff.state, "local_only");
    assert.equal(fixture.project().projectRoot, "");
    assert.equal(fs.existsSync(path.join(secondRoot, "xsxb_frame_tuner")), true);
  } finally {
    fixture.dispose();
  }
});

test("handoff rolls back partial external sync and preserves retryable binding", async () => {
  const fixture = createFixture();
  try {
    const godotRoot = fixture.createGodotRoot("game");
    fixture.failSync(new Error("disk full"));
    await assert.rejects(
      fixture.service.execute(fixture.project(), { action: "bind", projectRoot: godotRoot }),
      (error) =>
        error.code === "godot_sync_failed" &&
        error.details.godotHandoff.state === "sync_failed" &&
        error.details.dataRevision === fixture.projectDataRevision(fixture.project()),
    );
    assert.equal(fixture.project().projectRoot, godotRoot);
    assert.equal(fs.existsSync(path.join(godotRoot, "xsxb_frame_tuner", "partial.txt")), false);
    assert.equal(fixture.service.status(fixture.project()).state, "sync_failed");
  } finally {
    fixture.dispose();
  }
});
