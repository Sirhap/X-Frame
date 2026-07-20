const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/batch_cutout_navigation");

function createFixture() {
  const queueScrollTarget = { scrollIntoView() {} };
  const state = {
    items: [
      { id: "first", quality: { codes: ["area"] }, thumbnailRevision: 0 },
      { id: "second", quality: null, thumbnailRevision: 0 },
      { id: "third", quality: { codes: ["holes"] }, thumbnailRevision: 0 },
    ],
    selectedIndex: 0,
    sessionMode: "batch",
    qualityOnly: false,
    samplingProtectedColor: true,
    samplingBackgroundColor: true,
    playbackTimer: 0,
    playing: false,
    thumbnailJob: 0,
    thumbnailRevision: 1,
  };
  const calls = {
    status: [],
    renders: 0,
    updates: [],
    processed: [],
  };
  const elements = {
    cutoutQueue: {
      clientWidth: 280,
      scrollLeft: 0,
      querySelector: () => queueScrollTarget,
    },
    cutoutModal: { hidden: false },
  };
  const controller = createController({
    state,
    elements,
    selectedItem: () => state.items[state.selectedIndex] || null,
    hasQualityIssue: (item) => Boolean(item?.quality?.codes?.length),
    applyProcessingParametersToControls: () => {},
    setSettingsMode: () => {},
    renderSessionMode: () => {},
    setStatus: (message, tone) => calls.status.push({ message, tone }),
    text: (key) => key,
    renderQueue: () => {
      calls.renders += 1;
    },
    renderPreview: () => {
      calls.renders += 1;
    },
    renderStatus: () => {
      calls.renders += 1;
    },
    updateQueueCard: (item) => calls.updates.push(item.id),
    processItem: async (item) => {
      calls.processed.push(item.id);
      item.status = "processed";
    },
    windowRef: globalThis,
  });
  return { controller, state, calls };
}

test("navigation selects frames and wraps quality issue navigation", () => {
  const { controller, state, calls } = createFixture();

  controller.selectBatchIndex(1);
  assert.equal(state.selectedIndex, 1);
  assert.equal(state.samplingProtectedColor, false);
  assert.equal(state.samplingBackgroundColor, false);
  assert.equal(calls.renders, 3);

  controller.selectNextQualityIssue();
  assert.equal(state.selectedIndex, 2);
  assert.equal(calls.status.length, 0);
});

test("thumbnail scheduling isolates processed frames and updates their cards", async () => {
  const { controller, state, calls } = createFixture();

  controller.scheduleBatchThumbnails();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(calls.processed, ["second", "third"]);
  assert.deepEqual(calls.updates, ["second", "third"]);
  assert.equal(state.thumbnailJob, 1);
});
