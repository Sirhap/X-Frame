"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { calculateView, createController } = require("../animation_tuner/public/batch_cutout_preview");

test("cutout preview view calculation normalizes empty source dimensions", () => {
  const view = calculateView({
    canvasWidth: 100,
    canvasHeight: 100,
    sourceWidth: 0,
    sourceHeight: 0,
    fitScale: null,
    scale: null,
    panX: 0,
    panY: 0,
  });
  assert.equal(view.sourceWidth, 1);
  assert.equal(view.sourceHeight, 1);
  assert.ok(Number.isFinite(view.scale));
});

test("cutout preview rejects hidden layouts and right-edge source coordinates", () => {
  const result = { _cutoutView: null };
  const controller = createController({
    elements: {
      cutoutResult: result,
      cutoutOriginal: {},
      cutoutZoom: {},
      cutoutZoomValue: {},
      cutoutZoomFit: { classList: { toggle() {} } },
      cutoutZoomActual: { classList: { toggle() {} } },
    },
    state: { previewScale: 1, previewFitScale: 1, previewPanX: 0, previewPanY: 0 },
    renderPreview() {},
  });
  const hiddenCanvas = { width: 100, height: 100, getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  assert.equal(controller.previewCanvasPoint({ clientX: 0, clientY: 0 }, hiddenCanvas), null);

  const visibleCanvas = {
    width: 100,
    height: 100,
    _cutoutView: { sourceWidth: 10, sourceHeight: 10, scale: 10, offsetX: 0, offsetY: 0 },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
  assert.equal(controller.previewSourcePoint({ clientX: 100, clientY: 50 }, visibleCanvas), null);
});
