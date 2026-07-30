"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController, openCurrentAnimation } = require("../animation_tuner/public/frame_organizer_ui");

test("current-animation launcher loads the existing workset", async () => {
  let openCalls = 0;

  await openCurrentAnimation(async () => {
    openCalls += 1;
  });

  assert.equal(openCalls, 1);
  await assert.rejects(() => openCurrentAnimation(null), /loader is required/);
});

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

test("organizer UI exposes normalized image order strategy selection", () => {
  const state = { importOrderStrategy: "filename" };
  const controller = createController({ elements: {}, state, text: () => "" });

  controller.setImportOrderStrategy("selection");
  assert.equal(state.importOrderStrategy, "selection");
  controller.setImportOrderStrategy("unsupported");
  assert.equal(state.importOrderStrategy, "filename");
});
