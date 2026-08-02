"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateFitScale,
  calculateView,
  createController,
} = require("../animation_tuner/public/batch_cutout_preview");

test("cutout fit zoom matches the frame stage padding and zoom limits", () => {
  assert.equal(calculateFitScale(480, 360, 480, 360), 0.8);
  assert.equal(calculateFitScale(480, 360, 1, 1), 8);
  assert.equal(calculateFitScale(480, 360, 8000, 8000), 0.12);
});

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

test("cutout preview supports zooming up to eight hundred percent", () => {
  let renderCount = 0;
  const state = { previewScale: 1, previewFitScale: 1, previewPanX: 0, previewPanY: 0 };
  const elements = {
    cutoutResult: { _cutoutView: { scale: 8 } },
    cutoutOriginal: {},
    cutoutZoom: { value: "100" },
    cutoutZoomValue: { textContent: "" },
    cutoutZoomFit: { classList: { toggle() {} } },
    cutoutZoomActual: { classList: { toggle() {} } },
  };
  const controller = createController({
    elements,
    state,
    renderPreview() {
      renderCount += 1;
    },
  });

  controller.setPreviewScale(12);
  assert.equal(state.previewScale, 8);
  assert.equal(renderCount, 1);
  controller.renderPreviewZoom();
  assert.equal(elements.cutoutZoom.value, "800");
  assert.equal(elements.cutoutZoomValue.textContent, "800%");
});

test("cutout preview uses the frame stage twelve-percent lower zoom limit", () => {
  const state = { previewScale: 1, previewFitScale: 1, previewPanX: 0, previewPanY: 0 };
  const controller = createController({
    elements: {
      cutoutResult: {},
      cutoutOriginal: {},
      cutoutZoom: {},
      cutoutZoomValue: {},
      cutoutZoomFit: { classList: { toggle() {} } },
      cutoutZoomActual: { classList: { toggle() {} } },
    },
    state,
    renderPreview() {},
  });

  controller.setPreviewScale(0.01);
  assert.equal(state.previewScale, 0.12);
});

test("cutout comparison preview clips B while sharing one viewport", () => {
  const calls = [];
  const context = {
    clearRect: (...args) => calls.push(["clearRect", ...args]),
    drawImage: (...args) => calls.push(["drawImage", ...args]),
    save: () => calls.push(["save"]),
    beginPath: () => calls.push(["beginPath"]),
    rect: (...args) => calls.push(["rect", ...args]),
    clip: () => calls.push(["clip"]),
    restore: () => calls.push(["restore"]),
  };
  const target = {
    width: 480,
    height: 360,
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 480, height: 360 }),
  };
  const state = { previewScale: null, previewFitScale: null, previewPanX: 0, previewPanY: 0 };
  const controller = createController({
    elements: {
      cutoutResult: target,
      cutoutOriginal: {},
      cutoutZoom: {},
      cutoutZoomValue: {},
      cutoutZoomFit: { classList: { toggle() {} } },
      cutoutZoomActual: { classList: { toggle() {} } },
    },
    state,
    renderPreview() {},
    getDevicePixelRatio: () => 1,
  });
  const sourceA = { width: 100, height: 80 };
  const sourceB = { width: 100, height: 80 };

  controller.drawComparisonCanvas(target, sourceA, sourceB, 0.25);

  assert.equal(calls.filter(([name]) => name === "drawImage").length, 2);
  assert.deepEqual(
    calls.find(([name]) => name === "rect"),
    ["rect", 120, 0, 360, 360],
  );
  assert.ok(target._cutoutView);
});
