"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_stage_view");

test("stage view restores state after measuring unit content", () => {
  let view = { zoom: 2, x: 10, y: 20 };
  const controller = createController({
    stage: { width: 800, height: 600 },
    getView: () => view,
    setView: (nextView) => {
      view = nextView;
    },
    getStageViewMode: () => "custom",
    setStageViewMode() {},
    getCurrentGroup: () => ({}),
    getImages: () => [{}],
    currentFrameRect: () => ({ x: 1, y: 2, width: 10, height: 20 }),
    draw() {},
  });

  assert.deepEqual(controller.unitStageContentRect(), { x: 1, y: 2, width: 10, height: 20 });
  assert.deepEqual(view, { zoom: 2, x: 10, y: 20 });
});

test("stage view restores state when content measurement throws", () => {
  const originalView = { zoom: 1.5, x: 4, y: 5 };
  let view = originalView;
  const controller = createController({
    stage: { width: 800, height: 600 },
    getView: () => view,
    setView: (nextView) => {
      view = nextView;
    },
    getStageViewMode: () => "custom",
    setStageViewMode() {},
    getCurrentGroup: () => ({}),
    getImages: () => [{}],
    currentFrameRect: () => {
      throw new Error("measurement failed");
    },
    draw() {},
  });

  assert.throws(() => controller.unitStageContentRect(), /measurement failed/);
  assert.deepEqual(view, originalView);
});
