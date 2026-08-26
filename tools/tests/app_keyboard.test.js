"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_keyboard");

/**
 * Creates a frame option target with the DOM methods used by the shortcut controller.
 * @returns {object} Frame-card-like event target.
 */
function createFrameCardTarget() {
  return {
    tagName: "DIV",
    matches: (selector) => selector === '.thumb[role="option"]',
    classList: { contains: (className) => className === "thumb" },
    getAttribute: (name) => (name === "role" ? "option" : null),
  };
}

/**
 * Creates a browser-independent keyboard controller fixture.
 * @param {object} [overrides] Dependency overrides.
 * @returns {{controller: object, listeners: Map<string, Set<Function>>, state: object}}
 */
function createFixture(overrides = {}) {
  const listeners = new Map();
  const state = {
    route: "",
    routeCalls: 0,
    selectedFrame: 0,
    referenceHidden: false,
    drawCalls: 0,
    playCalls: 0,
    undoCalls: 0,
    copyCalls: 0,
    ...overrides.state,
  };
  const windowRef = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  const documentRef = {
    querySelector(selector) {
      if (selector === "#cutoutModal" || selector === "#organizerModal") return { hidden: false };
      return null;
    },
  };
  const controller = createController({
    windowRef,
    documentRef,
    getCurrentWorkbenchRoute: () => state.route,
    syncWorkbenchRoute: (route) => {
      state.route = route;
      state.routeCalls += 1;
    },
    applyWorkbenchRoute: async () => {},
    getReferenceFrame: () => ({ index: 0 }),
    getReferenceFrameHiddenByKey: () => state.referenceHidden,
    setReferenceFrameHiddenByKey: (value) => {
      state.referenceHidden = value;
    },
    draw: () => {
      state.drawCalls += 1;
    },
    playPauseElement: {
      click: () => {
        state.playCalls += 1;
      },
    },
    undo: () => {
      state.undoCalls += 1;
    },
    copyFrameImageAttachments: () => {
      state.copyCalls += 1;
      return true;
    },
    ...overrides.dependencies,
  });
  return { controller, listeners, state };
}

test("keyboard controller binds idempotently and routes Ctrl+3", () => {
  const { controller, listeners, state } = createFixture({
    dependencies: { documentRef: { querySelector: () => ({ hidden: true }) } },
  });
  const cleanup = controller.bind();
  controller.bind();
  const event = {
    key: "3",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: { tagName: "BODY" },
    preventDefault() {
      this.prevented = true;
    },
  };
  listeners.get("keydown").forEach((listener) => listener(event));

  assert.equal(state.route, "cutout");
  assert.equal(state.routeCalls, 1);
  assert.equal(event.prevented, true);
  cleanup();
  assert.equal(listeners.get("keydown").size, 0);
});

test("keyboard controller ignores editor shortcuts while a modal is open", () => {
  const { controller, state } = createFixture();
  let prevented = false;
  controller.handleEditorKeydown({
    key: "f",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    target: { tagName: "BODY" },
    preventDefault: () => {
      prevented = true;
    },
  });

  assert.equal(prevented, false);
  assert.equal(state.drawCalls, 0);
});

test("reference-frame H shortcut is released on keyup", () => {
  const { controller, state } = createFixture({
    dependencies: { documentRef: { querySelector: () => ({ hidden: true }) }, fitView: () => {} },
  });
  controller.handleEditorKeydown({
    key: "h",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    target: { tagName: "BODY" },
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(state.referenceHidden, true);
  controller.handleKeyup({ key: "h" });
  assert.equal(state.referenceHidden, false);
  assert.equal(state.drawCalls, 2);
});

test("missing modal elements do not suspend keyboard shortcuts", () => {
  let fitCalls = 0;
  const { controller } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => null },
      fitView: () => {
        fitCalls += 1;
      },
    },
  });

  controller.handleEditorKeydown({
    key: "f",
    ctrlKey: false,
    metaKey: false,
    target: { tagName: "BODY" },
    preventDefault() {},
  });

  assert.equal(fitCalls, 1);
});

test("application confirmation suspends global Space playback", () => {
  const { controller, state } = createFixture({
    dependencies: {
      documentRef: {
        querySelector: (selector) => ({ hidden: selector !== "#appConfirmPanel" }),
      },
    },
  });

  controller.handleEditorKeydown({
    key: " ",
    ctrlKey: false,
    metaKey: false,
    target: { tagName: "BUTTON" },
    preventDefault() {},
  });

  assert.equal(state.playCalls, 0);
});

