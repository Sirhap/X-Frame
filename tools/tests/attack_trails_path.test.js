"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_BEFORE_CHASE_MULTIPLIER,
  DEFAULT_TRAIL_SMEAR_PX,
  bladeEdgeTravel,
  normalizeAttackTrails,
  smearTailDistance,
  stickCenterTravel,
} = require("../attack_trails");

/** A blade that rotates in place: center stays put, tip sweeps a quarter circle. */
const ROTATING = Object.freeze([
  { frame: 0, top: { x: 0, y: -70 }, bottom: { x: 0, y: -10 } },
  { frame: 2, top: { x: 30, y: -40 }, bottom: { x: -30, y: -40 } },
]);

test("a rotating blade has almost no center travel and a long edge sweep", () => {
  assert.ok(stickCenterTravel(ROTATING) < 2, "centers are the same point");
  assert.ok(bladeEdgeTravel(ROTATING) > 40, "the tip must count as path length");
  // (0,-70)→(30,-40) is ~42px; the unit fixture is the larger rotation.
});

test("a new trail defaults to a trailing smear, not a filled pie", () => {
  const normalized = normalizeAttackTrails({
    bindings: {
      "hero/slash": [{ id: "cleave", sticks: ROTATING }],
    },
  });
  assert.ok(
    DEFAULT_BEFORE_CHASE_MULTIPLIER > 0.08 && DEFAULT_BEFORE_CHASE_MULTIPLIER < 0.3,
    "default chase must keep a long smear, not fill the pie or hug the blade",
  );
  assert.equal(
    normalized.bindings["hero/slash"][0].beforeStopChaseMultiplier,
    DEFAULT_BEFORE_CHASE_MULTIPLIER,
  );
});

test("a slash plus settle still keeps the slash on the last frame", () => {
  // hero_slash cleave: ~65px rotation then ~80px follow-through. Chase 0.4
  // drops 58px and eats the rotation, leaving a sticker on the settle.
  const slashThenSettle = 145;
  const ribbon = slashThenSettle - smearTailDistance(slashThenSettle, DEFAULT_BEFORE_CHASE_MULTIPLIER);
  assert.ok(ribbon >= 110, `last frame must keep the slash, kept ${ribbon}`);
});

test("smear tail sits behind the head instead of filling the pie", () => {
  const travel = bladeEdgeTravel(ROTATING);
  const tail = smearTailDistance(travel, DEFAULT_BEFORE_CHASE_MULTIPLIER, DEFAULT_TRAIL_SMEAR_PX);
  assert.ok(tail > 0, "a trailing smear must drop the swing origin");
  assert.ok(travel - tail >= 8, "the kept ribbon must stay visible");
  assert.equal(smearTailDistance(travel, 0, DEFAULT_TRAIL_SMEAR_PX), 0);
});

test("auto-phase pins the first stick to the start of its frame and the last to the end", () => {
  const normalized = normalizeAttackTrails({
    bindings: {
      "hero/slash": [
        {
          id: "cleave",
          sticks: ROTATING,
        },
      ],
    },
  });
  const sticks = normalized.bindings["hero/slash"][0].sticks;
  assert.equal(sticks[0].framePhase, 0);
  assert.equal(sticks[1].framePhase, 1);
});
