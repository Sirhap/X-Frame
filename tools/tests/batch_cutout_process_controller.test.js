"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_process_controller");
const imagePixelBudget = require("../animation_tuner/public/image_pixel_budget.js");

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
    cutoutRepairBatch: {
      textContent: "",
      classList: { add() {}, remove() {} },
      setAttribute() {},
    },
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
    imagePixelBudget: {
      totalPixels: () => 0,
      takeUntilBudget: (...args) => imagePixelBudget.takeUntilBudget(...args),
    },
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

test("loadCurrentGroup keeps frames that fit the pixel budget instead of emptying the batch", async () => {
  const images = [
    { width: 10, height: 10 },
    { width: 10, height: 10 },
    { width: 10, height: 10 },
  ];
  const { controller, state, statuses } = createFixture({
    dependencies: {
      host: {
        getCurrentAnimation: () => ({
          name: "run",
          frames: images.map((_, index) => ({ name: `f${index}.png` })),
          images,
        }),
      },
      imagePixelBudget: {
        takeUntilBudget: (sources) => ({
          kept: sources.slice(0, 2).map((source, index) => ({ source, index })),
          skipped: Math.max(0, sources.length - 2),
          reason: "total",
          limit: 200,
        }),
      },
    },
  });

  await controller.loadCurrentGroup();

  assert.equal(state.items.length, 2);
  assert.deepEqual(
    state.items.map((item) => item.name),
    ["f0.png", "f1.png"],
  );
  assert.equal(statuses.at(-1), "groupLoadedPartial");
});

test("applyCurrentGroup refuses a prefix-loaded batch instead of writing a short animation", async () => {
  const images = [
    { width: 10, height: 10 },
    { width: 10, height: 10 },
    { width: 10, height: 10 },
  ];
  const { controller, statuses, state } = createFixture({
    dependencies: {
      host: {
        getCurrentAnimation: () => ({
          name: "run",
          frames: images.map((_, index) => ({ name: `f${index}.png` })),
          images,
        }),
        applyOutputs: async () => {
          throw new Error("apply must not run on a prefix load");
        },
      },
      imagePixelBudget: {
        takeUntilBudget: (sources) => ({
          kept: sources.slice(0, 2).map((source, index) => ({ source, index })),
          skipped: 1,
          reason: "total",
          limit: 200,
        }),
      },
    },
  });

  await controller.loadCurrentGroup();
  await controller.applyCurrentGroup();

  assert.equal(state.items.length, 2);
  assert.equal(statuses.at(-1), "applyMismatch");
});

test("partial group-load copy does not promise a second apply batch", () => {
  const { TEXT } = require("../animation_tuner/public/batch_cutout_text.js");
  assert.doesNotMatch(TEXT.zh.groupLoadedPartial, /再载入/);
  assert.doesNotMatch(TEXT.en.groupLoadedPartial, /load again/i);
  assert.match(TEXT.zh.groupLoadedPartial, /回写|全部/);
});

test("loadCurrentGroup still fails closed when no frame fits the budget", async () => {
  const { controller, state, statuses } = createFixture({
    dependencies: {
      host: {
        getCurrentAnimation: () => ({
          name: "huge",
          frames: [{ name: "big.png" }],
          images: [{ width: 10, height: 10 }],
        }),
      },
      imagePixelBudget: {
        takeUntilBudget: () => ({ kept: [], skipped: 1, reason: "total", limit: 64 }),
      },
      assertImagePixelBudget: () => {
        throw new Error("batchPixelLimit:64");
      },
    },
  });

  await controller.loadCurrentGroup();

  assert.equal(state.items.length, 0);
  assert.equal(statuses.at(-1), "failed");
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

test("process controller reuses transferred result pixels for canvas painting", async () => {
  const resultPixels = new Uint8ClampedArray([9, 8, 7, 255]);
  let paintedImageData = null;
  const { controller, state } = createFixture({
    dependencies: {
      cutoutExecutor: {
        async process() {
          return {
            automaticData: new Uint8ClampedArray(resultPixels),
            data: resultPixels,
            shapeCandidates: [],
            shapeDescriptor: null,
            qualityMetrics: {},
            removedPixels: 0,
            partialPixels: 0,
          };
        },
      },
      documentRef: {
        createElement: () => ({
          getContext: () => ({
            putImageData(imageData) {
              paintedImageData = imageData;
            },
          }),
        }),
      },
    },
  });
  const item = {
    id: "frame-buffer",
    sourceImageData: { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) },
    repairs: [],
    processingRevision: 0,
    thumbnailRevision: -1,
    status: "ready",
  };
  state.items = [item];

  await controller.processItem(item);

  assert.equal(item.resultImageData.data, resultPixels);
  assert.equal(paintedImageData, item.resultImageData);
});

test("lightweight processing requests pixels only and skips editor analysis refresh", async () => {
  const requestContexts = [];
  let qualityRefreshes = 0;
  const { controller, state } = createFixture({
    dependencies: {
      cutoutExecutor: {
        async process(_data, _width, _height, _options, _repairs, requestContext) {
          requestContexts.push(requestContext);
          return {
            automaticData: new Uint8ClampedArray([1, 2, 3, 255]),
            data: new Uint8ClampedArray([1, 2, 3, 255]),
            shapeCandidates: null,
            shapeDescriptor: null,
            qualityMetrics: null,
            removedPixels: 0,
            partialPixels: 0,
          };
        },
      },
      refreshQualityAnalysis() {
        qualityRefreshes += 1;
      },
    },
  });
  const item = {
    id: "frame-lightweight",
    sourceImageData: { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) },
    repairs: [],
    processingRevision: 0,
    thumbnailRevision: -1,
    status: "ready",
  };
  state.items = [item];

  await controller.processItem(item, { lightweight: true, preview: false });

  assert.deepEqual(requestContexts, [{ analysisMode: "pixels-only" }]);
  assert.equal(qualityRefreshes, 0);
  assert.equal(item.resultVariant, "committed:pixels-only");
});

