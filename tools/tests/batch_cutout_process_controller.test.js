"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_process_controller");

/**
 * Creates a process-controller fixture that exercises coordination guards without a browser canvas.
 * @returns {{controller:object,processedRepairSets:object[][],statuses:string[],state:object}}
 */
function createFixture(overrides = {}) {
  const statuses = [];
  const processedRepairSets = [];
  const state = {
    items: [],
    thumbnailJob: 0,
    thumbnailRevision: 0,
    selectedIndex: 0,
    busy: false,
    cancelRequested: false,
    sourceKind: "",
    ...overrides.state,
  };
  const elements = {
    cutoutFileInput: { value: "" },
    cutoutRepairBatch: { textContent: "" },
  };
  class TestImageData {
    /** @param {Uint8ClampedArray|Uint8Array} data Pixel bytes. @param {number} width Width. @param {number} height Height. */
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
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
    repairReplayCore: { automaticCacheKey: () => "automatic" },
    cutoutExecutor: {
      async process(data, _width, _height, _options, repairs) {
        processedRepairSets.push(repairs);
        return {
          automaticData: new Uint8ClampedArray(data),
          data: new Uint8ClampedArray(data),
          shapeCandidates: [],
          shapeDescriptor: null,
          qualityMetrics: {},
          removedPixels: 0,
          partialPixels: 0,
        };
      },
    },
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
    documentRef: {
      createElement: () => ({
        getContext: () => ({ putImageData() {} }),
      }),
    },
    imageDataConstructor: TestImageData,
    domExceptionConstructor: DOMException,
    ...overrides.dependencies,
  });
  return { controller, processedRepairSets, statuses, state };
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

test("process controller confirms before replacing an existing batch with the current animation", async () => {
  let confirmation = null;
  const existingItems = [{ id: "existing", repairs: [{ id: "repair" }], editUndo: [] }];
  const { controller, state } = createFixture({
    state: { items: existingItems },
    dependencies: {
      host: { getCurrentAnimation: () => ({ frames: [{ name: "one.png" }], images: [{}] }) },
      requestConfirmation: async (message, details, options) => {
        confirmation = { message, details, options };
        return false;
      },
    },
  });

  await controller.loadCurrentGroup();

  assert.deepEqual(state.items, existingItems);
  assert.deepEqual(confirmation, {
    message: "loadGroupReplaceConfirm",
    details: [],
    options: {
      title: "loadGroupReplaceTitle",
      confirmLabel: "confirmLoadGroup",
      tone: "danger",
    },
  });
});

test("process controller returns an empty process result for an empty queue", async () => {
  const { controller } = createFixture();

  const result = await controller.processAll();

  assert.deepEqual(result, { outputs: [], failures: [], excluded: 0, cancelled: false });
});

test("process controller reuses an already current processed item", async () => {
  const { controller, state } = createFixture();
  const item = {
    status: "processed",
    thumbnailRevision: 3,
    resultVariant: "committed",
    resultCanvas: {},
  };
  state.thumbnailRevision = 3;

  assert.equal(await controller.processItem(item), item);
});

test("process controller previews staged recolor but commits only stored repairs", async () => {
  const previewRepair = { id: "preview", mode: "recolor", previewOnly: true };
  const committedRepair = { id: "committed", mode: "recolor" };
  const { controller, processedRepairSets, state } = createFixture({
    state: { batchPreviewRepair: { repair: previewRepair }, batchPreviewRevision: 4 },
    dependencies: { previewRepairsForItem: () => [previewRepair] },
  });
  const item = {
    id: "frame-2",
    sourceImageData: { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) },
    repairs: [committedRepair],
    processingRevision: 0,
    thumbnailRevision: -1,
    status: "ready",
  };
  state.items = [item];

  await controller.processItem(item);
  assert.deepEqual(processedRepairSets[0], [previewRepair]);
  assert.equal(item.resultVariant, "batch-preview:4");

  await controller.processItem(item, { preview: false });
  assert.deepEqual(processedRepairSets[1], [committedRepair]);
  assert.equal(item.resultVariant, "committed");
});
