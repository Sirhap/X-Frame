"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  advanceTrackingState,
  createTrackingState,
  selectTrackedCandidate,
} = require("../animation_tuner/public/cutout_tracking_core.js");

/**
 * Creates one deterministic descriptor for tracking-gate tests.
 * @param {object} [overrides] Descriptor overrides.
 * @returns {object} Complete shape descriptor.
 */
function createDescriptor(overrides = {}) {
  return {
    width: 100,
    height: 100,
    area: 1000,
    perimeter: 140,
    compactness: 1.56,
    aspectRatio: 2,
    center: { x: 50, y: 50 },
    majorAxis: { x: 1, y: 0 },
    minorAxis: { x: 0, y: 1 },
    majorLength: 40,
    minorLength: 20,
    ...overrides,
  };
}

test("tracking keeps PCA orientation continuous across a 180-degree eigenvector flip", () => {
  const source = createDescriptor();
  const flipped = createDescriptor({
    center: { x: 56, y: 50 },
    majorAxis: { x: -1, y: 0 },
    minorAxis: { x: 0, y: -1 },
    angle: Math.PI,
  });

  const match = selectTrackedCandidate(source, [flipped], createTrackingState(source));

  assert.ok(match);
  assert.ok(match.candidate.majorAxis.x > 0);
  assert.ok(match.candidate.minorAxis.y > 0);
});

test("tracking broadens reacquisition after several missing frames", () => {
  const source = createDescriptor();
  const target = createDescriptor({
    area: 480,
    perimeter: 100,
    compactness: 1.65,
    aspectRatio: 2.1,
    center: { x: 64, y: 50 },
    majorAxis: { x: -1, y: 0 },
    minorAxis: { x: 0, y: -1 },
    majorLength: 29,
    minorLength: 14,
  });
  const state = createTrackingState(source);
  for (let missingFrame = 0; missingFrame < 4; missingFrame += 1) {
    advanceTrackingState(state, null);
  }

  const match = selectTrackedCandidate(source, [target], state);

  assert.ok(match);
  assert.equal(match.reacquisitionLevel, 2);
  assert.ok(match.candidate.majorAxis.x > 0);
});