test("processItem turns exhausted engine retries into an actionable message", async () => {
  const { controller, state } = createFixture({
    dependencies: {
      text: (key) =>
        ({
          engineExecutionFailed: "engine restarted once; source preserved",
        })[key] || key,
      cutoutExecutor: {
        async process() {
          const error = new Error("ENGINE_EXECUTION_FAILED");
          error.code = "ENGINE_EXECUTION_FAILED";
          throw error;
        },
      },
    },
  });
  const item = {
    id: "frame-engine-error",
    sourceImageData: { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) },
    repairs: [],
    processingRevision: 0,
    thumbnailRevision: -1,
    status: "ready",
  };
  state.items = [item];

  await assert.rejects(controller.processItem(item), /engine restarted once; source preserved/);
  assert.equal(item.error, "engine restarted once; source preserved");
});

test("processAll publishes live outputs after each successful frame", async () => {
  const liveApplies = [];
  const { controller } = createFixture({
    state: {
      worksetResolver: {
        liveApply: async (outputs) => {
          liveApplies.push(outputs.length);
        },
      },
      items: [
        {
          id: "a",
          name: "a.png",
          frame: { uid: "a" },
          excluded: false,
          resultCanvas: { id: "ca" },
          statistics: {},
        },
        {
          id: "b",
          name: "b.png",
          frame: { uid: "b" },
          excluded: false,
          resultCanvas: { id: "cb" },
          statistics: {},
        },
      ],
    },
    dependencies: {
      resultArtifacts: {
        get: () => "data:image/png;base64,x",
        put() {},
      },
      outputCore: {
        uniquePngName: (name) => name,
        createOutput: (output) => output,
      },
      windowRef: {
        setTimeout(callback) {
          callback();
          return 1;
        },
      },
    },
  });

  await controller.processAll({ applyProgress: true });

  assert.deepEqual(liveApplies, [1, 2]);
});

test("processAll keeps live apply on canvases instead of encoding every frame as PNG", async () => {
  let encoded = 0;
  const liveApplies = [];
  const { controller } = createFixture({
    state: {
      worksetResolver: {
        liveApply: async (outputs) => {
          liveApplies.push(outputs.map((output) => output.data));
        },
      },
      items: [
        {
          id: "a",
          name: "a.png",
          frame: { uid: "a" },
          excluded: false,
          status: "processed",
          thumbnailRevision: 0,
          resultVariant: "committed",
          resultCanvas: {
            toDataURL() {
              encoded += 1;
              return "data:image/png;base64,full";
            },
          },
          statistics: {},
        },
      ],
    },
    dependencies: {
      resultArtifacts: {
        get: () => "",
        put() {},
      },
      outputCore: {
        uniquePngName: (name) => name,
        createOutput: (output) => output,
      },
      windowRef: {
        setTimeout(callback) {
          callback();
          return 1;
        },
      },
    },
  });

  await controller.processAll({ applyProgress: true });

  assert.equal(encoded, 0);
  assert.deepEqual(liveApplies, [[""]]);
});

