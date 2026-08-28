const assert = require("node:assert/strict");
const {
  analyzeDuplicateFrames,
  analyzeJumpFrames,
  createSequenceAnalysisContext,
  createSignature,
  findDuplicateFrames,
  findJumpFrames,
  findLoopCandidates,
  signatureSimilarity,
} = require("./animation_tuner/public/frame_organizer_core");

/**
 * Creates a deterministic frame signature with a colored center subject.
 * @param {[number, number, number]} subjectColor Center subject RGB color.
 * @returns {ReturnType<typeof createSignature>} Computed frame signature.
 */
function createSignatureFixture(subjectColor) {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let index = 0; index < 8 * 8; index += 1) {
    const offset = index * 4;
    pixels[offset] = 10;
    pixels[offset + 1] = 100;
    pixels[offset + 2] = 40;
    pixels[offset + 3] = 255;
  }
  for (let y = 2; y <= 5; y += 1) {
    for (let x = 2; x <= 5; x += 1) {
      const offset = (y * 8 + x) * 4;
      pixels[offset] = subjectColor[0];
      pixels[offset + 1] = subjectColor[1];
      pixels[offset + 2] = subjectColor[2];
    }
  }
  return createSignature(pixels, 8, 8, 4);
}

/**
 * Creates a compact signature used to exercise phase-based loop detection.
 * @param {[number, number, number]} color Subject RGB color.
 * @returns {ReturnType<typeof createSignature>} Computed frame signature.
 */
function createSyntheticSignature(color) {
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ].forEach(([x, y]) => {
    pixels.set([...color, 255], (y * 4 + x) * 4);
  });
  return createSignature(pixels, 4, 4);
}

/**
 * Runs duplicate, jump, sequence-cache, and loop-detection regression assertions.
 * @returns {void}
 */
function runFrameOrganizerCoreTests() {
  const darkSignature = createSignatureFixture([20, 20, 20]);
  const repeatedDarkSignature = createSignatureFixture([20, 20, 20]);
  const lightSignature = createSignatureFixture([240, 240, 240]);
  const colorSignature = createSignatureFixture([150, 50, 210]);
  assert.equal(signatureSimilarity(darkSignature, repeatedDarkSignature), 100);
  assert.ok(signatureSimilarity(darkSignature, lightSignature) < 90);
  assert.deepEqual(
    findDuplicateFrames([darkSignature, repeatedDarkSignature, lightSignature], 95).map(
      (entry) => entry.index,
    ),
    [1],
  );
  assert.deepEqual(
    findJumpFrames([darkSignature, lightSignature, repeatedDarkSignature], 90).map((entry) => entry.index),
    [1],
  );
  assert.equal(
    analyzeDuplicateFrames([darkSignature, repeatedDarkSignature, lightSignature], 95).autoAdjustedThreshold,
    null,
  );
  assert.ok(
    analyzeJumpFrames([darkSignature, lightSignature, repeatedDarkSignature], 90).matches[0].score > 0,
  );

  const sequenceAnalysisSignatures = [
    darkSignature,
    repeatedDarkSignature,
    lightSignature,
    colorSignature,
    darkSignature,
  ];
  const sequenceAnalysisContext = createSequenceAnalysisContext(sequenceAnalysisSignatures);
  assert.deepEqual(
    analyzeDuplicateFrames(sequenceAnalysisSignatures, 95, sequenceAnalysisContext),
    analyzeDuplicateFrames(sequenceAnalysisSignatures, 95),
  );
  assert.deepEqual(
    analyzeJumpFrames(sequenceAnalysisSignatures, 90, sequenceAnalysisContext),
    analyzeJumpFrames(sequenceAnalysisSignatures, 90),
  );
  assert.equal(sequenceAnalysisContext.getComparisonCount(), 7);

  const loopCandidates = findLoopCandidates(
    [
      darkSignature,
      lightSignature,
      colorSignature,
      darkSignature,
      lightSignature,
      colorSignature,
      darkSignature,
    ],
    { minPeriod: 2, maxPeriod: 4, preference: "auto" },
  );
  assert.equal(loopCandidates[0].period, 3);
  assert.ok(loopCandidates[0].smoothness >= 0 && loopCandidates[0].smoothness <= 1);

  const phaseA = createSyntheticSignature([255, 0, 0]);
  const phaseB = createSyntheticSignature([0, 255, 0]);
  const phaseC = createSyntheticSignature([0, 0, 255]);
  const phaseD = createSyntheticSignature([255, 255, 0]);
  const specifiedStartCandidates = findLoopCandidates(
    [phaseA, phaseB, phaseC, phaseA, phaseB, phaseC, phaseA],
    { minPeriod: 2, maxPeriod: 4, startFrame: 3 },
  );
  assert.ok(specifiedStartCandidates.every((candidate) => candidate.start >= 3));
  const nestedLoopSequence = [
    phaseA,
    phaseB,
    phaseC,
    phaseD,
    phaseA,
    phaseB,
    phaseC,
    phaseD,
    phaseA,
    phaseA,
    phaseB,
    phaseC,
    phaseA,
    phaseB,
    phaseC,
    phaseA,
  ];
  for (const preference of ["auto", "long"]) {
    assert.equal(
      findLoopCandidates(nestedLoopSequence, {
        minPeriod: 2,
        maxPeriod: 10,
        preference,
      })[0].period,
      8,
    );
  }
}

module.exports = { runFrameOrganizerCoreTests };
