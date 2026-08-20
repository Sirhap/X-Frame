"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  createController,
  createThumbnailDataUrl,
} = require("../animation_tuner/public/frame_organizer_grid");

const ORGANIZER_SOURCE = fs.readFileSync(
  path.join(__dirname, "../animation_tuner/public/frame_organizer.js"),
  "utf8",
);
const ORGANIZER_UI_SOURCE = fs.readFileSync(
  path.join(__dirname, "../animation_tuner/public/frame_organizer_ui.js"),
  "utf8",
);

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
    text: (key, variables) => (variables ? `${key} ${JSON.stringify(variables)}` : key),
    getCurrentAnimation: () => null,
    canAddAssets: () => options.canAddAssets !== false,
    canExport: () => options.canExport !== false,
    commitImportToCurrent: () => options.commitImportToCurrent === true,
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
  assert.equal(fixture.elements.organizerToggleImportSetup.hidden, false);
  assert.equal(fixture.elements.organizerImportSetup.hidden, false);
  assert.equal(fixture.elements.organizerToggleImportSetup.attributes["aria-expanded"], "true");
});

test("writing into the current animation still leaves import settings togglable", () => {
  const fixture = createFixture({ mode: "import", commitImportToCurrent: true });
  fixture.controller.renderCounts();

  assert.equal(fixture.elements.organizerToggleImportSetup.hidden, false);
  assert.equal(fixture.state.showImportSetup, false);

  fixture.state.frames = [];
  fixture.controller.renderCounts();

  assert.equal(fixture.state.showImportSetup, true);
  assert.equal(fixture.elements.organizerToggleImportSetup.hidden, false);
  assert.equal(fixture.elements.organizerImportSetup.hidden, false);
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

test("createFrame and temporary workset install use the imported membership helpers", () => {
  assert.match(ORGANIZER_SOURCE, /selected:\s*gridModule\.importedFrameStartsSelected\(options\)/);
  assert.match(ORGANIZER_SOURCE, /gridModule\.applyImportedWorksetMembership\(frame,\s*item\.enabled\)/);
  assert.match(ORGANIZER_UI_SOURCE, /invertWorksetMembership\(state\.frames\)/);
});

test("a fully included imported workset starts selected so 选中 and 删除选中 agree with the checks", () => {
  const {
    importedFrameStartsSelected,
    applyImportedWorksetMembership,
  } = require("../animation_tuner/public/frame_organizer_grid");
  assert.equal(importedFrameStartsSelected({ imported: true }), true);
  assert.equal(importedFrameStartsSelected({ imported: false }), false);
  assert.equal(importedFrameStartsSelected({}), false);

  const fixture = createFixture({ mode: "import" });
  fixture.state.frames = [
    applyImportedWorksetMembership(
      {
        included: true,
        selected: importedFrameStartsSelected({ imported: true }),
        hasEditedResult: false,
      },
      true,
    ),
    applyImportedWorksetMembership(
      {
        included: true,
        selected: importedFrameStartsSelected({ imported: true }),
        hasEditedResult: false,
      },
      true,
    ),
  ];

  fixture.controller.renderCounts();

  assert.match(fixture.elements.organizerCount.textContent, /"included":2/);
  assert.match(fixture.elements.organizerSelection.textContent, /"count":2/);
  assert.equal(fixture.elements.organizerDeleteSelected.disabled, false);
  assert.equal(fixture.elements.organizerDeleteExcluded.disabled, true);
});

test("inverting the workset flips included only so ORG-009 stays independent of selection", () => {
  const { invertWorksetMembership } = require("../animation_tuner/public/frame_organizer_grid");
  const frames = [
    { included: true, selected: true },
    { included: false, selected: false },
    { included: true, selected: true },
    { included: false, selected: false },
  ];

  invertWorksetMembership(frames);

  assert.deepEqual(
    frames.map((frame) => frame.included),
    [false, true, false, true],
  );
  assert.deepEqual(
    frames.map((frame) => frame.selected),
    [true, false, true, false],
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
  assert.equal(fixture.cutoutScope.textContent, 'cutoutScopeWorkset {"count":1}');
  fixture.state.frames[0].selected = true;
  fixture.controller.renderCounts();
  assert.equal(fixture.cutoutScope.textContent, 'cutoutScopeSelection {"count":1}');
});

/**
 * Builds a grid fixture that keeps real card nodes so draggable can be asserted.
 * @returns {{controller:ReturnType<typeof createController>,state:object,cards:object[]}}
 */
function createCardGridFixture() {
  const cards = [];
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
  const grid = {
    children: cards,
    querySelectorAll(selector) {
      if (selector === ".organizerFrame") return cards;
      if (selector === ".organizerFrameCutout") return cards.map(() => fakeNode());
      return [];
    },
    querySelector: () => null,
    replaceChildren(fragment) {
      cards.length = 0;
      cards.push(...(fragment.childNodes || []));
    },
  };
  const button = () => ({
    disabled: false,
    hidden: false,
    title: "",
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    classList: { toggle() {} },
  });
  const state = {
    mode: "import",
    busy: false,
    sequenceAnalyzing: false,
    viewMode: "edited",
    showImportSetup: false,
    hadFrames: false,
    frames: [
      {
        uid: "frame-a",
        name: "a.png",
        tag: "",
        included: true,
        selected: false,
        analysisMatch: "",
        hasEditedResult: false,
        thumbnails: { edited: "data:a" },
      },
      {
        uid: "frame-b",
        name: "b.png",
        tag: "",
        included: true,
        selected: false,
        analysisMatch: "",
        hasEditedResult: false,
        thumbnails: { edited: "data:b" },
      },
    ],
  };
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
    organizerImportSetup: { closest: () => ({ classList: { toggle() {} } }) },
    organizerGrid: grid,
  };
  const controller = createController({
    document: {
      createDocumentFragment: () => {
        const childNodes = [];
        return {
          childNodes,
          appendChild(node) {
            childNodes.push(node);
            return node;
          },
        };
      },
      createElement: () => fakeNode(),
      querySelector: () => ({ textContent: "", hidden: false }),
    },
    elements,
    state,
    text: (key) => key,
    getCurrentAnimation: () => null,
    canAddAssets: () => true,
    canExport: () => true,
    editImportCutout: async () => {},
    renderPreview: () => {},
    restartPreview: () => {},
    setStatus: () => {},
  });
  return { controller, state, cards };
}

test("ORG-013 renderCounts restores card.draggable after a busy extract paint", () => {
  const fixture = createCardGridFixture();
  fixture.state.busy = true;
  fixture.controller.renderGrid();
  assert.equal(fixture.cards.length, 2);
  assert.equal(fixture.cards[0].draggable, false);
  assert.equal(fixture.cards[1].draggable, false);

  fixture.state.busy = false;
  fixture.controller.renderCounts();

  assert.equal(fixture.state.busy, false);
  assert.equal(fixture.cards[0].draggable, true);
  assert.equal(fixture.cards[1].draggable, true);
});
