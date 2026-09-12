"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore } = require("../project_store");
const { validateImport } = require("../validate_import");

/**
 * Builds an isolated tuner + Godot project for validate_import path checks.
 * @returns {{root:string,godot:string,store:object,project:object,dispose:()=>void}}
 */
function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-validate-import-"));
  const godot = path.join(root, "godot");
  fs.mkdirSync(godot, { recursive: true });
  fs.writeFileSync(path.join(godot, "project.godot"), '[application]\nconfig/name="Validate"\n');
  const store = createProjectStore(root);
  store.addProject({ id: "demo", label: "Demo", projectRoot: godot });
  const project = store.resolveProject(store.readRegistry());
  return {
    root,
    godot,
    store,
    project,
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("validate_import rejects standalone paths that only share a root prefix", () => {
  const fixture = createFixture();
  const sibling = `${fixture.root}2`;
  try {
    fs.mkdirSync(sibling, { recursive: true });
    const decoy = path.join(sibling, "secret.png");
    fs.writeFileSync(decoy, "png");
    const paths = fixture.store.projectPaths(fixture.project);
    fixture.store.writeJson(paths.manifest, {
      schemaVersion: 1,
      profiles: [
        {
          id: "hero",
          animations: [
            {
              id: "idle",
              name: "idle",
              type: "vfx",
              frames: [{ path: path.relative(fixture.root, decoy) }],
            },
          ],
        },
      ],
    });
    const result = validateImport({ project: "demo" }, { root: fixture.root, projectStore: fixture.store });
    assert.ok(
      result.errors.some((message) => /hero\/idle:0: standalone frame path is missing/.test(message)),
      result.errors.join("\n"),
    );
  } finally {
    fixture.dispose();
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test("validate_import rejects escaped game-local res:// frame paths", () => {
  const fixture = createFixture();
  try {
    const escaped = path.join(fixture.root, "escaped.png");
    fs.writeFileSync(escaped, "png");
    const paths = fixture.store.projectPaths(fixture.project);
    const animation = {
      id: "idle",
      name: "idle",
      type: "vfx",
      frames: [{ path: "workspace/projects/demo/assets/idle.png" }],
    };
    fixture.store.writeJson(paths.manifest, {
      schemaVersion: 1,
      profiles: [{ id: "hero", animations: [animation] }],
    });
    const gameData = path.join(fixture.godot, "x_frame", "data", "projects", fixture.project.id);
    fs.mkdirSync(gameData, { recursive: true });
    const gameManifest = {
      schemaVersion: 1,
      profiles: [
        {
          id: "hero",
          animations: [{ ...animation, frames: [{ path: "res://../escaped.png" }] }],
        },
      ],
    };
    fs.writeFileSync(path.join(gameData, "animation_manifest.json"), `${JSON.stringify(gameManifest)}\n`);
    const result = validateImport({ project: "demo" }, { root: fixture.root, projectStore: fixture.store });
    assert.ok(
      result.errors.some((message) =>
        /hero\/idle:0: game-local frame is missing: \.\.\/escaped\.png/.test(message),
      ),
      result.errors.join("\n"),
    );
  } finally {
    fixture.dispose();
  }
});
