"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { normalizeAttackTrails, validateAttackTrails } = require("../attack_trails");
const { createLiteStore } = require("../frame_tuner_lite/store");
const { syncAttackTrails } = require("../godot_sync");
const { createProjectStore } = require("../project_store");
const { profileIdsForSceneText } = require("../scene_profiles");
const timingModes = require("../animation_tuner/public/timing_modes");

test("attack trails normalize timing, sticks, and active animation bindings", () => {
  const trails = normalizeAttackTrails({
    bindings: {
      "hero/attack": [
        {
          id: "slash",
          texture: { path: "trail.png", hasEffectiveAlpha: true },
          colorMode: "original",
          sticks: [
            { frame: 2, top: { x: 0, y: 0 }, bottom: { x: 0, y: 20 } },
            { frame: 0, top: { x: 10, y: 0 }, bottom: { x: 10, y: 20 } },
          ],
        },
      ],
    },
  });
  assert.equal(trails.schemaVersion, 8);
  assert.deepEqual(
    trails.bindings["hero/attack"][0].sticks.map((stick) => stick.frame),
    [2, 0],
  );
  assert.deepEqual(
    validateAttackTrails(trails, {
      profiles: [{ id: "hero", animations: [{ id: "attack" }] }],
    }),
    [],
  );
});

test("attack-trail sync prunes stale project textures before rebuilding current bindings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-trail-sync-"));
  try {
    const godotRoot = path.join(root, "godot");
    fs.mkdirSync(godotRoot, { recursive: true });
    fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Trail Sync"\n');
    const store = createProjectStore(root);
    const registry = store.addProject({ id: "trail-sync", label: "Trail Sync", projectRoot: godotRoot });
    const project = store.resolveProject(registry, "trail-sync");
    const sourceTexture = path.join(
      store.projectWorkspaceDir(project),
      "attack_trails",
      "hero",
      "run",
      "trail.png",
    );
    fs.mkdirSync(path.dirname(sourceTexture), { recursive: true });
    fs.writeFileSync(sourceTexture, "current-texture");
    const projectTextureRoot = path.join(godotRoot, "x_frame", "attack_trails", "projects", project.id);
    const staleTexture = path.join(projectTextureRoot, "hero", "run", "stale.png");
    fs.mkdirSync(path.dirname(staleTexture), { recursive: true });
    fs.writeFileSync(staleTexture, "stale-texture");

    const result = syncAttackTrails(root, store, project, {
      schemaVersion: 8,
      bindings: {
        "hero/run": [
          {
            id: "slash",
            texture: { path: path.relative(root, sourceTexture) },
            sticks: [],
          },
        ],
      },
    });

    assert.equal(result.attackTrailCount, 1);
    assert.equal(fs.existsSync(staleTexture), false);
    const synchronizedDirectory = path.join(projectTextureRoot, "hero", "run");
    const synchronizedTextures = fs
      .readdirSync(synchronizedDirectory)
      .filter((name) => name.endsWith(".png"));
    assert.equal(synchronizedTextures.length, 1);

    const synchronizedTexture = path.join(synchronizedDirectory, synchronizedTextures[0]);
    syncAttackTrails(root, store, project, {
      schemaVersion: 8,
      bindings: {
        "hero/run": [
          {
            id: "slash",
            texture: {
              path: `res://${path.relative(godotRoot, synchronizedTexture).replaceAll(path.sep, "/")}`,
            },
            sticks: [],
          },
        ],
      },
    });
    assert.equal(fs.existsSync(synchronizedTexture), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Lite export samples subdivide only active trail intervals", () => {
  const samples = timingModes.liteExportSamples(
    [
      { frameIndex: 0, durationMs: 200, trailActive: false },
      { frameIndex: 1, durationMs: 200, trailActive: true },
    ],
    80,
  );
  assert.equal(samples.filter((sample) => sample.frameIndex === 0).length, 1);
  assert.equal(samples.filter((sample) => sample.frameIndex === 1).length, 3);
  assert.equal(Math.round(samples.reduce((sum, sample) => sum + sample.durationMs, 0)), 400);
});

test("Lite store isolates registry, manifest, tuning, and settings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-lite-store-"));
  try {
    const store = createLiteStore(root);
    const project = store.ensureProject({ id: "demo", label: "Demo" });
    const paths = store.paths(project);
    assert.equal(project.kind, "frame_lite");
    for (const filePath of [paths.manifest, paths.tuning, paths.settings]) {
      assert.equal(fs.existsSync(filePath), true);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Lite store preserves a corrupt registry instead of wiping it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-lite-corrupt-"));
  try {
    const store = createLiteStore(root);
    store.ensureProject("p1", "One");
    store.ensureProject("p2", "Two");
    fs.writeFileSync(store.path, "{not-json", "utf8");
    assert.throws(() => store.ensureProject("p3", "Three"), /Invalid JSON/);
    const backup = fs.readdirSync(path.dirname(store.path)).find((name) => name.includes(".corrupt-"));
    assert.ok(backup);
    assert.equal(fs.readFileSync(path.join(path.dirname(store.path), backup), "utf8"), "{not-json");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("scene profiles match relevant actor resource aliases", () => {
  const matches = profileIdsForSceneText(
    '[ext_resource type="Script" path="res://characters/hero_controller.gd" id="1"]',
    [{ id: "hero", label: "Hero", sceneAliases: ["hero"] }],
  );
  assert.deepEqual(matches, ["hero"]);
});
