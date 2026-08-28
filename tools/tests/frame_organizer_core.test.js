"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  analyzeDuplicateFrames,
  createSequenceAnalysisContext,
  createSignature,
  detectStableBackground,
  findDuplicateFrames,
  findLoopCandidates,
  signatureSimilarity,
} = require("../animation_tuner/public/frame_organizer_core");

/**
 * Builds a flat RGBA test image.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @param {[number,number,number,number]} color Initial RGBA color.
 * @returns {Uint8ClampedArray} Pixel buffer.
 */
function createImage(width, height, color) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(color, offset);
  return rgba;
}

/**
 * Fills a rectangle in a test image.
 * @param {Uint8ClampedArray} rgba Pixel buffer.
 * @param {number} width Image width.
 * @param {number} x Horizontal origin.
 * @param {number} y Vertical origin.
 * @param {number} rectWidth Rectangle width.
 * @param {number} rectHeight Rectangle height.
 * @param {[number,number,number,number]} color RGBA color.
 * @returns {void}
 */
function fillRect(rgba, width, x, y, rectWidth, rectHeight, color) {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) {
      rgba.set(color, (row * width + column) * 4);
    }
  }
}

/**
 * Builds a white-plate signature with a solid subject block.
 * @param {number} size Canvas width and height.
 * @param {number} x Subject origin X.
 * @param {number} y Subject origin Y.
 * @param {number} subjectSize Subject width and height.
 * @param {[number,number,number]} rgb Subject RGB color.
 * @returns {ReturnType<typeof createSignature>} Frame signature.
 */
function whiteWithBlock(size, x, y, subjectSize, rgb) {
  const rgba = createImage(size, size, [255, 255, 255, 255]);
  fillRect(rgba, size, x, y, subjectSize, subjectSize, [...rgb, 255]);
  return createSignature(rgba, size, size);
}

/**
 * Walks frames with a persistent non-duplicate anchor at a fixed threshold.
 * @param {(left:number,right:number)=>number} compare Frame-index comparator.
 * @param {number} frameCount Sequence length.
 * @param {number} threshold Similarity threshold in the range 0-100.
 * @returns {Array<{index:number,matchIndex:number,similarity:number,anchorSimilarity:number}>}
 */
function walkPersistentAnchor(compare, frameCount, threshold) {
  const matches = [];
  let anchorIndex = 0;
  for (let index = 1; index < frameCount; index += 1) {
    const similarity = compare(index - 1, index);
    const anchorSimilarity = compare(anchorIndex, index);
    if (similarity >= threshold && anchorSimilarity >= threshold) {
      matches.push({ index, matchIndex: anchorIndex, similarity, anchorSimilarity });
    } else {
      anchorIndex = index;
    }
  }
  return matches;
}

test("translated non-overlapping poses are not 100% similar", () => {
  const left = whiteWithBlock(32, 2, 12, 8, [200, 40, 40]);
  const right = whiteWithBlock(32, 14, 12, 8, [200, 40, 40]);
  const background = detectStableBackground([left, right]);
  const translatedSim = signatureSimilarity(left, right, background);

  const walk = [];
  for (let index = 0; index < 8; index += 1) {
    walk.push(whiteWithBlock(32, 2 + index * 2, 12, 8, [200, 40, 40]));
  }
  const walkMatches = findDuplicateFrames(walk, 88);
  const walkAnalysis = analyzeDuplicateFrames(walk, 88);
  const walkIndexes = walkMatches.map((entry) => entry.index);

  assert.notEqual(translatedSim, 100, "empty subject intersection is no-evidence, not 100%");
  assert.ok(translatedSim < 88, "a 12px translation with no overlap must not pass the duplicate slider");
  assert.ok(
    !(
      walkMatches.length === 7 &&
      JSON.stringify(walkIndexes) === "[1,2,3,4,5,6,7]" &&
      walkMatches.every((entry) => entry.similarity === 100)
    ),
    "an 8-frame walk must not mark every later frame as a 100% duplicate",
  );
  assert.ok(
    walkAnalysis.matches.every((entry) => entry.similarity !== 100),
    "translated walk poses must not score 100% against a persistent anchor",
  );
  assert.equal(walkMatches.length, 0, "a uniform walk step is not duplicates at slider 88");
  assert.equal(walkAnalysis.autoAdjustedThreshold, null, "auto-adjust must not write the slider down to the walk-step floor");
  assert.notDeepEqual(walkIndexes, [1, 3, 5, 7], "auto-adjust must not thin every other walk frame");
});

