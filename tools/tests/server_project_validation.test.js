"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectValidation } = require("../animation_tuner/server_project_validation");

test("project validation lists real scenes and skips generated tuner scenes", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-project-validation-"));
  try {
    fs.mkdirSync(path.join(projectRoot, "game"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "x_frame", "runtime"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "game", "arena.tscn"), "[gd_scene]");
    fs.writeFileSync(path.join(projectRoot, "x_frame", "runtime", "preview.tscn"), "[gd_scene]");

    const controller = createProjectValidation();
    assert.deepEqual(controller.listSceneFiles(projectRoot), [
      { id: "res://game/arena.tscn", label: "arena", path: "game/arena.tscn" },
    ]);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("project validation reports source-heavy local binding keys", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-project-validation-"));
  try {
    const project = { id: "demo", projectRoot };
    const dataRoot = path.join(projectRoot, "x_frame", "data", "projects", "demo");
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(path.join(dataRoot, "frame_audio_bindings.json"), "[]");
    fs.writeFileSync(path.join(dataRoot, "frame_image_attachments.json"), "[]");
    const controller = createProjectValidation({
      projectStore: {
        readJson: () => [{ key: "hero/run:source:frame-01" }],
      },
    });
    const warnings = controller.validateGameLocalBindingKeys(project);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /source-heavy/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
