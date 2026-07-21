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
    cutoutProtectionTolerance: { value: "0" },
    cutoutProtectionPreview: { hidden: false, dataset: {} },
    cutoutProtectionPreviewStatus: { textContent: "" },
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
