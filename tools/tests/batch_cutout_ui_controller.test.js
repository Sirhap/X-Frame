"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createController,
  formatAdvancedSummary,
} = require("../animation_tuner/public/batch_cutout_ui_controller");
const { TEXT } = require("../animation_tuner/public/batch_cutout_text");

class HTMLElementStub {
  constructor(tagName = "DIV") {
    this.tagName = tagName;
    this.isContentEditable = false;
  }
}

function classList() {
  const names = new Set();
  return {
    add(...tokens) {
      tokens.forEach((token) => names.add(token));
    },
    remove(...tokens) {
      tokens.forEach((token) => names.delete(token));
    },
    toggle(token, force) {
      const enabled = force === undefined ? !names.has(token) : Boolean(force);
      if (enabled) names.add(token);
      else names.delete(token);
      return enabled;
    },
    contains(token) {
      return names.has(token);
    },
  };
}

/**
 * Creates a small DOM/state fixture for the UI controller.
 * @returns {{controller:object,state:object,elements:object,documentRef:object}}
 */
function createFixture() {
  const state = {
    items: [],
    selectedIndex: 0,
    sessionMode: "batch",
    sourceKind: "",
    repairMode: "automatic",
    previewMode: "result",
    previewSpacePan: false,
    previewPanDrag: null,
    previewPanX: 0,
    previewPanY: 0,
    confirmationResolver: null,
  };
  const confirmationCard = {
    dataset: {},
    removeAttribute(name) {
      if (name === "data-tone") delete this.dataset.tone;
    },
  };
  const elements = {
    cutoutResult: { dataset: {}, setAttribute() {}, classList: classList() },
    cutoutOriginal: { dataset: {}, setAttribute() {}, classList: classList() },
    cutoutConfirmPanel: {
      hidden: true,
      querySelector: (selector) => (selector === ".cutoutConfirmCard" ? confirmationCard : null),
    },
    cutoutModal: {
      hidden: false,
      classList: classList(),
      querySelectorAll: () => [],
    },
    cutoutOpen: {},
    cutoutClose: { setAttribute() {} },
    cutoutPrevious: { setAttribute() {}, classList: classList(), closest: () => null },
    cutoutNext: { setAttribute() {}, classList: classList(), closest: () => null },
    cutoutAddFiles: {},
    cutoutTitle: {},
    cutoutFramePrefix: {},
    cutoutApplyGroup: {},
    cutoutRepairBatch: {},
    cutoutViewResult: { classList: classList(), setAttribute() {} },
    cutoutViewOriginal: { classList: classList(), setAttribute() {} },
    cutoutViewAlpha: { classList: classList(), setAttribute() {} },
    cutoutViewDifference: { classList: classList(), setAttribute() {} },
    cutoutViewCaption: {},
    cutoutRepairTools: { dataset: {} },
    cutoutConfirmTitle: {},
    cutoutConfirmCancel: {
      focus() {
        documentRef.activeElement = this;
      },
    },
    cutoutConfirmApply: {
      focus() {
        documentRef.activeElement = this;
      },
    },
    cutoutConfirmMessage: {},
    cutoutConfirmDetails: { hidden: false, innerHTML: "", append() {} },
    cutoutBatchTrayActions: {
      scrollWidth: 500,
      clientWidth: 100,
      scrollLeft: 0,
      scrollTo({ left }) {
        this.scrollLeft = left;
      },
    },
    cutoutAlphaLow: { value: "0" },
    cutoutAlphaHigh: { value: "255" },
    cutoutAlphaThreshold: { value: "2" },
    cutoutProtectionTolerance: { value: "8" },
  };
  const app = {};
  const returnFocus = {
    isConnected: true,
    focus() {
      documentRef.activeElement = this;
    },
  };
  const documentRef = {
    activeElement: returnFocus,
    title: "",
    querySelector: () => app,
    querySelectorAll: () => [],
    createElement: (tagName) => new HTMLElementStub(tagName.toUpperCase()),
  };
  const advancedSummary = { textContent: "" };
  const dependencies = {
    elements,
    state,
    text: (key) => key,
    selectedItem: () => state.items[state.selectedIndex] || null,
    renderQueue() {},
    renderStatus() {},
    renderProtectionPreviewInfo() {},
    renderPreview() {},
    setPreviewScale() {},
    previewCanvasPoint: () => ({ x: 0, y: 0 }),
    documentRef,
    windowRef: {
      setTimeout(callback) {
        callback();
      },
    },
    advancedSummary,
    advancedPresetButtons: [],
    advancedPresets: {},
    htmlElementConstructor: HTMLElementStub,
  };
  const controller = createController(dependencies);
  return { confirmationCard, controller, dependencies, state, elements, documentRef, returnFocus };
}

