"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { planWorksetOperations } = require("../animation_tuner/public/workset_handoff_core");

function fixture(overrides = {}) {
  return {
    manifest: {
      profiles: [
        {
          id: "hero",
          animations: [{ id: "idle", frames: [{}, {}, {}] }],
        },
      ],
    },
    tuning: {
      frame_visual_overrides: { "hero/idle:0": {}, "hero/idle:2": {} },
      frame_playback_overrides: { "hero/idle:1": {} },
      frame_box_overrides: { "hero/idle:0": {}, "hero/idle:2": {} },
    },
    frameAudioBindings: [{ key: "hero/idle:0" }, { key: "hero/idle:2" }],
    frameImageAttachments: [{ key: "hero/idle:1" }],
    attackTrails: {
      schemaVersion: 8,
      bindings: {
        "hero/idle": [{ sticks: [{ frame: 0 }, { frame: 1 }, { frame: 2 }] }],
      },
    },
    ...overrides,
  };
}

test("workset planner blocks implicit overwrite and duplicate batch targets", () => {
  const plan = planWorksetOperations(
    fixture({
      operations: [
        { id: "first", type: "create", profileLabel: "Hero", animationName: "Idle", frameCount: 2 },
        { id: "second", type: "create", profileLabel: "Hero", animationName: "Idle", frameCount: 1 },
      ],
    }),
  );

  assert.equal(plan.ok, false);
  assert.deepEqual(
    plan.conflicts.map((conflict) => conflict.code),
    ["animation_exists", "duplicate_target"],
  );
});

test("workset planner reports preserved and removed replacement bindings", () => {
  const plan = planWorksetOperations(
    fixture({
      operations: [
        {
          id: "replace-idle",
          type: "replace",
          profileId: "hero",
          profileLabel: "Hero",
          animationId: "idle",
          animationName: "Idle",
          items: [{ sourceIndex: 0 }, { sourceIndex: 2 }],
        },
      ],
    }),
  );

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.impacts[0].frames, { before: 3, after: 2 });
  assert.deepEqual(plan.impacts[0].visual, { preserved: 2, removed: 0 });
  assert.deepEqual(plan.impacts[0].playback, { preserved: 0, removed: 1 });
  assert.deepEqual(plan.impacts[0].audio, { preserved: 2, removed: 0 });
  assert.deepEqual(plan.impacts[0].attachments, { preserved: 0, removed: 1 });
  assert.deepEqual(plan.impacts[0].attackTrails, { preserved: 2, removed: 1 });
});

test("workset planner supports mixed create and explicit replace targets", () => {
  const plan = planWorksetOperations(
    fixture({
      operations: [
        {
          id: "replace-idle",
          type: "replace",
          profileId: "hero",
          profileLabel: "Hero",
          animationId: "idle",
          animationName: "Idle",
          items: [{ sourceIndex: 0 }],
        },
        {
          id: "create-run",
          type: "create",
          profileId: "hero",
          profileLabel: "Hero",
          animationId: "run",
          animationName: "Run",
          frameCount: 4,
        },
      ],
    }),
  );

  assert.equal(plan.ok, true);
  assert.equal(plan.operations.length, 2);
  assert.equal(plan.impacts.length, 1);
});
