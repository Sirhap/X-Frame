"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_session_controller");

/**
 * Creates a modal/session fixture with browser APIs reduced to deterministic stubs.
 * @returns {{controller:object,state:object,statuses:string[]}}
 */
function createFixture() {
  const statuses = [];
  const lifecycle = [];
  const state = {
    busy: false,
    items: [
      {
        id: "frame-1",
        processingActivated: false,
        repairs: [],
        backgroundSamples: [],
        protectedColors: [],
      },
    ],
    selectedIndex: 0,
    selectedIds: new Set(["frame-1"]),
    sourceKind: "files",
    sessionMode: "batch",
    thumbnailJob: 0,
    batchTrayCollapsed: false,
    worksetResolver: null,
    previewMode: "result",
  };
  const elements = {
    cutoutConnected: { checked: true },
    cutoutPerceptual: { checked: true },
    cutoutModal: { hidden: true, classList: { add() {}, remove() {} } },
    cutoutAddFiles: { focus() {} },
    cutoutConfirmPanel: { hidden: true },
  };
  const documentRef = {
    activeElement: { focus() {} },
    body: { classList: { add() {}, remove() {} } },
  };
  const controller = createController({
    state,
    elements,
    text: (key) => key,
    documentRef,
    host: {
      onOpen: () => lifecycle.push("open-route"),
      onClose: () => lifecycle.push("close-route"),
    },
    setSettingsMode() {},
    setEditorInert(value) {
      lifecycle.push(`editor-inert:${value}`);
    },
    renderLanguage() {},
    renderPreview() {},
    scheduleBatchThumbnails() {},
    stopBatchPlayback() {},
    cancelRepairGestureFrame() {},
    resolveConfirmation() {},
    resultArtifacts: { clear() {} },
    assertImagePixelBudget: () => ({ totalPixels: 1 }),
    createItem: (image, name, frame) => ({
      id: name,
      image,
      name,
      frame,
      processingActivated: false,
      repairs: [],
      backgroundSamples: [],
      protectedColors: [],
    }),
    applyProcessingParametersToControls() {},
    selectedItem: () => state.items[state.selectedIndex] || null,
    renderQueue() {},
    setStatus: (message) => statuses.push(message),
    requestConfirmation: async () => true,
  });
  return { controller, lifecycle, state, statuses };
}

test("session controller validates required dependencies", () => {
  assert.throws(() => createController(), /dependencies are required/);
});

test("session controller detects workset changes", () => {
  const { controller, state } = createFixture();

  assert.equal(controller.hasWorksetChanges(), false);
  state.items[0].processingActivated = true;
  assert.equal(controller.hasWorksetChanges(), true);
});

test("session controller clears the current batch after confirmation", async () => {
  const { controller, state } = createFixture();

  await controller.clear();

  assert.equal(state.items.length, 0);
  assert.equal(state.sourceKind, "");
  assert.equal(state.selectedIndex, 0);
});

test("session controller resolves an isolated workset without replacing its host route", async () => {
  const { controller, lifecycle, state } = createFixture();
  const resultPromise = controller.openWorkset({
    name: "demo",
    mode: "single",
    items: [{ name: "frame.png", image: {}, frame: { id: "frame-1" } }],
  });

  assert.equal(state.sourceKind, "workset");
  assert.deepEqual(lifecycle, ["editor-inert:true"]);
  controller.close();

  assert.equal(await resultPromise, null);
  assert.equal(state.sourceKind, "");
  assert.deepEqual(lifecycle, ["editor-inert:true"]);
});
