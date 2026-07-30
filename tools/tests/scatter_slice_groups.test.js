"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createGroupedGridPlan, groupBoxesByRows } = require("../animation_tuner/public/scatter_slice_groups");

/**
 * Creates a minimal detection box for grouping tests.
 * @param {number} x Horizontal position.
 * @param {number} y Vertical position.
 * @param {number} [w] Width.
 * @param {number} [h] Height.
 * @returns {{x:number,y:number,w:number,h:number,pixels:number}} Detection box.
 */
function box(x, y, w = 12, h = 24) {
  return { x, y, w, h, pixels: w * h };
}

test("row grouping tolerates small vertical offsets and sorts frames left to right", () => {
  const upperRight = box(48, 8, 12, 32);
  const lowerLeft = box(3, 78, 12, 25);
  const upperLeft = box(4, 12, 12, 26);
  const lowerRight = box(42, 82, 12, 23);
  const groups = groupBoxesByRows([lowerRight, upperRight, lowerLeft, upperLeft]);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["row-1", "row-2"],
  );
  assert.deepEqual(groups[0].boxes, [upperLeft, upperRight]);
  assert.deepEqual(groups[1].boxes, [lowerLeft, lowerRight]);
});

test("row grouping keeps vertically separate animation rows independent", () => {
  const groups = groupBoxesByRows([box(0, 0, 18, 18), box(0, 42, 18, 18), box(0, 84, 18, 18)]);

  assert.deepEqual(
    groups.map((group) => group.boxes.length),
    [1, 1, 1],
  );
});

test("grouped grid plan starts every animation group on a fresh output row", () => {
  assert.deepEqual(createGroupedGridPlan([3, 5], 4), {
    columns: 4,
    rowCount: 3,
    rows: [
      { groupIndex: 0, startIndex: 0, count: 3, row: 0 },
      { groupIndex: 1, startIndex: 0, count: 4, row: 1 },
      { groupIndex: 1, startIndex: 4, count: 1, row: 2 },
    ],
  });
});

test("grouped grid plan handles empty groups and invalid column input safely", () => {
  assert.deepEqual(createGroupedGridPlan([], 8), { columns: 0, rowCount: 0, rows: [] });
  assert.deepEqual(createGroupedGridPlan([0, 2], Number.NaN), {
    columns: 1,
    rowCount: 2,
    rows: [
      { groupIndex: 1, startIndex: 0, count: 1, row: 0 },
      { groupIndex: 1, startIndex: 1, count: 1, row: 1 },
    ],
  });
});

test("row grouping rejects non-array input", () => {
  assert.throws(() => groupBoxesByRows(null), /boxes/);
  assert.throws(() => createGroupedGridPlan(null, 8), /groupLengths/);
});