test("cutout results can be handed to a project while retaining frame mapping", async () => {
  const sourceFrame = { name: "idle.png" };
  let projectRequest = null;
  const { controller, state } = createFixture({
    state: { thumbnailRevision: 2, sourceKind: "group" },
    dependencies: {
      resultArtifacts: {
        get: () => "data:image/png;base64,result",
        put() {},
      },
      outputCore: {
        uniquePngName: (name) => name,
        createOutput: (output) => output,
      },
      premiumFeatures: { detectCutoutFeatures: () => [], normalizeFeatureIds: (values) => values },
      ensurePremiumActivated: async () => true,
      host: {
        getCurrentAnimation: () => ({
          name: "idle",
          profileLabel: "Hero",
          frames: [sourceFrame],
        }),
        addToProject: async (request) => {
          projectRequest = request;
        },
      },
    },
  });
  state.items = [
    {
      id: "frame-1",
      name: "idle.png",
      frame: sourceFrame,
      excluded: false,
      processingRevision: 0,
    },
  ];

  await controller.addToProject();

  assert.equal(projectRequest.sourceTool, "cutout");
  assert.equal(projectRequest.worksets[0].profileLabel, "Hero");
  assert.deepEqual(projectRequest.worksets[0].items, [
    {
      sourceIndex: 0,
      name: "idle.png",
      data: "data:image/png;base64,result",
      flipped: false,
    },
  ]);
});

/**
 * Builds a 64×64 RGBA buffer with a 4px white chrome around a chroma-green field.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}}
 */
