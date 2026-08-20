"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { calculateSelection, createController } = require("../animation_tuner/public/frame_organizer_video");

test("video selection normalizes range, FPS, and output dimensions", () => {
  assert.deepEqual(
    calculateSelection({
      duration: 10,
      width: 4096,
      height: 2048,
      start: -2,
      end: 3.5,
      fps: 12.4,
    }),
    {
      start: 0,
      end: 3.5,
      fps: 12,
      count: 42,
      pixelCount: 42 * 2048 * 1024,
      width: 2048,
      height: 1024,
    },
  );
});

test("ORG-005 video extract FPS clamps 0 to 1, 121 to 60, and rejects non-numeric", () => {
  const base = { duration: 2, width: 64, height: 64, start: 0, end: 1 };
  assert.equal(calculateSelection({ ...base, fps: 0 }).fps, 1);
  assert.equal(calculateSelection({ ...base, fps: 121 }).fps, 60);
  assert.equal(calculateSelection({ ...base, fps: "abc" }).fps, 1);

  const { controller, elements } = createExtractFixture();
  elements.organizerVideoFpsNumber.value = "0";
  controller.syncControls("fps");
  assert.equal(elements.organizerVideoFpsNumber.value, "1");

  elements.organizerVideoFpsNumber.value = "121";
  controller.syncControls("fps");
  assert.equal(elements.organizerVideoFpsNumber.value, "60");

  elements.organizerVideoFpsNumber.value = "nope";
  controller.syncControls("fps");
  const clamped = Number(elements.organizerVideoFpsNumber.value);
  assert.ok(Number.isFinite(clamped));
  assert.ok(clamped >= 1 && clamped <= 60);
  assert.notEqual(elements.organizerVideoFpsNumber.value, "nope");
});

test("video selection returns an empty count for reversed or missing ranges", () => {
  assert.equal(
    calculateSelection({ duration: 5, width: 1920, height: 1080, start: 4, end: 2, fps: 30 }).count,
    0,
  );
  assert.equal(calculateSelection({ duration: 0, width: 0, height: 0, start: 0, end: 0, fps: 0 }).count, 0);
});

test("video controller rejects missing integration dependencies", () => {
  assert.throws(() => createController(), /dependencies are required/);
  assert.throws(() => createController({ elements: {} }), /dependencies are required/);
});

/**
 * Records listeners so tests can click Cancel / X / overlay.
 * @returns {{addEventListener:Function,click:Function,pointerdown:Function}}
 */
function createClickTarget() {
  const listeners = {};
  return {
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    click(event = {}) {
      for (const handler of listeners.click || []) handler(event);
    },
    pointerdown(event) {
      for (const handler of listeners.pointerdown || []) handler(event);
    },
  };
}

/**
 * Builds a video-extract fixture that records whether the last grid paint was idle.
 * @param {{holdSeeks?:boolean}} [options] When true, seeked handlers wait until releaseSeeks().
 * @returns {{
 *   controller:ReturnType<typeof createController>,
 *   state:Record<string,any>,
 *   gridBusySnapshots:boolean[],
 *   elements:Record<string,any>,
 *   statusMessages:string[],
 *   releaseSeeks:()=>void,
 *   restoreReadyVideo:()=>void
 * }}
 */
function createExtractFixture(options = {}) {
  const gridBusySnapshots = [];
  const statusMessages = [];
  const pendingSeeked = [];
  let holdSeeks = Boolean(options.holdSeeks);
  const state = {
    busy: false,
    videoExtracting: false,
    videoDuration: 0.5,
    videoWidth: 32,
    videoHeight: 32,
    videoFileName: "clip.webm",
    videoUrl: "blob:clip",
    frames: [],
    nextImportBatchIndex: 0,
  };
  const video = {
    currentTime: holdSeeks ? 99 : 0,
    readyState: 2,
    pause() {},
    removeAttribute() {},
    load() {},
    addEventListener(type, handler) {
      if (type !== "seeked") return;
      if (holdSeeks) pendingSeeked.push(handler);
      else queueMicrotask(handler);
    },
    removeEventListener() {},
  };
  const panel = Object.assign(createClickTarget(), { hidden: false });
  const elements = {
    organizerVideoStatus: { textContent: "", dataset: {} },
    organizerVideoStart: { value: "0", addEventListener() {} },
    organizerVideoEnd: { value: "0.5", addEventListener() {} },
    organizerVideoStartRange: { value: "0", max: "", addEventListener() {} },
    organizerVideoEndRange: { value: "0.5", max: "", addEventListener() {} },
    organizerVideoFps: { value: "4", addEventListener() {} },
    organizerVideoFpsNumber: { value: "4", addEventListener() {} },
    organizerVideoDuration: { textContent: "" },
    organizerVideoEstimate: { textContent: "" },
    organizerVideoExtract: Object.assign(createClickTarget(), { disabled: false }),
    organizerVideoElement: video,
    organizerVideoInput: { value: "", files: [], addEventListener() {}, click() {} },
    organizerVideoName: { textContent: "" },
    organizerVideoMeta: { textContent: "" },
    organizerVideoPanel: panel,
    organizerVideoClose: createClickTarget(),
    organizerVideoCancel: createClickTarget(),
    organizerVideoReselect: createClickTarget(),
    organizerApply: { parentElement: { querySelector: () => null } },
  };
  const controller = createController({
    elements,
    state,
    text: (key, variables = {}) => `${key}:${variables.current ?? variables.count ?? ""}`,
    createFrame: (_image, options) => ({ uid: options.name, ...options }),
    renderCounts() {},
    renderGrid() {
      gridBusySnapshots.push(state.busy);
    },
    restartPreview() {},
    setStatus(message) {
      statusMessages.push(String(message || ""));
    },
    document: {
      createElement() {
        return {
          width: 0,
          height: 0,
          getContext() {
            return { drawImage() {} };
          },
        };
      },
    },
    window: {
      setTimeout(handler, delay) {
        if (!delay) handler();
        return 1;
      },
      clearTimeout() {},
    },
    urlApi: { revokeObjectURL() {} },
  });
  return {
    controller,
    state,
    gridBusySnapshots,
    elements,
    statusMessages,
    releaseSeeks() {
      holdSeeks = false;
      const pending = pendingSeeked.splice(0);
      for (const handler of pending) handler();
    },
    restoreReadyVideo() {
      state.videoDuration = 0.5;
      state.videoWidth = 32;
      state.videoHeight = 32;
      state.videoFileName = "clip.webm";
      state.videoUrl = "blob:clip";
      video.currentTime = 0;
      video.readyState = 2;
      elements.organizerVideoPanel.hidden = false;
      elements.organizerVideoStart.value = "0";
      elements.organizerVideoEnd.value = "0.5";
      elements.organizerVideoFps.value = "4";
      elements.organizerVideoFpsNumber.value = "4";
      elements.organizerVideoExtract.disabled = false;
    },
  };
}

