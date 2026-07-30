"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ORDER_STRATEGIES,
  SOURCE_TYPES,
  compareNaturalNames,
  createFrameOrderMetadata,
  nextImportBatchIndex,
  orderImageBatch,
  restoreImportOrder,
} = require("../animation_tuner/public/frame_sequence_order");

test("natural filename comparison handles numbers, Unicode normalization, and stable duplicates", () => {
  assert.ok(compareNaturalNames("frame_2.png", "frame_10.png") < 0);
  assert.equal(compareNaturalNames("ＦＲＡＭＥ_2.png", "frame_2.png"), 0);
  assert.ok(compareNaturalNames("frame_0002.png", "frame_2.png") > 0);
  assert.ok(
    compareNaturalNames("frame_999999999999999999999999.png", "frame_1000000000000000000000000.png") < 0,
  );

  const files = [
    { name: "same.png", id: "first" },
    { name: "same.png", id: "second" },
  ];
  assert.deepEqual(
    orderImageBatch(files).map(({ item }) => item.id),
    ["first", "second"],
  );
});

test("image batches support natural filename and FileList selection strategies", () => {
  const files = [{ name: "frame_10.png" }, { name: "frame_2.png" }, { name: "frame_1.png" }];
  const filename = orderImageBatch(files, ORDER_STRATEGIES.FILENAME);
  const selection = orderImageBatch(files, ORDER_STRATEGIES.SELECTION);

  assert.deepEqual(
    filename.map(({ item }) => item.name),
    ["frame_1.png", "frame_2.png", "frame_10.png"],
  );
  assert.deepEqual(
    selection.map(({ item }) => item.name),
    ["frame_10.png", "frame_2.png", "frame_1.png"],
  );
  assert.deepEqual(
    filename.map(({ selectionIndex }) => selectionIndex),
    [2, 1, 0],
  );
});

test("restore keeps Manifest order, appends batches, and never filename-sorts video", () => {
  const manifest = (index) => ({
    id: `manifest-${index}`,
    sourceIndex: index,
    ...createFrameOrderMetadata({ sourceType: SOURCE_TYPES.MANIFEST, selectionIndex: index }),
  });
  const imported = (id, sourceType, batchIndex, selectionIndex, filenameIndex) => ({
    id,
    imported: true,
    ...createFrameOrderMetadata({ sourceType, batchIndex, selectionIndex, filenameIndex }),
  });
  const shuffled = [
    imported("image-b1-file-2", SOURCE_TYPES.IMAGE, 1, 0, 1),
    manifest(1),
    imported("video-b2-frame-2", SOURCE_TYPES.VIDEO, 2, 1, 0),
    imported("image-b0-file-1", SOURCE_TYPES.IMAGE, 0, 1, 0),
    manifest(0),
    imported("video-b2-frame-1", SOURCE_TYPES.VIDEO, 2, 0, 1),
    imported("image-b1-file-1", SOURCE_TYPES.IMAGE, 1, 1, 0),
    imported("image-b0-file-2", SOURCE_TYPES.IMAGE, 0, 0, 1),
  ];

  assert.deepEqual(
    restoreImportOrder(shuffled, ORDER_STRATEGIES.FILENAME).map(({ id }) => id),
    [
      "manifest-0",
      "manifest-1",
      "image-b0-file-1",
      "image-b0-file-2",
      "image-b1-file-1",
      "image-b1-file-2",
      "video-b2-frame-1",
      "video-b2-frame-2",
    ],
  );
  assert.deepEqual(
    restoreImportOrder(shuffled, ORDER_STRATEGIES.SELECTION).map(({ id }) => id),
    [
      "manifest-0",
      "manifest-1",
      "image-b0-file-2",
      "image-b0-file-1",
      "image-b1-file-2",
      "image-b1-file-1",
      "video-b2-frame-1",
      "video-b2-frame-2",
    ],
  );
  assert.equal(nextImportBatchIndex(shuffled), 3);
});

test("restore tolerates legacy records and returns a shallow copy", () => {
  const frames = [
    { id: "import", imported: true },
    { id: "second", sourceIndex: 1 },
    { id: "first", originalIndex: 0 },
  ];
  const restored = restoreImportOrder(frames);

  assert.notEqual(restored, frames);
  assert.deepEqual(
    restored.map(({ id }) => id),
    ["first", "second", "import"],
  );
});
