"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ORGANIZER_SIMILARITY_THRESHOLD } = require("../animation_tuner/public/frame_organizer_core");
const {
  applyReduceIncludedFlags,
  bindSimilarityThreshold,
  canReuseLoadedAnimation,
  confirmReduceIncludedFlags,
  cycleTabFocus,
  hasUnsavedWorksetChanges,
  listFocusableElements,
  persistIncludedFlags,
  restoreIncludedFlags,
  worksetChangeSignature,
} = require("../animation_tuner/public/frame_organizer_ui");
const { createTranslator } = require("../animation_tuner/public/frame_organizer_text");

test("bindSimilarityThreshold writes the exported organizer range onto the slider", () => {
  const input = { min: "0", max: "10", value: "1" };
  const output = { textContent: "" };
  bindSimilarityThreshold({ organizerThreshold: input, organizerThresholdValue: output });
  assert.equal(input.min, String(ORGANIZER_SIMILARITY_THRESHOLD.min));
  assert.equal(input.max, String(ORGANIZER_SIMILARITY_THRESHOLD.max));
  assert.equal(input.value, String(ORGANIZER_SIMILARITY_THRESHOLD.fallback));
  assert.equal(output.textContent, String(ORGANIZER_SIMILARITY_THRESHOLD.fallback));
});

/**
 * Builds an included workset for reduce-flag tests.
 * @param {number} count Frame count.
 * @returns {{uid:string,included:boolean}[]}
 */
function includedFrames(count) {
  return Array.from({ length: count }, (_, index) => ({ uid: `f${index}`, included: true }));
}

test("applyReduceIncludedFlags keeps 1 of every N included frames", () => {
  const frames = includedFrames(5);
  applyReduceIncludedFlags(frames, 2);
  assert.deepEqual(
    frames.map((frame) => frame.included),
    [true, false, true, false, true],
  );
});

test("ORG-035 canceling reduce confirmation leaves included flags unchanged", async () => {
  const frames = includedFrames(4);
  const prompts = [];
  const accepted = await confirmReduceIncludedFlags({
    frames,
    step: 2,
    requestConfirmation: async (message, details, options) => {
      prompts.push({ message, details, options });
      return false;
    },
    text: createTranslator(() => "zh"),
  });
  assert.equal(accepted, false);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].message, /每 2 帧保留 1 帧/);
  assert.deepEqual(
    frames.map((frame) => frame.included),
    [true, true, true, true],
  );
});

test("adding a workset to a project accepts the current organizer session as saved", () => {
  const original = {};
  const edited = {};
  const frames = [
    {
      uid: "idle-3",
      assetRevision: 1,
      included: true,
      flipped: false,
      imported: false,
      tag: "",
      originalCanvas: original,
      editedCanvas: edited,
    },
  ];
  const state = {
    mode: "edit",
    videoExtracting: false,
    frames,
    baselineFrameIds: ["idle-3"],
    acceptedWorksetSignature: "",
  };
  assert.equal(hasUnsavedWorksetChanges(state), true);
  state.acceptedWorksetSignature = worksetChangeSignature(frames);
  assert.equal(hasUnsavedWorksetChanges(state), false);
  frames[0].assetRevision = 2;
  assert.equal(hasUnsavedWorksetChanges(state), true);
});

test("ENV-004 reopening the same animation keeps unchecked frames instead of reloading", () => {
  const state = {
    mode: "edit",
    animationName: "idle",
    frames: [
      { uid: "idle-1", included: true },
      { uid: "idle-2", included: false },
    ],
  };
  const animation = {
    name: "idle",
    frames: [{ id: "idle-1" }, { id: "idle-2" }],
  };
  assert.equal(canReuseLoadedAnimation(state, animation), true);
  assert.equal(canReuseLoadedAnimation({ ...state, mode: "import" }, animation), false);
  assert.equal(canReuseLoadedAnimation(state, { name: "run", frames: animation.frames }), false);
  assert.equal(
    canReuseLoadedAnimation(state, { name: "idle", frames: [{ id: "idle-1" }] }),
    false,
  );
});

test("ENV-004 included flags persist across organizer sessions of the same animation", () => {
  const storage = new Map();
  const store = {
    setItem(key, value) {
      storage.set(key, String(value));
    },
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
  };
  persistIncludedFlags(
    [
      { uid: "idle-1", included: true },
      { uid: "idle-2", included: false },
    ],
    "pets",
    "idle",
    store,
  );
  const frames = [
    { uid: "idle-1", included: true },
    { uid: "idle-2", included: true },
  ];
  assert.equal(restoreIncludedFlags(frames, "pets", "idle", store), true);
  assert.deepEqual(
    frames.map((frame) => frame.included),
    [true, false],
  );
});

test("ENV-008 confirm buttons stay in the Tab cycle when getClientRects is empty", () => {
  const cancel = {
    hidden: false,
    disabled: false,
    offsetParent: null,
    getClientRects: () => [],
  };
  const accept = {
    hidden: false,
    disabled: false,
    offsetParent: null,
    getClientRects: () => [],
  };
  const container = {
    querySelectorAll() {
      return [cancel, accept];
    },
  };
  assert.deepEqual(listFocusableElements(container), [cancel, accept]);
  assert.deepEqual(listFocusableElements(container, [cancel, accept]), [cancel, accept]);
});

test("ENV-008 Tab cycles inside a confirm dialog even when offsetParent is null", () => {
  const documentRef = { activeElement: null };
  const cancel = {
    hidden: false,
    disabled: false,
    offsetParent: null,
    focus() {
      documentRef.activeElement = this;
    },
  };
  const accept = {
    hidden: false,
    disabled: false,
    offsetParent: null,
    focus() {
      documentRef.activeElement = this;
    },
  };
  const container = {
    querySelectorAll() {
      return [cancel, accept];
    },
  };
  documentRef.activeElement = cancel;

  assert.deepEqual(listFocusableElements(container), [cancel, accept]);
  let prevented = false;
  cycleTabFocus(
    {
      key: "Tab",
      shiftKey: false,
      preventDefault() {
        prevented = true;
      },
    },
    container,
    documentRef,
  );
  assert.equal(prevented, true);
  assert.equal(documentRef.activeElement, accept);

  prevented = false;
  cycleTabFocus(
    {
      key: "Tab",
      shiftKey: false,
      preventDefault() {
        prevented = true;
      },
    },
    container,
    documentRef,
  );
  assert.equal(prevented, true);
  assert.equal(documentRef.activeElement, cancel);

  prevented = false;
  cycleTabFocus(
    {
      key: "Tab",
      shiftKey: true,
      preventDefault() {
        prevented = true;
      },
    },
    container,
    documentRef,
  );
  assert.equal(prevented, true);
  assert.equal(documentRef.activeElement, accept);
});

test("ORG-035 accepting reduce confirmation applies keep-1-of-N flags", async () => {
  const frames = includedFrames(4);
  const accepted = await confirmReduceIncludedFlags({
    frames,
    step: 2,
    requestConfirmation: async () => true,
    text: createTranslator(() => "zh"),
  });
  assert.equal(accepted, true);
  assert.deepEqual(
    frames.map((frame) => frame.included),
    [true, false, true, false],
  );
});
