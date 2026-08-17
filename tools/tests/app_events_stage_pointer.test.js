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
    "auxclick",
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
  stage.dispatch("pointerdown", { pointerId: 7, clientX: 10, clientY: 12, button: 0 });

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

test("transform hit outside sprite falls through to pan", () => {
  const stage = createStage();
  const state = { view: { x: 1, y: 2, zoom: 1 } };
  const controller = createController({
    stage,
    state,
    handlers: {
      stagePoint: () => ({ x: 0, y: 0 }),
      updateCoordHud: () => {},
      hitTestBoxes: () => null,
      hitTestDirectManipulationAttachment: () => null,
      hitTestDirectManipulationFrame: () => null,
    },
  });

  controller.bind();
  stage.dispatch("pointerdown", { pointerId: 1, clientX: 40, clientY: 50, button: 0 });
  assert.equal(state.drag.mode, "pan");
});

test("middle mouse and Space-held primary pan before frame transforms", () => {
  const stage = createStage();
  const state = { view: { x: 3, y: 6, zoom: 1 }, stageSpacePan: true, stageSpacePanConsumed: false };
  let frameHits = 0;
  const controller = createController({
    stage,
    state,
    handlers: {
      stagePoint: () => ({ x: 0, y: 0 }),
      updateCoordHud: () => {},
      hitTestBoxes: () => null,
      hitTestDirectManipulationAttachment: () => null,
      hitTestDirectManipulationFrame: () => {
        frameHits += 1;
        return { offset: { x: 0, y: 0 }, scale: 1 };
      },
      pushUndo: () => {},
    },
  });

  controller.bind();
  stage.dispatch("pointerdown", { pointerId: 2, clientX: 8, clientY: 9, button: 1, preventDefault() {} });
  assert.equal(state.drag.mode, "pan");
  assert.equal(frameHits, 0);

  state.drag = null;
  stage.dispatch("pointerdown", { pointerId: 3, clientX: 11, clientY: 12, button: 0, preventDefault() {} });
  assert.equal(state.drag.mode, "pan");
  assert.equal(frameHits, 0);
});

test("Space pointerdown without movement does not consume play/pause", () => {
  const stage = createStage();
  const state = {
    view: { x: 3, y: 6, zoom: 1 },
    stageSpacePan: true,
    stageSpacePanConsumed: false,
    stageViewMode: "fit",
  };
  const controller = createController({
    stage,
    state,
    handlers: {
      stagePoint: () => ({ x: 0, y: 0 }),
      updateCoordHud: () => {},
      hitTestBoxes: () => null,
      hitTestDirectManipulationAttachment: () => null,
      hitTestDirectManipulationFrame: () => ({ offset: { x: 0, y: 0 }, scale: 1 }),
      draw: () => {},
    },
  });

  controller.bind();
  stage.dispatch("pointerdown", { pointerId: 4, clientX: 11, clientY: 12, button: 0, preventDefault() {} });
  stage.dispatch("pointermove", { clientX: 12, clientY: 12 });
  stage.dispatch("pointerup", {});

  assert.equal(state.stageSpacePanConsumed, false);
  assert.equal(state.stageViewMode, "fit");
});

test("empty-canvas pan past threshold marks the view custom", () => {
  const stage = createStage();
  const state = { view: { x: 3, y: 6, zoom: 1 }, stageViewMode: "actual" };
  const controller = createController({
    stage,
    state,
    handlers: {
      stagePoint: () => ({ x: 0, y: 0 }),
      updateCoordHud: () => {},
      hitTestBoxes: () => null,
      hitTestDirectManipulationAttachment: () => null,
      draw: () => {},
    },
  });

  controller.bind();
  stage.dispatch("pointerdown", { pointerId: 6, clientX: 11, clientY: 12, button: 0 });
  stage.dispatch("pointermove", { clientX: 20, clientY: 12 });

  assert.equal(state.stageViewMode, "custom");
  assert.equal(state.view.x, 12);
});

test("Space drag past threshold consumes pan and marks the view custom", () => {
  const stage = createStage();
  const state = {
    view: { x: 3, y: 6, zoom: 1 },
    stageSpacePan: true,
    stageSpacePanConsumed: false,
    stageViewMode: "fit",
  };
  const controller = createController({
    stage,
    state,
    handlers: {
      stagePoint: () => ({ x: 0, y: 0 }),
      updateCoordHud: () => {},
      hitTestBoxes: () => null,
      hitTestDirectManipulationAttachment: () => null,
      hitTestDirectManipulationFrame: () => ({ offset: { x: 0, y: 0 }, scale: 1 }),
      draw: () => {},
    },
  });

  controller.bind();
  stage.dispatch("pointerdown", { pointerId: 5, clientX: 11, clientY: 12, button: 0, preventDefault() {} });
  stage.dispatch("pointermove", { clientX: 20, clientY: 12 });

  assert.equal(state.stageSpacePanConsumed, true);
  assert.equal(state.stageViewMode, "custom");
  assert.equal(state.view.x, 12);
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
  stage.dispatch("pointerdown", { pointerId: 7, clientX: 10, clientY: 12, button: 0 });
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
