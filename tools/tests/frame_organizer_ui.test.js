"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ORGANIZER_SIMILARITY_THRESHOLD } = require("../animation_tuner/public/frame_organizer_core");
const { bindSimilarityThreshold } = require("../animation_tuner/public/frame_organizer_ui");

test("bindSimilarityThreshold writes the exported organizer range onto the slider", () => {
  const input = { min: "0", max: "10", value: "1" };
  const output = { textContent: "" };
  bindSimilarityThreshold({ organizerThreshold: input, organizerThresholdValue: output });
  assert.equal(input.min, String(ORGANIZER_SIMILARITY_THRESHOLD.min));
  assert.equal(input.max, String(ORGANIZER_SIMILARITY_THRESHOLD.max));
  assert.equal(input.value, String(ORGANIZER_SIMILARITY_THRESHOLD.fallback));
  assert.equal(output.textContent, String(ORGANIZER_SIMILARITY_THRESHOLD.fallback));
});
