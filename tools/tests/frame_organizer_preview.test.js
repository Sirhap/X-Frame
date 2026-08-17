"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/frame_organizer_preview");

test("organizer preview clamps stale indexes and tolerates missing canvases", () => {
  const state = { previewIndex: -4, previewTimer: 0, viewMode: "edited" };
  const frame = { originalCanvas: { width: 2, height: 2 }, editedCanvas: null };
  const previewCanvas = {
    clientWidth: 480,
    clientHeight: 320,
    getContext: () => null,
  };
  const controller = createController({
    elements: {
      organizerPreview: previewCanvas,
      organizerPreviewFrame: { textContent: "" },
      organizerModal: { hidden: false },
      organizerSpeed: { min: "40", max: "600", value: "400" },
    },
    state,
    text: (key, values = {}) => `${key}:${values.current || ""}`,
    includedFrames: () => [frame],
    clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    window: { clearTimeout() {}, setTimeout: () => 1 },
  });

  assert.doesNotThrow(() => controller.renderPreview());
  assert.equal(state.previewIndex, 0);
});

test("organizer preview draws the frame against the top of the canvas", () => {
  const draws = [];
  const previewCanvas = {
    clientWidth: 400,
    clientHeight: 400,
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect() {},
      drawImage(_source, x, y, width, height) {
        draws.push({ x, y, width, height });
      },
    }),
  };
  const controller = createController({
    elements: {
      organizerPreview: previewCanvas,
      organizerPreviewFrame: { textContent: "" },
      organizerModal: { hidden: false },
      organizerSpeed: { min: "40", max: "600", value: "400" },
    },
    state: { previewIndex: 0, previewTimer: 0, viewMode: "original" },
    text: (key, values = {}) => `${key}:${values.current || ""}`,
    includedFrames: () => [{ originalCanvas: { width: 100, height: 50 }, editedCanvas: null }],
    clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    window: { clearTimeout() {}, setTimeout: () => 1 },
  });

  controller.renderPreview();

  assert.equal(draws.length, 1);
  assert.equal(draws[0].width, 400);
  assert.equal(draws[0].height, 200);
  assert.equal(draws[0].x, 0);
  assert.ok(draws[0].y <= 12);
});
