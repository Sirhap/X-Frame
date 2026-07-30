"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createBoxFromPoints,
  hitTestBoxes,
  moveBox,
  normalizeBox,
  pointFromClient,
  resizeBox,
  selectedGroupIdsAfterRegroup,
  selectionAfterDelete,
} = require("../animation_tuner/public/scatter_slice_editor_core");

const bounds = Object.freeze({ width: 30, height: 24 });
const box = Object.freeze({ x: 5, y: 5, w: 10, h: 8, pixels: 80 });

test("new slices support reverse dragging and remain inside the source", () => {
  assert.deepEqual(createBoxFromPoints({ x: 20, y: 18 }, { x: 4, y: 3 }, bounds), {
    x: 4,
    y: 3,
    w: 16,
    h: 15,
    pixels: 240,
  });
  assert.deepEqual(createBoxFromPoints({ x: 29, y: 23 }, { x: 50, y: 40 }, bounds), {
    x: 29,
    y: 23,
    w: 1,
    h: 1,
    pixels: 1,
  });
});

test("moving a slice preserves its size and clamps it to source bounds", () => {
  assert.deepEqual(moveBox({ x: 8, y: 5, w: 4, h: 3, pixels: 12 }, 10, -20, { width: 12, height: 10 }), {
    x: 8,
    y: 0,
    w: 4,
    h: 3,
    pixels: 12,
  });
});

test("normalizing a slice rejects invalid bounds and clamps rectangle values", () => {
  assert.deepEqual(normalizeBox({ x: -4, y: 23, w: 100, h: 0 }, bounds), {
    x: 0,
    y: 23,
    w: 30,
    h: 1,
    pixels: 30,
  });
  assert.throws(() => normalizeBox(box, { width: 0, height: 24 }), /bounds/);
});

test("all resize handles change only their owned edges", () => {
  const cases = [
    ["n", 2, -2, { x: 5, y: 3, w: 10, h: 10, pixels: 100 }],
    ["ne", 4, -2, { x: 5, y: 3, w: 14, h: 10, pixels: 140 }],
    ["e", 4, -2, { x: 5, y: 5, w: 14, h: 8, pixels: 112 }],
    ["se", 4, 3, { x: 5, y: 5, w: 14, h: 11, pixels: 154 }],
    ["s", 4, 3, { x: 5, y: 5, w: 10, h: 11, pixels: 110 }],
    ["sw", -3, 3, { x: 2, y: 5, w: 13, h: 11, pixels: 143 }],
    ["w", -3, 3, { x: 2, y: 5, w: 13, h: 8, pixels: 104 }],
    ["nw", -3, -2, { x: 2, y: 3, w: 13, h: 10, pixels: 130 }],
  ];

  cases.forEach(([handle, dx, dy, expected]) => {
    assert.deepEqual(resizeBox(box, handle, dx, dy, bounds), expected, handle);
  });
});

test("resizing cannot cross the opposite edge or leave the source", () => {
  assert.deepEqual(resizeBox(box, "nw", 50, 50, bounds), {
    x: 14,
    y: 12,
    w: 1,
    h: 1,
    pixels: 1,
  });
  assert.deepEqual(resizeBox(box, "se", 50, 50, bounds), {
    x: 5,
    y: 5,
    w: 25,
    h: 19,
    pixels: 475,
  });
});

test("client coordinates map to source pixels", () => {
  assert.deepEqual(
    pointFromClient(
      { x: 60, y: 45 },
      { left: 10, top: 5, width: 100, height: 80 },
      { width: 200, height: 160 },
    ),
    { x: 100, y: 80 },
  );
});

test("selected resize handles win hit testing before box movement", () => {
  assert.deepEqual(hitTestBoxes([box], { x: 15, y: 9 }, 0, 2), {
    index: 0,
    action: "resize",
    handle: "e",
  });
  assert.deepEqual(hitTestBoxes([box], { x: 8, y: 8 }, 0, 2), {
    index: 0,
    action: "move",
  });
  assert.equal(hitTestBoxes([box], { x: 29, y: 20 }, 0, 2), null);
});

test("overlapping handles select the nearest resize direction on small slices", () => {
  assert.deepEqual(hitTestBoxes([box], { x: 15, y: 9 }, 0, 6), {
    index: 0,
    action: "resize",
    handle: "e",
  });
  assert.deepEqual(hitTestBoxes([box], { x: 15, y: 13 }, 0, 6), {
    index: 0,
    action: "resize",
    handle: "se",
  });
});

test("regrouping never enables boxes that were previously excluded", () => {
  const first = { x: 0, y: 0, w: 4, h: 4 };
  const second = { x: 8, y: 0, w: 4, h: 4 };
  const groups = [{ id: "row-1", boxes: [first, second] }];

  assert.deepEqual(selectedGroupIdsAfterRegroup(groups, new Set([first, second])), ["row-1"]);
  assert.deepEqual(selectedGroupIdsAfterRegroup(groups, new Set([first])), []);
});

test("deletion chooses the next slice then falls back to the previous slice", () => {
  assert.equal(selectionAfterDelete(3, 0), 0);
  assert.equal(selectionAfterDelete(3, 1), 1);
  assert.equal(selectionAfterDelete(3, 2), 1);
  assert.equal(selectionAfterDelete(1, 0), null);
  assert.throws(() => selectionAfterDelete(2, 2), /deletedIndex/);
});
