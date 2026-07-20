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
