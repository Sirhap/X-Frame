"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resetFixtureRoot, seedFixtureRoot } = require("./e2e/e2e_fixture");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("resetFixtureRoot restores the seed project after extra imports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-e2e-fixture-"));
  try {
    seedFixtureRoot(root);
    const extraDir = path.join(root, "data", "projects", "leaked-project");
    fs.mkdirSync(extraDir, { recursive: true });
    fs.writeFileSync(path.join(extraDir, "animation_manifest.json"), "{}\n");
    const registryPath = path.join(root, "data", "projects.json");
    const registry = readJson(registryPath);
    registry.projects.push({
      id: "leaked-project",
      label: "Leaked",
      projectRoot: "",
      dataDir: "data/projects/leaked-project",
      workspaceDir: "workspace/projects/leaked-project",
    });
    registry.activeProjectId = "leaked-project";
    fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

    resetFixtureRoot(root);

    const restored = readJson(registryPath);
    assert.equal(restored.activeProjectId, "seed-project");
    assert.deepEqual(
      restored.projects.map((project) => project.id),
      ["seed-project"],
    );
    assert.equal(fs.existsSync(extraDir), false);
    assert.equal(fs.existsSync(path.join(root, "data", "projects", "seed-project")), true);
    assert.equal(
      fs.existsSync(
        path.join(root, "workspace", "projects", "seed-project", "assets", "hero", "idle", "frame_0001.png"),
      ),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resetFixtureRoot drops animations imported into the seed project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-e2e-fixture-"));
  try {
    seedFixtureRoot(root);
    const assets = path.join(root, "workspace", "projects", "seed-project", "assets");
    fs.mkdirSync(path.join(assets, "Hero", "loop-idle"), { recursive: true });
    fs.writeFileSync(path.join(assets, "Hero", "loop-idle", "frame_0001.png"), "");

    resetFixtureRoot(root);

    assert.deepEqual(
      fs
        .readdirSync(assets)
        .flatMap((profile) =>
          fs.readdirSync(path.join(assets, profile)).map((animation) => `${profile}/${animation}`),
        ),
      ["hero/idle"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