test("UI controller validates required dependencies", () => {
  assert.throws(() => createController(), /dependencies are required/);
});

test("batch workset exposes embedded stacking state without single-image layout", () => {
  const { controller, elements, state } = createFixture();
  controller.renderSessionMode();
  assert.equal(elements.cutoutModal.classList.contains("worksetSession"), false);

  state.sourceKind = "workset";
  state.sessionMode = "batch";
  controller.renderSessionMode();
  assert.equal(elements.cutoutModal.classList.contains("worksetSession"), true);
  assert.equal(elements.cutoutModal.classList.contains("singleEditSession"), false);

  state.sessionMode = "single";
  controller.renderSessionMode();
  assert.equal(elements.cutoutModal.classList.contains("worksetSession"), true);
  assert.equal(elements.cutoutModal.classList.contains("singleEditSession"), true);

  state.sourceKind = "files";
  controller.renderSessionMode();
  assert.equal(elements.cutoutModal.classList.contains("worksetSession"), false);
});

test("preview pan controller preserves viewport state and redraws", () => {
  const fixture = createFixture();
  const { controller, dependencies, state, elements } = fixture;
  let renders = 0;
  const target = {
    width: 100,
    height: 80,
    setPointerCapture() {},
    getBoundingClientRect: () => ({ width: 200, height: 160 }),
    _cutoutView: { scale: 1 },
  };
  const event = {
    button: 1,
    pointerId: 7,
    clientX: 20,
    clientY: 30,
    preventDefault() {},
  };
  const panController = createController({
    ...dependencies,
    renderPreview() {
      renders += 1;
    },
  });
  assert.equal(panController.beginPreviewPan(event, target), true);
  assert.equal(state.previewPanDrag.pointerId, 7);
  panController.movePreviewPan({ pointerId: 7, clientX: 40, clientY: 70 });
  assert.equal(state.previewPanX, 10);
  assert.equal(state.previewPanY, 20);
  assert.equal(renders, 1);
  panController.endPreviewPan({ pointerId: 7 });
  assert.equal(state.previewPanDrag, null);
  assert.equal(controller.isEditableTarget(new HTMLElementStub("INPUT")), true);
  assert.equal(elements.cutoutResult.dataset.processing, undefined);
});

test("idle preview uses stage-style primary drag while repair tools keep pointer priority", () => {
  const { controller, state, elements } = createFixture();
  const primaryPointer = { button: 0 };

  state.repairMode = "automatic";
  assert.equal(controller.shouldPanPreview(primaryPointer, elements.cutoutResult), true);
  state.repairMode = "brush";
  state.previewMode = "result";
  assert.equal(controller.shouldPanPreview(primaryPointer, elements.cutoutResult), false);
  assert.equal(controller.shouldPanPreview(primaryPointer, elements.cutoutOriginal), true);
  state.previewSpacePan = true;
  assert.equal(controller.shouldPanPreview(primaryPointer, elements.cutoutResult), true);
});

