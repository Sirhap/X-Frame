"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_ui_controller");

class HTMLElementStub {
  constructor(tagName = "DIV") {
    this.tagName = tagName;
    this.isContentEditable = false;
  }
}

function classList() {
  return { add() {}, remove() {}, toggle() {} };
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
  const elements = {
    cutoutResult: { dataset: {}, setAttribute() {}, classList: classList() },
    cutoutConfirmPanel: { hidden: true },
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
    cutoutConfirmApply: { focus() {} },
    cutoutConfirmMessage: {},
    cutoutConfirmDetails: { innerHTML: "", append() {} },
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
  const documentRef = {
    activeElement: null,
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
  return { controller, dependencies, state, elements, documentRef };
}

test("UI controller validates required dependencies", () => {
  assert.throws(() => createController(), /dependencies are required/);
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

test("confirmation controller resolves the active promise", async () => {
  const { controller, elements } = createFixture();
  const resultPromise = controller.requestConfirmation("message", [["count", 2]]);
  assert.equal(elements.cutoutConfirmPanel.hidden, false);
  controller.resolveConfirmation(true);
  assert.equal(await resultPromise, true);
  assert.equal(elements.cutoutConfirmPanel.hidden, true);
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