test("a 48px 12px-body +2px walk is not duplicates at slider 88", () => {
  const walk = [];
  for (let index = 0; index < 8; index += 1) {
    walk.push(whiteWithBlock(48, 2 + index * 2, 18, 12, [200, 40, 40]));
  }
  const analysis = analyzeDuplicateFrames(walk, 88);
  const indexes = analysis.matches.map((entry) => entry.index);
  assert.equal(analysis.matches.length, 0, "uniform translation walk is not duplicates at 88");
  assert.equal(analysis.autoAdjustedThreshold, null, "must not auto-write the slider down to the walk step");
  assert.notDeepEqual(indexes, [1, 3, 5, 7], "must not select every other walk card");
});

test("duplicate auto-threshold re-runs the persistent-anchor walk", () => {
  const colors = [
    [255, 0, 0],
    [224, 31, 0],
    [193, 62, 0],
    [162, 93, 0],
    [131, 124, 0],
  ];
  const frames = colors.map((rgb) => whiteWithBlock(32, 12, 12, 8, rgb));
  const requested = 95;
  const analysis = analyzeDuplicateFrames(frames, requested);
  const context = createSequenceAnalysisContext(frames);

  const firstPass = walkPersistentAnchor(context.compareIndexes, frames.length, requested);
  assert.equal(firstPass.length, 0, "neighbor ~90 must miss a 95 slider so auto-adjust can run");
  assert.ok(analysis.autoAdjustedThreshold !== null);
  assert.equal(analysis.autoAdjustedThreshold, 90);

  const adjusted = analysis.autoAdjustedThreshold;
  const adjacentOnly = [];
  for (let index = 1; index < frames.length; index += 1) {
    const similarity = context.compareIndexes(index - 1, index);
    if (similarity >= adjusted) {
      adjacentOnly.push(index);
    }
  }
  const expected = walkPersistentAnchor(context.compareIndexes, frames.length, adjusted);

  assert.deepEqual(
    analysis.matches.map((entry) => entry.index),
    expected.map((entry) => entry.index),
    "auto-adjust must re-run the persistent-anchor walk at the lowered threshold",
  );
  assert.deepEqual(
    analysis.matches.map((entry) => entry.index),
    [1, 3],
  );
  assert.notDeepEqual(
    analysis.matches.map((entry) => entry.index),
    adjacentOnly,
    "auto-adjust must not keep the adjacent-only filter that marks 1,2,3,4",
  );
  assert.ok(!analysis.matches.some((entry) => entry.index === 2));
  assert.ok(!analysis.matches.some((entry) => entry.index === 4));
});

test("loop candidates keep every pose in the detected period", () => {
  /**
   * Builds an 8×8 solid-color signature.
   * @param {[number,number,number]} rgb Fill color.
   * @returns {ReturnType<typeof createSignature>} Frame signature.
   */
  function solid(rgb) {
    const rgba = createImage(8, 8, [...rgb, 255]);
    return createSignature(rgba, 8, 8);
  }
  const red = solid([220, 20, 20]);
  const green = solid([20, 200, 20]);
  const blue = solid([20, 20, 220]);
  const sequence = [red, green, blue, red, green, blue];
  const candidates = findLoopCandidates(sequence, { minPeriod: 2, maxPeriod: 4, preference: "auto" });
  const top = candidates[0];

  assert.ok(top, "RGBRGB must produce a loop candidate");
  assert.equal(top.period, 3);
  assert.equal(top.end, top.start + top.period - 1, "end = start + period - 1 so length === period");
  assert.equal(top.length, top.period);
  assert.notEqual(top.length, top.period - 1);
});
