const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_events");

function createElement() {
  const listeners = new Map();
  return {
    value: "",
    checked: false,
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
    setPointerCapture() {},
    focus() {},
  };
}

function createElements() {
  const names = [
    "adjustCharacter",
    "adjustFrame",
    "adjustGroup",
    "applyBaseToFrame",
    "baseScale",
    "baseScaleX",
    "baseScaleY",
    "baseX",
    "baseY",
    "boxEnabled",
    "boxH",
    "boxRotation",
    "boxW",
    "boxX",
    "boxY",
    "canvasColor",
    "chainGroupSelect",
    "clearFrame",
    "clearGroup",
    "clearProject",
    "deleteProject",
    "frameDisabled",
    "frameDuration",
    "frameReference",
    "frameRotation",
    "frameScale",
    "frameScaleX",
    "frameScaleY",
    "frameX",
    "frameY",
    "ghostToggle",
    "groupSearch",
    "groupSelect",
    "importAnimationOpen",
    "playPause",
    "projectSelect",
    "refreshProject",
    "save",
    "sceneScale",
    "sceneSelect",
    "showBoxes",
    "stage",
    "stageZoom",
    "stageZoomActual",
    "stageZoomFit",
    "stageZoomIn",
    "stageZoomOut",
    "undo",
    "undoTop",
    "redoTop",
  ];
  const elements = Object.fromEntries(names.map((name) => [name, createElement()]));
  elements.languageButtons = [];
  elements.themeButtons = [];
  elements.boxChoiceInputs = [];
  return elements;
}

test("event controller binds the original listener groups once", () => {
  const elements = createElements();
  const englishButton = createElement();
  englishButton.dataset.language = "en";
  elements.languageButtons = [englishButton];
  const state = {
    config: { groups: [] },
    currentGroup: null,
    selectedFrames: new Set([0]),
    selectedBoxes: new Set(),
    inputEditSnapshots: new Map(),
    undoStack: [],
    redoStack: [],
    heldAttachmentTransformKeys: new Set(),
    frameImageAttachments: [],
    view: { x: 0, y: 0, zoom: 1 },
  };
  let keyboardBindCount = 0;
  const languagePreferences = [];
  const handlers = new Proxy(
    {
      adjustmentNumberInputs: () => [],
      keyboardController: { bind: () => (keyboardBindCount += 1) },
      renderGroupSelect: () => [],
      selectedFrameAttachment: () => null,
    },
    {
      get(target, key) {
        return key in target ? target[key] : () => {};
      },
    },
  );
  const storage = {
    getItem: () => null,
    setItem: (key, value) => languagePreferences.push([key, value]),
  };
  const controller = createController({
    elements,
    state,
    constants: { ADJUSTMENT_MODE_KEY: "adjustment-mode" },
    documentRef: { querySelectorAll: () => [] },
    windowRef: { confirm: () => true },
    storage,
    handlers,
  });

  const cleanup = controller.bind();
  assert.equal(typeof cleanup, "function");
  controller.bind();
  assert.equal(elements.projectSelect.listenerCount("change"), 1);
  assert.equal(elements.stage.listenerCount("pointerdown"), 1);
  assert.equal(keyboardBindCount, 1);
  englishButton.dispatch("click");
  assert.equal(state.language, "en");
  assert.deepEqual(languagePreferences, [
    ["xsxbFrameTuner.language", "en"],
    ["xsxbFrameTuner.languageExplicit", "true"],
  ]);
});

test("SAV-004 adjustment number fields bind a non-passive wheel guard", () => {
  const elements = createElements();
  const wheelOptions = [];
  const originalAdd = elements.baseX.addEventListener.bind(elements.baseX);
  elements.baseX.addEventListener = (type, listener, options) => {
    if (type === "wheel") wheelOptions.push(options);
    return originalAdd(type, listener, options);
  };
  const state = {
    config: { groups: [] },
    currentGroup: null,
    selectedFrames: new Set([0]),
    selectedBoxes: new Set(),
    inputEditSnapshots: new Map(),
    undoStack: [],
    redoStack: [],
    heldAttachmentTransformKeys: new Set(),
    frameImageAttachments: [],
    view: { x: 0, y: 0, zoom: 1 },
  };
  let guarded = 0;
  const handlers = new Proxy(
    {
      adjustmentNumberInputs: () => [elements.baseX],
      keyboardController: { bind: () => {} },
      renderGroupSelect: () => [],
      selectedFrameAttachment: () => null,
      guardAdjustmentNumberWheel: () => {
        guarded += 1;
        return false;
      },
    },
    {
      get(target, key) {
        return key in target ? target[key] : () => {};
      },
    },
  );
  const controller = createController({
    elements,
    state,
    constants: { ADJUSTMENT_MODE_KEY: "adjustment-mode" },
    documentRef: { querySelectorAll: () => [] },
    storage: { getItem: () => null, setItem() {} },
    handlers,
  });
  controller.bind();

  assert.equal(elements.baseX.listenerCount("wheel"), 1);
  assert.deepEqual(wheelOptions, [{ passive: false }]);
  elements.baseX.dispatch("wheel", { deltaY: 120 });
  assert.equal(guarded, 1);
});

test("event controller restores group transforms and frame overrides without deleting unrelated groups", () => {
  const elements = createElements();
  const group = {
    name: "run",
    scale: "run.scale",
    scaleVector: "run.scaleVector",
    offset: "run.offset",
    rotation: "run.rotation",
  };
  const values = {
    "run.scale": 2,
    "run.scaleVector": { x: 2, y: 2 },
    "run.offset": { x: 4, y: 5 },
    "run.rotation": 10,
    "idle.scale": 3,
  };
  const visualOverrides = { "run:0": { visual_size: 2 }, "idle:0": { visual_size: 3 } };
  const playbackOverrides = { "run:0": { duration_ms: 90 }, "idle:0": { duration_ms: 120 } };
  const state = {
    currentGroup: group,
    selectedFrames: new Set([0]),
    selectedBoxes: new Set(),
    inputEditSnapshots: new Map(),
    heldAttachmentTransformKeys: new Set(),
    view: { x: 0, y: 0, zoom: 1 },
  };
  let undoCount = 0;
  let dirtyCount = 0;
  const handlers = new Proxy(
    {
      adjustmentNumberInputs: () => [],
      canEditFrameTransform: () => true,
      canEditFramePlayback: () => true,
      groupOwnsFrameKey: (_group, key) => key.startsWith("run:"),
      keyboardController: { bind: () => {} },
      overrideStore: () => visualOverrides,
      playbackStore: () => playbackOverrides,
      pushUndo: () => {
        undoCount += 1;
      },
      markDirty: () => {
        dirtyCount += 1;
      },
      renderGroupSelect: () => [],
      selectedFrameAttachment: () => null,
      status: () => {},
      t: (key) => key,
      valueStore: () => values,
    },
    {
      get(target, key) {
        return key in target ? target[key] : () => {};
      },
    },
  );
  const controller = createController({
    elements,
    state,
    handlers,
    documentRef: { querySelectorAll: () => [] },
    storage: { getItem: () => null, setItem() {} },
  });
  controller.bind();

  elements.clearGroup.dispatch("click");

  assert.equal(undoCount, 1);
  assert.equal(dirtyCount, 1);
  assert.deepEqual(values, { "idle.scale": 3 });
  assert.deepEqual(visualOverrides, { "idle:0": { visual_size: 3 } });
  assert.deepEqual(playbackOverrides, { "idle:0": { duration_ms: 120 } });
});
