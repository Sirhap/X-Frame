"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const connectivity = require("../animation_tuner/public/batch_cutout_connectivity_core.js");
const batchCore = require("../animation_tuner/public/batch_cutout_core.js");

test("batch cutout core forwards connectivity helper identities", () => {
  for (const name of [
    "chamfer345Distance",
    "chamferDistanceToTransparent",
    "connectedCandidateMask",
    "connectedRemovalMask",
    "isWithinConnectivityTolerance",
  ]) {
    assert.strictEqual(batchCore[name], connectivity[name]);
  }
});

test("connectivity helpers preserve flood-fill and chamfer semantics", () => {
  const candidates = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
  assert.deepEqual([...connectivity.connectedCandidateMask(candidates, 3, 3)], [1, 1, 1, 1, 0, 1, 1, 1, 1]);

  const source = new Uint8ClampedArray(3 * 3 * 4);
  for (let pixel = 0; pixel < 9; pixel += 1) {
    const offset = pixel * 4;
    source[offset] = 0;
    source[offset + 1] = 255;
    source[offset + 2] = 0;
    source[offset + 3] = 255;
  }
  const centerOffset = 4 * 4;
  source[centerOffset] = 255;
  source[centerOffset + 1] = 0;
  source[centerOffset + 2] = 0;
  assert.deepEqual(
    [...connectivity.connectedRemovalMask(source, 3, 3, { r: 0, g: 255, b: 0 }, 1)],
    [1, 1, 1, 1, 0, 1, 1, 1, 1],
  );

  const transparent = new Uint8ClampedArray(source);
  transparent[centerOffset + 3] = 0;
  assert.deepEqual(
    [...connectivity.chamferDistanceToTransparent(transparent, 3, 3)],
    [4, 3, 4, 3, 0, 3, 4, 3, 4],
  );
  assert.deepEqual(
    [...connectivity.chamfer345Distance(Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]), 3, 3)],
    [4, 3, 4, 3, 0, 3, 4, 3, 4],
  );
});

test("connectivity tolerance validates dimensions and threshold", () => {
  const mask = Uint8Array.from([0, 1]);
  assert.equal(connectivity.isWithinConnectivityTolerance(mask, Int16Array.from([10, 9]), 2, 1), true);
  assert.equal(connectivity.isWithinConnectivityTolerance(mask, Int16Array.from([10, 10]), 2, 1), false);
  assert.equal(connectivity.isWithinConnectivityTolerance(mask, Int16Array.from([10]), 2, 1), false);
});
