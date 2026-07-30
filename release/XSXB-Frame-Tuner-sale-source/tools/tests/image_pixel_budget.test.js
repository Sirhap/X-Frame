"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const imagePixelBudget = require("../animation_tuner/public/image_pixel_budget.js");

test("image pixel budget accepts a source within both limits", () => {
  const result = imagePixelBudget.evaluate({ naturalWidth: 1024, naturalHeight: 1024 }, 2_000_000, {
    maxPixelsPerImage: 4_000_000,
    maxTotalPixels: 4_000_000,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.pixels, 1_048_576);
  assert.equal(result.totalPixels, 3_048_576);
});

test("image pixel budget rejects oversized single images before canvas allocation", () => {
  const result = imagePixelBudget.evaluate({ width: 4096, height: 4096 }, 0, {
    maxPixelsPerImage: 10_000_000,
    maxTotalPixels: 30_000_000,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "single");
});

test("image pixel budget rejects batches whose decoded pixels exceed the total", () => {
  const result = imagePixelBudget.evaluate({ width: 2048, height: 2048 }, 8_000_000, {
    maxPixelsPerImage: 5_000_000,
    maxTotalPixels: 10_000_000,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "total");
});
