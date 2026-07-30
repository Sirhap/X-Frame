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
  const confirmations = [];
  const lifecycle = [];
  const appliedParameters = [];
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
    setRepairMode() {},
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
      sourceImageData: image.sourceImageData || {
        width: 1,
        height: 1,
        data: new Uint8ClampedArray([255, 255, 255, 255]),
      },
      processingParameters: { tolerance: 1, feather: 0 },
      processingActivated: false,
      repairs: [],
      backgroundSamples: [],
      protectedColors: [],
    }),
    applyProcessingParametersToControls(parameters) {
      appliedParameters.push(parameters);
    },
    estimateBackgroundColor: () => ({ r: 12, g: 34, b: 56 }),
    backgroundController: {
      normalizeColor: (color) => ({ ...color, a: 255 }),
    },
    selectedItem: () => state.items[state.selectedIndex] || null,
    renderQueue() {},
    setStatus: (message) => statuses.push(message),
    requestConfirmation: async (message, _details, options) => {
      confirmations.push({ message, options });
      return true;
    },
  });
  return { appliedParameters, controller, confirmations, lifecycle, state, statuses };
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

test("session controller announces a restored standalone batch", () => {
  const { controller, statuses } = createFixture();

  controller.open({ syncRoute: false });

  assert.deepEqual(statuses, ["batchResumed"]);
});

test("session controller clears the current batch after confirmation", async () => {
  const { controller, state } = createFixture();

  await controller.clear();

  assert.equal(state.items.length, 0);
  assert.equal(state.sourceKind, "");
  assert.equal(state.selectedIndex, 0);
});

test("session controller uses new-batch confirmation wording", async () => {
  const { controller, confirmations } = createFixture();

  await controller.clear({ mode: "new" });

  assert.deepEqual(confirmations[0], {
    message: "newBatchConfirm",
    options: { title: "newBatchTitle", confirmLabel: "confirmNewBatch", tone: "danger" },
  });
});

test("session controller restores a standalone batch after an isolated workset closes", async () => {
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
  assert.equal(state.sourceKind, "files");
  assert.deepEqual(
    state.items.map((item) => item.id),
    ["frame-1"],
  );
  assert.deepEqual([...state.selectedIds], ["frame-1"]);
  assert.deepEqual(lifecycle, ["editor-inert:true"]);
});

test("session controller clears an isolated workset when no standalone batch was suspended", async () => {
  const { controller, state } = createFixture();
  state.items = [];
  state.selectedIds.clear();
  state.sourceKind = "";
  const resultPromise = controller.openWorkset({
    name: "demo",
    mode: "single",
    items: [{ name: "frame.png", image: {}, frame: { id: "frame-1" } }],
  });

  controller.close();

  assert.equal(await resultPromise, null);
  assert.equal(state.sourceKind, "");
  assert.deepEqual(state.items, []);
});

test("session controller auto-detects each batch background and restores the requested profile", async () => {
  const { appliedParameters, controller, state } = createFixture();
  state.items = [];
  state.selectedIds.clear();
  state.sourceKind = "";
  const resultPromise = controller.openWorkset({
    name: "demo",
    mode: "batch",
    autoDetectBackground: true,
    processingParameters: {
      tolerance: -1,
      edgeBoost: 10,
      blendStrength: 100,
      blendMode: "blend",
      despillStrength: 100,
      despillMode: "general",
    },
    items: [{ name: "frame.png", image: {}, frame: { id: "frame-1" } }],
  });

  assert.equal(state.items[0].processingActivated, true);
  assert.equal(state.items[0].automaticCutoutActivated, true);
  assert.equal(state.items[0].processingParameters.backgroundColor, "#0c2238");
  assert.equal(state.items[0].processingParameters.tolerance, -1);
  assert.equal(state.items[0].processingParameters.blendStrength, 100);
  assert.equal(state.items[0].processingParameters.despillStrength, 100);
  assert.deepEqual(state.items[0].backgroundSamples, [{ r: 12, g: 34, b: 56, a: 255 }]);
  assert.equal(appliedParameters.at(-1), state.items[0].processingParameters);

  controller.close();
  assert.equal(await resultPromise, null);
});
