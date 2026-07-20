"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
require("../animation_tuner/public/batch_cutout_events_preview");
const { createController } = require("../animation_tuner/public/batch_cutout_events");

/** Creates a tolerant DOM fixture for event-wiring registration. @returns {object} Fixture. */
function createFixture() {
  const registrations = [];
  const element = {
    hidden: true,
    value: "",
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, listener) {
      registrations.push({ type, listener });
    },
    click() {},
    focus() {},
    setPointerCapture() {},
    scrollTo() {},
  };
  const elements = new Proxy(
    {},
    {
      get: () => element,
    },
  );
  const windowRef = {
    addEventListener(type, listener) {
      registrations.push({ type, listener });
    },
    requestAnimationFrame() {
      return 1;
    },
  };
  const documentRef = {
    activeElement: element,
    querySelectorAll: () => [],
  };
  const state = { items: [], selectedIndex: 0 };
  const controller = createController({
    elements,
    state,
    windowRef,
    documentRef,
    navigatorRef: {},
    advancedPresetButtons: [],
    bindNumericRange() {},
    text: (key) => key,
  });
  return { controller, registrations };
}

test("batch cutout event controller registers the full interaction surface", () => {
  const { controller, registrations } = createFixture();

  assert.doesNotThrow(() => controller.bind());
  assert.ok(registrations.length > 30);
  assert.ok(registrations.some(({ type }) => type === "pointerdown"));
  assert.ok(registrations.some(({ type }) => type === "keydown"));
  assert.ok(registrations.some(({ type }) => type === "resize"));
});

test("batch cutout event controller validates required state and elements", () => {
  assert.throws(() => createController(), /requires elements, state/);
});
