"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_queue");

/**
 * Creates a queue controller fixture for selection behavior.
 * @param {object} state Mutable queue state.
 * @returns {ReturnType<typeof createController>}
 */
function createFixture(state) {
  return createController({
    state,
    elements: { cutoutQueue: {} },
    text: (key) => key,
    hasQualityIssue: (item) => item.issue,
    qualityLabel: () => "",
    selectedItem: () => state.items[state.selectedIndex],
    selectBatchIndex() {},
    renderPreview() {},
    renderStatus() {},
    refreshQualityAnalysis() {},
    stopBatchPlayback() {},
    scheduleBatchThumbnails() {},
  });
}

test("quality-only range selection excludes hidden healthy frames", () => {
  const state = {
    items: [
      { id: "issue-a", issue: true },
      { id: "healthy", issue: false },
      { id: "issue-b", issue: true },
    ],
    qualityOnly: true,
    selectedIds: new Set(["issue-a"]),
    selectionAnchorIndex: 0,
  };
  const controller = createFixture(state);

  controller.updateBatchSelection(2, { shiftKey: true, metaKey: false, ctrlKey: false });

  assert.deepEqual([...state.selectedIds], ["issue-a", "issue-b"]);
});

test("range selection repairs a stale anchor without reading past the queue", () => {
  const state = {
    items: [
      { id: "first", issue: true },
      { id: "second", issue: true },
    ],
    qualityOnly: false,
    selectedIds: new Set(),
    selectionAnchorIndex: 99,
  };
  const controller = createFixture(state);

  assert.doesNotThrow(() =>
    controller.updateBatchSelection(1, { shiftKey: true, metaKey: false, ctrlKey: false }),
  );
  assert.deepEqual([...state.selectedIds], ["second"]);
});
