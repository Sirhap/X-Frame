"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore } = require("../project_store");
const { remapAttackTrails, remapReferenceFrame, reorganizeAnimation } = require("../frame_organizer");

/** 1×1 transparent PNG used as organizer replacement payload. */
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
).toString("base64")}`;

test("TUN-021 remapping a deleted reference frame clears the persisted descriptor", () => {
  const descriptor = {
    profile_id: "player",
    animation_id: "assassin_jump",
    frame_index: 2,
    transform: { scale: 1 },
  };
  assert.equal(
    remapReferenceFrame(descriptor, "player", "assassin_jump", [
      { sourceIndex: 0 },
      { sourceIndex: 1 },
      { sourceIndex: 3 },
    ]),
    null,
  );
  assert.deepEqual(
    remapReferenceFrame(descriptor, "player", "assassin_jump", [{ sourceIndex: 0 }, { sourceIndex: 2 }]),
    { profile_id: "player", animation_id: "assassin_jump", frame_index: 1, transform: { scale: 1 } },
  );
  assert.deepEqual(remapReferenceFrame(descriptor, "other", "idle", [{ sourceIndex: 0 }]), descriptor);
});

test("frame organizer chronologically remaps attack trails with duplicate and removed frames", () => {
  const source = {
    schemaVersion: 8,
    bindings: {
      "hero/idle": [
        {
          id: "trail",
          sticks: [
            { frame: 0, framePhase: 0.9, order: 0, width: 2 },
            { frame: 1, framePhase: 0.5, order: 1, width: 3 },
            { frame: 2, framePhase: 0.8, order: 3, width: 4 },
            { frame: 2, framePhase: 0.2, order: 2, width: 5 },
          ],
        },
      ],
      "other/run": [{ id: "other", sticks: [{ frame: 1, order: 0 }] }],
    },
  };

  const result = remapAttackTrails(source, "hero/idle", [
    { sourceIndex: 2 },
    { sourceIndex: 0 },
    { sourceIndex: 2 },
  ]);

  assert.deepEqual(result.bindings["hero/idle"][0].sticks, [
    { frame: 0, framePhase: 0.2, order: 0, width: 5 },
    { frame: 0, framePhase: 0.8, order: 1, width: 4 },
    { frame: 1, framePhase: 0.9, order: 2, width: 2 },
    { frame: 2, framePhase: 0.2, order: 3, width: 5 },
    { frame: 2, framePhase: 0.8, order: 4, width: 4 },
  ]);
  assert.deepEqual(result.bindings["other/run"], source.bindings["other/run"]);
  assert.equal(source.bindings["hero/idle"][0].sticks[0].frame, 0);
});

test("frame organizer uses normalized phase and old order as stable trail tie-breakers", () => {
  const source = {
    schemaVersion: 8,
    bindings: {
      "hero/attack": [
        {
          id: "trail",
          sticks: [
            { id: "late-stable", frame: 0, framePhase: 4, order: 8 },
            { id: "early-stable", frame: 0, framePhase: 2, order: 2 },
            { id: "middle", frame: 0, framePhase: "invalid", order: 4 },
          ],
        },
      ],
    },
  };

  const result = remapAttackTrails(source, "hero/attack", [{ sourceIndex: 0 }]);

  assert.deepEqual(
    result.bindings["hero/attack"][0].sticks.map(({ id, order }) => ({ id, order })),
    [
      { id: "middle", order: 0 },
      { id: "early-stable", order: 1 },
      { id: "late-stable", order: 2 },
    ],
  );
});

test("reorganizeAnimation writes PNG frames beside a spritesheet file instead of replacing it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-reorganize-sheet-"));
  try {
    const store = createProjectStore(root);
    store.addProject({ id: "codex_pets", label: "Codex 宠物", kind: "codex_pets" });
    const project = store.resolveProject(store.readRegistry());
    const workspaceDir = store.projectWorkspaceDir(project);
    const atlasRel = path.posix.join("workspace/projects/codex_pets/spritesheets/custom/lanma-duck.webp");
    const atlasPath = path.join(root, atlasRel);
    fs.mkdirSync(path.dirname(atlasPath), { recursive: true });
    fs.writeFileSync(atlasPath, Buffer.from("FAKEWEBP"));
    const paths = store.projectPaths(project);
    store.writeJson(paths.manifest, {
      schemaVersion: 1,
      profiles: [
        {
          id: "custom:lanma-duck",
          animations: [
            {
              id: "idle",
              name: "idle",
              source: atlasRel,
              frames: [
                { id: "idle_01", name: "idle 1", path: atlasRel },
                { id: "idle_02", name: "idle 2", path: atlasRel },
              ],
            },
          ],
        },
      ],
    });
    store.writeJson(paths.tuning, { schemaVersion: 1, values: {} });

    const result = reorganizeAnimation({
      root,
      projectStore: store,
      project,
      profileId: "custom:lanma-duck",
      animationId: "idle",
      items: [
        { data: PNG_DATA_URL, name: "a.png" },
        { data: PNG_DATA_URL, name: "b.png" },
      ],
    });

    assert.equal(fs.statSync(atlasPath).isFile(), true, "shared Codex atlas must remain a file");
    assert.equal(fs.readFileSync(atlasPath).toString(), "FAKEWEBP");
    assert.equal(fs.statSync(result.targetDir).isDirectory(), true);
    assert.notEqual(result.targetDir, atlasPath);
    assert.ok(
      result.targetDir.startsWith(`${workspaceDir}${path.sep}`),
      "replacement frames must stay in the project workspace",
    );
    assert.equal(result.frameCount, 2);
    assert.ok(fs.existsSync(path.join(result.targetDir, "frame_0001.png")));
    assert.ok(fs.existsSync(path.join(result.targetDir, "frame_0002.png")));
    const idle = store
      .readJson(paths.manifest)
      .profiles[0].animations.find((animation) => animation.id === "idle");
    assert.notEqual(idle.source, atlasRel);
    assert.ok(idle.frames.every((frame) => frame.path.endsWith(".png")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
