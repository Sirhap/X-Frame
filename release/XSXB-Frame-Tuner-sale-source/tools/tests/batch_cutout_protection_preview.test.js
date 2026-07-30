"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_protection_preview");
const colorUtils = require("../animation_tuner/public/batch_cutout_public_color");

/**
 * Creates a protection-preview fixture with deterministic pixel-processing stubs.
 * @param {object} [overrides] Fixture overrides.
 * @returns {{controller: object, state: object, item: object}}
 */
function createFixture(overrides = {}) {
  const state = {
    previewMode: "result",
    repairMode: "protect",
    repairDrag: null,
    protectionPreview: null,
    ...overrides.state,
  };
  const item = {
    id: "frame-1",
    sourceImageData: {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255]),
    },
    repairs: [
      {
        id: "repair-1",
        mode: "protect-color",
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
        colors: [{ r: 255, g: 0, b: 0 }],
      },
    ],
    processingRevision: 1,
    processingParameters: { protectionTolerance: 0 },
    ...overrides.item,
  };
  const elements = {
    cutoutProtectionType: { value: "color" },
    cutoutProtectionTolerance: { value: "0" },
    cutoutProtectionPreview: { hidden: false, dataset: {} },
    cutoutProtectionPreviewStatus: { textContent: "" },
    cutoutProtectionSubject: { hidden: true },
    cutoutProtectionSubjectCanvas: null,
    cutoutResult: {
      width: 2,
      height: 2,
      _cutoutView: { sourceWidth: 2, sourceHeight: 2, scale: 1, offsetX: 0, offsetY: 0 },
      getContext: () => null,
    },
    ...overrides.elements,
  };
  const selectionRepairExecutor = {
    analyze: async () => ({
      mask: new Uint8Array([1, 0, 0, 0]),
      count: 1,
      bounds: { x1: 0, y1: 0, x2: 0, y2: 0 },
      coverage: 25,
    }),
  };
  const controller = createController({
    colorUtils,
    selectionRepairExecutor,
    state,
    elements,
    text: (key) => key,
    selectedItem: () => item,
    selectedBackgroundColors: () => [],
  });
  return { controller, state, item };
}

test("protection color preview reports matching pixels and source dimensions", async () => {
  const { controller, item } = createFixture();
  const result = await controller.createProtectionPreviewForRepair(item, item.repairs[0]);

  assert.equal(result.width, 2);
  assert.equal(result.height, 2);
  assert.equal(result.count, 2);
  assert.deepEqual(result.bounds, { x1: 0, y1: 0, x2: 1, y2: 1 });
});

test("protection preview rejects malformed source image data", async () => {
  const { controller, item } = createFixture({
    item: { sourceImageData: { width: 2, height: 2, data: new Uint8ClampedArray(3) } },
  });

  assert.equal(await controller.createProtectionPreviewForRepair(item, item.repairs[0]), null);
});

test("protection preview cache invalidates after processing revision changes", async () => {
  const { controller, state, item } = createFixture();

  await controller.syncProtectionPreview(item);
  const firstPreview = state.protectionPreview;
  item.processingRevision += 1;
  await controller.syncProtectionPreview(item);

  assert.notEqual(state.protectionPreview, firstPreview);
  assert.notEqual(state.protectionPreview.previewKey, firstPreview.previewKey);
});

test("protection preview ignores repairs from the inactive protection mode", async () => {
  const { controller, state, item } = createFixture({
    elements: { cutoutProtectionType: { value: "range" } },
  });

  await controller.syncProtectionPreview(item);

  assert.equal(state.protectionPreview, null);
});

test("protection focus sampling preserves blocks that contain protected pixels", () => {
  const { controller } = createFixture();
  const preview = {
    mask: new Uint8Array([0, 1, 0, 0]),
    width: 2,
    height: 2,
  };
  const bounds = { x1: 0, y1: 0, x2: 1, y2: 1 };

  assert.equal(controller.protectionBlockHasMatch(preview, 0, 0, 2, bounds), true);
  assert.equal(controller.protectionBlockHasMatch(preview, 0, 1, 1, bounds), false);
});

test("protection subject pixels are cropped to the detected silhouette", () => {
  const { controller, item } = createFixture();
  const preview = {
    mask: new Uint8Array([1, 0, 0, 1]),
    width: 2,
    height: 2,
    bounds: { x1: 0, y1: 0, x2: 1, y2: 1 },
  };

  const subject = controller.createProtectionSubjectPixels(item.sourceImageData, preview);

  assert.equal(subject.width, 2);
  assert.equal(subject.height, 2);
  assert.deepEqual(Array.from(subject.data.slice(0, 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(subject.data.slice(4, 12)), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(subject.data.slice(12, 16)), [255, 0, 0, 255]);
});

test("completed protection recognition does not draw a box on the main canvas", () => {
  let contextRequests = 0;
  const { controller } = createFixture({
    elements: {
      cutoutResult: {
        getContext: () => {
          contextRequests += 1;
          return {};
        },
      },
    },
  });

  controller.drawProtectionPreview();

  assert.equal(contextRequests, 0);
});

test("persisted native subject masks decode into the selected image region", () => {
  const { controller } = createFixture();
  const decoded = controller.decodeSubjectMask(
    { width: 2, height: 2, data: "CQ==" },
    { x1: 1, y1: 1, x2: 2, y2: 2 },
    4,
    4,
  );

  assert.equal(decoded.count, 2);
  assert.equal(decoded.mask[1 * 4 + 1], 1);
  assert.equal(decoded.mask[2 * 4 + 2], 1);
  assert.deepEqual(decoded.bounds, { x1: 1, y1: 1, x2: 2, y2: 2 });
});
