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
 * Builds a video-extract fixture that records whether the last grid paint was idle.
 * @returns {{
 *   controller:ReturnType<typeof createController>,
 *   state:Record<string,any>,
 *   gridBusySnapshots:boolean[],
 *   elements:Record<string,any>
 * }}
 */
function createExtractFixture() {
  const gridBusySnapshots = [];
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
    currentTime: 0,
    readyState: 2,
    pause() {},
    removeAttribute() {},
    load() {},
    addEventListener(type, handler) {
      if (type === "seeked") queueMicrotask(handler);
    },
    removeEventListener() {},
  };
  const elements = {
    organizerVideoStatus: { textContent: "", dataset: {} },
    organizerVideoStart: { value: "0" },
    organizerVideoEnd: { value: "0.5" },
    organizerVideoStartRange: { value: "0", max: "" },
    organizerVideoEndRange: { value: "0.5", max: "" },
    organizerVideoFps: { value: "4" },
    organizerVideoFpsNumber: { value: "4" },
    organizerVideoDuration: { textContent: "" },
    organizerVideoEstimate: { textContent: "" },
    organizerVideoExtract: { disabled: false },
    organizerVideoElement: video,
    organizerVideoInput: { value: "" },
    organizerVideoName: { textContent: "" },
    organizerVideoMeta: { textContent: "" },
    organizerVideoPanel: { hidden: false },
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
    setStatus() {},
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
  return { controller, state, gridBusySnapshots, elements };
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
