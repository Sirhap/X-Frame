"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_keyboard");

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
