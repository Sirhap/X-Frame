"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_preview_renderer");

/**
 * Creates a renderer fixture with no selected item so only deterministic view
 * orchestration is exercised.
 * @returns {{controller:object,calls:string[]}}
 */
function createFixture() {
  const calls = [];
  const state = {
    items: [],
    selectedIndex: 0,
    previewRenderToken: 0,
    sessionMode: "batch",
    previewMode: "result",
    samplingProtectedColor: false,
    samplingBackgroundColor: false,
  };
  const makeList = () => ({ innerHTML: "", appendChild() {} });
  const elements = {
    cutoutOriginal: {},
    cutoutResult: {},
    cutoutProtectedColors: makeList(),
    cutoutProtectClear: { disabled: false },
    cutoutProtectSample: { classList: { toggle() {} } },
    cutoutBackgroundColors: makeList(),
    cutoutBackgroundClear: { disabled: false },
    cutoutRepairAutomatic: { classList: { toggle() {} }, setAttribute() {}, title: "" },
    cutoutRepairAutomaticQuick: { classList: { toggle() {} }, setAttribute() {}, title: "" },
    cutoutBackgroundHint: { textContent: "" },
    cutoutModal: { classList: { toggle() {} } },
    cutoutColor: { value: "#000000" },
  };
  const controller = createController({
    state,
    elements,
    text: (key) => key,
    selectedItem: () => null,
    selectedBackgroundColor: () => ({ hex: "#000000" }),
    protectedColorEntries: () => [],
    recordItemEdit() {},
    invalidateItem() {},
    setStatus() {},
    schedulePreview() {},
    processItem: async () => {},
    drawPreviewCanvas: (_target, source) => calls.push(source ? "draw-source" : "draw-empty"),
    renderPreviewMode: () => calls.push("mode"),
    renderPreviewZoom: () => calls.push("zoom"),
    setPreviewProcessing: (value) => calls.push(`processing:${value}`),
    drawRepairOverlay() {},
    drawProtectionPreview() {},
    renderProtectionPreviewInfo: () => calls.push("protection"),
    renderStatus: () => calls.push("status"),
    updateQueueCard() {},
    createDiagnosticCanvas() {
      return null;
    },
    colorUtils: { rgbToHex: () => "#000000" },
    backgroundController: { removeBackgroundSample: () => null },
    documentRef: { createElement: () => ({}) },
  });
  return { controller, calls };
}

test("preview renderer keeps empty-preview orchestration order", async () => {
  const { controller, calls } = createFixture();

  await controller.renderPreview();

  assert.deepEqual(calls, [
    "processing:true",
    "draw-empty",
    "draw-empty",
    "mode",
    "zoom",
    "protection",
    "status",
    "processing:false",
  ]);
});
