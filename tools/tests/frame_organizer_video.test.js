"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { calculateSelection, createController } = require("../animation_tuner/public/frame_organizer_video");

test("video selection normalizes range, FPS, and output dimensions", () => {
  assert.deepEqual(
    calculateSelection({
      duration: 10,
      width: 4096,
      height: 2048,
      start: -2,
      end: 3.5,
      fps: 12.4,
    }),
    {
      start: 0,
      end: 3.5,
      fps: 12,
      count: 42,
      pixelCount: 42 * 2048 * 1024,
      width: 2048,
      height: 1024,
    },
  );
});

test("video selection returns an empty count for reversed or missing ranges", () => {
  assert.equal(
    calculateSelection({ duration: 5, width: 1920, height: 1080, start: 4, end: 2, fps: 30 }).count,
    0,
  );
  assert.equal(calculateSelection({ duration: 0, width: 0, height: 0, start: 0, end: 0, fps: 0 }).count, 0);
});

test("video controller rejects missing integration dependencies", () => {
  assert.throws(() => createController(), /dependencies are required/);
  assert.throws(() => createController({ elements: {} }), /dependencies are required/);
});

test("video controller allows selections above the former frame and decoded-pixel budgets", () => {
  const elements = {
    organizerVideoStatus: { textContent: "", dataset: {} },
    organizerVideoStart: { value: "0" },
    organizerVideoEnd: { value: "31" },
    organizerVideoStartRange: { value: "" },
    organizerVideoEndRange: { value: "" },
    organizerVideoFps: { value: "10" },
    organizerVideoFpsNumber: { value: "10" },
    organizerVideoDuration: { textContent: "" },
    organizerVideoEstimate: { textContent: "" },
    organizerVideoExtract: { disabled: true },
  };
  const controller = createController({
    elements,
    state: {
      videoDuration: 31,
      videoWidth: 7680,
      videoHeight: 4320,
      videoExtracting: false,
    },
    text: (key) => key,
  });

  controller.syncControls();

  assert.equal(elements.organizerVideoExtract.disabled, false);
  assert.equal(elements.organizerVideoEstimate.textContent, "310");
  assert.equal(elements.organizerVideoStatus.textContent, "videoLoaded");
});
