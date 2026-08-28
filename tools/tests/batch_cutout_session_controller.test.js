"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_session_controller");

/**
 * Creates a modal/session fixture with browser APIs reduced to deterministic stubs.
 * @returns {{controller:object,state:object,statuses:string[]}}
 */
function createFixture(overrides = {}) {
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
    estimateBackgroundColor: overrides.estimateBackgroundColor || (() => ({ r: 12, g: 34, b: 56 })),
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
  state.items[0].repairs = [{ id: "repair-1" }];
  assert.equal(controller.hasWorksetChanges(), true);
});

test("preview-arming processing is not a workset change", () => {
  const { controller, state } = createFixture();
  state.sourceKind = "group";
  state.items[0].processingActivated = true;
  state.items[0].automaticCutoutActivated = true;
  assert.equal(controller.hasWorksetChanges(), false);
  assert.equal(controller.hasUnsavedChanges(), false);
});

test("loaded current-group cutout is not unsaved until the user edits", () => {
  const { controller, state } = createFixture();
  state.sourceKind = "group";
  assert.equal(controller.hasUnsavedChanges(), false);
  state.items[0].processingRevision = Number(state.items[0].processingRevision || 0) + 1;
  assert.equal(controller.hasUnsavedChanges(), true);
  state.items = [];
  assert.equal(controller.hasUnsavedChanges(), false);
});

test("imported file batches stay unsaved until cleared", () => {
  const { controller, state } = createFixture();
  state.sourceKind = "files";
  assert.equal(controller.hasUnsavedChanges(), true);
  state.items = [];
  assert.equal(controller.hasUnsavedChanges(), false);
});

test("closing an unedited loaded group does not ask to discard", async () => {
  const { controller, confirmations, state } = createFixture();
  state.sourceKind = "group";
  const closed = await controller.requestClose();
  assert.equal(closed, true);
  assert.equal(confirmations.length, 0);
});

test("closing an edited loaded group asks to discard", async () => {
  const { controller, confirmations, state } = createFixture();
  state.sourceKind = "group";
  state.items[0].repairs = [{ id: "repair-1" }];
  const closed = await controller.requestClose();
  assert.equal(closed, true);
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].options.confirmLabel, "confirmDiscard");
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
  assert.equal(controller.hasWorksetChanges(), false);
  assert.equal(controller.hasUnsavedChanges(), false);

  controller.close();
  assert.equal(await resultPromise, null);
});

test("session autoDetectBackground keys chroma behind 4px white chrome", async () => {
  const { estimateBackgroundColor } = require("../animation_tuner/public/batch_cutout_background_estimator");
  const { applyCutout } = require("../animation_tuner/public/batch_cutout_core");
  const { resolveAutomaticSettingsHintKey } = require("../animation_tuner/public/batch_cutout_settings");
  const width = 64;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set([255, 255, 255, 255], offset);
  for (let y = 4; y < height - 4; y += 1) {
    for (let x = 4; x < width - 4; x += 1) data.set([0, 177, 64, 255], (y * width + x) * 4);
  }
  const { appliedParameters, controller, state } = createFixture({ estimateBackgroundColor });
  state.items = [];
  state.selectedIds.clear();
  state.sourceKind = "";
  const resultPromise = controller.openWorkset({
    name: "chrome",
    mode: "batch",
    autoDetectBackground: true,
    items: [{ name: "green-behind-white-chrome.png", image: { sourceImageData: { data, width, height } } }],
  });
  const item = state.items[0];
  assert.equal(item.processingParameters.backgroundColor, "#00b140");
  assert.equal(item.automaticCutoutActivated, true);
  assert.ok(item.backgroundSamples.length);
  assert.equal(appliedParameters.at(-1)?.backgroundColor, "#00b140");
  assert.notEqual(
    resolveAutomaticSettingsHintKey({
      itemAvailable: true,
      automatic: true,
      hasBackgroundSample: Boolean(item.backgroundSamples.length),
    }),
    "needsBackgroundSampleHint",
  );
  const keyed = applyCutout(data, width, height, {
    backgroundColor: estimateBackgroundColor(data, width, height),
    automaticCutout: true,
    connected: false,
    tolerance: 1,
  });
  let remainingGreen = 0;
  for (let offset = 0; offset < keyed.data.length; offset += 4) {
    if (keyed.data[offset + 3] < 16) continue;
    if (keyed.data[offset] < 40 && keyed.data[offset + 1] > 150 && keyed.data[offset + 2] < 90) remainingGreen += 1;
  }
  assert.equal(remainingGreen, 0);
  controller.close();
  assert.equal(await resultPromise, null);
});

test("editing an auto-detected workset asks to discard", async () => {
  const { confirmations, controller, state } = createFixture();
  state.items = [];
  state.selectedIds.clear();
  state.sourceKind = "";
  const resultPromise = controller.openWorkset({
    name: "demo",
    mode: "batch",
    autoDetectBackground: true,
    items: [{ name: "frame.png", image: {}, frame: { id: "frame-1" } }],
  });
  assert.equal(controller.hasWorksetChanges(), false);
  state.items[0].processingParameters = {
    ...state.items[0].processingParameters,
    tolerance: 9,
  };
  const closed = await controller.requestClose();
  assert.equal(closed, true);
  assert.equal(confirmations.length, 1);
  assert.equal(await resultPromise, null);
});

