"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectInspection } = require("../project_inspection");

test("project inspection reads each relevant source once and skips dependency folders", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-project-inspection-"));
  try {
    fs.mkdirSync(path.join(root, "actors"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "ignored"), { recursive: true });
    fs.writeFileSync(path.join(root, "actors", "hero.gd"), "extends Node2D\n", "utf8");
    fs.writeFileSync(path.join(root, "actors", "level.tscn"), "[gd_scene format=3]\n", "utf8");
    fs.writeFileSync(path.join(root, "node_modules", "ignored", "dependency.gd"), "extends Node\n", "utf8");

    const inspection = createProjectInspection(root);

    assert.deepEqual(
      inspection.gdScripts.map((script) => script.relativePath),
      ["actors/hero.gd"],
    );
    assert.deepEqual(inspection.gdScripts[0].lines, ["extends Node2D", ""]);
    assert.deepEqual(
      inspection.scenes.map((scene) => scene.relativePath),
      ["actors/level.tscn"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
