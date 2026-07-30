"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_repair_controller");
const colorUtils = require("../animation_tuner/public/batch_cutout_public_color");
const tracking = require("../animation_tuner/public/cutout_tracking_core");
const localTracking = require("../animation_tuner/public/cutout_local_tracking_core");
const { analyzeDevelopmentRepairTracking } = require("../animation_tuner/public/protected_algorithm_runtime");

/**
 * Creates the minimum repair-controller fixture used by focused workflow tests.
 * @param {object} [overrides] Fixture overrides.
 * @returns {{controller:object,state:object,item:object,statuses:string[]}}
 */
function createFixture(overrides = {}) {
  const statuses = [];
  const item = {
    id: "frame-1",
    sourceImageData: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
    resultImageData: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
    automaticImageData: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
    repairs: [],
    undoneRepairs: [],
    shapeCandidates: [],
    shapeDescriptor: { center: { x: 1, y: 1 }, minorLength: 2 },
    processingParameters: {},
    ...overrides.item,
  };
  const state = {
    items: [item],
    selectedIndex: 0,
    protectionPreview: null,
    sessionMode: "batch",
    ...overrides.state,
  };
  const elements = {
    cutoutProtectionType: { value: "range" },
    cutoutProtectionBoundary: { value: "4" },
    cutoutProtectionPadding: { value: "2" },
    cutoutProtectionTolerance: { value: "8" },
    cutoutModal: { dataset: {} },
    cutoutRepairBatch: {
      classList: { remove() {} },
      setAttribute() {},
    },
    ...overrides.elements,
  };
  const core = {
    createProtectedRegionMask: () => ({
      mask: new Uint8Array([1, 1, 0, 0]),
      count: 2,
      bounds: { x1: 0, y1: 0, x2: 1, y2: 0 },
      coverage: 50,
    }),
    selectProtectedColorsInRectangle: () => ({
      colors: [{ r: 10, g: 20, b: 30 }],
      count: 1,
      coverage: 100,
      status: 0,
    }),
    colorDistance: () => 99,
    ...overrides.core,
  };
  const dependencies = {
    state,
    elements,
    colorUtils,
    selectionRepairExecutor: {
      analyze: async (_source, _width, _height, _mask, parameters) =>
        parameters.mode === "protect-range"
          ? core.createProtectedRegionMask()
          : core.selectProtectedColorsInRectangle(),
    },
    createSelectionMask: (_rectangle, width, height) => new Uint8Array(width * height).fill(1),
    text: (key) => key,
    processItem: async () => {},
    selectedItem: () => state.items[state.selectedIndex] || null,
    selectedBackgroundColor: () => ({ r: 0, g: 0, b: 0, a: 255 }),
    selectedBackgroundColors: () => [{ r: 0, g: 0, b: 0, a: 255 }],
    effectiveProtectedColors: () => [],
    createColorProtectionPreview: () => ({
      mask: new Uint8Array([1, 0, 0, 0]),
      count: 1,
      bounds: { x1: 0, y1: 0, x2: 0, y2: 0 },
      coarseArea: 4,
      width: 2,
      height: 2,
    }),
    recordItemEdit: () => {},
    invalidateItem: () => {},
    setStatus: (message) => statuses.push(message),
    renderPreview: () => {},
    captureProcessingParameters: () => ({ backgroundColor: "#000000" }),
    sessionCore: {
      propagateAutomaticProcessing: () => 1,
      beginPropagation: () => {},
      clearBatchRepairPreview: () => {
        state.batchPreviewRepair = null;
        return true;
      },
      copyAutomaticProcessingState: (targetItem, sourceItem, options = {}) => {
        targetItem.processingParameters = { ...sourceItem.processingParameters };
        targetItem.backgroundSamples = (sourceItem.backgroundSamples || []).map((color) => ({ ...color }));
        targetItem.seedPoints = options.mapSeedPoints
          ? (sourceItem.seedPoints || []).map((point) => ({
              x: (point.x * targetItem.sourceImageData.width) / sourceItem.sourceImageData.width,
              y: (point.y * targetItem.sourceImageData.height) / sourceItem.sourceImageData.height,
            }))
          : [];
        targetItem.automaticCutoutActivated = true;
        targetItem.processingActivated = true;
        targetItem.pendingAutomaticPropagation = false;
      },
    },
    refreshQualityAnalysis: () => {},
    scheduleBatchThumbnails: () => {},
    applyCurrentGroup: async () => {},
    cutoutAnalysisExecutor: {
      captureRepairContext: async (source, width, height, parameters) =>
        analyzeDevelopmentRepairTracking(
          { tracking, localTracking },
          { data: source, width, height },
          { ...parameters, kind: "capture" },
        ),
      mapRepairTarget: async (source, width, height, parameters) =>
        analyzeDevelopmentRepairTracking(
          { tracking, localTracking },
          { data: source, width, height },
          { ...parameters, kind: "map-target" },
        ),
    },
    ...overrides.dependencies,
  };
  return { controller: createController(dependencies), state, item, statuses };
}

