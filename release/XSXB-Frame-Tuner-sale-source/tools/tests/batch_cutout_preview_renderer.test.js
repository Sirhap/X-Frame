"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/batch_cutout_preview_renderer");

/**
 * Creates a renderer fixture with no selected item so only deterministic view
 * orchestration is exercised.
 * @param {{item?:object|null,repairMode?:string,protectedEntries?:object[]}} [options] Fixture overrides.
 * @returns {{controller:object,calls:string[],elements:object}}
 */
function createFixture(options = {}) {
  const calls = [];
  const item = options.item || null;
  const state = {
    items: item ? [item] : [],
    selectedIndex: 0,
    previewRenderToken: 0,
    sessionMode: "batch",
    previewMode: "result",
    repairMode: options.repairMode || "automatic",
    samplingProtectedColor: false,
    samplingBackgroundColor: false,
  };
  const makeList = () => ({
    innerHTML: "",
    children: [],
    appendChild(node) {
      this.children.push(node);
    },
  });
  const elements = {
    cutoutOriginal: {},
    cutoutResult: {},
    cutoutProtectedColors: makeList(),
    cutoutProtectionColors: makeList(),
    cutoutProtectionColorStatus: { textContent: "" },
    cutoutProtectionColorClear: { disabled: false },
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
    selectedItem: () => item,
    selectedBackgroundColor: () => ({ hex: "#000000" }),
    protectedColorEntries: () => options.protectedEntries || [],
    recordItemEdit() {},
    invalidateItem() {},
    setStatus() {},
    schedulePreview() {},
    processItem: async () => calls.push("process"),
    drawPreviewCanvas: (_target, source) => calls.push(source ? "draw-source" : "draw-empty"),
    renderPreviewMode: () => calls.push("mode"),
    renderPreviewZoom: () => calls.push("zoom"),
    setPreviewProcessing: (value) => calls.push(`processing:${value}`),
    drawRepairOverlay() {},
    syncProtectionPreview: async () => calls.push("sync-protection"),
    drawProtectionPreview: () => calls.push("draw-protection"),
    renderProtectionPreviewInfo: () => calls.push("protection"),
    renderStatus: () => calls.push("status"),
    updateQueueCard() {},
    createDiagnosticCanvas() {
      return null;
    },
    colorUtils: { rgbToHex: () => "#000000" },
    backgroundController: { removeBackgroundSample: () => null },
    documentRef: {
      createElement: () => ({
        setAttribute() {},
        style: { setProperty() {} },
        addEventListener() {},
      }),
    },
  });
  return { controller, calls, elements };
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

test("preview renderer synchronizes protection data before drawing its focus view", async () => {
  const item = { sourceCanvas: {}, resultCanvas: {}, processingActivated: true };
  const { controller, calls } = createFixture({ item, repairMode: "protect" });

  await controller.renderPreview();

  assert.ok(calls.indexOf("sync-protection") > calls.indexOf("process"));
  assert.ok(calls.indexOf("sync-protection") < calls.indexOf("draw-protection"));
});

test("protected colors render in advanced and active-tool palettes", () => {
  const item = { protectedColors: [{ r: 50, g: 217, b: 197 }], repairs: [] };
  const entries = [{ color: item.protectedColors[0], container: item.protectedColors, index: 0 }];
  const { controller, elements } = createFixture({ item, protectedEntries: entries });

  controller.renderProtectedColors();

  assert.equal(elements.cutoutProtectedColors.children.length, 1);
  assert.equal(elements.cutoutProtectionColors.children.length, 1);
  assert.equal(elements.cutoutProtectionColorStatus.textContent, "protectedColorCount");
  assert.equal(elements.cutoutProtectionColorClear.disabled, false);
});