test("Space on native controls is left to the focused control", () => {
  const { controller, state } = createFixture({
    dependencies: { documentRef: { querySelector: () => ({ hidden: true }) } },
  });
  let prevented = false;

  controller.handleEditorKeydown({
    key: " ",
    ctrlKey: false,
    metaKey: false,
    target: { tagName: "BUTTON" },
    preventDefault: () => {
      prevented = true;
    },
  });

  assert.equal(prevented, false);
  assert.equal(state.playCalls, 0);
});

test("Space on a frame option selects the card without toggling playback", () => {
  const { controller, state } = createFixture({
    dependencies: { documentRef: { querySelector: () => ({ hidden: true }) } },
  });
  let prevented = false;

  controller.handleEditorKeydown({
    key: " ",
    ctrlKey: false,
    metaKey: false,
    target: createFrameCardTarget(),
    preventDefault: () => {
      prevented = true;
    },
  });

  assert.equal(prevented, false);
  assert.equal(state.playCalls, 0);
});

test("frame option retains select-all and route shortcuts while focused", () => {
  let selectedFrames = new Set();
  const { controller, state } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      getCurrentGroup: () => ({ frames: [{}, {}] }),
      setSelectedFrames: (nextSelection) => {
        selectedFrames = nextSelection;
      },
    },
  });
  const selectAllEvent = {
    key: "a",
    ctrlKey: true,
    metaKey: false,
    target: createFrameCardTarget(),
    preventDefault() {
      this.prevented = true;
    },
  };
  const routeEvent = {
    key: "3",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: createFrameCardTarget(),
    preventDefault() {
      this.prevented = true;
    },
  };

  controller.handleEditorKeydown(selectAllEvent);
  controller.handleRouteKeydown(routeEvent);

  assert.deepEqual([...selectedFrames], [0, 1]);
  assert.equal(selectAllEvent.prevented, true);
  assert.equal(state.route, "cutout");
  assert.equal(routeEvent.prevented, true);
});

test("Ctrl+Z on a number input undoes the editor action", () => {
  const { controller, state } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      isTypingTarget: () => true,
      isNumberInputTarget: () => true,
    },
  });
  const event = {
    key: "z",
    ctrlKey: true,
    metaKey: false,
    target: { tagName: "INPUT", type: "number" },
    preventDefault() {
      this.prevented = true;
    },
  };

  controller.handleEditorKeydown(event);

  assert.equal(event.prevented, true);
  assert.equal(state.undoCalls, 1);
});

test("native text editing keeps undo and copy shortcuts", () => {
  const { controller, state } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      isTypingTarget: () => true,
    },
  });
  let prevented = false;
  const baseEvent = {
    ctrlKey: true,
    metaKey: false,
    target: { tagName: "INPUT" },
    preventDefault: () => {
      prevented = true;
    },
  };

  controller.handleEditorKeydown({ ...baseEvent, key: "z" });
  controller.handleEditorKeydown({ ...baseEvent, key: "c" });

  assert.equal(prevented, false);
  assert.equal(state.undoCalls, 0);
  assert.equal(state.copyCalls, 0);
});

test("Ctrl or Cmd Y redoes an editor action outside text inputs", () => {
  let redoCount = 0;
  const { controller, state } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      redo: () => {
        redoCount += 1;
      },
    },
  });
  const event = {
    key: "y",
    ctrlKey: true,
    metaKey: false,
    target: { tagName: "DIV" },
    preventDefault() {
      this.prevented = true;
    },
  };

  controller.handleEditorKeydown(event);

  assert.equal(event.prevented, true);
  assert.equal(redoCount, 1);
});

test("Space tap arms pan then toggles play on keyup when unused", () => {
  let spacePan = false;
  let spaceConsumed = false;
  let spaceCanPlay = false;
  const { controller, state } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      setStageSpacePan: (value) => {
        spacePan = Boolean(value);
      },
      getStageSpacePan: () => spacePan,
      getStageSpacePanConsumed: () => spaceConsumed,
      setStageSpacePanConsumed: (value) => {
        spaceConsumed = Boolean(value);
      },
      getStageSpacePanCanPlay: () => spaceCanPlay,
      setStageSpacePanCanPlay: (value) => {
        spaceCanPlay = Boolean(value);
      },
    },
  });

  const stageTarget = {
    id: "stage",
    tagName: "CANVAS",
    closest(selector) {
      return selector === "#stage" ? this : null;
    },
  };
  controller.handleEditorKeydown({
    key: " ",
    code: "Space",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target: stageTarget,
    preventDefault() {},
  });
  assert.equal(spacePan, true);
  assert.equal(state.playCalls, 0);

  controller.handleKeyup({ code: "Space" });
  assert.equal(spacePan, false);
  assert.equal(state.playCalls, 1);
});

