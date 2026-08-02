"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveCandidateTargets } = require("../animation_tuner/public/batch_cutout_candidate_controller.js");

test("candidate target scopes preserve exclusions and explicit batch selection", () => {
  const items = [
    { id: "a", excluded: false },
    { id: "b", excluded: false },
    { id: "c", excluded: true },
  ];
  const state = {
    items,
    selectedIndex: 0,
    selectedIds: new Set(["b", "c"]),
  };

  assert.deepEqual(resolveCandidateTargets(state, "current"), [items[0]]);
  assert.deepEqual(resolveCandidateTargets(state, "selected"), [items[1]]);
  assert.deepEqual(resolveCandidateTargets(state, "all"), [items[0], items[1]]);
  state.selectedIndex = 2;
  assert.deepEqual(resolveCandidateTargets(state, "current"), []);
});
