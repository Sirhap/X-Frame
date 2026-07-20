"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const backgroundController = require("../animation_tuner/public/batch_cutout_background_controller.js");
const { applyProductCutout } = require("../animation_tuner/public/batch_cutout_core.js");

test("background sample promotion makes the latest color and click point active", () => {
  const item = {
    backgroundSamples: [
      { r: 255, g: 0, b: 255, a: 255 },
      { r: 0, g: 0, b: 0, a: 255 },
    ],
    seedPoints: [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ],
  };

  const result = backgroundController.promoteBackgroundSample(
    item,
    { r: 0, g: 0, b: 0, a: 255 },
    { x: 7, y: 8 },
  );

  assert.deepEqual(result, { added: false, promoted: true });
  assert.deepEqual(item.backgroundSamples, [
    { r: 0, g: 0, b: 0, a: 255 },
    { r: 255, g: 0, b: 255, a: 255 },
  ]);
  assert.deepEqual(item.seedPoints, [
    { x: 7, y: 8 },
    { x: 1, y: 1 },
  ]);
});

test("result sampling repair clears the visible connected replacement", () => {
  const source = Uint8ClampedArray.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const fill = {
    mode: "fill",
    scope: "connected",
    x: 0,
    y: 0,
    sourceColor: { r: 0, g: 0, b: 0, a: 255 },
    color: { r: 0, g: 255, b: 0, a: 255 },
    tolerance: 1,
  };
  const clearVisibleResult = backgroundController.createVisibleColorClearRepair({
    id: "clear-visible-result",
    color: { r: 0, g: 255, b: 0, a: 255 },
    point: { x: 0, y: 0 },
    tolerance: 1,
  });

  const result = applyProductCutout(source, 3, 1, { automaticCutout: false }, [fill, clearVisibleResult]);

  assert.deepEqual([...result.data], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("region restore copies every selected pixel back from the original source", () => {
  const source = Uint8ClampedArray.from([
    255, 0, 255, 255, 12, 24, 36, 255, 64, 96, 128, 180, 8, 16, 32, 255,
  ]);
  const result = applyProductCutout(source, 2, 2, { automaticCutout: false }, [
    { mode: "clear", x1: 0, y1: 0, x2: 1, y2: 1, tolerance: 1, feather: 0 },
    {
      mode: "brush",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      size: 3,
      hardness: 1,
      opacity: 1,
      color: { r: 0, g: 255, b: 0 },
    },
    { mode: "restore", x1: 0, y1: 0, x2: 1, y2: 1, tolerance: 0, feather: 0 },
  ]);

  assert.deepEqual([...result.data], [...source]);
});

test("background sample removal clears automatic mode only after the last sample", () => {
  const item = {
    automaticCutoutActivated: true,
    backgroundSamples: [
      { r: 1, g: 2, b: 3, a: 255 },
      { r: 4, g: 5, b: 6, a: 255 },
    ],
    seedPoints: [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ],
  };

  assert.deepEqual(backgroundController.removeBackgroundSample(item, 0), { r: 1, g: 2, b: 3, a: 255 });
  assert.equal(item.backgroundSamples.length, 1);
  assert.equal(item.automaticCutoutActivated, true);
  assert.equal(backgroundController.clearBackgroundSamples(item), 1);
  assert.deepEqual(item.backgroundSamples, []);
  assert.deepEqual(item.seedPoints, []);
});
