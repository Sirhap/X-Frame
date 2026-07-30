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
    exported: null,
    animation: null,
    sessionAnimation: null,
    status: [],
    counts: 0,
    reloads: 0,
    languages: 0,
    closes: 0,
    cutoutWorksets: [],
    projectRequest: null,
  };
  const controller = createController({
    state,
    elements: {
      organizerModal: { inert: false, setAttribute() {}, removeAttribute() {} },
      organizerAnimationName: { value: "demo" },
      organizerBatchCutout: { focus() {} },
      organizerGrid: { querySelector: () => null },
    },
    hooks: {
      addAssets: async (items) => {
        calls.assets = items;
        return items.length;
      },
      addToProject: async (request) => {
        calls.projectRequest = request;
      },
      editCutout: async (workset) => {
        calls.cutoutWorksets.push(workset);
        return state.cutoutOutputs || null;
      },
      getCurrentAnimation: () => ({
        name: "demo",
        profileLabel: "Hero",
        animationType: "actor",
        fps: 12,
        anchorMode: "canvas_bottom_center",
      }),
      exportAnimation: async (metadata, items, options) => {
        calls.exported = { metadata, items, options };
        if (state.exportError) throw state.exportError;
        options.onProgress(1, items.length);
        return { filename: "demo-xsxb.zip", frameCount: items.length };
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
      setEditorInert() {},
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
  assert.equal(fixture.calls.closes, 1);
});

test("organizer actions export the edited workset as PNG frames", async () => {
  const fixture = createFixture();
  fixture.state.confirmApply = true;

  await fixture.controller.exportIncludedFrames();

  assert.equal(fixture.calls.exported.metadata.animationName, "demo");
  assert.deepEqual(fixture.calls.exported.items, [
    {
      name: "frame.png",
      flipped: false,
      data: "data:image/png;base64,frame",
    },
  ]);
  assert.deepEqual(fixture.calls.status, ["exportingZip", "exportedZip"]);
  assert.equal(fixture.state.busy, false);
});

test("organizer actions hand off an ordered processed workset without closing the session", async () => {
  const fixture = createFixture();

  await fixture.controller.addIncludedFramesToProject();

  assert.equal(fixture.calls.projectRequest.sourceTool, "organizer");
  assert.equal(fixture.calls.projectRequest.worksets[0].animationName, "demo");
  assert.deepEqual(fixture.calls.projectRequest.worksets[0].items, [
    {
      sourceIndex: 0,
      name: "frame.png",
      flipped: false,
      data: "data:image/png;base64,frame",
    },
  ]);
  assert.equal(fixture.calls.closes, 0);
  assert.equal(fixture.state.busy, false);
});

test("organizer actions forwards sprite-sheet canvases only when requested", async () => {
  const fixture = createFixture();
  fixture.state.confirmApply = true;
  fixture.frame.editedCanvas.width = 32;
  fixture.frame.editedCanvas.height = 24;

  await fixture.controller.exportIncludedFrames({
    confirmed: true,
    formats: { frames: true, spritesheet: true },
  });

  assert.equal(fixture.calls.exported.items[0].image, fixture.frame.editedCanvas);
  assert.equal(fixture.calls.exported.items[0].width, 32);
  assert.deepEqual(fixture.calls.exported.options.formats, { frames: true, spritesheet: true });
});

test("organizer actions forwards cancellation and reports dialog export failures", async () => {
  const fixture = createFixture();
  const abortController = new AbortController();
  fixture.state.exportError = new Error("encoding failed");

  await assert.rejects(
    fixture.controller.exportIncludedFrames({
      confirmed: true,
      formats: { gif: true },
      signal: abortController.signal,
    }),
    /encoding failed/,
  );

  assert.equal(fixture.calls.exported.options.signal, abortController.signal);
  assert.equal(fixture.calls.status.at(-1), "failed");
  assert.equal(fixture.state.busy, false);
});

test("organizer actions reject an unknown cutout target without side effects", async () => {
  const fixture = createFixture();
  await fixture.controller.editImportCutout({ uid: "missing" });
  assert.deepEqual(fixture.calls.status, ["cutoutNeedFrames"]);
  assert.equal(fixture.calls.reloads, 0);
});

test("organizer batch cutout opens included frames with the automatic removal profile", async () => {
  const fixture = createFixture();

  await fixture.controller.editBatchCutout();

  const [workset] = fixture.calls.cutoutWorksets;
  assert.equal(workset.mode, "batch");
  assert.equal(workset.autoDetectBackground, true);
  assert.equal(workset.items.length, 1);
  assert.deepEqual(workset.processingParameters, {
    backgroundColor: "#ffffff",
    connected: false,
    perceptual: false,
    tolerance: -1,
    feather: 0,
    alphaThreshold: 0,
    chromaFeather: 0,
    edgeBoost: 10,
    blendStrength: 100,
    blendMode: "blend",
    alphaLow: 0,
    alphaHigh: 0,
    despillStrength: 100,
    despillMode: "general",
    edgeDespillRadius: 0,
    edgeRecoveryStrength: 0,
    backgroundRadius: 0,
    blurRadius: 0,
    protectionTolerance: 0,
  });
});

test("organizer single-frame cutout forwards the last applied parameter state", async () => {
  const fixture = createFixture();
  fixture.frame.cutoutState = {
    processingParameters: { tolerance: -1, blendStrength: 100, despillStrength: 100 },
    backgroundSamples: [{ r: 2, g: 4, b: 6, a: 255 }],
  };

  await fixture.controller.editImportCutout(fixture.frame);

  assert.equal(fixture.calls.cutoutWorksets[0].mode, "single");
  assert.equal(fixture.calls.cutoutWorksets[0].items[0].cutoutState, fixture.frame.cutoutState);
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