test("single-frame reopen keeps prior cutout parameters armed on the true source", async () => {
  const { appliedParameters, confirmations, controller, state } = createFixture();
  state.items = [];
  state.selectedIds.clear();
  state.sourceKind = "";
  const resultPromise = controller.openWorkset({
    name: "demo",
    mode: "single",
    items: [
      {
        name: "frame.png",
        image: { label: "source" },
        frame: { id: "frame-1" },
        cutoutState: {
          processingParameters: { tolerance: 1, feather: 2 },
          backgroundSamples: [{ r: 255, g: 255, b: 255, a: 255 }],
        },
      },
    ],
  });

  assert.equal(state.items[0].processingActivated, true);
  assert.equal(state.items[0].automaticCutoutActivated, true);
  assert.equal(state.items[0].processingParameters.tolerance, 1);
  assert.deepEqual(state.items[0].backgroundSamples, [{ r: 255, g: 255, b: 255, a: 255 }]);
  assert.equal(appliedParameters.at(-1), state.items[0].processingParameters);
  assert.equal(controller.hasWorksetChanges(), false);
  assert.equal(controller.hasUnsavedChanges(), false);

  const closed = await controller.requestClose();
  assert.equal(closed, true);
  assert.equal(confirmations.length, 0);
  assert.equal(await resultPromise, null);
});

function platedRedBodySource() {
  const width = 256;
  const height = 256;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        data.set([0, 0, 0, 0], offset);
      } else if (x <= 2 || y <= 2 || x >= width - 3 || y >= height - 3) {
        data.set([255, 255, 255, 255], offset);
      } else {
        data.set([210, 36, 42, 255], offset);
      }
    }
  }
  return { data, width, height };
}

function paleEdgeCutSource() {
  const width = 32;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 4; y < height - 4; y += 1) {
    for (let x = 4; x < width - 4; x += 1) data.set([210, 36, 42, 255], (y * width + x) * 4);
  }
  for (let i = 0; i < 16; i += 1) data.set([250, 250, 250, 255], (0 * width + (8 + i)) * 4);
  return { data, width, height };
}

test("/tools/cutout session import keys the white plate not the red body", async () => {
  const { estimateBackgroundColor } = require("../animation_tuner/public/batch_cutout_background_estimator");
  const { applyCutout } = require("../animation_tuner/public/batch_cutout_core");
  const source = platedRedBodySource();
  const { controller, state } = createFixture({ estimateBackgroundColor });
  state.items = [];
  state.selectedIds.clear();
  state.sourceKind = "";
  const resultPromise = controller.openWorkset({
    name: "plate",
    mode: "batch",
    autoDetectBackground: true,
    items: [{ name: "large-gutter-plate.png", image: { sourceImageData: source } }],
  });
  const item = state.items[0];
  assert.notEqual(item.processingParameters.backgroundColor, "#d2242a");
  assert.match(item.processingParameters.backgroundColor, /^#f[ef]f[ef]f[ef]$/i);
  const keyed = applyCutout(source.data, source.width, source.height, {
    backgroundColor: estimateBackgroundColor(source.data, source.width, source.height),
    automaticCutout: true,
    connected: false,
    tolerance: 1,
  });
  let opaqueRed = 0;
  let opaqueWhite = 0;
  for (let offset = 0; offset < keyed.data.length; offset += 4) {
    if (keyed.data[offset + 3] < 16) continue;
    if (keyed.data[offset] > 180 && keyed.data[offset + 1] < 60) opaqueRed += 1;
    if (keyed.data[offset] > 240 && keyed.data[offset + 1] > 240 && keyed.data[offset + 2] > 240) opaqueWhite += 1;
  }
  assert.ok(opaqueRed > 1000, `red body must stay, got ${opaqueRed} opaque red px`);
  assert.equal(opaqueWhite, 0, "white plate must be keyed to alpha 0");
  controller.close();
  assert.equal(await resultPromise, null);
});

test("/tools/cutout session import does not recut already-cut pale hair", async () => {
  const { estimateBackgroundColor } = require("../animation_tuner/public/batch_cutout_background_estimator");
  const { alreadyCutOut } = require("../xsxb_mcp_cutout");
  const source = paleEdgeCutSource();
  assert.equal(alreadyCutOut(source.data, source.width, source.height), true);
  const { controller, state } = createFixture({ estimateBackgroundColor });
  state.items = [];
  state.selectedIds.clear();
  state.sourceKind = "";
  const resultPromise = controller.openWorkset({
    name: "pale",
    mode: "batch",
    autoDetectBackground: true,
    items: [{ name: "pale-edge-cut.png", image: { sourceImageData: source } }],
  });
  const item = state.items[0];
  assert.ok(!item.automaticCutoutActivated, "already-cut frames must not arm a second key");
  assert.notEqual(item.processingParameters.backgroundColor, "#fafafa");
  let hair = 0;
  for (let offset = 0; offset < source.data.length; offset += 4) {
    if (source.data[offset + 3] < 16) continue;
    if (source.data[offset] > 240 && source.data[offset + 1] > 240 && source.data[offset + 2] > 240) hair += 1;
  }
  assert.equal(hair, 16, "pale edge hair must stay opaque");
  controller.close();
  assert.equal(await resultPromise, null);
});
