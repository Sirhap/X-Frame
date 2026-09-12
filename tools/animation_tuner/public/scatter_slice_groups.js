(function attachScatterSliceGroups(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameScatterSliceGroups = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * @typedef {object} SliceBox
   * @property {number} x
   * @property {number} y
   * @property {number} w
   * @property {number} h
   */

  /**
   * @typedef {object} SliceGroup
   * @property {string} id
   * @property {SliceBox[]} boxes
   */

  /**
   * Returns the vertical center of one detection box.
   * @param {SliceBox} box Detection box.
   * @returns {number} Vertical center coordinate.
   */
  function verticalCenter(box) {
    return box.y + box.h / 2;
  }

  /**
   * Measures how confidently a box belongs to an existing visual row.
   * @param {SliceBox} box Candidate box.
   * @param {{boxes:SliceBox[],centerTotal:number,heightTotal:number}} row Row accumulator.
   * @returns {number|null} Match score, or null when the rows are separate.
   */
  function rowMatchScore(box, row) {
    const averageCenter = row.centerTotal / row.boxes.length;
    const averageHeight = row.heightTotal / row.boxes.length;
    const centerDistance = Math.abs(verticalCenter(box) - averageCenter);
    const centerTolerance = Math.max(8, Math.min(box.h, averageHeight) * 0.55);
    const rowTop = Math.min(...row.boxes.map((item) => item.y));
    const rowBottom = Math.max(...row.boxes.map((item) => item.y + item.h));
    const overlap = Math.max(0, Math.min(box.y + box.h, rowBottom) - Math.max(box.y, rowTop));
    const overlapRatio = overlap / Math.max(1, Math.min(box.h, averageHeight));
    if (overlapRatio < 0.2 && centerDistance > centerTolerance) return null;
    return overlapRatio * 2 - centerDistance / Math.max(1, centerTolerance);
  }

  /**
   * Groups detection boxes into visual rows while preserving box object identity.
   * @param {SliceBox[]} boxes Detection boxes.
   * @returns {SliceGroup[]} Top-to-bottom groups with left-to-right frames.
   */
  function groupBoxesByRows(boxes) {
    if (!Array.isArray(boxes)) throw new TypeError("boxes 必须是数组");
    const ordered = [...boxes].sort((first, second) => {
      const centerDifference = verticalCenter(first) - verticalCenter(second);
      return Math.abs(centerDifference) > 4 ? centerDifference : first.x - second.x;
    });
    const rows = [];

    ordered.forEach((box) => {
      let target = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      rows.forEach((row) => {
        const score = rowMatchScore(box, row);
        if (score !== null && score > bestScore) {
          bestScore = score;
          target = row;
        }
      });
      if (!target) {
        rows.push({ boxes: [box], centerTotal: verticalCenter(box), heightTotal: box.h });
        return;
      }
      target.boxes.push(box);
      target.centerTotal += verticalCenter(box);
      target.heightTotal += box.h;
    });

    return rows
      .sort(
        (first, second) => first.centerTotal / first.boxes.length - second.centerTotal / second.boxes.length,
      )
      .map((row, index) => ({
        id: `row-${index + 1}`,
        boxes: row.boxes.sort((first, second) => first.x - second.x || first.y - second.y),
      }));
  }

  /**
   * Plans grouped sprite-sheet rows without allowing adjacent groups to share a row.
   * @param {number[]} groupLengths Number of frames in each selected group.
   * @param {number} maximumColumns Maximum frames per output row.
   * @returns {{columns:number,rowCount:number,rows:Array<{groupIndex:number,startIndex:number,count:number,row:number}>}} Grid plan.
   */
  function createGroupedGridPlan(groupLengths, maximumColumns) {
    if (!Array.isArray(groupLengths)) throw new TypeError("groupLengths 必须是数组");
    const safeLengths = groupLengths.map((length) => Math.max(0, Math.floor(Number(length) || 0)));
    const largestGroup = Math.max(0, ...safeLengths);
    if (largestGroup === 0) return { columns: 0, rowCount: 0, rows: [] };
    const columns = Math.max(1, Math.min(largestGroup, Math.floor(Number(maximumColumns) || 1)));
    const rows = [];
    safeLengths.forEach((length, groupIndex) => {
      for (let startIndex = 0; startIndex < length; startIndex += columns) {
        rows.push({
          groupIndex,
          startIndex,
          count: Math.min(columns, length - startIndex),
          row: rows.length,
        });
      }
    });
    return { columns, rowCount: rows.length, rows };
  }

  return Object.freeze({ createGroupedGridPlan, groupBoxesByRows });
});
