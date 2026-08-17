"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { deleteAnimation, stripAnimationOwnedData } = require("../animation_mutations");
const { importAnimation, remapBindings } = require("../frame_organizer");
const { importFrames } = require("../import_frames");
const { createProjectStore } = require("../project_store");

/** Creates a minimal 1×1 PNG buffer accepted by the frame organizer. */
function tinyPng() {
  const buffer = Buffer.alloc(24);
  buffer.write("\x89PNG\r\n\x1a\n", 0, "ascii");
  buffer.writeUInt32BE(1, 16);
  buffer.writeUInt32BE(1, 20);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

test("deleteAnimation removes only data owned by the requested animation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-animation-delete-"));
  try {
    const store = createProjectStore(root);
    const registry = store.addProject({ id: "mutations", label: "Mutations" });
    const project = store.resolveProject(registry, "mutations");
    const paths = store.projectPaths(project);
    const animationDirectory = path.join(paths.workspaceDir, "assets", "hero", "run");
    const attackTrailDirectory = path.join(paths.workspaceDir, "attack_trails", "hero", "run");
    const legacyAttackTrailDirectory = path.join(paths.workspaceDir, "attack_trails", "hero", "Run");
    const unrelatedAttackTrailDirectory = path.join(paths.workspaceDir, "attack_trails", "other", "idle");
    fs.mkdirSync(animationDirectory, { recursive: true });
    fs.mkdirSync(attackTrailDirectory, { recursive: true });
    fs.mkdirSync(legacyAttackTrailDirectory, { recursive: true });
    fs.mkdirSync(unrelatedAttackTrailDirectory, { recursive: true });
    fs.writeFileSync(path.join(animationDirectory, "frame_0001.png"), "one");
    fs.writeFileSync(path.join(animationDirectory, "frame_0002.png"), "two");
    fs.writeFileSync(path.join(attackTrailDirectory, "run.png"), "trail");
    fs.writeFileSync(path.join(legacyAttackTrailDirectory, "run-legacy.png"), "trail");
    fs.writeFileSync(path.join(unrelatedAttackTrailDirectory, "idle.png"), "trail");
    const animationSource = path.relative(root, animationDirectory).replaceAll(path.sep, "/");
    const framePath = (name) => `${animationSource}/${name}`;
    const attackTrailPath = path
      .relative(root, path.join(attackTrailDirectory, "run.png"))
      .replaceAll(path.sep, "/");
    const unrelatedAttackTrailPath = path
      .relative(root, path.join(unrelatedAttackTrailDirectory, "idle.png"))
      .replaceAll(path.sep, "/");
    const legacyAttackTrailPath = path
      .relative(root, path.join(legacyAttackTrailDirectory, "run-legacy.png"))
      .replaceAll(path.sep, "/");
    store.writeJson(paths.manifest, {
      schemaVersion: 1,
      profiles: [
        {
          id: "hero",
          label: "Hero",
          animations: [
            {
              id: "run",
              name: "Run",
              source: animationSource,
              frames: [{ path: framePath("frame_0001.png") }, { path: framePath("frame_0002.png") }],
            },
          ],
        },
      ],
    });
    store.writeJson(paths.tuning, {
      schemaVersion: 1,
      values: {
        keep: true,
        "profiles.hero.character.visual_size": 1.25,
        "profiles.hero.groups.run.visual_size": 1.5,
      },
      frame_visual_overrides: { "hero/run:0": { x: 1 }, "other/idle:0": { x: 2 } },
      frame_playback_overrides: { "hero/run:1": { disabled: true } },
      frame_box_overrides: { "hero/run:0": { hurtbox: {} } },
    });
    store.writeJson(paths.frameAudio, {
      "hero/run:0": { path: "run.wav" },
      "other/idle:0": { path: "idle.wav" },
    });
    store.writeJson(paths.frameImageAttachments, [
      { key: "hero/run:0", path: "run.png" },
      { key: "other/idle:0", path: "idle.png" },
    ]);
    store.writeJson(paths.attachmentAssets, [
      { id: "run", groupKey: "hero/run", path: "run.png" },
      { id: "idle", groupKey: "other/idle", path: "idle.png" },
    ]);
    store.writeJson(paths.attackTrails, {
      schemaVersion: 8,
      bindings: {
        "hero/run": [
          {
            id: "run-trail",
            texture: { path: attackTrailPath },
            sticks: [],
          },
        ],
        "hero/Run": [
          {
            id: "run-trail-legacy-name",
            texture: { path: legacyAttackTrailPath },
            sticks: [],
          },
        ],
        "other/idle": [
          {
            id: "idle-trail",
            texture: { path: unrelatedAttackTrailPath },
            sticks: [],
          },
        ],
      },
    });

    const result = deleteAnimation({
      root,
      projectStore: store,
      project,
      profileId: "hero",
      animationId: "run",
    });

    assert.equal(result.removedFrames, 2);
    assert.equal(fs.existsSync(animationDirectory), false);
    assert.equal(fs.existsSync(attackTrailDirectory), false);
    assert.equal(fs.existsSync(legacyAttackTrailDirectory), false);
    assert.equal(fs.existsSync(unrelatedAttackTrailDirectory), true);
    assert.deepEqual(result.manifest.profiles, []);
    assert.deepEqual(result.tuning.values, { keep: true });
    assert.deepEqual(result.tuning.frame_visual_overrides, { "other/idle:0": { x: 2 } });
    assert.deepEqual(result.frameAudioBindings, [{ key: "other/idle:0", path: "idle.wav" }]);
    assert.deepEqual(result.frameImageAttachments, [{ key: "other/idle:0", path: "idle.png" }]);
    assert.deepEqual(result.attachmentAssets, [{ id: "idle", groupKey: "other/idle", path: "idle.png" }]);
    assert.deepEqual(Object.keys(result.attackTrails.bindings), ["other/idle"]);
    assert.deepEqual(Object.keys(store.readJson(paths.attackTrails, {}).bindings), ["other/idle"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deleteAnimation preserves a legacy-name key owned canonically by another animation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-animation-delete-collision-"));
  try {
    const store = createProjectStore(root);
    const registry = store.addProject({ id: "collisions", label: "Collisions" });
    const project = store.resolveProject(registry, "collisions");
    const paths = store.projectPaths(project);
    const attackDirectory = path.join(paths.workspaceDir, "assets", "hero", "attack");
    const idleDirectory = path.join(paths.workspaceDir, "assets", "hero", "idle");
    const sharedLegacyTextureDirectory = path.join(paths.workspaceDir, "attack_trails", "hero", "idle");
    for (const directory of [attackDirectory, idleDirectory, sharedLegacyTextureDirectory]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(path.join(attackDirectory, "attack.png"), "attack");
    fs.writeFileSync(path.join(idleDirectory, "idle.png"), "idle");
    const idleTrailPath = path.join(sharedLegacyTextureDirectory, "idle-trail.png");
    fs.writeFileSync(idleTrailPath, "trail");
    const relative = (filePath) => path.relative(root, filePath).replaceAll(path.sep, "/");
    store.writeJson(paths.manifest, {
      schemaVersion: 1,
      profiles: [
        {
          id: "hero",
          animations: [
            {
              id: "attack",
              name: "idle",
              source: relative(attackDirectory),
              frames: [{ path: relative(path.join(attackDirectory, "attack.png")) }],
            },
            {
              id: "idle",
              name: "Idle",
              source: relative(idleDirectory),
              frames: [{ path: relative(path.join(idleDirectory, "idle.png")) }],
            },
          ],
        },
      ],
    });
    store.writeJson(paths.attackTrails, {
      schemaVersion: 8,
      bindings: {
        "hero/attack": [{ id: "attack-trail", texture: {}, sticks: [] }],
        "hero/idle": [{ id: "idle-trail", texture: { path: relative(idleTrailPath) }, sticks: [] }],
      },
    });

    const result = deleteAnimation({
      root,
      projectStore: store,
      project,
      profileId: "hero",
      animationId: "attack",
    });

    assert.deepEqual(Object.keys(result.attackTrails.bindings), ["hero/idle"]);
    assert.equal(fs.existsSync(sharedLegacyTextureDirectory), true);
    assert.equal(result.manifest.profiles[0].animations[0].id, "idle");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("remapBindings preserves unrelated legacy keyed bindings", () => {
  const result = remapBindings(
    {
      "hero/run:0": { path: "first.wav" },
      "hero/run:1": { path: "second.wav" },
      "other/idle:0": { path: "idle.wav" },
    },
    "hero/run",
    [{ sourceIndex: 1 }],
  );

  assert.deepEqual(result, [
    { key: "other/idle:0", path: "idle.wav" },
    { key: "hero/run:0", path: "second.wav" },
  ]);
});

test("stripAnimationOwnedData removes leftover frame overrides and bindings", () => {
  const stripped = stripAnimationOwnedData({
    tuning: {
      values: {
        "profiles.hero.groups.run.visual_size": 2,
        "profiles.hero.character.visual_size": 1,
      },
      frame_visual_overrides: { "hero/run:0": { visual_size: 2 }, "hero/idle:0": { visual_size: 1 } },
      frame_playback_overrides: { "hero/run:9": { duration: 2 } },
      frame_box_overrides: { "hero/run:0": { hurtbox: {} } },
    },
    audioBindings: [
      { key: "hero/run:0", path: "old.wav" },
      { key: "hero/idle:0", path: "keep.wav" },
    ],
    imageAttachments: [{ key: "hero/run:1", path: "old.png" }],
    attachmentAssets: [{ groupKey: "hero/run" }, { groupKey: "hero/idle" }],
    attackTrails: {
      schemaVersion: 8,
      bindings: { "hero/run": [{ id: "old" }], "hero/idle": [{ id: "keep" }] },
    },
    profile: { id: "hero", animations: [{ id: "run", name: "Run" }, { id: "idle" }] },
    animation: { id: "run", name: "Run" },
  });
  assert.equal(stripped.tuning.values["profiles.hero.groups.run.visual_size"], undefined);
  assert.equal(stripped.tuning.values["profiles.hero.character.visual_size"], 1);
  assert.deepEqual(stripped.tuning.frame_visual_overrides, { "hero/idle:0": { visual_size: 1 } });
  assert.deepEqual(stripped.frameAudioBindings, [{ key: "hero/idle:0", path: "keep.wav" }]);
  assert.deepEqual(stripped.attachmentAssets, [{ groupKey: "hero/idle" }]);
  assert.deepEqual(Object.keys(stripped.attackTrails.bindings), ["hero/idle"]);
});

test("CLI frame import replace clears leftover bindings and rejects invalid fps", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-import-frames-"));
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XkM0WQAAAABJRU5ErkJggg==",
    "base64",
  );
  try {
    const store = createProjectStore(root);
    store.addProject({ id: "imports", label: "Imports" });
    const firstSource = path.join(root, "src-a");
    const secondSource = path.join(root, "src-b");
    fs.mkdirSync(firstSource, { recursive: true });
    fs.mkdirSync(secondSource, { recursive: true });
    for (let index = 0; index < 3; index += 1) {
      fs.writeFileSync(path.join(firstSource, `frame_${index}.png`), onePixelPng);
    }
    fs.writeFileSync(path.join(secondSource, "only.png"), onePixelPng);
    importFrames(
      { profile: "hero", animation: "run", source: firstSource, project: "imports", fps: "12" },
      { root, projectStore: store, quiet: true },
    );
    const project = store.resolveProject(store.readRegistry(), "imports");
    const paths = store.projectPaths(project);
    const tuning = store.readJson(paths.tuning, {});
    tuning.frame_visual_overrides["hero/run:2"] = { visual_size: 3 };
    tuning.frame_playback_overrides = { "hero/run:2": { duration: 4 } };
    store.writeJson(paths.tuning, tuning);
    store.writeJson(paths.frameAudio, [{ key: "hero/run:2", path: "old.wav" }]);
    assert.throws(
      () =>
        importFrames(
          {
            profile: "hero",
            animation: "run",
            source: secondSource,
            project: "imports",
            fps: "abc",
            replace: true,
          },
          { root, projectStore: store, quiet: true },
        ),
      /fps must be a finite number/,
    );
    const replaced = importFrames(
      {
        profile: "hero",
        animation: "run",
        source: secondSource,
        project: "imports",
        fps: "18",
        replace: true,
      },
      { root, projectStore: store, quiet: true },
    );
    assert.equal(replaced.replaced, true);
    assert.equal(replaced.fps, 18);
    assert.equal(replaced.frameCount, 1);
    const nextTuning = store.readJson(paths.tuning, {});
    assert.equal(nextTuning.frame_visual_overrides["hero/run:2"], undefined);
    assert.equal(nextTuning.frame_playback_overrides["hero/run:2"], undefined);
    assert.deepEqual(store.readJson(paths.frameAudio, []), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("importAnimation rejects duplicate animation names with a conflict code", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-animation-import-"));
  try {
    const store = createProjectStore(root);
    const registry = store.addProject({ id: "imports", label: "Imports" });
    const project = store.resolveProject(registry, "imports");
    const options = {
      root,
      projectStore: store,
      project,
      profileId: "hero",
      profileLabel: "Hero",
      profileKind: "actor",
      animationId: "run",
      animationName: "Run",
      animationType: "actor",
      anchorMode: "canvas_bottom_center",
      fps: 12,
      items: [{ data: tinyPng() }],
    };

    const first = importAnimation(options);
    assert.equal(first.animationId, "run");
    assert.throws(
      () => importAnimation(options),
      (error) => error?.status === 409 && error?.code === "animation_exists",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
