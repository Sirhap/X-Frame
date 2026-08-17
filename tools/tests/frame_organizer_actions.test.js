"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createController,
  partitionFramesByPixelBudget,
} = require("../animation_tuner/public/frame_organizer_actions");
const { REGULAR_AUTO_BACKGROUND_PARAMETERS } = require("../animation_tuner/public/smart_cutout_defaults");

/** Creates the small host fixture needed to exercise organizer actions. */
function createFixture() {
  const frame = {
    uid: "frame-1",
    name: "frame.png",
    editedCanvas: { width: 16, height: 16, toDataURL: () => "data:image/png;base64,frame" },
    sourceIndex: 0,
    sourcePath: "frame.png",
    imported: true,
    assetRevision: 1,
    flipped: false,
    thumbnails: { edited: "" },
  };
  const state = {
    frames: [frame],
    mode: "edit",
    animationName: "demo",
    busy: false,
    previewTimer: 0,
    viewMode: "edited",
  };
  const calls = {
    assets: null,
    exported: null,
    animation: null,
    animations: [],
    sessionAnimation: null,
    sessionAnimations: [],
    imageCanvases: 0,
    grids: 0,
    status: [],
    counts: 0,
    reloads: 0,
    languages: 0,
    closes: 0,
    cutoutWorksets: [],
    autoCutoutWorksets: [],
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
        return state.cutoutOutputsByCall?.shift?.() || state.cutoutOutputs || null;
      },
      autoCutout: async (workset) => {
        calls.autoCutoutWorksets.push(workset);
        const steps =
          state.liveCutoutOutputSteps || (state.liveCutoutOutputs ? [state.liveCutoutOutputs] : []);
        for (const step of steps) await workset.onLiveApply?.(step);
        return state.cutoutOutputsByCall?.shift?.() || state.cutoutOutputs || null;
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
        calls.animations.push({ metadata, items });
      },
      createSessionAnimation: async (metadata, items) => {
        if (state.createError) throw state.createError;
        calls.sessionAnimation = { metadata, items };
        calls.sessionAnimations.push({ metadata, items });
      },
    },
    text: (key) => key,
    includedFrames: () => state.frames,
    imageCanvas: (source) => {
      calls.imageCanvases += 1;
      return source;
    },
    renderGrid: () => {
      calls.grids += 1;
    },
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
  assert.deepEqual(
    fixture.calls.exported.items.map(
      ({ name, flipped, data, width, height, durationMs, frameId, assetRevision }) => ({
        name,
        flipped,
        data,
        width,
        height,
        durationMs,
        frameId,
        assetRevision,
      }),
    ),
    [
      {
        name: "frame.png",
        flipped: false,
        data: "data:image/png;base64,frame",
        width: 16,
        height: 16,
        durationMs: 83,
        frameId: "frame-1",
        assetRevision: 1,
      },
    ],
  );
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

test("direct batch cutout applies live partial outputs before the batch finishes", async () => {
  const fixture = createFixture();
  const second = {
    ...fixture.frame,
    uid: "frame-2",
    name: "frame-2.png",
    hasEditedResult: false,
    thumbnails: { edited: "" },
  };
  fixture.frame.hasEditedResult = false;
  fixture.state.frames = [fixture.frame, second];
  fixture.state.viewMode = "original";
  fixture.state.liveCutoutOutputs = [
    { frame: { uid: fixture.frame.uid }, canvas: fixture.frame.editedCanvas },
  ];
  fixture.state.cutoutOutputs = [
    { frame: { uid: fixture.frame.uid }, canvas: fixture.frame.editedCanvas },
    { frame: { uid: second.uid }, canvas: second.editedCanvas },
  ];

  await fixture.controller.editBatchCutout();

  assert.equal(fixture.frame.hasEditedResult, true);
  assert.equal(second.hasEditedResult, true);
  assert.equal(fixture.state.viewMode, "edited");
  assert.ok(fixture.calls.status.some((message) => message === "cutoutFrameProgress"));
});

test("live cutout progress rewrites each frame once instead of the whole applied prefix", async () => {
  const fixture = createFixture();
  fixture.frame.hasEditedResult = false;
  const frames = [fixture.frame];
  for (const uid of ["frame-2", "frame-3", "frame-4"]) {
    frames.push({
      ...fixture.frame,
      uid,
      name: `${uid}.png`,
      hasEditedResult: false,
      assetRevision: 1,
      thumbnails: { edited: "" },
    });
  }
  fixture.state.frames = frames;
  fixture.state.viewMode = "original";
  const outputs = frames.map((frame) => ({
    frame: { uid: frame.uid },
    canvas: frame.editedCanvas,
  }));
  fixture.state.liveCutoutOutputSteps = outputs.map((_, index) => outputs.slice(0, index + 1));
  fixture.state.cutoutOutputs = outputs;

  await fixture.controller.editBatchCutout();

  assert.equal(fixture.calls.imageCanvases, frames.length);
  assert.deepEqual(
    frames.map((frame) => frame.assetRevision),
    frames.map(() => 2),
  );
  assert.equal(fixture.calls.grids, frames.length + 1);
  assert.equal(fixture.calls.status.at(-1), "cutoutReady");
});

