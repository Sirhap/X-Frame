"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ORGANIZER_SIMILARITY_THRESHOLD } = require("../animation_tuner/public/frame_organizer_core");
const {
  applyReduceIncludedFlags,
  bindSimilarityThreshold,
  confirmReduceIncludedFlags,
  cycleTabFocus,
  listFocusableElements,
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
