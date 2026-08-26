const assert = require("node:assert/strict");
const test = require("node:test");

const { BOX_MIN_SIZE, resizeFrameBox } = require("../animation_tuner/public/app_box_geometry");
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
      toggle(name, force) {
        if (force === false) classNames.delete(name);
        else if (force === true) classNames.add(name);
        else if (classNames.has(name)) classNames.delete(name);
        else classNames.add(name);
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
    "contextmenu",
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

test("wheel over the stage is captured even on a narrow layout", () => {
  const stage = createStage();
  const events = [];
  const controller = createController({
    stage,
    state: { view: { x: 0, y: 0, zoom: 1 } },
    getViewportWidth: () => 640,
    handlers: {
      stagePoint: () => ({ x: 0, y: 0 }),
      zoomViewAt: () => events.push("zoom"),
      applySelectedAttachmentWheel: () => false,
    },
  });
  controller.bind();
  let prevented = false;
  stage.dispatch("wheel", {
    deltaY: 40,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(events, ["zoom"]);
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

test("east-handle drag cannot shrink a box below 1x1 or emit non-finite values", () => {
  const stage = createStage();
  const state = { view: { x: 0, y: 0, zoom: 1 }, selectedBoxes: new Set(["hurtbox"]) };
  const overrides = [];
  const box = {
    offset: { x: 10, y: 20 },
    size: { x: 40, y: 30 },
    rotation: 0,
    enabled: true,
  };
  const controller = createController({
    stage,
    state,
    handlers: {
      stagePoint: () => ({ x: 0, y: 0 }),
      updateCoordHud: () => {},
      hitTestBoxes: () => ({ boxName: "hurtbox", mode: "box-resize", handle: "e" }),
      hitTestDirectManipulationAttachment: () => null,
      hitTestDirectManipulationFrame: () => null,
      frameBox: () => box,
      selectedFrameIndexes: () => [0],
      cloneVector: (value) => ({ x: value.x, y: value.y }),
      isCollisionBox: () => false,
      boxResizeDeltaFromScreenDelta: (delta) => delta,
      resizeFrameBox,
      setBoxOverride: (...args) => overrides.push(args),
      pushUndo: () => {},
      syncBoxInputs: () => {},
      draw: () => {},
    },
  });

  controller.bind();
  stage.dispatch("pointerdown", { pointerId: 8, clientX: 80, clientY: 40, button: 0 });
  stage.dispatch("pointermove", { clientX: -400, clientY: 40 });

  assert.equal(state.drag.mode, "box-resize");
  assert.equal(state.drag.handle, "e");
  const next = overrides.at(-1)[1];
  assert.ok(next.size.x >= BOX_MIN_SIZE);
  assert.ok(next.size.y >= BOX_MIN_SIZE);
  assert.ok(Number.isFinite(next.offset.x));
  assert.ok(Number.isFinite(next.offset.y));
  assert.ok(Number.isFinite(next.size.x));
  assert.ok(Number.isFinite(next.size.y));
  assert.equal(next.size.y, 30);
});

test("right mouse pans on the sprite while left drag still moves the character", () => {
  const stage = createStage();
  const state = { view: { x: 3, y: 6, zoom: 1 } };
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

  stage.dispatch("pointerdown", { pointerId: 2, clientX: 8, clientY: 9, button: 2, preventDefault() {} });
  assert.equal(state.drag.mode, "pan");
  assert.equal(frameHits, 0);

  state.drag = null;
  stage.dispatch("pointerdown", { pointerId: 3, clientX: 11, clientY: 12, button: 0, preventDefault() {} });
  assert.equal(state.drag.mode, "frame-transform");
  assert.equal(frameHits, 1);
});

test("trackpad wheel pans the stage while a mouse wheel still zooms", () => {
  const stage = createStage();
  const events = [];
  const controller = createController({
    stage,
    state: { view: { x: 0, y: 0, zoom: 1 } },
    getViewportWidth: () => 1440,
    handlers: {
      stagePoint: () => ({ x: 0, y: 0 }),
      applySelectedAttachmentWheel: () => false,
      applySelectedFrameWheel: () => false,
      panViewBy: (x, y) => events.push(["pan", x, y]),
      zoomViewAt: () => events.push("zoom"),
      draw: () => {},
    },
  });
  controller.bind();

  stage.dispatch("wheel", { deltaX: 12, deltaY: 4, deltaMode: 0, preventDefault() {} });
  stage.dispatch("wheel", { deltaX: 0, deltaY: 40, deltaMode: 0, preventDefault() {} });
  stage.dispatch("wheel", {
    deltaX: 0,
    deltaY: 8,
    deltaMode: 0,
    wheelDeltaY: -24,
    preventDefault() {},
  });
  stage.dispatch("wheel", { deltaX: 0, deltaY: 40, shiftKey: true, preventDefault() {} });
  stage.dispatch("wheel", { deltaX: 0, deltaY: 40, ctrlKey: true, preventDefault() {} });

  assert.equal(events.length, 5);
  assert.deepEqual(events[0], ["pan", -12, -4]);
  assert.equal(events[1], "zoom");
  assert.equal(events[2][0], "pan");
  assert.equal(events[2][1], 0);
  assert.equal(events[2][2], -8);
  assert.equal(events[3][0], "pan");
  assert.equal(events[3][1], 0);
  assert.equal(events[3][2], -40);
  assert.equal(events[4], "zoom");
});

test("Z/R wheel scales the main frame when no attachment is hit", () => {
  const stage = createStage();
  const events = [];
  const controller = createController({
    stage,
    state: { view: { x: 0, y: 0, zoom: 1 } },
    getViewportWidth: () => 1440,
    handlers: {
      stagePoint: () => ({ x: 0, y: 0 }),
      applySelectedAttachmentWheel: () => false,
      applySelectedFrameWheel: () => {
        events.push("frame-wheel");
        return true;
      },
      zoomViewAt: () => events.push("zoom"),
    },
  });
  controller.bind();
  stage.dispatch("wheel", { deltaY: -1, preventDefault() {} });
  assert.deepEqual(events, ["frame-wheel"]);
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
