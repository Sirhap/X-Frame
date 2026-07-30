const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_frame_selection");

function createFixture() {
  const group = { frames: [{}, {}, {}] };
  let selectedFrame = 0;
  let selectedFrames = new Set();
  let selectionAnchorFrame = 0;
  const controller = createController({
    getCurrentGroup: () => group,
    getSelectedFrame: () => selectedFrame,
    setSelectedFrame: (value) => {
      selectedFrame = value;
    },
    getSelectedFrames: () => selectedFrames,
    setSelectedFrames: (value) => {
      selectedFrames = value;
    },
    getSelectionAnchorFrame: () => selectionAnchorFrame,
    setSelectionAnchorFrame: (value) => {
      selectionAnchorFrame = value;
    },
  });
  return { controller, getState: () => ({ selectedFrame, selectedFrames, selectionAnchorFrame }) };
}

test("frame selection clamps indexes and keeps one primary frame", () => {
  const { controller, getState } = createFixture();
  controller.setSingleFrameSelection(99);
  assert.deepEqual(getState(), {
    selectedFrame: 2,
    selectedFrames: new Set([2]),
    selectionAnchorFrame: 2,
  });
  assert.equal(controller.clampFrameIndex(-4), 0);
});

test("frame selection normalizes multi-selection and sorts indexes", () => {
  const { controller, getState } = createFixture();
  controller.setFrameSelection([2, 1, 1, -2, 99], 1);
  assert.deepEqual(controller.selectedFrameIndexes(), [0, 1, 2]);
  assert.equal(controller.selectedFrameCount(), 3);
  assert.equal(getState().selectionAnchorFrame, 0);
});

test("frame selection repairs an empty selection on read", () => {
  const { controller, getState } = createFixture();
  assert.deepEqual(controller.selectedFrameIndexes(), [0]);
  assert.deepEqual(getState().selectedFrames, new Set([0]));
});