test("repair controller creates a protected range repair", async () => {
  const { controller, item, state } = createFixture();
  const created = await controller.applyProtectionSelection(item, { x1: 0, y1: 0, x2: 1, y2: 1 });

  assert.equal(created, true);
  assert.equal(item.repairs[0].mode, "protect-range");
  assert.equal(state.protectionPreview.count, 2);
  assert.equal(state.protectionPreview.width, 2);
  assert.equal(state.protectionPreview.height, 2);
});

test("repair controller prefers and persists a native subject mask", async () => {
  let fallbackCalls = 0;
  const subjectMask = { width: 2, height: 2, data: "Aw==" };
  const { controller, item, state } = createFixture({
    dependencies: {
      detectNativeSubject: async () => ({
        mask: new Uint8Array([1, 1, 0, 0]),
        count: 2,
        bounds: { x1: 0, y1: 0, x2: 1, y2: 0 },
        coverage: 50,
        subjectMask,
      }),
      selectionRepairExecutor: {
        analyze: async () => {
          fallbackCalls += 1;
          throw new Error("The fallback should not run.");
        },
      },
    },
  });

  assert.equal(await controller.applyProtectionSelection(item, { x1: 0, y1: 0, x2: 1, y2: 1 }), true);
  assert.deepEqual(item.repairs[0].subjectMask, subjectMask);
  assert.equal(state.protectionPreview.count, 2);
  assert.equal(fallbackCalls, 0);
});

test("repair controller reports empty protected selections without creating history", async () => {
  const { controller, item, statuses } = createFixture({
    core: { createProtectedRegionMask: () => ({ mask: new Uint8Array(4), count: 0 }) },
  });
  const created = await controller.applyProtectionSelection(item, { x1: 0, y1: 0, x2: 1, y2: 1 });

  assert.equal(created, false);
  assert.equal(item.repairs.length, 0);
  assert.ok(statuses.includes("protectedRangeEmpty"));
});

test("color protection distinguishes empty selections from duplicate colors", async () => {
  const empty = createFixture({
    elements: { cutoutProtectionType: { value: "color" } },
    core: { selectProtectedColorsInRectangle: () => ({ colors: [], count: 0, coverage: 0, status: 1 }) },
  });
  assert.equal(
    await empty.controller.applyProtectionSelection(empty.item, { x1: 0, y1: 0, x2: 1, y2: 1 }),
    false,
  );
  assert.ok(empty.statuses.includes("protectedRegionEmpty"));

  const duplicate = createFixture({
    elements: { cutoutProtectionType: { value: "color" } },
    core: { selectProtectedColorsInRectangle: () => ({ colors: [], count: 1, coverage: 100, status: 0 }) },
  });
  assert.equal(
    await duplicate.controller.applyProtectionSelection(duplicate.item, { x1: 0, y1: 0, x2: 1, y2: 1 }),
    false,
  );
  assert.ok(duplicate.statuses.includes("protectedColorsUnchanged"));
});

