"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const candidateCore = require("../animation_tuner/public/batch_cutout_candidate_core.js");

function createParameters(overrides = {}) {
  return {
    backgroundColor: "#ffffff",
    connected: false,
    perceptual: false,
    blendMode: "blend",
    despillMode: "general",
    tolerance: 10,
    feather: 3,
    alphaThreshold: 12,
    chromaFeather: 24,
    edgeBoost: 30,
    blendStrength: 0,
    alphaLow: 16,
    alphaHigh: 220,
    despillStrength: 20,
    edgeDespillRadius: 2,
    edgeRecoveryStrength: 10,
    backgroundRadius: 8,
    blurRadius: 2,
    protectionTolerance: 8,
    ...overrides,
  };
}

test("candidate suggestion protects a damaged subject before cleaning residue", () => {
  const parameters = createParameters();
  const suggestion = candidateCore.createSuggestedCandidate({
    parameters,
    quality: { codes: ["holes", "background-residue"] },
  });

  assert.equal(suggestion.parameters.connected, true);
  assert.equal(suggestion.parameters.tolerance, 8);
  assert.equal(suggestion.parameters.edgeBoost, 20);
  assert.equal(suggestion.parameters.despillStrength, 30);
  assert.deepEqual(suggestion.reasonCodes, ["preserve-subject", "clean-transparent-color"]);
  assert.equal(parameters.connected, false);
  assert.equal(parameters.tolerance, 10);
});

test("candidate suggestion increases cleanup strength for background residue", () => {
  const suggestion = candidateCore.createSuggestedCandidate({
    parameters: createParameters({ tolerance: -1, connected: true }),
    quality: { codes: ["background-residue"] },
  });

  assert.equal(suggestion.parameters.tolerance, 1);
  assert.equal(suggestion.parameters.connected, false);
  assert.equal(suggestion.parameters.edgeBoost, 40);
  assert.equal(suggestion.parameters.despillStrength, 30);
  assert.equal(suggestion.parameters.edgeDespillRadius, 3);
  assert.deepEqual(suggestion.reasonCodes, ["clean-background"]);
});

test("candidate suggestion sharpens soft edges and removes transparent RGB residue", () => {
  const suggestion = candidateCore.createSuggestedCandidate({
    parameters: createParameters(),
    quality: { codes: ["soft-edge", "transparent-rgb"] },
  });

  assert.equal(suggestion.parameters.feather, 2);
  assert.equal(suggestion.parameters.chromaFeather, 16);
  assert.equal(suggestion.parameters.blurRadius, 1);
  assert.equal(suggestion.parameters.alphaLow, 24);
  assert.equal(suggestion.parameters.alphaHigh, 212);
  assert.equal(suggestion.parameters.despillStrength, 30);
  assert.equal(suggestion.parameters.edgeRecoveryStrength, 20);
  assert.deepEqual(suggestion.reasonCodes, ["sharpen-edge", "clean-transparent-color"]);
});

test("candidate suggestion uses estimated background only without a manual seed", () => {
  const automatic = candidateCore.createSuggestedCandidate({
    parameters: createParameters(),
    backgroundSamples: [{ r: 255, g: 255, b: 255, a: 255 }],
    seedPoints: [],
    estimatedBackground: { r: 20, g: 180, b: 40, a: 255 },
    quality: { codes: [] },
  });
  assert.equal(automatic.parameters.backgroundColor, "#14b428");
  assert.deepEqual(automatic.backgroundSamples, [{ r: 20, g: 180, b: 40, a: 255 }]);

  const manual = candidateCore.createSuggestedCandidate({
    parameters: createParameters(),
    backgroundSamples: [{ r: 255, g: 255, b: 255, a: 255 }],
    seedPoints: [{ x: 2, y: 3 }],
    estimatedBackground: { r: 20, g: 180, b: 40, a: 255 },
    quality: { codes: [] },
  });
  assert.equal(manual.parameters.backgroundColor, "#ffffff");
  assert.deepEqual(manual.backgroundSamples, [{ r: 255, g: 255, b: 255, a: 255 }]);
});

test("candidate differences are stable and omit unchanged values", () => {
  const baseline = createParameters();
  const suggestion = createParameters({ tolerance: 12, edgeBoost: 40 });

  assert.deepEqual(candidateCore.diffProcessingParameters(baseline, suggestion), [
    { key: "tolerance", from: 10, to: 12 },
    { key: "edgeBoost", from: 30, to: 40 },
  ]);
});
