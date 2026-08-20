"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { remapAttackTrails, remapReferenceFrame } = require("../frame_organizer");

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