test("color protection samples the original selection without filtering by the current cutout", async () => {
  let capturedParameters = null;
  let capturedMask = null;
  const { controller, item } = createFixture({
    elements: { cutoutProtectionType: { value: "color" } },
    dependencies: {
      selectionRepairExecutor: {
        analyze: async (_source, _width, _height, mask, parameters) => {
          if (parameters.mode === "protect-range") {
            return { mask: new Uint8Array([1, 1, 0, 0]), count: 2 };
          }
          capturedMask = mask;
          capturedParameters = parameters;
          return {
            colors: [{ r: 242, g: 173, b: 15 }],
            count: 1,
            coverage: 100,
            status: 0,
          };
        },
      },
      detectNativeSubject: async () => ({ mask: new Uint8Array([1, 0, 1, 0]) }),
      encodeSubjectMask: () => ({ width: 2, height: 2, data: "AQ==" }),
    },
  });

  assert.equal(await controller.applyProtectionSelection(item, { x1: 0, y1: 0, x2: 1, y2: 1 }), true);
  assert.equal(Object.hasOwn(capturedParameters, "previewData"), false);
  assert.deepEqual(Array.from(capturedMask), [1, 0, 0, 0]);
  assert.deepEqual(item.repairs[0].colors, [{ r: 242, g: 173, b: 15 }]);
  assert.deepEqual(item.repairs[0].subjectMask, { width: 2, height: 2, data: "AQ==" });
});

test("repair controller propagates automatic processing through the session core", async () => {
  const { controller, state, item, statuses } = createFixture({
    state: { items: [], selectedIndex: 0 },
  });
  const target = { ...item, id: "frame-2", publishedCanvas: null, sourceCanvas: {} };
  item.pendingAutomaticPropagation = true;
  state.items = [item, target];

  await controller.propagateLatestRepair();

  assert.ok(statuses.includes("automaticCutoutPropagated"));
});

test("single-image clear applies to every target with deterministic canvas mapping", async () => {
  const { controller, state, item, statuses } = createFixture({
    state: { items: [], selectedIndex: 0, sessionMode: "single" },
    dependencies: {
      tracking: {
        createTrackingState: () => ({}),
        advanceTrackingState: () => {},
        selectTrackedCandidate: () => {
          throw new Error("single-image propagation must not require subject tracking");
        },
        mapCanvasRectangle: (rectangle, source, target) => ({
          x1: (rectangle.x1 * target.width) / source.width,
          y1: (rectangle.y1 * target.height) / source.height,
          x2: (rectangle.x2 * target.width) / source.width,
          y2: (rectangle.y2 * target.height) / source.height,
        }),
        mapCanvasPoint: (point, source, target) => ({
          x: (point.x * target.width) / source.width,
          y: (point.y * target.height) / source.height,
        }),
        sampleMatchingColor: () => ({ r: 0, g: 0, b: 0, a: 255 }),
      },
      localTracking: {
        createLocalAnchor: (_data, _width, _height, point) => ({ point }),
      },
    },
  });
  const target = {
    ...item,
    id: "frame-2",
    sourceImageData: { width: 4, height: 4, data: new Uint8ClampedArray(64) },
    resultImageData: { width: 4, height: 4, data: new Uint8ClampedArray(64) },
    automaticImageData: { width: 4, height: 4, data: new Uint8ClampedArray(64) },
    repairs: [],
    undoneRepairs: [],
  };
  item.repairs = [
    {
      id: "clear-source-region",
      mode: "clear",
      x1: 0.5,
      y1: 0.5,
      x2: 1.5,
      y2: 1.5,
      localAnchor: { point: { x: 1, y: 1 } },
    },
  ];
  item.processingParameters = { tolerance: 42, feather: 7 };
  item.backgroundSamples = [{ r: 10, g: 240, b: 20 }];
  item.seedPoints = [{ x: 0.5, y: 0.5 }];
  item.automaticCutoutActivated = true;
  target.processingParameters = { tolerance: 1, feather: 0 };
  target.backgroundSamples = [];
  state.items = [item, target];

  await controller.propagateLatestRepair();

  assert.deepEqual(
    {
      x1: target.repairs[0].x1,
      y1: target.repairs[0].y1,
      x2: target.repairs[0].x2,
      y2: target.repairs[0].y2,
    },
    { x1: 1, y1: 1, x2: 3, y2: 3 },
  );
  assert.equal(target.repairs[0].propagatedFrom, "clear-source-region");
  assert.deepEqual(target.processingParameters, item.processingParameters);
  assert.deepEqual(target.backgroundSamples, item.backgroundSamples);
  assert.notEqual(target.backgroundSamples[0], item.backgroundSamples[0]);
  assert.deepEqual(target.seedPoints, [{ x: 1, y: 1 }]);
  assert.equal(target.automaticCutoutActivated, true);
  assert.ok(statuses.includes("batchRepairedSingle"));
});

test("repair controller validates required dependencies", () => {
  assert.throws(() => createController(), /dependencies are required/);
});
