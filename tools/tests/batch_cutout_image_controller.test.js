"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_image_controller");

/**
 * Builds a deterministic browser-like image helper fixture.
 * @returns {{controller:object,state:object,createdCanvases:object[]}}
 */
function createFixture() {
  const createdCanvases = [];
  const context = {
    imageSmoothingEnabled: true,
    drawImage() {},
    getImageData() {
      return { width: 4, height: 2, data: new Uint8ClampedArray(32) };
    },
  };
  const documentRef = {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return context;
        },
        toDataURL() {
          return "data:image/png;base64,thumb";
        },
      };
      createdCanvases.push(canvas);
      return canvas;
    },
  };
  const state = { items: [], selectedIndex: 0 };
  const colorUtils = {
    hexToRgb: () => ({ r: 1, g: 2, b: 3 }),
    rgbToHex: ({ r, g, b }) => `#${r}${g}${b}`,
    colorDistance: () => 99,
  };
  const sessionCore = {
    recordItemEdit(item) {
      item.recorded = true;
    },
    createProcessingOptions(item, options) {
      return { item, options };
    },
  };
  const controller = createController({
    state,
    elements: { cutoutColor: { value: "#010203" } },
    colorUtils,
    sessionCore,
    imagePixelBudget: {},
    imagePixelLimits: { maxPixelsPerImage: 10, maxTotalPixels: 20 },
    captureProcessingParameters: () => ({ backgroundColor: "#010203" }),
    assertImagePixelBudget: () => ({ width: 4, height: 2 }),
    text: (key) => key,
    documentRef,
    imageConstructor: class FakeImage {},
    urlRef: { createObjectURL: () => "blob:1", revokeObjectURL() {} },
    cryptoRef: { randomUUID: () => "item-1" },
  });
  return { controller, state, createdCanvases };
}

test("image controller builds queue items with the original state shape", () => {
  const { controller, state, createdCanvases } = createFixture();
  const item = controller.createItem({ width: 4, height: 2 }, "frame.png");
  state.items.push(item);

  assert.equal(item.id, "item-1");
  assert.equal(item.sourceImageData.width, 4);
  assert.equal(item.sourceImageData.height, 2);
  assert.equal(item.sourceThumbnail, "data:image/png;base64,thumb");
  assert.equal(createdCanvases.length, 2);
  assert.equal(controller.selectedItem(), item);
});

test("image controller preserves protected colors and processing option derivation", () => {
  const { controller, state } = createFixture();
  const item = {
    processingParameters: { backgroundColor: "#010203" },
    backgroundSamples: [{ r: 4, g: 5, b: 6 }],
    protectedColors: [{ r: 9, g: 9, b: 9 }],
    repairs: [{ mode: "protect-color", colors: [{ r: 12, g: 12, b: 12 }] }],
  };
  state.items.push(item);

  assert.deepEqual(controller.selectedBackgroundColors(item), item.backgroundSamples);
  assert.equal(controller.effectiveProtectedColors(item).length, 2);
  assert.deepEqual(controller.processingOptions(item).options.backgroundColors, item.backgroundSamples);
});