test("organizer smart cutout directly processes included frames with the automatic removal profile", async () => {
  const fixture = createFixture();
  fixture.state.viewMode = "original";
  fixture.state.cutoutOutputs = [{ frame: { uid: fixture.frame.uid }, canvas: fixture.frame.editedCanvas }];

  await fixture.controller.editBatchCutout();

  assert.equal(fixture.calls.cutoutWorksets.length, 0);
  const [workset] = fixture.calls.autoCutoutWorksets;
  assert.equal(workset.mode, "batch");
  assert.equal(workset.autoDetectBackground, true);
  assert.equal(workset.items.length, 1);
  assert.equal(fixture.frame.hasEditedResult, true);
  assert.equal(fixture.state.viewMode, "edited");
  // Compare against the shared profile instead of restating it: a second copy
  // of the table hides the case where the profile itself becomes a no-op.
  assert.deepEqual(workset.processingParameters, { ...REGULAR_AUTO_BACKGROUND_PARAMETERS });
});

test("organizer cutout partitions decoded pixels without reordering frames", () => {
  const frames = [
    { uid: "a", editedCanvas: { width: 4_000, height: 4_000 } },
    { uid: "b", editedCanvas: { width: 4_000, height: 4_000 } },
    { uid: "c", editedCanvas: { width: 4_000, height: 4_000 } },
    { uid: "d", editedCanvas: { width: 4_000, height: 4_000 } },
    { uid: "e", editedCanvas: { width: 4_000, height: 4_000 } },
  ];

  const batches = partitionFramesByPixelBudget(frames, 64_000_000);

  assert.deepEqual(
    batches.map((batch) => batch.map((frame) => frame.uid)),
    [["a", "b", "c", "d"], ["e"]],
  );
});

test("organizer smart cutout processes large worksets as sequential pixel-safe batches", async () => {
  const fixture = createFixture();
  fixture.state.frames = Array.from({ length: 5 }, (_, index) => ({
    ...fixture.frame,
    uid: `frame-${index + 1}`,
    name: `frame-${index + 1}.png`,
    editedCanvas: { width: 4_000, height: 4_000 },
    thumbnails: { edited: "" },
  }));
  fixture.state.cutoutOutputsByCall = [
    fixture.state.frames
      .slice(0, 4)
      .map((frame) => ({ frame: { uid: frame.uid }, canvas: frame.editedCanvas })),
    fixture.state.frames.slice(4).map((frame) => ({ frame: { uid: frame.uid }, canvas: frame.editedCanvas })),
  ];

  await fixture.controller.editBatchCutout();

  assert.equal(fixture.calls.autoCutoutWorksets.length, 2);
  assert.deepEqual(
    fixture.calls.autoCutoutWorksets.map((workset) => workset.items.map((item) => item.frame.uid)),
    [["frame-1", "frame-2", "frame-3", "frame-4"], ["frame-5"]],
  );
  assert.ok(fixture.state.frames.every((frame) => frame.hasEditedResult));
});

test("organizer single-frame cutout forwards the last applied parameter state", async () => {
  const fixture = createFixture();
  fixture.state.viewMode = "original";
  fixture.state.cutoutOutputs = [{ frame: { uid: fixture.frame.uid }, canvas: fixture.frame.editedCanvas }];
  fixture.frame.cutoutState = {
    processingParameters: { tolerance: -1, blendStrength: 100, despillStrength: 100 },
    backgroundSamples: [{ r: 2, g: 4, b: 6, a: 255 }],
  };

  await fixture.controller.editImportCutout(fixture.frame);

  assert.equal(fixture.calls.cutoutWorksets[0].mode, "single");
  assert.equal(fixture.calls.cutoutWorksets[0].items.length, 1);
  assert.equal(fixture.calls.cutoutWorksets[0].items[0].cutoutState, fixture.frame.cutoutState);
  assert.equal(fixture.state.viewMode, "edited");
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
        frameId: "frame-1",
        assetRevision: 1,
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

test("scatter imports create one transient animation per source group by default", async () => {
  const fixture = createFixture();
  fixture.state.mode = "import";
  fixture.state.confirmApply = true;
  fixture.state.frames = [
    { ...fixture.frame, uid: "idle-1", groupId: "idle", groupName: "Idle" },
    {
      ...fixture.frame,
      uid: "run-1",
      name: "run.png",
      groupId: "run",
      groupName: "Run",
    },
  ];
  fixture.state.importMetadata = {
    projectId: "browser-session",
    profileLabel: "Hero",
    animationName: "hero",
    creationMode: "groups",
  };

  await fixture.controller.applyPlan();

  assert.deepEqual(
    fixture.calls.animations.map(({ metadata, items }) => [metadata.animationName, items.length]),
    [
      ["Idle", 1],
      ["Run", 1],
    ],
  );
  assert.equal(fixture.calls.closes, 1);
});

test("scatter imports can explicitly merge source groups into one animation", async () => {
  const fixture = createFixture();
  fixture.state.mode = "import";
  fixture.state.confirmApply = true;
  fixture.state.frames = [
    { ...fixture.frame, uid: "idle-1", groupId: "idle", groupName: "Idle" },
    { ...fixture.frame, uid: "run-1", groupId: "run", groupName: "Run" },
  ];
  fixture.state.importMetadata = {
    projectId: "browser-session",
    profileLabel: "Hero",
    animationName: "hero-combined",
    creationMode: "merge",
  };

  await fixture.controller.applyPlan();

  assert.equal(fixture.calls.animations.length, 1);
  assert.equal(fixture.calls.animations[0].metadata.animationName, "hero-combined");
  assert.equal(fixture.calls.animations[0].items.length, 2);
});
