"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/frame_organizer_actions");

/** Creates the small host fixture needed to exercise organizer actions. */
function createFixture() {
  const frame = {
    uid: "frame-1",
    name: "frame.png",
    editedCanvas: { toDataURL: () => "data:image/png;base64,frame" },
    sourceIndex: 0,
    sourcePath: "frame.png",
    imported: true,
    flipped: false,
    thumbnails: { edited: "" },
  };
  const state = { frames: [frame], mode: "edit", animationName: "demo", busy: false, previewTimer: 0 };
  const calls = {
    assets: null,
    animation: null,
    sessionAnimation: null,
    status: [],
    counts: 0,
    reloads: 0,
    languages: 0,
    closes: 0,
  };
  const controller = createController({
    state,
    elements: {
      organizerModal: { inert: false, setAttribute() {}, removeAttribute() {} },
      organizerAnimationName: { value: "demo" },
      organizerGrid: { querySelector: () => null },
    },
    hooks: {
      addAssets: async (items) => {
        calls.assets = items;
        return items.length;
      },
      createAnimation: async (metadata, items) => {
        if (state.createError) throw state.createError;
        calls.animation = { metadata, items };
      },
      createSessionAnimation: async (metadata, items) => {
        if (state.createError) throw state.createError;
        calls.sessionAnimation = { metadata, items };
      },
    },
    text: (key) => key,
    includedFrames: () => state.frames,
    imageCanvas: (source) => source,
    renderGrid: () => {},
    renderCounts: () => {
      calls.counts += 1;
    },
    restartPreview: () => {},
    setStatus: (message) => {
      calls.status.push(message);
    },
    loadCurrentAnimation: async () => {
      calls.reloads += 1;
    },
    importMetadata: () => state.importMetadata,
    renderLanguage: () => {
      calls.languages += 1;
    },
    closeOrganizer: () => {
      calls.closes += 1;
    },
    getUiController: () => ({
      requestConfirmation: async () => Boolean(state.confirmApply),
    }),
    windowRef: {
      clearTimeout() {},
      setTimeout(callback) {
        callback();
      },
    },
  });
  return { frame, state, calls, controller };
}

test("organizer actions add included frames without changing host payloads", async () => {
  const fixture = createFixture();
  await fixture.controller.addIncludedFramesToAssets();
  assert.deepEqual(fixture.calls.assets, [{ name: "frame.png", image: fixture.frame.editedCanvas }]);
  assert.equal(fixture.state.busy, false);
  assert.deepEqual(fixture.calls.status, ["assetsAdded"]);
  assert.equal(fixture.calls.counts, 2);
});

test("organizer actions reject an unknown cutout target without side effects", async () => {
  const fixture = createFixture();
  await fixture.controller.editImportCutout({ uid: "missing" });
  assert.deepEqual(fixture.calls.status, ["cutoutNeedFrames"]);
  assert.equal(fixture.calls.reloads, 0);
});

test("import mode creates an animation and enters the tuning workbench", async () => {
  const fixture = createFixture();
  fixture.state.mode = "import";
  fixture.state.confirmApply = true;
  fixture.state.importMetadata = { projectId: "project-a", profileLabel: "Hero", animationName: "demo" };

  await fixture.controller.applyPlan();

  assert.equal(fixture.state.mode, "edit");
  assert.equal(fixture.calls.reloads, 0);
  assert.equal(fixture.calls.closes, 1);
  assert.deepEqual(fixture.calls.animation, {
    metadata: fixture.state.importMetadata,
    items: [
      {
        sourceIndex: 0,
        sourcePath: "frame.png",
        name: "frame.png",
        flipped: false,
        data: "data:image/png;base64,frame",
      },
    ],
  });
  assert.deepEqual(fixture.calls.status, ["created"]);
  assert.equal(fixture.calls.languages, 1);
  assert.equal(fixture.state.busy, false);
});

test("failed animation creation keeps the import workbench and staged frames open", async () => {
  const fixture = createFixture();
  fixture.state.mode = "import";
  fixture.state.confirmApply = true;
  fixture.state.importMetadata = { projectId: "project-a", profileLabel: "Hero", animationName: "demo" };
  fixture.state.createError = new Error("creation failed");

  await fixture.controller.applyPlan();

  assert.equal(fixture.state.mode, "import");
  assert.equal(fixture.calls.reloads, 0);
  assert.equal(fixture.calls.closes, 0);
  assert.deepEqual(fixture.calls.status, ["failed"]);
  assert.equal(fixture.state.frames.length, 1);
  assert.equal(fixture.state.busy, false);
});

test("browser import creates a transient animation group instead of downloading a ZIP", async () => {
  const fixture = createFixture();
  fixture.state.mode = "import";
  fixture.state.confirmApply = true;
  fixture.state.importMetadata = {
    projectId: "browser-session",
    profileLabel: "Hero",
    animationName: "demo",
  };
  fixture.state.premiumFeatures = new Set(["organizer.sequence-analysis"]);
  fixture.controller = createController({
    state: fixture.state,
    elements: {
      organizerModal: { inert: false, setAttribute() {}, removeAttribute() {} },
      organizerAnimationName: { value: "demo" },
      organizerGrid: { querySelector: () => null },
    },
    hooks: {
      browserExportOnly: true,
      createSessionAnimation: async (metadata, items, options) => {
        fixture.calls.sessionAnimation = { metadata, items, options };
      },
    },
    text: (key) => key,
    includedFrames: () => fixture.state.frames,
    imageCanvas: (source) => source,
    renderGrid: () => {},
    renderCounts: () => {},
    restartPreview: () => {},
    setStatus: (message) => fixture.calls.status.push(message),
    loadCurrentAnimation: async () => {},
    importMetadata: () => fixture.state.importMetadata,
    renderLanguage: () => {},
    closeOrganizer: () => {
      fixture.calls.closes += 1;
    },
    getUiController: () => ({ requestConfirmation: async () => true }),
    windowRef: { clearTimeout() {} },
  });

  await fixture.controller.applyPlan();

  assert.equal(fixture.state.mode, "edit");
  assert.equal(fixture.calls.closes, 1);
  assert.equal(fixture.calls.sessionAnimation.metadata.animationName, "demo");
  assert.equal(fixture.calls.sessionAnimation.items[0].data, "data:image/png;base64,frame");
  assert.deepEqual(fixture.calls.sessionAnimation.options.premiumFeatures, ["organizer.sequence-analysis"]);
  assert.deepEqual(fixture.calls.status, ["created"]);
});
