"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_process_controller");

/**
 * Creates a process-controller fixture that exercises coordination guards without a browser canvas.
 * @returns {{controller:object,statuses:string[],state:object}}
 */
function createFixture() {
  const statuses = [];
  const state = {
    items: [],
    thumbnailJob: 0,
    thumbnailRevision: 0,
    selectedIndex: 0,
    busy: false,
    cancelRequested: false,
    sourceKind: "",
  };
  const elements = {
    cutoutFileInput: { value: "" },
    cutoutRepairBatch: { textContent: "" },
  };
  const controller = createController({
    state,
    elements,
    text: (key) => key,
    setStatus: (message) => statuses.push(message),
    renderStatus() {},
    renderSessionMode() {},
    renderQueue() {},
    renderPreview() {},
    scheduleBatchThumbnails() {},
    stopBatchPlayback() {},
    mapSettledWithConcurrency: async (items) => items.map((value) => ({ status: "fulfilled", value })),
    loadFileImage: async (file) => file,
    imagePixelBudget: { totalPixels: () => 0 },
    assertImagePixelBudget: () => ({ totalPixels: 0 }),
    createItem: (image, name) => ({ image, name }),
    processingOptions: () => ({}),
    repairReplayCore: {},
    core: {},
    cutoutExecutor: {},
    tracking: {},
    quality: {},
    createThumbnailUrl: () => "",
    refreshQualityAnalysis() {},
    resultArtifacts: {},
    outputCore: {},
    batchZip: {},
    updateQueueCard() {},
    selectedItem: () => null,
    requestConfirmation: async () => false,
    close() {},
    host: {},
  });
  return { controller, statuses, state };
}

test("process controller rejects invalid dependencies", () => {
  assert.throws(() => createController(), /dependencies are required/);
});

test("process controller reports an unsupported file selection", async () => {
  const { controller, statuses } = createFixture();

  await controller.loadFiles([{ name: "notes.txt", type: "text/plain", size: 1 }]);

  assert.ok(statuses.includes("invalidFiles"));
});

test("process controller reports an unavailable animation group", async () => {
  const { controller, statuses } = createFixture();

  await controller.loadCurrentGroup();

  assert.ok(statuses.includes("groupUnavailable"));
});

test("process controller returns an empty process result for an empty queue", async () => {
  const { controller } = createFixture();

  const result = await controller.processAll();

  assert.deepEqual(result, { outputs: [], failures: [], excluded: 0, cancelled: false });
});

test("process controller reuses an already current processed item", async () => {
  const { controller, state } = createFixture();
  const item = { status: "processed", thumbnailRevision: 3, resultCanvas: {} };
  state.thumbnailRevision = 3;

  assert.equal(await controller.processItem(item), item);
});
