"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createController,
  createThumbnailDataUrl,
} = require("../animation_tuner/public/frame_organizer_grid");

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
    viewMode: "edited",
    showImportSetup: true,
    hadFrames: false,
    frames: [{ included: options.included !== false, selected: false, hasEditedResult: false }],
  };
  const activeClasses = new Set();
  const button = () => ({
    disabled: false,
    hidden: false,
    title: "",
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    classList: {
      toggle(name, enabled) {
        if (enabled) activeClasses.add(name);
        else activeClasses.delete(name);
      },
    },
  });
  const workbenchClasses = new Set();
  const elements = {
    organizerCount: { textContent: "" },
    organizerSelection: { textContent: "" },
    organizerApply: button(),
    organizerGodotPlaceholder: button(),
    organizerDeleteSelected: button(),
    organizerClearWorkset: button(),
    organizerBatchCutout: button(),
    organizerInvert: button(),
    organizerInvertSelection: button(),
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
    organizerToggleImportSetup: button(),
    organizerViewOriginal: button(),
    organizerViewEdited: button(),
    organizerImportSetup: {
      closest: () => ({
        classList: {
          toggle(name, enabled) {
            if (enabled) workbenchClasses.add(name);
            else workbenchClasses.delete(name);
          },
        },
      }),
    },
    organizerGrid: {
      children: [],
      querySelectorAll: () => [],
      querySelector: () => null,
      replaceChildren() {
        this.children = [];
      },
    },
  };
  const fakeNode = () => ({
    dataset: {},
    className: "",
    draggable: false,
    innerHTML: "",
    textContent: "",
    hidden: false,
    disabled: false,
    src: "",
    checked: false,
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {},
    setAttribute() {},
    querySelector() {
      return fakeNode();
    },
  });
  const cutoutScope = { textContent: "", hidden: false };
  const batchScope = { hidden: true };
  const batchScopeText = { textContent: "" };
  const controller = createController({
    document: {
      createDocumentFragment: () => ({ appendChild() {} }),
      createElement: () => fakeNode(),
      querySelector(selector) {
        if (selector === "#organizerBatchCutoutScope") return cutoutScope;
        if (selector === "#organizerBatchScope") return batchScope;
        if (selector === "#organizerBatchScopeText") return batchScopeText;
        return null;
      },
    },
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
  return { controller, elements, state, activeClasses, workbenchClasses, cutoutScope, batchScopeText };
}

test("attached-assets action remains available while editing an existing animation", () => {
  const fixture = createFixture({ mode: "edit" });

  fixture.controller.renderCounts();

  assert.equal(fixture.elements.organizerAddAssets.hidden, false);
  assert.equal(fixture.elements.organizerAddAssets.disabled, false);
  assert.equal(fixture.elements.organizerExport.hidden, false);
  assert.equal(fixture.elements.organizerExport.disabled, false);
  assert.equal(fixture.elements.organizerClearWorkset.disabled, false);
});

test("attached-assets action can report a missing target instead of becoming inert", () => {
  const fixture = createFixture({ mode: "import" });

  fixture.controller.renderCounts();

  assert.equal(fixture.elements.organizerAddAssets.hidden, false);
  assert.equal(fixture.elements.organizerAddAssets.disabled, false);
});

test("empty import keeps import settings and removal actions visible", () => {
  const fixture = createFixture({ mode: "import" });
  fixture.state.frames = [];

  fixture.controller.renderCounts();

  assert.equal(fixture.elements.organizerToggleImportSetup.hidden, false);
  assert.equal(fixture.elements.organizerDeleteSelected.hidden, false);
  assert.equal(fixture.elements.organizerDeleteExcluded.hidden, false);
  assert.equal(fixture.elements.organizerDeleteSelected.disabled, true);
  assert.equal(fixture.elements.organizerDeleteExcluded.disabled, true);
});

test("attached-assets action is disabled without frames and hidden without host support", () => {
  const emptyFixture = createFixture({ included: false });
  emptyFixture.state.frames = [];
  emptyFixture.controller.renderCounts();
  assert.equal(emptyFixture.elements.organizerAddAssets.disabled, true);
  assert.equal(emptyFixture.elements.organizerAddAssets.title, "needFrames");
  assert.equal(emptyFixture.elements.organizerClearWorkset.disabled, true);

  const unsupportedFixture = createFixture({ canAddAssets: false });
  unsupportedFixture.controller.renderCounts();
  assert.equal(unsupportedFixture.elements.organizerAddAssets.hidden, true);
  assert.equal(unsupportedFixture.elements.organizerAddAssets.disabled, true);

  const exportUnsupportedFixture = createFixture({ canExport: false });
  exportUnsupportedFixture.controller.renderCounts();
  assert.equal(exportUnsupportedFixture.elements.organizerExport.hidden, true);
  assert.equal(exportUnsupportedFixture.elements.organizerExport.disabled, true);
});

test("clearing an imported workset restores import settings", () => {
  const fixture = createFixture({ mode: "import" });
  fixture.controller.renderCounts();
  assert.equal(fixture.state.showImportSetup, false);
  assert.equal(fixture.state.hadFrames, true);

  fixture.state.frames = [];
  fixture.controller.renderCounts();

  assert.equal(fixture.state.showImportSetup, true);
  assert.equal(fixture.elements.organizerToggleImportSetup.attributes["aria-expanded"], "true");
});

test("loaded worksets collapse low-frequency controls and disable missing edited results", () => {
  const fixture = createFixture({ mode: "import" });

  fixture.controller.renderCounts();

  assert.equal(fixture.state.showImportSetup, false);
  assert.equal(fixture.elements.organizerToggleImportSetup.hidden, false);
  assert.equal(fixture.elements.organizerToggleImportSetup.attributes["aria-expanded"], "false");
  assert.equal(fixture.elements.organizerViewEdited.disabled, true);
  assert.equal(fixture.state.viewMode, "original");
  assert.equal(fixture.workbenchClasses.has("hasFrames"), true);
});

test("edited-result view activates after a real frame edit", () => {
  const fixture = createFixture({ mode: "import" });
  fixture.state.frames[0].hasEditedResult = true;

  fixture.controller.renderCounts();

  assert.equal(fixture.elements.organizerViewEdited.disabled, false);
  assert.equal(fixture.state.viewMode, "edited");
});

test("analysis hints sit on the matching buttons after a long hover instead of a permanent note", () => {
  const fixture = createFixture({ mode: "import" });
  fixture.state.frames = [
    { included: true, selected: false, hasEditedResult: false },
    { included: true, selected: false, hasEditedResult: false },
    { included: true, selected: false, hasEditedResult: false },
    { included: true, selected: false, hasEditedResult: false },
  ];

  fixture.controller.renderCounts();

  assert.equal(fixture.elements.organizerFindJump.title, "jumpHint");
  assert.equal(fixture.elements.organizerFindDuplicate.title, "duplicateHint");
  assert.equal(fixture.elements.organizerFindLoop.title, "loopHint");
});

test("organizer grid reorders frames when one card is dropped onto another", () => {
  const fixture = createFixture({ mode: "import" });
  fixture.state.frames = [
    {
      uid: "frame-1",
      included: true,
      selected: false,
      hasEditedResult: false,
      thumbnails: { edited: "data:1" },
    },
    {
      uid: "frame-2",
      included: true,
      selected: false,
      hasEditedResult: false,
      thumbnails: { edited: "data:2" },
    },
    {
      uid: "frame-3",
      included: true,
      selected: false,
      hasEditedResult: false,
      thumbnails: { edited: "data:3" },
    },
  ];

  fixture.controller.reorderFrame("frame-3", 0, false);

  assert.deepEqual(
    fixture.state.frames.map((frame) => frame.uid),
    ["frame-3", "frame-1", "frame-2"],
  );
});

test("secondary removal actions stay visible and disable when they are not actionable", () => {
  const fixture = createFixture({ mode: "import" });
  fixture.state.frames = [
    { included: true, selected: false, hasEditedResult: false },
    { included: true, selected: false, hasEditedResult: false },
  ];

  fixture.controller.renderCounts();
  assert.equal(fixture.elements.organizerDeleteSelected.hidden, false);
  assert.equal(fixture.elements.organizerDeleteExcluded.hidden, false);
  assert.equal(fixture.elements.organizerDeleteSelected.disabled, true);
  assert.equal(fixture.elements.organizerDeleteExcluded.disabled, true);

  fixture.state.frames[0].selected = true;
  fixture.controller.renderCounts();
  assert.equal(fixture.elements.organizerDeleteSelected.disabled, false);
  assert.equal(fixture.elements.organizerDeleteExcluded.disabled, true);

  fixture.state.frames[1].included = false;
  fixture.controller.renderCounts();
  assert.equal(fixture.elements.organizerDeleteSelected.disabled, false);
  assert.equal(fixture.elements.organizerDeleteExcluded.disabled, false);
});

test("organizer thumbnails encode a downscaled canvas instead of the full frame", () => {
  const encoded = [];
  const source = {
    width: 1024,
    height: 768,
    toDataURL() {
      throw new Error("full-resolution encode must not run");
    },
  };
  const dataUrl = createThumbnailDataUrl(source, 156, {
    createElement() {
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return { imageSmoothingEnabled: false, drawImage() {} };
        },
        toDataURL() {
          encoded.push({ width: this.width, height: this.height });
          return "data:thumb";
        },
      };
      return canvas;
    },
  });

  assert.equal(dataUrl, "data:thumb");
  assert.deepEqual(encoded, [{ width: 156, height: 117 }]);
});

test("cutout scope copy comes from the organizer translator", () => {
  const fixture = createFixture();
  fixture.controller.renderCounts();
  assert.equal(fixture.cutoutScope.textContent, "cutoutScopeWorkset");
  fixture.state.frames[0].selected = true;
  fixture.controller.renderCounts();
  assert.equal(fixture.cutoutScope.textContent, "cutoutScopeSelection");
});
