const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_events_stage_pointer");

function createStage() {
  const listeners = new Map();
  const classNames = new Set();
  return {
    classList: {
      add(name) {
        classNames.add(name);
      },
      remove(name) {
        classNames.delete(name);
      },
      has(name) {
        return classNames.has(name);
      },
    },
    addEventListener(type, listener, options) {
      const entries = listeners.get(type) || [];
      entries.push({ listener, options });
      listeners.set(type, entries);
    },
    setPointerCapture() {},
    listenerTypes() {
      return [...listeners.keys()];
    },
    listenerOptions(type) {
      return listeners.get(type)?.[0]?.options;
    },
    dispatch(type, event = {}) {
      for (const { listener } of listeners.get(type) || []) listener(event);
    },
  };
}

test("stage pointer controller preserves listener order and wheel options", () => {
  const stage = createStage();
  const controller = createController({
    stage,
    state: { view: { x: 0, y: 0, zoom: 1 } },
    handlers: new Proxy(
      {},
      {
        get: () => () => null,
      },
    ),
  });

  controller.bind();

  assert.deepEqual(stage.listenerTypes(), [
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "pointerleave",
    "wheel",
  ]);
  assert.deepEqual(stage.listenerOptions("wheel"), { passive: false });
});

test("stage pointer controller starts a pan drag through injected handlers", () => {
  const stage = createStage();
  const state = { view: { x: 4, y: 8, zoom: 2 } };
  const controller = createController({
    stage,
    state,
    handlers: {
      stagePoint: () => ({ x: 1, y: 2 }),
      updateCoordHud: () => {},
      hitTestBoxes: () => null,
      hitTestDirectManipulationAttachment: () => null,
    },
  });

  controller.bind();
  stage.dispatch("pointerdown", { pointerId: 7, clientX: 10, clientY: 12 });

  assert.deepEqual(state.pointerStagePoint, { x: 1, y: 2 });
  assert.deepEqual(state.drag, {
    mode: "pan",
    x: 10,
    y: 12,
    viewX: 4,
    viewY: 8,
  });
  assert.equal(stage.classList.has("dragging"), true);
});

test("stage pointer controller drags the main frame after attachment hit testing", () => {
  const stage = createStage();
  const state = { view: { x: 0, y: 0, zoom: 1 } };
  const calls = [];
  const controller = createController({
    stage,
    state,
    handlers: {
      stagePoint: () => ({ x: 40, y: 60 }),
      updateCoordHud: () => {},
      hitTestBoxes: () => null,
      hitTestDirectManipulationAttachment: () => null,
      hitTestDirectManipulationFrame: () => ({ offset: { x: 8, y: 12 }, scale: 1 }),
      pushUndo: (label) => calls.push(["undo", label]),
      moveDirectManipulationFrameByClientDelta: (transform, x, y) => calls.push(["move", transform, x, y]),
    },
  });

  controller.bind();
  stage.dispatch("pointerdown", { pointerId: 7, clientX: 10, clientY: 12 });
  stage.dispatch("pointermove", { clientX: 22, clientY: 18 });

  assert.deepEqual(state.drag, {
    mode: "frame-transform",
    x: 10,
    y: 12,
    transform: { offset: { x: 8, y: 12 }, scale: 1 },
  });
  assert.deepEqual(calls, [
    ["undo", "drag frame transform"],
    ["move", { offset: { x: 8, y: 12 }, scale: 1 }, 12, 6],
  ]);
});
