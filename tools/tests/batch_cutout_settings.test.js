const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  applyPreviewBackground,
  createController,
  normalizePreviewBackground,
  resolveAutomaticControlDependencies,
  resolveAutomaticSettingsHintKey,
  resolveRepairPropagationState,
  syncAutomaticControlDependencies,
} = require("../animation_tuner/public/batch_cutout_settings.js");
const { TEXT } = require("../animation_tuner/public/batch_cutout_text.js");
const { applyCutout, applyProductCutout } = require("../animation_tuner/public/batch_cutout_core.js");

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
    cutoutSettingsContext: { hidden: false },
    cutoutAutomaticSettings: { hidden: true },
    cutoutLocalSettings: { hidden: true },
    cutoutSettings: { classList: { toggle() {} } },
    cutoutActiveToolTitle: { textContent: "" },
    cutoutActiveToolHint: { textContent: "" },
    cutoutTolerance: { value: "24" },
    cutoutAlphaLow: { value: "8" },
    cutoutAlphaHigh: { value: "240" },
    cutoutToleranceClosedHint: { hidden: true, textContent: "" },
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
  assert.equal(elements.cutoutSettingsContext.hidden, true);
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
  assert.equal(elements.cutoutToleranceClosedHint.hidden, true);

  elements.cutoutTolerance.value = "24";
  elements.cutoutAlphaHigh.value = "4";
  controller.setSettingsMode("automatic");
  assert.match(elements.cutoutActiveToolHint.textContent, /alphaWindowRangeHint/);

  state.items = [];
  controller.setSettingsMode("automatic");
  assert.match(elements.cutoutActiveToolHint.textContent, /settingsEmptyHint/);
});

test("batch cutout text keeps the alpha-window label and range warning on different keys", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/batch_cutout_text.js"),
    "utf8",
  );
  const html = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/index.html"), "utf8");

  assert.equal(
    [...source.matchAll(/^\s+alphaWindowHint:/gmu)].length,
    2,
    "one description key in zh and one in en",
  );
  assert.equal([...source.matchAll(/^\s+alphaWindowRangeHint:/gmu)].length, 2);
  assert.match(html, /data-cutout-i18n="alphaWindowHint"/);
  assert.equal([...source.matchAll(/^\s+toleranceClosedHint:/gmu)].length, 2);
  assert.match(html, /id="cutoutToleranceClosedHint"/);
  assert.match(html, /data-cutout-i18n="toleranceClosedHint"/);
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

/**
 * Paints a flat background with a centered opaque subject. A 1×1 or solid plate
 * cannot tell "matching off" from "algorithm returned the source unchanged".
 * @param {number} size Square edge.
 * @param {[number,number,number]} background Background RGB.
 * @param {[number,number,number]} subject Subject RGB.
 * @returns {Uint8ClampedArray} RGBA pixels.
 */
function paintSubjectOnBackground(size, background, subject) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = x >= size / 4 && x < (size * 3) / 4 && y >= size / 4 && y < (size * 3) / 4;
      const color = inside ? subject : background;
      rgba.set([color[0], color[1], color[2], 255], (y * size + x) * 4);
    }
  }
  return rgba;
}

test("CUT-035 tolerance -1 shows closed matching copy and does not auto-estimate or rewrite pixels", () => {
  const { controller, item, elements } = createFixture();
  item.backgroundSamples = [{ hex: "#ffffff", r: 255, g: 255, b: 255 }];
  elements.cutoutTolerance.value = "-1";

  controller.setSettingsMode("automatic");

  assert.equal(
    resolveAutomaticSettingsHintKey({
      itemAvailable: true,
      automatic: true,
      hasBackgroundSample: true,
      tolerance: -1,
      alphaLow: 0,
      alphaHigh: 0,
    }),
    "toleranceClosedHint",
  );
  assert.match(elements.cutoutActiveToolHint.textContent, /toleranceClosedHint/);
  assert.equal(elements.cutoutToleranceClosedHint.hidden, false);
  assert.match(elements.cutoutToleranceClosedHint.textContent, /toleranceClosedHint/);

  for (const language of ["zh", "en"]) {
    const copy = TEXT[language].toleranceClosedHint;
    assert.match(copy, /关闭|off|closed/iu, `${language} must say matching is closed/off`);
    assert.match(copy, /像素|pixels do not move/iu, `${language} must say pixels stay put`);
    assert.match(
      copy,
      /不会自动估算|does not auto-estimate/iu,
      `${language} must deny auto-estimate instead of promising it`,
    );
    assert.doesNotMatch(copy, /将自动估算|auto-estimates/iu, `${language} must not claim auto-estimate`);
  }

  const size = 32;
  const source = paintSubjectOnBackground(size, [255, 255, 255], [210, 36, 42]);
  const workbenchIdle = {
    connected: false,
    perceptual: false,
    feather: 0,
    alphaThreshold: 0,
    edgeBoost: 10,
    blendStrength: 0,
    despillStrength: 0,
    alphaLow: 0,
    alphaHigh: 0,
  };

  const closedWithoutSample = applyCutout(source, size, size, {
    ...workbenchIdle,
    tolerance: -1,
  });
  assert.deepEqual(
    [...closedWithoutSample.data],
    [...source],
    "tolerance -1 must not estimate a key color and rewrite pixels as a match",
  );
  assert.equal(closedWithoutSample.removedPixels, 0);
  assert.equal(closedWithoutSample.partialPixels, 0);

  const estimatedAtZero = applyCutout(source, size, size, {
    ...workbenchIdle,
    tolerance: 0,
  });
  assert.ok(
    estimatedAtZero.data[3] < 255,
    "tolerance 0 still auto-keys the estimated white plate, so -1 is not a silent no-op default",
  );

  const closedReference = applyProductCutout(
    source,
    size,
    size,
    {
      ...workbenchIdle,
      automaticCutout: true,
      referenceChromaKey: true,
      backgroundColor: { r: 255, g: 255, b: 255, a: 255 },
      backgroundColors: [{ r: 255, g: 255, b: 255, a: 255 }],
      tolerance: -1,
    },
    [],
  );
  assert.deepEqual([...closedReference.data], [...source], "reference matching at -1 must leave every pixel");

  const closedPlate = applyCutout(source, size, size, {
    ...workbenchIdle,
    referenceChromaKey: false,
    perceptual: true,
    backgroundColor: { r: 255, g: 255, b: 255 },
    backgroundColors: [{ r: 255, g: 255, b: 255 }],
    tolerance: -1,
  });
  assert.deepEqual([...closedPlate.data], [...source], "plate path at -1 must not clamp into an exact match");
});
