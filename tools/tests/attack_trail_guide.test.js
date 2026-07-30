"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { STEPS, normalizeStepIndex } = require("../animation_tuner/public/attack_trail_guide");

test("attack trail guide presents the production workflow in order", () => {
  assert.deepEqual(
    STEPS.map((step) => step.id),
    ["enable", "sticks", "align", "appearance", "preview"],
  );
  assert.equal(
    STEPS.every((step) => step.checklist.length === 3),
    true,
  );
  assert.equal(new Set(STEPS.map((step) => step.targetSelector)).size, STEPS.length);
});

test("attack trail guide clamps invalid step indexes", () => {
  assert.equal(normalizeStepIndex(-3), 0);
  assert.equal(normalizeStepIndex("missing"), 0);
  assert.equal(normalizeStepIndex(2), 2);
  assert.equal(normalizeStepIndex(99), STEPS.length - 1);
});
