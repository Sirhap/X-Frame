"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { deleteAnimation } = require("../animation_mutations");
const { remapBindings } = require("../frame_organizer");
const { createProjectStore } = require("../project_store");

test("deleteAnimation removes only data owned by the requested animation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-animation-delete-"));
  try {
    const store = createProjectStore(root);
    const registry = store.addProject({ id: "mutations", label: "Mutations" });
    const project = store.resolveProject(registry, "mutations");
    const paths = store.projectPaths(project);
    const animationDirectory = path.join(paths.workspaceDir, "assets", "hero", "run");
    fs.mkdirSync(animationDirectory, { recursive: true });
    fs.writeFileSync(path.join(animationDirectory, "frame_0001.png"), "one");
    fs.writeFileSync(path.join(animationDirectory, "frame_0002.png"), "two");
    const animationSource = path.relative(root, animationDirectory).replaceAll(path.sep, "/");
    const framePath = (name) => `${animationSource}/${name}`;
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
      values: { keep: true },
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

    const result = deleteAnimation({
      root,
      projectStore: store,
      project,
      profileId: "hero",
      animationId: "run",
    });

    assert.equal(result.removedFrames, 2);
    assert.equal(fs.existsSync(animationDirectory), false);
    assert.deepEqual(result.manifest.profiles, []);
    assert.deepEqual(result.tuning.frame_visual_overrides, { "other/idle:0": { x: 2 } });
    assert.deepEqual(result.frameAudioBindings, [{ key: "other/idle:0", path: "idle.wav" }]);
    assert.deepEqual(result.frameImageAttachments, [{ key: "other/idle:0", path: "idle.png" }]);
    assert.deepEqual(result.attachmentAssets, [{ id: "idle", groupKey: "other/idle", path: "idle.png" }]);
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
