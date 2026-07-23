const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_events_input_helpers");

function createElement() {
  const listeners = new Map();
  return {
    value: "",
    dataset: {},
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
  };
}

test("input helpers preserve adjustment, undo, audio, and panel behavior", () => {
  const frameScale = createElement();
  const frameScaleX = createElement();
  const frameScaleY = createElement();
  const baseScale = createElement();
  const baseScaleX = createElement();
  const baseScaleY = createElement();
  const undoInput = createElement();
  const panel = { dataset: { panel: "scene" }, open: false, addEventListener() {} };
  const state = {
    inputEditSnapshots: new Map(),
    undoStack: [],
    redoStack: [{ stale: true }],
    baseEditSnapshot: { stale: true },
    boxEditSnapshot: { stale: true },
  };
  const stored = new Map([["animationTuner.panel.scene", "open"]]);
  let historyUpdates = 0;
  let adjustmentUpdates = 0;
  const helpers = createController({
    elements: { frameScale, frameScaleX, frameScaleY, baseScale, baseScaleX, baseScaleY },
    state,
    constants: { ADJUSTMENT_MODE_KEY: "adjustment-mode" },
    documentRef: { querySelectorAll: () => [panel] },
    storage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    handlers: {
      cloneState: () => ({ snapshot: true }),
      normalizeAdjustmentMode: (mode) => `normalized:${mode}`,
      syncAdjustmentInputs: () => {
        adjustmentUpdates += 1;
      },
      updateHistoryControls: () => {
        historyUpdates += 1;
      },
    },
  });

  frameScale.value = "1.25";
  helpers.syncFrameAxisScaleToUniform();
  assert.equal(frameScaleX.value, "1.25");
  assert.equal(frameScaleY.value, "1.25");
  baseScale.value = "0.8";
  helpers.syncBaseAxisScaleToUniform();
  assert.equal(baseScaleX.value, "0.8");
  assert.equal(baseScaleY.value, "0.8");

  helpers.setAdjustmentMode("group");
  assert.equal(state.adjustmentMode, "normalized:group");
  assert.equal(stored.get("adjustment-mode"), "normalized:group");
  assert.equal(adjustmentUpdates, 1);

  const audio = helpers.audioFileFromList([
    { name: "notes.txt", type: "text/plain" },
    { name: "frame.wav", type: "" },
  ]);
  assert.equal(audio.name, "frame.wav");
  assert.equal(helpers.audioFileFromList([{ name: "notes.txt", type: "text/plain" }]), null);

  helpers.armInputUndo(undoInput, "frame input");
  undoInput.dispatch("focus");
  undoInput.dispatch("input");
  undoInput.dispatch("input");
  assert.equal(state.undoStack.length, 1);
  assert.deepEqual(state.undoStack[0], { label: "frame input", state: { snapshot: true } });
  assert.equal(historyUpdates, 1);
  undoInput.dispatch("blur");

  helpers.initPanelState();
  assert.equal(panel.open, true);
});

test("input helpers keep UI behavior when browser storage is unavailable", () => {
  const panel = createElement();
  panel.dataset.panel = "playback";
  panel.open = false;
  const state = { baseEditSnapshot: {}, boxEditSnapshot: {} };
  let adjustmentUpdates = 0;
  const helpers = createController({
    state,
    constants: { ADJUSTMENT_MODE_KEY: "adjustment-mode" },
    documentRef: { querySelectorAll: () => [panel] },
    storage: {
      getItem() {
        throw new Error("storage denied");
      },
      setItem() {
        throw new Error("storage quota exceeded");
      },
    },
    handlers: {
      normalizeAdjustmentMode: (mode) => mode,
      syncAdjustmentInputs: () => {
        adjustmentUpdates += 1;
      },
    },
  });

  assert.doesNotThrow(() => helpers.setAdjustmentMode("frame"));
  assert.equal(state.adjustmentMode, "frame");
  assert.equal(adjustmentUpdates, 1);
  assert.equal(helpers.readPreference("missing"), null);
  assert.equal(helpers.writePreference("key", "value"), false);
  assert.doesNotThrow(() => helpers.initPanelState());
  assert.doesNotThrow(() => panel.dispatch("toggle"));
});