test("Space on the workbench prevents page-down and arms pan without playing", () => {
  let spacePan = false;
  let spaceCanPlay = true;
  const { controller, state } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      setStageSpacePan: (value) => {
        spacePan = Boolean(value);
      },
      getStageSpacePan: () => spacePan,
      getStageSpacePanConsumed: () => false,
      setStageSpacePanConsumed: () => {},
      getStageSpacePanCanPlay: () => spaceCanPlay,
      setStageSpacePanCanPlay: (value) => {
        spaceCanPlay = Boolean(value);
      },
    },
  });
  const mainTarget = {
    id: "mainWorkbench",
    tagName: "MAIN",
    closest(selector) {
      return selector === "#mainWorkbench" ? this : null;
    },
  };
  let prevented = false;
  controller.handleEditorKeydown({
    key: " ",
    code: "Space",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target: mainTarget,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(spacePan, true);
  assert.equal(spaceCanPlay, false);
  controller.handleKeyup({ code: "Space" });
  assert.equal(state.playCalls, 0);
});

test("Space on the workbench arms pan without toggling playback", () => {
  let spacePan = false;
  let spaceCanPlay = true;
  const { controller, state } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      setStageSpacePan: (value) => {
        spacePan = Boolean(value);
      },
      getStageSpacePan: () => spacePan,
      getStageSpacePanConsumed: () => false,
      setStageSpacePanConsumed: () => {},
      getStageSpacePanCanPlay: () => spaceCanPlay,
      setStageSpacePanCanPlay: (value) => {
        spaceCanPlay = Boolean(value);
      },
    },
  });
  const mainTarget = {
    id: "mainWorkbench",
    tagName: "MAIN",
    closest(selector) {
      return selector === "#mainWorkbench" ? this : null;
    },
  };

  controller.handleEditorKeydown({
    key: " ",
    code: "Space",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target: mainTarget,
    preventDefault() {},
  });
  assert.equal(spacePan, true);
  assert.equal(spaceCanPlay, false);
  controller.handleKeyup({ code: "Space" });
  assert.equal(spacePan, false);
  assert.equal(state.playCalls, 0);
});

test("Alt+arrows nudge the character instead of changing frames", () => {
  const nudged = [];
  let selectedFrame = 2;
  const { controller } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      getCurrentGroup: () => ({ frames: [{}, {}, {}, {}] }),
      getSelectedFrame: () => selectedFrame,
      selectFilmstripFrame: (index) => {
        selectedFrame = index;
      },
      stepOffsetByArrowKey: (key, multiplier) => {
        nudged.push([key, multiplier]);
        return true;
      },
    },
  });

  controller.handleEditorKeydown({
    key: "ArrowRight",
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    target: { tagName: "BODY" },
    preventDefault() {},
  });

  assert.deepEqual(nudged, [["ArrowRight", 10]]);
  assert.equal(selectedFrame, 2);
});

test("Space on the workbench or body after a control click does not start playback", () => {
  let spacePan = false;
  let spaceCanPlay = false;
  const { controller, state } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      setStageSpacePan: (value) => {
        spacePan = Boolean(value);
      },
      getStageSpacePan: () => spacePan,
      getStageSpacePanConsumed: () => false,
      setStageSpacePanConsumed: () => {},
      getStageSpacePanCanPlay: () => spaceCanPlay,
      setStageSpacePanCanPlay: (value) => {
        spaceCanPlay = Boolean(value);
      },
    },
  });
  const mainTarget = {
    id: "mainWorkbench",
    tagName: "MAIN",
    closest(selector) {
      return selector === "#mainWorkbench" ? this : null;
    },
  };

  controller.handleEditorKeydown({
    key: " ",
    code: "Space",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target: mainTarget,
    preventDefault() {},
  });
  controller.handleKeyup({ code: "Space" });
  assert.equal(spacePan, false);
  assert.equal(state.playCalls, 0);

  controller.handleEditorKeydown({
    key: " ",
    code: "Space",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target: { tagName: "BODY" },
    preventDefault() {},
  });
  controller.handleKeyup({ code: "Space" });
  assert.equal(state.playCalls, 0);
});

