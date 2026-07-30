const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_canvas_renderer");

test("canvas renderer computes frame rectangles through injected transforms", () => {
  const image = { width: 10, height: 20 };
  const group = { uiId: "main", type: "animation", frames: [image] };
  const controller = createController({
    context: {},
    elements: { stage: { width: 100, height: 100 } },
    getState: () => ({
      view: { zoom: 1 },
      currentGroup: group,
      images: [image],
      selectedFrame: 0,
    }),
    frameTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    renderTransformForGroup: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    runtimeBaseScaleForGroup: () => 1,
    groupOriginScreen: () => ({ x: 50, y: 50 }),
    usesRuntimeFootAnchor: () => false,
    usesSceneTopLeftAnchor: () => false,
    getDevicePixelRatio: () => 1,
  });

  assert.deepEqual(controller.currentFrameRect(), {
    x: 45,
    y: 40,
    originX: 50,
    originY: 50,
    width: 10,
    height: 20,
  });
});
