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
    hexToRgb(value) {
      const number = Number.parseInt(String(value).replace("#", ""), 16);
      return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255 };
    },
    rgbToHex({ r, g, b }) {
      return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    },
    colorDistance(red, green, blue, target) {
      return red === target.r && green === target.g && blue === target.b ? 0 : 99;
    },
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
  assert.deepEqual(controller.processingOptions(item).options.protectedColors, item.protectedColors);
});

test("image controller validates manual protected colors without mutating the palette", () => {
  const controller = createFixture().controller;
  const item = {
    protectedColors: [{ r: 50, g: 217, b: 197 }],
    repairs: [],
  };

  assert.deepEqual(controller.resolveProtectedColorInput(item, "invalid"), { status: "invalid" });
  assert.deepEqual(controller.resolveProtectedColorInput(item, "#32d9c5"), { status: "duplicate" });
  assert.deepEqual(controller.resolveProtectedColorInput(item, "ff8800"), {
    status: "added",
    color: { r: 255, g: 136, b: 0 },
    hex: "#ff8800",
  });
  assert.equal(item.protectedColors.length, 1);
});

test("image controller enforces the 32-color protection limit", () => {
  const controller = createFixture().controller;
  const item = {
    protectedColors: Array.from({ length: 32 }, (_, index) => ({ r: index * 4, g: 0, b: 0 })),
    repairs: [],
  };

  assert.deepEqual(controller.resolveProtectedColorInput(item, "#ffffff"), { status: "limit" });
});
