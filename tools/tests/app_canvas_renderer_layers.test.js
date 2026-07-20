const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_canvas_renderer_layers");

function createContext(log) {
  return {
    save: () => log.push("save"),
    restore: () => log.push("restore"),
    translate: (...args) => log.push(["translate", ...args]),
    rotate: (...args) => log.push(["rotate", ...args]),
    scale: (...args) => log.push(["scale", ...args]),
    drawImage: (...args) => log.push(["drawImage", ...args]),
    strokeRect: (...args) => log.push(["strokeRect", ...args]),
  };
}

test("canvas layer renderer preserves frame draw and selection marker order", () => {
  const log = [];
  const image = { width: 10, height: 20 };
  const group = { uiId: "main", type: "animation", frames: [image] };
  const controller = createController({
    context: createContext(log),
    getState: () => ({ view: { zoom: 1 }, currentGroup: group, images: [image] }),
    frameScreenRect: () => ({ originX: 50, originY: 50 }),
    frameTransform: () => ({ scaleX: 1, scaleY: 1, rotation: 0 }),
    renderTransformForGroup: (transform) => transform,
    runtimeBaseScaleForGroup: () => 1,
    getDevicePixelRatio: () => 1,
  });

  controller.drawFrame(0, 1, true);

  assert.deepEqual(log, [
    "save",
    ["translate", 50, 50],
    ["rotate", 0],
    ["drawImage", image, -5, -10, 10, 20],
    ["strokeRect", -5, -5, 10, 10],
    "restore",
  ]);
});

test("canvas layer renderer requests continuous draw for sequence overlap", () => {
  const group = { uiId: "main", sequenceOverlap: true, frames: [{}, {}] };
  const controller = createController({
    context: createContext([]),
    getState: () => ({ playing: true, currentGroup: group }),
  });

  assert.equal(controller.playbackNeedsContinuousDraw(), true);
});
