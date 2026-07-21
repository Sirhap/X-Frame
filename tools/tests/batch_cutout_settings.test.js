const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/batch_cutout_settings.js");

function createFixture() {
  const item = { id: "frame-1", repairs: [{ mode: "fill", color: "#fff" }] };
  const state = {
    items: [item],
    selectedIds: new Set(),
    selectedIndex: 0,
    selectedItem: item,
    repairMode: "fill",
    areaColorTransparent: false,
  };
  const elements = {
    cutoutAreaColor: { value: "#0a0b0c" },
  };
  const events = [];
  const controller = createController({
    state,
    elements,
    imagePixelBudget: {
      evaluate: (_source, currentPixels, limits) => ({
        allowed: currentPixels === 0,
        reason: currentPixels === 0 ? null : "total",
        limit: limits.maxTotalPixels,
      }),
    },
    imagePixelLimits: { maxPixelsPerImage: 10, maxTotalPixels: 20 },
    text: (key, variables = {}) => `${key}:${variables.limit || ""}`,
    selectedItem: () => item,
    hasQualityIssue: () => false,
    selectedBackgroundColor: () => ({ hex: "#000000" }),
    colorUtils: {
      hexToRgb: (hex) => ({ hex }),
    },
    recordItemEdit: () => events.push("record"),
    invalidateItem: () => events.push("invalidate"),
    renderPreview: () => events.push("preview"),
    schedulePreview: () => events.push("schedule"),
    syncProtectionPreview: () => events.push("protection"),
    renderAdvancedMode: () => events.push("advanced"),
    advancedSummary: {},
  });
  return { controller, state, item, elements, events };
}

test("batch settings keeps color and area-repair updates delegated", () => {
  const { controller, state, item, events } = createFixture();

  assert.deepEqual(controller.selectedAreaColor(), { hex: "#0a0b0c" });
  state.areaColorTransparent = true;
  assert.deepEqual(controller.selectedAreaColor(), { r: 0, g: 0, b: 0, a: 0 });
  state.areaColorTransparent = false;
  assert.equal(controller.updateLatestAreaRepair({ tolerance: 6 }), true);
  assert.equal(item.repairs.at(-1).tolerance, 6);
  assert.deepEqual(events, ["record", "invalidate", "preview"]);
});

test("batch settings preserves pixel-budget rejection messages", () => {
  const { controller } = createFixture();

  assert.throws(() => controller.assertImagePixelBudget({ width: 4, height: 4 }, 1), /batchPixelLimit:1/);
});
