"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
require("../animation_tuner/public/batch_cutout_events_preview");
const {
  activateAutomaticPreview,
  createController,
} = require("../animation_tuner/public/batch_cutout_events");

/** Creates a tolerant DOM fixture for event-wiring registration. @returns {object} Fixture. */
function createFixture() {
  const registrations = [];
  const elementsByName = {};
  const createElement = (name) => {
    const attributes = new Map();
    return {
      hidden: true,
      value: "",
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, listener) {
        registrations.push({ name, type, listener });
      },
      setAttribute(attribute, value) {
        attributes.set(attribute, String(value));
      },
      getAttribute(attribute) {
        return attributes.get(attribute) ?? null;
      },
      click() {},
      focus() {},
      setPointerCapture() {},
      scrollTo() {},
    };
  };
  const elements = new Proxy(
    {},
    {
      get: (_target, name) => (elementsByName[name] ||= createElement(name)),
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
    activeElement: createElement("activeElement"),
    querySelectorAll: () => [],
  };
  const state = { items: [], selectedIndex: 0, protectionPreview: null };
  let renderCalls = 0;
  const controller = createController({
    elements,
    state,
    windowRef,
    documentRef,
    navigatorRef: {},
    advancedPresetButtons: [],
    bindNumericRange() {},
    text: (key) => key,
    renderPreview: () => {
      renderCalls += 1;
    },
    renderStatus() {},
  });
  return { controller, registrations, elementsByName, state, renderCalls: () => renderCalls };
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

test("automatic parameter edits activate processing and reveal the result preview", () => {
  const state = { previewMode: "original" };
  const item = { processingActivated: false, automaticCutoutActivated: false };

  assert.equal(activateAutomaticPreview(state, item), true);
  assert.equal(state.previewMode, "result");
  assert.equal(item.processingActivated, true);
  assert.equal(item.automaticCutoutActivated, true);
  assert.equal(activateAutomaticPreview(state, null), false);
  assert.throws(() => activateAutomaticPreview(null, item), /requires session state/);
});

test("switching protection mode clears the incompatible preview", () => {
  const { controller, registrations, elementsByName, state, renderCalls } = createFixture();
  controller.bind();
  state.protectionPreview = { mode: "protect-range" };
  elementsByName.cutoutProtectionType.value = "color";
  const change = registrations.find(
    (registration) => registration.name === "cutoutProtectionType" && registration.type === "change",
  );

  change.listener();

  assert.equal(state.protectionPreview, null);
  assert.equal(renderCalls(), 1);
});

test("sidebar switches between parameters and batch images and can collapse", () => {
  const { controller, elementsByName, state, renderCalls } = createFixture();
  controller.bind();
  state.batchTrayCollapsed = true;

  controller.setSidebarPanel("batch");
  assert.equal(elementsByName.cutoutSidebarParametersPanel.hidden, true);
  assert.equal(elementsByName.cutoutSidebarBatchPanel.hidden, false);
  assert.equal(elementsByName.cutoutSidebarBatchTab.getAttribute("aria-selected"), "true");
  assert.equal(elementsByName.cutoutModal.dataset.sidebarPanel, "batch");
  assert.equal(state.batchTrayCollapsed, false);

  controller.setSidebarCollapsed(true);
  assert.equal(elementsByName.cutoutSidebarCollapse.getAttribute("aria-expanded"), "false");
  assert.equal(renderCalls(), 1);
});

test("switching Regular/Post tabs restores stored parameters instead of recapturing HTML defaults", () => {
  const tabs = [];
  const panels = [];
  const createNode = (dataset) => ({
    dataset,
    listeners: [],
    classList: {
      names: new Set(),
      toggle(name, force) {
        if (force) this.names.add(name);
        else this.names.delete(name);
      },
    },
    setAttribute() {},
    addEventListener(type, listener) {
      this.listeners.push({ type, listener });
    },
  });
  for (const tab of ["regular", "post"]) tabs.push(createNode({ cutoutTab: tab }));
  for (const panel of ["regular", "post"]) panels.push(createNode({ cutoutPanel: panel }));
  const stored = { tolerance: 1, despillStrength: 0, edgeRecoveryStrength: 0 };
  let previewCalls = 0;
  let restoreCalls = 0;
  let scheduleCalls = 0;
  const closeCalls = [];
  const state = {
    items: [{ processingParameters: stored, processingActivated: true }],
    selectedIndex: 0,
    worksetResolver: null,
    previewFitScale: 1,
    protectionPreview: null,
  };
  const elementsByName = {
    cutoutModal: {
      hidden: false,
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {},
    },
    cutoutConfirmPanel: { hidden: true, addEventListener() {} },
  };
  const elements = new Proxy(elementsByName, {
    get: (target, name) =>
      target[name] ||
      (target[name] = {
        hidden: true,
        value: "",
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute() {},
        getAttribute() {
          return null;
        },
        click() {},
        focus() {},
        setPointerCapture() {},
        scrollTo() {},
      }),
  });
  const registrations = [];
  const controller = createController({
    elements,
    state,
    windowRef: {
      addEventListener(type, listener) {
        registrations.push({ type, listener });
      },
      requestAnimationFrame(callback) {
        callback();
        return 1;
      },
    },
    documentRef: {
      body: { classList: { contains: () => true } },
      activeElement: { tagName: "BODY", getAttribute: () => null },
      querySelectorAll(selector) {
        if (selector === "[data-cutout-tab]") return tabs;
        if (selector === "[data-cutout-panel]") return panels;
        return [];
      },
    },
    navigatorRef: {},
    advancedPresetButtons: [],
    bindNumericRange() {},
    selectedItem: () => state.items[0],
    applyProcessingParametersToControls(parameters) {
      restoreCalls += 1;
      assert.equal(parameters, stored);
    },
    schedulePreview() {
      scheduleCalls += 1;
    },
    requestClose() {
      closeCalls.push("close");
      return Promise.resolve(true);
    },
    text: (key) => key,
    renderPreview() {
      previewCalls += 1;
    },
    renderStatus() {},
  });
  controller.bind();
  const postClick = tabs[1].listeners.find((entry) => entry.type === "click");
  postClick.listener();
  assert.equal(scheduleCalls, 0, "tab switches must not recapture hidden range defaults");
  assert.equal(restoreCalls, 1);
  assert.equal(state.items[0].processingParameters, stored);
  assert.equal(state.previewFitScale, null);
  assert.ok(previewCalls >= 1);

  const escape = registrations.find((entry) => entry.type === "keydown");
  const event = {
    key: "Escape",
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {},
  };
  escape.listener(event);
  assert.deepEqual(closeCalls, []);
  assert.equal(event.prevented, true);
});
