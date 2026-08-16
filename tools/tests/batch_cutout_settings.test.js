const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyPreviewBackground,
  createController,
  normalizePreviewBackground,
  resolveAutomaticControlDependencies,
  resolveRepairPropagationState,
  syncAutomaticControlDependencies,
} = require("../animation_tuner/public/batch_cutout_settings.js");

/**
 * Creates a DOM-like preview background button for state synchronization tests.
 * @returns {{classList:{toggle:(name:string,active:boolean)=>void},setAttribute:(name:string,value:string)=>void,classes:Set<string>,attributes:Record<string,string>}}
 */
function createPreviewBackgroundButton() {
  const classes = new Set();
  const attributes = {};
  return {
    classes,
    attributes,
    classList: {
      toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
  };
}

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
    cutoutSettingsEmpty: { hidden: true },
    cutoutAutomaticSettings: { hidden: true },
    cutoutLocalSettings: { hidden: true },
    cutoutSettings: { classList: { toggle() {} } },
    cutoutActiveToolTitle: { textContent: "" },
    cutoutActiveToolHint: { textContent: "" },
    cutoutTolerance: { value: "24" },
    cutoutAlphaLow: { value: "8" },
    cutoutAlphaHigh: { value: "240" },
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
    selectedItem: () => state.items[state.selectedIndex] || null,
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

test("preview background switching is display-only and falls back to light", () => {
  const exportedRgba = Uint8ClampedArray.from([12, 34, 56, 78]);
  const state = { previewBackground: "light", exportedRgba };
  const elements = {
    cutoutModal: { dataset: {} },
    cutoutBackgroundLight: createPreviewBackgroundButton(),
    cutoutBackgroundDark: createPreviewBackgroundButton(),
    cutoutBackgroundWhite: createPreviewBackgroundButton(),
  };

  assert.equal(applyPreviewBackground(elements, state, "dark"), "dark");
  assert.equal(elements.cutoutModal.dataset.previewBackground, "dark");
  assert.equal(elements.cutoutBackgroundDark.classes.has("active"), true);
  assert.equal(elements.cutoutBackgroundDark.attributes["aria-pressed"], "true");
  assert.equal(elements.cutoutBackgroundLight.classes.has("active"), false);
  assert.equal(state.exportedRgba, exportedRgba);
  assert.deepEqual([...exportedRgba], [12, 34, 56, 78]);

  assert.equal(normalizePreviewBackground("unsupported"), "light");
  assert.equal(applyPreviewBackground(elements, state, "unsupported"), "light");
  assert.equal(elements.cutoutModal.dataset.previewBackground, "light");
});

test("automatic parameter dependencies disable controls with no active effect", () => {
  assert.deepEqual(
    resolveAutomaticControlDependencies({
      blendStrength: 0,
      despillStrength: 0,
      edgeDespillRadius: 0,
      edgeRecoveryStrength: 0,
    }),
    {
      blendModeDisabled: true,
      despillModeDisabled: true,
      backgroundRadiusDisabled: true,
    },
  );
  assert.deepEqual(
    resolveAutomaticControlDependencies({
      blendStrength: 25,
      despillStrength: 0,
      edgeDespillRadius: 3,
      edgeRecoveryStrength: 50,
    }),
    {
      blendModeDisabled: false,
      despillModeDisabled: false,
      backgroundRadiusDisabled: false,
    },
  );

  const backgroundRadiusNumber = { disabled: false };
  const controls = {
    cutoutBlendStrength: { value: "0" },
    cutoutBlendMode: { disabled: false },
    cutoutDespillStrength: { value: "0" },
    cutoutEdgeDespillRadius: { value: "0" },
    cutoutDespillMode: { disabled: false },
    cutoutEdgeRecoveryStrength: { value: "0" },
    cutoutBackgroundRadius: { disabled: false },
  };
  syncAutomaticControlDependencies(controls, false, (range) =>
    range === controls.cutoutBackgroundRadius ? backgroundRadiusNumber : null,
  );
  assert.equal(controls.cutoutBlendMode.disabled, true);
  assert.equal(controls.cutoutDespillMode.disabled, true);
  assert.equal(controls.cutoutBackgroundRadius.disabled, true);
  assert.equal(backgroundRadiusNumber.disabled, true);
});

test("batch settings follows the active tool and exposes canvas-only tool instructions", () => {
  const { controller, state, elements } = createFixture();

  controller.setSettingsMode("automatic");
  assert.equal(elements.cutoutAutomaticSettings.hidden, false);
  assert.equal(elements.cutoutLocalSettings.hidden, true);
  assert.equal(elements.cutoutActiveToolTitle.textContent, "repairAutomatic:");

  state.repairMode = "clear";
  controller.setSettingsMode("tool");
  assert.equal(elements.cutoutAutomaticSettings.hidden, true);
  assert.equal(elements.cutoutLocalSettings.hidden, false);
  assert.equal(elements.cutoutActiveToolTitle.textContent, "repairClear:");
});

test("batch settings replaces inactive controls with an image-loading guide", () => {
  const { controller, state, elements } = createFixture();
  state.items = [];

  controller.setSettingsMode("automatic");

  assert.equal(elements.cutoutSettingsEmpty.hidden, false);
  assert.equal(elements.cutoutAutomaticSettings.hidden, true);
  assert.equal(elements.cutoutLocalSettings.hidden, true);
  assert.equal(elements.cutoutActiveToolTitle.textContent, "settingsEmptyTitle:");
});

test("batch settings writes live protection parameters to the latest range repair", () => {
  const { controller, state, item, events } = createFixture();
  item.repairs = [{ mode: "protect-range", boundaryStrength: 4, padding: 1 }];

  assert.equal(controller.updateLatestProtectionRepair({ boundaryStrength: 70, padding: 3 }), true);
  assert.equal(item.repairs[0].boundaryStrength, 70);
  assert.equal(item.repairs[0].padding, 3);
  assert.equal(state.protectionPreview, null);
  assert.deepEqual(events, ["record", "invalidate", "preview"]);
});

test("batch settings warns when automatic parameters cannot take effect", () => {
  const { controller, state, item, elements } = createFixture();

  controller.setSettingsMode("automatic");
  assert.match(elements.cutoutActiveToolHint.textContent, /needsBackgroundSampleHint/);

  item.backgroundSamples = [{ hex: "#00ff00" }];
  controller.setSettingsMode("automatic");
  assert.match(elements.cutoutActiveToolHint.textContent, /automaticToolSettingsHint/);

  elements.cutoutTolerance.value = "100";
  controller.setSettingsMode("automatic");
  assert.match(elements.cutoutActiveToolHint.textContent, /toleranceAggressiveHint/);

  elements.cutoutTolerance.value = "24";
  elements.cutoutAlphaHigh.value = "4";
  controller.setSettingsMode("automatic");
  assert.match(elements.cutoutActiveToolHint.textContent, /alphaWindowHint/);

  state.items = [];
  controller.setSettingsMode("automatic");
  assert.match(elements.cutoutActiveToolHint.textContent, /settingsEmptyHint/);
});

test("batch settings explains that automatic parameters are already shared", () => {
  assert.deepEqual(
    resolveRepairPropagationState({ total: 3, item: { repairs: [] }, busy: false, sessionMode: "batch" }),
    {
      enabled: false,
      labelKey: "repairBatchParametersSynced",
      titleKey: "repairBatchParametersSyncedTitle",
    },
  );
  assert.equal(
    resolveRepairPropagationState({
      total: 3,
      item: { repairs: [{ mode: "protect-range" }] },
      busy: false,
      sessionMode: "batch",
    }).enabled,
    true,
  );
});
