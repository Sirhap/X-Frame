"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/frame_organizer_grid");

/**
 * Creates the minimal state and element fixture used by count rendering tests.
 * @param {{mode?:"edit"|"import",included?:boolean,busy?:boolean,canAddAssets?:boolean,canExport?:boolean}} [options]
 * Fixture overrides.
 * @returns {{controller:ReturnType<typeof createController>,elements:Record<string,object>,state:Record<string,unknown>}}
 */
function createFixture(options = {}) {
  const state = {
    mode: options.mode || "edit",
    busy: options.busy === true,
    sequenceAnalyzing: false,
    frames: [{ included: options.included !== false, selected: false }],
  };
  const button = () => ({ disabled: false, hidden: false, title: "" });
  const elements = {
    organizerCount: { textContent: "" },
    organizerSelection: { textContent: "" },
    organizerApply: button(),
    organizerGodotPlaceholder: button(),
    organizerDeleteSelected: button(),
    organizerInvert: button(),
    organizerFlip: button(),
    organizerDeleteExcluded: button(),
    organizerFileInput: button(),
    organizerVideoInput: button(),
    organizerAddAssets: button(),
    organizerExport: button(),
    organizerReduce: button(),
    organizerAutoSort: button(),
    organizerFindJump: button(),
    organizerFindDuplicate: button(),
    organizerFindLoop: button(),
    organizerGrid: { querySelectorAll: () => [] },
  };
  const controller = createController({
    elements,
    state,
    text: (key) => key,
    getCurrentAnimation: () => null,
    canAddAssets: () => options.canAddAssets !== false,
    canExport: () => options.canExport !== false,
    editImportCutout: async () => {},
    renderPreview: () => {},
    restartPreview: () => {},
    setStatus: () => {},
  });
  return { controller, elements, state };
}

test("attached-assets action remains available while editing an existing animation", () => {
  const fixture = createFixture({ mode: "edit" });

  fixture.controller.renderCounts();

  assert.equal(fixture.elements.organizerAddAssets.hidden, false);
  assert.equal(fixture.elements.organizerAddAssets.disabled, false);
  assert.equal(fixture.elements.organizerExport.hidden, false);
  assert.equal(fixture.elements.organizerExport.disabled, false);
});

test("attached-assets action can report a missing target instead of becoming inert", () => {
  const fixture = createFixture({ mode: "import" });

  fixture.controller.renderCounts();

  assert.equal(fixture.elements.organizerAddAssets.hidden, false);
  assert.equal(fixture.elements.organizerAddAssets.disabled, false);
});

test("attached-assets action is disabled without frames and hidden without host support", () => {
  const emptyFixture = createFixture({ included: false });
  emptyFixture.controller.renderCounts();
  assert.equal(emptyFixture.elements.organizerAddAssets.disabled, true);
  assert.equal(emptyFixture.elements.organizerAddAssets.title, "needFrames");

  const unsupportedFixture = createFixture({ canAddAssets: false });
  unsupportedFixture.controller.renderCounts();
  assert.equal(unsupportedFixture.elements.organizerAddAssets.hidden, true);
  assert.equal(unsupportedFixture.elements.organizerAddAssets.disabled, true);

  const exportUnsupportedFixture = createFixture({ canExport: false });
  exportUnsupportedFixture.controller.renderCounts();
  assert.equal(exportUnsupportedFixture.elements.organizerExport.hidden, true);
  assert.equal(exportUnsupportedFixture.elements.organizerExport.disabled, true);
});