test("video extract re-renders the grid after clearing busy so ORG-013 cards can drag", async () => {
  const { controller, state, gridBusySnapshots } = createExtractFixture();

  await controller.extract();

  assert.equal(state.busy, false);
  assert.equal(state.videoExtracting, false);
  assert.equal(state.frames.length, 2);
  assert.ok(gridBusySnapshots.length >= 1);
  assert.equal(
    gridBusySnapshots.at(-1),
    false,
    `last renderGrid ran while busy=${gridBusySnapshots.at(-1)}; idle paint is required`,
  );
});

test("video controller allows selections above the former frame and decoded-pixel budgets", () => {
  const elements = {
    organizerVideoStatus: { textContent: "", dataset: {} },
    organizerVideoStart: { value: "0" },
    organizerVideoEnd: { value: "31" },
    organizerVideoStartRange: { value: "" },
    organizerVideoEndRange: { value: "" },
    organizerVideoFps: { value: "10" },
    organizerVideoFpsNumber: { value: "10" },
    organizerVideoDuration: { textContent: "" },
    organizerVideoEstimate: { textContent: "" },
    organizerVideoExtract: { disabled: true },
  };
  const controller = createController({
    elements,
    state: {
      videoDuration: 31,
      videoWidth: 7680,
      videoHeight: 4320,
      videoExtracting: false,
    },
    text: (key) => key,
  });

  controller.syncControls();

  assert.equal(elements.organizerVideoExtract.disabled, false);
  assert.equal(elements.organizerVideoEstimate.textContent, "310");
  assert.equal(elements.organizerVideoStatus.textContent, "videoLoaded");
});

/**
 * Starts a held extract, dismisses it, then lets seeks finish so an ignored
 * cancel would still commit frames.
 * @param {"close"|"cancel"|"overlay"} dismiss How the user leaves the dialog.
 * @returns {Promise<{state:Record<string,any>,statusMessages:string[],elements:Record<string,any>}>}
 */
async function cancelHeldExtract(dismiss) {
  const fixture = createExtractFixture({ holdSeeks: true });
  fixture.controller.bindEvents();
  const existing = fixture.state.frames.length;
  const done = fixture.controller.extract();
  assert.equal(fixture.state.videoExtracting, true);
  assert.equal(existing, 0);

  if (dismiss === "cancel") fixture.elements.organizerVideoCancel.click();
  else if (dismiss === "overlay") {
    fixture.elements.organizerVideoPanel.pointerdown({
      target: fixture.elements.organizerVideoPanel,
    });
  } else fixture.controller.close();

  assert.equal(
    fixture.elements.organizerVideoPanel.hidden,
    true,
    "cancel must close the extract dialog immediately",
  );
  fixture.releaseSeeks();
  await done;
  return fixture;
}

test("ORG-040 cancel mid-extract closes the dialog and leaves the workset unchanged", async () => {
  const { state, statusMessages } = await cancelHeldExtract("cancel");

  assert.equal(state.frames.length, 0);
  assert.equal(state.videoExtracting, false);
  assert.equal(state.busy, false);
  assert.ok(
    statusMessages.includes("videoCancelled:"),
    `expected cancel status, got: ${statusMessages.join(" | ")}`,
  );
  assert.equal(
    statusMessages.some((message) => message.startsWith("videoImported:")),
    false,
    `cancelled extract still committed: ${statusMessages.join(" | ")}`,
  );
});

test("ORG-040 closing extract via X or overlay aborts the same way as Cancel", async () => {
  for (const dismiss of ["close", "overlay"]) {
    const { state, statusMessages, elements } = await cancelHeldExtract(dismiss);
    assert.equal(state.frames.length, 0, `${dismiss} still appended frames`);
    assert.equal(elements.organizerVideoPanel.hidden, true);
    assert.equal(
      statusMessages.some((message) => message.startsWith("videoImported:")),
      false,
      `${dismiss} still reported videoImported`,
    );
  }
});

test("ORG-040 a later extract on the same video still commits after a cancel", async () => {
  const fixture = createExtractFixture({ holdSeeks: true });
  fixture.controller.bindEvents();
  const cancelled = fixture.controller.extract();
  fixture.elements.organizerVideoCancel.click();
  fixture.releaseSeeks();
  await cancelled;
  assert.equal(fixture.state.frames.length, 0);

  fixture.restoreReadyVideo();
  await fixture.controller.extract();

  assert.equal(fixture.state.frames.length, 2);
  assert.equal(fixture.state.videoExtracting, false);
  assert.ok(fixture.statusMessages.some((message) => message === "videoImported:2"));
});