test("Space drag consumption skips play toggle on keyup", () => {
  let spacePan = true;
  let spaceConsumed = true;
  const { controller, state } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      setStageSpacePan: (value) => {
        spacePan = Boolean(value);
      },
      getStageSpacePan: () => spacePan,
      getStageSpacePanConsumed: () => spaceConsumed,
      setStageSpacePanConsumed: (value) => {
        spaceConsumed = Boolean(value);
      },
    },
  });

  controller.handleKeyup({ code: "Space" });
  assert.equal(state.playCalls, 0);
  assert.equal(spacePan, false);
});

test("arrow keys nudge a selected box on the boxes page without changing the frame", () => {
  const { BOX_NUDGE_STEP } = require("../animation_tuner/public/app_box_geometry");
  const box = { x: 10, y: 20 };
  let selectedFrame = 2;
  const { controller } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      getCurrentWorkbenchRoute: () => "boxes",
      getCurrentGroup: () => ({ frames: [{}, {}, {}, {}] }),
      getSelectedFrame: () => selectedFrame,
      selectFilmstripFrame: (index) => {
        selectedFrame = index;
      },
      nudgeSelectedBox: (deltaX, deltaY) => {
        box.x += deltaX;
        box.y += deltaY;
        return true;
      },
    },
  });

  for (const [key, deltaX, deltaY] of [
    ["ArrowRight", BOX_NUDGE_STEP, 0],
    ["ArrowLeft", -BOX_NUDGE_STEP, 0],
    ["ArrowUp", 0, -BOX_NUDGE_STEP],
    ["ArrowDown", 0, BOX_NUDGE_STEP],
  ]) {
    const startX = box.x;
    const startY = box.y;
    controller.handleEditorKeydown({
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: { tagName: "DIV" },
      preventDefault() {},
    });
    assert.equal(box.x, startX + deltaX, key);
    assert.equal(box.y, startY + deltaY, key);
    assert.equal(selectedFrame, 2, key);
  }
});

test("transform-page arrows still step frames even if a box is selected in prefs", () => {
  let selectedFrame = 0;
  let nudged = false;
  const { controller } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      getCurrentWorkbenchRoute: () => "animation",
      getCurrentGroup: () => ({ frames: [{}, {}] }),
      getSelectedFrame: () => selectedFrame,
      selectFilmstripFrame: (index) => {
        selectedFrame = index;
      },
      nudgeSelectedBox: () => {
        nudged = true;
        return true;
      },
    },
  });

  controller.handleEditorKeydown({
    key: "ArrowRight",
    ctrlKey: false,
    metaKey: false,
    target: { tagName: "DIV" },
    preventDefault() {},
  });

  assert.equal(nudged, false);
  assert.equal(selectedFrame, 1);
});

test("arrow keys still step the filmstrip when no box consumes them", () => {
  let selectedFrame = 1;
  const { controller } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      getCurrentWorkbenchRoute: () => "boxes",
      getCurrentGroup: () => ({ frames: [{}, {}, {}] }),
      getSelectedFrame: () => selectedFrame,
      selectFilmstripFrame: (index) => {
        selectedFrame = index;
      },
      nudgeSelectedBox: () => false,
    },
  });

  controller.handleEditorKeydown({
    key: "ArrowRight",
    ctrlKey: false,
    metaKey: false,
    target: { tagName: "DIV" },
    preventDefault() {},
  });

  assert.equal(selectedFrame, 2);
});

test("Ctrl+/- zooms the stage around the center", () => {
  let zoom = 1;
  const zooms = [];
  const { controller } = createFixture({
    dependencies: {
      documentRef: { querySelector: () => ({ hidden: true }) },
      getStageZoom: () => zoom,
      setStageZoom: (nextZoom) => {
        zooms.push(nextZoom);
        zoom = nextZoom;
      },
    },
  });

  controller.handleEditorKeydown({
    key: "=",
    ctrlKey: true,
    metaKey: false,
    target: { tagName: "DIV" },
    preventDefault() {},
  });
  controller.handleEditorKeydown({
    key: "-",
    ctrlKey: true,
    metaKey: false,
    target: { tagName: "DIV" },
    preventDefault() {},
  });

  assert.deepEqual(zooms, [1.08, 1.08 * 0.92]);
});
