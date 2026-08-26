"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_stage_view");

test("panViewBy moves the viewport in device pixels and marks the view custom", () => {
  let view = { zoom: 2, x: 10, y: 20 };
  let mode = "fit";
  const controller = createController({
    stage: { width: 800, height: 600 },
    getView: () => view,
    setView: (nextView) => {
      view = nextView;
    },
    getStageViewMode: () => mode,
    setStageViewMode: (nextMode) => {
      mode = nextMode;
    },
    getCurrentGroup: () => null,
    getImages: () => [],
    currentFrameRect: () => null,
    draw() {},
    getDevicePixelRatio: () => 2,
  });

  controller.panViewBy(5, -3);

  assert.equal(mode, "custom");
  assert.deepEqual(view, { zoom: 2, x: 20, y: 14 });
});

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

test("resize keeps custom zoom and pan instead of refitting", () => {
  let view = { zoom: 2.1, x: 40, y: 50 };
  let mode = "custom";
  let drawCalls = 0;
  const stage = {
    width: 800,
    height: 600,
    getBoundingClientRect: () => ({ width: 400, height: 300 }),
  };
  const controller = createController({
    stage,
    getView: () => view,
    setView: (nextView) => {
      view = nextView;
    },
    getStageViewMode: () => mode,
    setStageViewMode: (nextMode) => {
      mode = nextMode;
    },
    getCurrentGroup: () => ({}),
    getImages: () => [{}],
    currentFrameRect: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    draw: () => {
      drawCalls += 1;
    },
    getDevicePixelRatio: () => 1,
  });

  controller.resizeCanvas();

  assert.equal(mode, "custom");
  assert.equal(view.zoom, 2.1);
  assert.equal(stage.width, 640);
  assert.equal(stage.height, 420);
  assert.equal(drawCalls, 1);
  // Keep the same world point under the previous canvas center after the
  // backing store shrinks from 800x600 to the 640x420 floor.
  assert.equal(view.x, 40 - (800 / 2 - 640 / 2));
  assert.equal(view.y, 50 - (600 / 2 - 420 / 2));
});
