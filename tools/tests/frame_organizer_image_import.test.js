"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/frame_organizer_image_import");

/**
 * Creates an importer fixture with deterministic asynchronous image decoding.
 * @param {"filename"|"selection"} [strategy] Initial image ordering strategy.
 * @returns {{controller:ReturnType<typeof createController>,state:object,statuses:Array<object>,revoked:string[]}}
 */
function createFixture(strategy = "filename") {
  const filesByUrl = new Map();
  const revoked = [];
  let nextUrl = 0;
  class FakeImage {
    set src(value) {
      const file = filesByUrl.get(value);
      setTimeout(() => {
        this.width = 2;
        this.height = 2;
        this.onload?.();
      }, file.delay);
    }
  }
  const state = { busy: false, frames: [], importOrderStrategy: strategy, nextImportBatchIndex: 0 };
  const statuses = [];
  const controller = createController({
    elements: {
      organizerGrid: {
        lastElementChild: { scrollIntoView() {} },
      },
    },
    state,
    text: (key, variables = {}) => `${key}:${variables.count ?? variables.failed ?? ""}`,
    imagePixelBudget: {
      totalPixels: (sources) => sources.reduce((total, source) => total + source.width * source.height, 0),
    },
    assertImagePixelBudget: (source, currentPixels = 0) => ({
      totalPixels: currentPixels + source.width * source.height,
    }),
    createFrame: (image, options) => ({ originalCanvas: image, ...options }),
    renderCounts() {},
    renderGrid() {},
    restartPreview() {},
    setStatus: (message, tone) => statuses.push({ message, tone }),
    imageConstructor: FakeImage,
    urlApi: {
      createObjectURL(file) {
        const url = `blob:test-${++nextUrl}`;
        filesByUrl.set(url, file);
        return url;
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
  });
  return { controller, state, statuses, revoked };
}

test("image importer naturally sorts each batch across concurrent decoding", async () => {
  const { controller, state, statuses, revoked } = createFixture();
  const files = [
    { name: "frame_10.png", type: "image/png", size: 10, delay: 8 },
    { name: "frame_2.png", type: "image/png", size: 10, delay: 0 },
  ];

  await controller.importFiles(files);

  assert.deepEqual(
    state.frames.map((frame) => frame.name),
    ["frame_2.png", "frame_10.png"],
  );
  assert.deepEqual(
    state.frames.map((frame) => [
      frame.importBatchIndex,
      frame.importSelectionIndex,
      frame.importFilenameIndex,
    ]),
    [
      [0, 1, 0],
      [0, 0, 1],
    ],
  );
  assert.equal(state.busy, false);
  assert.equal(revoked.length, 2);
  assert.deepEqual(statuses.at(-1), { message: "imported:2", tone: "success" });
});

test("image importer preserves selection order and appends later batches", async () => {
  const { controller, state } = createFixture("selection");

  await controller.importFiles([
    { name: "frame_10.png", type: "image/png", size: 10, delay: 4 },
    { name: "frame_2.png", type: "image/png", size: 10, delay: 0 },
  ]);
  await controller.importFiles([
    { name: "frame_20.png", type: "image/png", size: 10, delay: 0 },
    { name: "frame_1.png", type: "image/png", size: 10, delay: 0 },
  ]);

  assert.deepEqual(
    state.frames.map((frame) => frame.name),
    ["frame_10.png", "frame_2.png", "frame_20.png", "frame_1.png"],
  );
  assert.deepEqual(
    state.frames.map((frame) => frame.importBatchIndex),
    [0, 0, 1, 1],
  );
});

test("image importer rejects unsupported files without entering busy state", async () => {
  const { controller, state, statuses } = createFixture();

  await controller.importFiles([{ name: "notes.txt", type: "text/plain", size: 10, delay: 0 }]);

  assert.equal(state.busy, false);
  assert.deepEqual(state.frames, []);
  assert.deepEqual(statuses.at(-1), { message: "importInvalid:", tone: "error" });
});
