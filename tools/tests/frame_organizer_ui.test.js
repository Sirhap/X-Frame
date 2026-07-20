"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/frame_organizer_ui");

test("organizer UI controller preserves baseline change detection", () => {
  const state = {
    mode: "edit",
    frames: [],
    baselineFrameIds: [],
    videoExtracting: false,
  };
  const controller = createController({ elements: {}, state, text: () => "" });

  assert.equal(controller.hasUnsavedChanges(), false);
  state.frames.push({ uid: "frame-1", imported: false, flipped: false, included: true, tag: "" });
  assert.equal(controller.hasUnsavedChanges(), true);
  state.baselineFrameIds = ["frame-1"];
  assert.equal(controller.hasUnsavedChanges(), false);
  state.frames[0].tag = "hero";
  assert.equal(controller.hasUnsavedChanges(), true);
});
