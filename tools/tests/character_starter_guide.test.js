"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MODES, commandForMode } = require("../animation_tuner/public/character_starter_guide");

test("character starter guide exposes every supported upstream mode in product order", () => {
  assert.deepEqual(
    MODES.map((mode) => mode.id),
    ["s", "ct", "p", "sq", "cs"],
  );
});

test("character starter guide normalizes unknown modes to simplify", () => {
  assert.equal(commandForMode("p"), "$2DCS p");
  assert.equal(commandForMode("missing"), "$2DCS s");
});