function chromeGreenSource() {
  const width = 64;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set([255, 255, 255, 255], offset);
  for (let y = 4; y < height - 4; y += 1) {
    for (let x = 4; x < width - 4; x += 1) {
      data.set([0, 177, 64, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

/**
 * Builds a 64×64 white plate with a large red subject.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}}
 */
function largeRedOnWhiteSource() {
  const width = 64;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set([255, 255, 255, 255], offset);
  for (let y = 8; y < height - 8; y += 1) {
    for (let x = 8; x < width - 8; x += 1) {
      data.set([210, 36, 42, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

/**
 * Counts opaque chroma-green pixels remaining in a buffer.
 * @param {Uint8ClampedArray} rgba Pixels.
 * @returns {number} Count.
 */
function countOpaqueGreen(rgba) {
  let count = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] < 16) continue;
    if (rgba[offset] < 40 && rgba[offset + 1] > 150 && rgba[offset + 2] < 90) count += 1;
  }
  return count;
}

test("/tools/cutout file import auto-detects chroma behind white chrome and arms cutout", async () => {
  const { estimateBackgroundColor } = require("../animation_tuner/public/batch_cutout_background_estimator");
  const { applyCutout } = require("../animation_tuner/public/batch_cutout_core");
  const { resolveAutomaticSettingsHintKey } = require("../animation_tuner/public/batch_cutout_settings");
  const source = chromeGreenSource();
  const applied = [];
  const { controller, state } = createFixture({
    dependencies: {
      estimateBackgroundColor,
      applyProcessingParametersToControls: (parameters) => applied.push(parameters),
      createItem: (image, name) => ({
        id: name,
        name,
        sourceImageData: image.sourceImageData,
        processingParameters: { backgroundColor: "#ffffff" },
        backgroundSamples: [],
        automaticCutoutActivated: false,
        processingActivated: false,
      }),
      loadFileImage: async (file) => file,
    },
  });

  await controller.loadFiles([
    {
      name: "green-behind-white-chrome.png",
      type: "image/png",
      size: 100,
      sourceImageData: source,
    },
  ]);

  const item = state.items[0];
  assert.equal(item.processingParameters.backgroundColor, "#00b140");
  assert.equal(item.automaticCutoutActivated, true);
  assert.ok(item.backgroundSamples.length, "auto-detect must record a background sample");
  assert.equal(applied.at(-1)?.backgroundColor, "#00b140");
  assert.notEqual(
    resolveAutomaticSettingsHintKey({
      itemAvailable: true,
      automatic: true,
      hasBackgroundSample: Boolean(item.backgroundSamples.length),
    }),
    "needsBackgroundSampleHint",
  );

  const estimated = estimateBackgroundColor(source.data, source.width, source.height);
  assert.equal(item.processingParameters.backgroundColor, estimated.hex);
  const keyed = applyCutout(source.data, source.width, source.height, {
    backgroundColor: estimated,
    automaticCutout: true,
    connected: false,
    tolerance: 1,
  });
  assert.equal(countOpaqueGreen(source.data), 56 * 56, "source green field stays opaque");
  assert.equal(
    countOpaqueGreen(keyed.data),
    0,
    "automatic cutout with the estimated chroma must key the green field",
  );
});

test("/tools/cutout file import still keys white under a large subject", async () => {
  const { estimateBackgroundColor } = require("../animation_tuner/public/batch_cutout_background_estimator");
  const source = largeRedOnWhiteSource();
  const { controller, state } = createFixture({
    dependencies: {
      estimateBackgroundColor,
      createItem: (image, name) => ({
        id: name,
        name,
        sourceImageData: image.sourceImageData,
        processingParameters: { backgroundColor: "#000000" },
        backgroundSamples: [],
        automaticCutoutActivated: false,
        processingActivated: false,
      }),
      loadFileImage: async (file) => file,
    },
  });

  await controller.loadFiles([
    {
      name: "large-red-on-white.png",
      type: "image/png",
      size: 100,
      sourceImageData: source,
    },
  ]);

  assert.equal(state.items[0].processingParameters.backgroundColor, "#ffffff");
});

test("/tools/cutout file import keys the white plate not the red body", async () => {
  const { estimateBackgroundColor } = require("../animation_tuner/public/batch_cutout_background_estimator");
  const { applyCutout } = require("../animation_tuner/public/batch_cutout_core");
  const width = 256;
  const height = 256;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) data.set([0, 0, 0, 0], offset);
      else if (x <= 2 || y <= 2 || x >= width - 3 || y >= height - 3) data.set([255, 255, 255, 255], offset);
      else data.set([210, 36, 42, 255], offset);
    }
  }
  const source = { data, width, height };
  const { controller, state } = createFixture({
    dependencies: {
      estimateBackgroundColor,
      createItem: (image, name) => ({
        id: name,
        name,
        sourceImageData: image.sourceImageData,
        processingParameters: { backgroundColor: "#000000" },
        backgroundSamples: [],
        automaticCutoutActivated: false,
        processingActivated: false,
      }),
      loadFileImage: async (file) => file,
    },
  });
  await controller.loadFiles([
    { name: "large-gutter-plate.png", type: "image/png", size: 100, sourceImageData: source },
  ]);
  const hex = state.items[0].processingParameters.backgroundColor;
  assert.notEqual(hex, "#d2242a");
  assert.match(hex, /^#f[ef]f[ef]f[ef]$/i);
  const keyed = applyCutout(source.data, source.width, source.height, {
    backgroundColor: estimateBackgroundColor(source.data, source.width, source.height),
    automaticCutout: true,
    connected: false,
    tolerance: 1,
  });
  let opaqueWhite = 0;
  for (let offset = 0; offset < keyed.data.length; offset += 4) {
    if (keyed.data[offset + 3] < 16) continue;
    if (keyed.data[offset] > 240 && keyed.data[offset + 1] > 240 && keyed.data[offset + 2] > 240) opaqueWhite += 1;
  }
  assert.equal(opaqueWhite, 0);
});

test("/tools/cutout file import does not recut already-cut pale hair", async () => {
  const { estimateBackgroundColor } = require("../animation_tuner/public/batch_cutout_background_estimator");
  const { alreadyCutOut } = require("../animation_tuner/public/batch_cutout_background_estimator");
  const width = 32;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 4; y < height - 4; y += 1) {
    for (let x = 4; x < width - 4; x += 1) data.set([210, 36, 42, 255], (y * width + x) * 4);
  }
  for (let i = 0; i < 16; i += 1) data.set([250, 250, 250, 255], (8 + i) * 4);
  const source = { data, width, height };
  assert.equal(alreadyCutOut(data, width, height), true);
  const { controller, state } = createFixture({
    dependencies: {
      estimateBackgroundColor,
      createItem: (image, name) => ({
        id: name,
        name,
        sourceImageData: image.sourceImageData,
        processingParameters: { backgroundColor: "#ffffff" },
        backgroundSamples: [],
        automaticCutoutActivated: false,
        processingActivated: false,
      }),
      loadFileImage: async (file) => file,
    },
  });
  await controller.loadFiles([
    { name: "pale-edge-cut.png", type: "image/png", size: 100, sourceImageData: source },
  ]);
  assert.equal(state.items[0].automaticCutoutActivated, false);
  assert.notEqual(state.items[0].processingParameters.backgroundColor, "#fafafa");
  let hair = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] < 16) continue;
    if (data[offset] > 240 && data[offset + 1] > 240 && data[offset + 2] > 240) hair += 1;
  }
  assert.equal(hair, 16);
});