test("preview wheel zoom matches the frame stage without requiring a modifier", () => {
  const fixture = createFixture();
  const zoomCalls = [];
  const controller = createController({
    ...fixture.dependencies,
    setPreviewScale(...args) {
      zoomCalls.push(args);
    },
    previewCanvasPoint(event, target) {
      const rect = target.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * target.width,
        y: ((event.clientY - rect.top) / rect.height) * target.height,
      };
    },
  });
  const target = {
    width: 200,
    height: 100,
    _cutoutView: { scale: 2 },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
  };
  let prevented = false;

  controller.zoomPreviewAtPointer(
    {
      clientX: 110,
      clientY: 70,
      deltaY: -1,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {
        prevented = true;
      },
    },
    target,
  );

  assert.equal(prevented, true);
  assert.equal(zoomCalls.length, 1);
  assert.equal(zoomCalls[0][0], 2.16);
  assert.equal(zoomCalls[0][1], target);
  assert.deepEqual(zoomCalls[0][2], { x: 100, y: 50 });
});

test("confirmation controller resolves the active promise", async () => {
  const { controller, elements, documentRef, returnFocus } = createFixture();
  const resultPromise = controller.requestConfirmation("message", [["count", 2]]);
  assert.equal(elements.cutoutConfirmPanel.hidden, false);
  assert.equal(elements.cutoutConfirmDetails.hidden, false);
  assert.equal(documentRef.activeElement, elements.cutoutConfirmApply);
  controller.resolveConfirmation(true);
  assert.equal(await resultPromise, true);
  assert.equal(elements.cutoutConfirmPanel.hidden, true);
  assert.equal(documentRef.activeElement, returnFocus);
});

test("danger confirmation focuses cancellation and hides empty details", async () => {
  const { confirmationCard, controller, elements, documentRef } = createFixture();
  const resultPromise = controller.requestConfirmation("Delete batch?", [], { tone: "danger" });

  assert.equal(confirmationCard.dataset.tone, "danger");
  assert.equal(elements.cutoutConfirmDetails.hidden, true);
  assert.equal(documentRef.activeElement, elements.cutoutConfirmCancel);
  controller.resolveConfirmation(false);
  assert.equal(await resultPromise, false);
  assert.equal(confirmationCard.dataset.tone, undefined);
});

test("advanced summary uses 未设置 / Off instead of the zero machine string", () => {
  const interpolate =
    (language) =>
    (key, variables = {}) =>
      String(TEXT[language][key] || key).replace(/\{(\w+)\}/g, (_match, name) => variables[name] ?? "");

  assert.equal(
    formatAdvancedSummary({ alphaLow: 0, alphaHigh: 0, alphaThreshold: 0 }, interpolate("zh")),
    "未设置",
  );
  assert.equal(
    formatAdvancedSummary({ alphaLow: 0, alphaHigh: 0, alphaThreshold: 0 }, interpolate("en")),
    "Off",
  );
  assert.doesNotMatch(
    formatAdvancedSummary({ alphaLow: 0, alphaHigh: 0, alphaThreshold: 0 }, interpolate("zh")),
    /0 — 0 \/ T 0/,
  );
  assert.equal(
    formatAdvancedSummary({ alphaLow: 8, alphaHigh: 240, alphaThreshold: 2 }, interpolate("zh")),
    "8 — 240 / T 2",
  );

  const fixture = createFixture();
  fixture.elements.cutoutAlphaLow.value = "0";
  fixture.elements.cutoutAlphaHigh.value = "0";
  fixture.elements.cutoutAlphaThreshold.value = "0";
  const wired = createController({
    ...fixture.dependencies,
    text: interpolate("zh"),
  });
  wired.renderAdvancedMode();
  assert.equal(fixture.dependencies.advancedSummary.textContent, "未设置");
  assert.doesNotMatch(fixture.dependencies.advancedSummary.textContent, /0 — 0 \/ T 0/);
});

test("toolbar scrolling keeps wheel and keyboard behavior bounded", () => {
  const { controller, elements } = createFixture();
  let prevented = false;
  controller.scrollBatchActionsByWheel({
    ctrlKey: false,
    deltaX: 0,
    deltaY: 999,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(elements.cutoutBatchTrayActions.scrollLeft, 400);
  assert.equal(prevented, true);
  controller.scrollBatchActionsByKeyboard({
    target: elements.cutoutBatchTrayActions,
    key: "Home",
    preventDefault() {},
  });
  assert.equal(elements.cutoutBatchTrayActions.scrollLeft, 0);
});
