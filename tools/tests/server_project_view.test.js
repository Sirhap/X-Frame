"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectView } = require("../animation_tuner/server_project_view");

function createEmptyView(overrides = {}) {
  return createProjectView({
    root: "/workspace",
    projectStore: { readRegistry: () => ({ activeProjectId: "", projects: [] }) },
    projectFromRequest: () => ({ registry: { projects: [] }, project: null }),
    emptyTuning: {},
    tuningForClient: (value) => value,
    readManifest: () => ({ profiles: [] }),
    readTuningFile: () => ({}),
    buildGroups: () => [],
    validateProject: () => [],
    profileForClient: (value) => value,
    listSceneFiles: () => [],
    readFrameAudioBindings: () => [],
    readFrameImageAttachments: () => [],
    readAttachmentAssets: () => [],
    projectDataRevision: () => "",
    ...overrides,
  });
}

test("project view preserves empty config response shape", () => {
  const response = createEmptyView().configResponse("");
  assert.equal(response.root, "/workspace");
  assert.deepEqual(response.groups, []);
  assert.deepEqual(response.tuning, {});
  assert.equal(response.godotSync.ok, false);
  assert.equal(response.godotHandoff.state, "local_only");
});

test("project view exposes current Godot handoff state", () => {
  const project = { id: "demo", kind: "godot", projectRoot: "/game" };
  const view = createEmptyView({
    projectFromRequest: () => ({ registry: { projects: [project] }, project }),
    projectStore: {
      projectForClient: (entry) => entry,
      projectWorkspaceDir: () => "/workspace/demo",
    },
    readAttackTrails: () => ({}),
    syncCodexPetProject: () => ({ warnings: [] }),
    godotHandoffForProject: () => ({ state: "sync_required", projectRoot: "/game" }),
  });
  const response = view.configResponse("demo");
  assert.equal(response.godotHandoff.state, "sync_required");
  assert.equal(response.godotSync.ok, false);
  assert.equal(response.godotSync.projectRoot, "/game");
});

test("project summaries expose animation group counts", () => {
  const projects = [
    { id: "ready", label: "Ready" },
    { id: "empty", label: "Empty" },
  ];
  const view = createEmptyView({
    projectStore: {
      readRegistry: () => ({ activeProjectId: "ready", projects }),
      projectForClient: (project) => ({ ...project }),
    },
    readManifest: (project) =>
      project.id === "ready"
        ? { profiles: [{ animations: [{ frames: [{ path: "frame.png" }] }] }] }
        : { profiles: [] },
  });

  const response = view.projectsResponse();

  assert.deepEqual(
    response.projects.map((project) => [project.id, project.animationGroupCount]),
    [
      ["ready", 1],
      ["empty", 0],
    ],
  );
});

test("project summaries leave runtime-synced Codex pet counts unknown", () => {
  const petProject = { id: "codex_pets", kind: "codex_pets", label: "Codex Pets" };
  const view = createEmptyView({
    projectStore: {
      readRegistry: () => ({ activeProjectId: petProject.id, projects: [petProject] }),
      projectForClient: (project) => ({ ...project }),
    },
    readManifest: () => ({ profiles: [] }),
  });

  const [summary] = view.projectsResponse().projects;

  assert.equal(Object.hasOwn(summary, "animationGroupCount"), false);
});

test("runtime project id sync updates only GDScript constants", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-project-view-"));
  try {
    fs.mkdirSync(path.join(projectRoot, "addons"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "actor.gd"), 'const XSXB_PROJECT_ID: String = "old"\n');
    fs.writeFileSync(
      path.join(projectRoot, "addons", "plugin.gd"),
      'const XSXB_PROJECT_ID: String = "old"\n',
    );
    const view = createEmptyView();
    const changed = view.syncGodotRuntimeProjectId({ id: "new", projectRoot });
    assert.deepEqual(changed, ["actor.gd"]);
    assert.match(fs.readFileSync(path.join(projectRoot, "actor.gd"), "utf8"), /"new"/);
    assert.match(fs.readFileSync(path.join(projectRoot, "addons", "plugin.gd"), "utf8"), /"old"/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
