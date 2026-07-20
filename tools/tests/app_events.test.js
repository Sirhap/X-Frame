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
    "languageSelect",
    "playPause",
    "profileSelect",
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
    "updateButton",
  ];
  const elements = Object.fromEntries(names.map((name) => [name, createElement()]));
  elements.languageButtons = [];
  elements.themeButtons = [];
  elements.boxChoiceInputs = [];
  return elements;
}

test("event controller binds the original listener groups once", () => {
  const elements = createElements();
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
  const storage = new Map();
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
});
