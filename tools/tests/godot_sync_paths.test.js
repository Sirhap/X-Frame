"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { GODOT_SYNC_ROOT, localFrameRelPath, syncManifest } = require("../godot_sync");
const { createProjectStore } = require("../project_store");

test("localFrameRelPath keeps Godot copies inside xsxb_frame_tuner/", () => {
  assert.equal(localFrameRelPath("xsxb_frame_tuner/../art/hero.png"), `${GODOT_SYNC_ROOT}/hero.png`);
  assert.equal(
    localFrameRelPath("workspace/projects/demo/a.png"),
    `${GODOT_SYNC_ROOT}/workspace/projects/demo/a.png`,
  );
  assert.ok(localFrameRelPath("xsxb_frame_tuner/assets/a.png").startsWith(`${GODOT_SYNC_ROOT}/`));
  assert.ok(!localFrameRelPath("xsxb_frame_tuner/../art/hero.png").includes(".."));
});

test("syncManifest does not write escaped frame paths outside the sandbox", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-sync-sandbox-"));
  const godotRoot = path.join(root, "godot");
  const artDir = path.join(godotRoot, "art");
  fs.mkdirSync(artDir, { recursive: true });
  fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Sync"\n');
  const victim = path.join(artDir, "hero.png");
  fs.writeFileSync(victim, "original");
  const store = createProjectStore(root);
  store.addProject({ id: "sync", label: "Sync", projectRoot: godotRoot });
  const project = store.resolveProject(store.readRegistry(), "sync");
  const source = path.join(root, "workspace/projects/sync/assets/frame.png");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, "frame-bytes");
  store.writeJson(store.projectPaths(project).manifest, {
    schemaVersion: 1,
    profiles: [
      {
        id: "hero",
        animations: [
          {
            id: "idle",
            frames: [{ path: "xsxb_frame_tuner/../art/hero.png", name: "hero.png" }],
          },
        ],
      },
    ],
  });
  try {
    syncManifest(root, store, project);
    assert.equal(fs.readFileSync(victim, "utf8"), "original");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
