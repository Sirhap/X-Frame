"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_processing_helpers");
const backgroundController = require("../animation_tuner/public/batch_cutout_background_controller");

test("processing helpers expose quality predicates and localized labels", () => {
  const controller = createController({
    state: { items: [], qualityOnly: false },
    elements: {},
    quality: {},
    getCurrentAnimation: () => null,
    text: (key) => ({ qualityEmpty: "Empty", qualityArea: "Area" })[key] || key,
    setStatus: () => {},
    selectedItem: () => null,
    renderQueue: () => {},
    updateQueueCard: () => {},
    sessionCore: {},
    renderPreview: () => {},
    previewSourcePoint: () => null,
    backgroundController: {},
    core: {},
    recordItemEdit: () => {},
    createRepairTrackingMetadata: () => ({}),
    schedulePreview: () => {},
    documentRef: { createElement: () => ({}) },
    imageDataConstructor: function ImageData() {},
  });

  assert.equal(controller.hasQualityIssue({ quality: { codes: ["empty"] } }), true);
  assert.equal(controller.hasQualityIssue({ quality: { codes: [] } }), false);
  assert.equal(controller.qualityLabel({ codes: ["empty", "area"] }), "Empty · Area");
});

test("background sampling stays active and reads original colors behind transparent results", () => {
  const item = {
    sourceImageData: {
      width: 2,
      height: 1,
      data: Uint8ClampedArray.from([0, 255, 0, 255, 0, 0, 255, 255]),
    },
    resultImageData: {
      width: 2,
      height: 1,
      data: Uint8ClampedArray.from([0, 255, 0, 0, 0, 0, 255, 0]),
    },
    backgroundSamples: [],
    seedPoints: [],
    protectedColors: [],
    repairs: [],
    undoneRepairs: [],
  };
  const state = {
    items: [item],
    qualityOnly: false,
    samplingBackgroundColor: true,
    samplingProtectedColor: false,
    previewMode: "result",
  };
  const elements = {
    cutoutResult: { dataset: { processing: "false" } },
    cutoutTolerance: { value: "12" },
    cutoutColor: { value: "#000000" },
  };
  let scheduledPreviews = 0;
  const controller = createController({
    state,
    elements,
    quality: { analyzeCutoutQualitySequence: () => [] },
    getCurrentAnimation: () => null,
    text: (key) => key,
    setStatus: () => {},
    selectedItem: () => item,
    renderQueue: () => {},
    updateQueueCard: () => {},
    sessionCore: { resetItemProcessing: () => {} },
    renderPreview: () => {},
    previewSourcePoint: (event) => ({ sourceX: event.sampleX, sourceY: 0 }),
    backgroundController,
    core: {
      colorDistance: () => 99,
      rgbToHex: (color) =>
        `#${[color.r, color.g, color.b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`,
    },
    recordItemEdit: () => {},
    createRepairTrackingMetadata: () => ({}),
    schedulePreview: () => {
      scheduledPreviews += 1;
    },
    documentRef: { createElement: () => ({}) },
    imageDataConstructor: function ImageData() {},
  });

  controller.samplePreviewColor({ currentTarget: elements.cutoutResult, sampleX: 0 });
  controller.samplePreviewColor({ currentTarget: elements.cutoutResult, sampleX: 1 });

  assert.equal(state.samplingBackgroundColor, true);
  assert.deepEqual(item.backgroundSamples, [
    { r: 0, g: 0, b: 255, a: 255 },
    { r: 0, g: 255, b: 0, a: 255 },
  ]);
  assert.deepEqual(item.seedPoints, [
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert.equal(item.repairs.length, 0);
  assert.equal(scheduledPreviews, 2);
});
