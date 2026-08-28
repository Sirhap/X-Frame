"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  detectScatterSlices,
  normalizeOptions,
  removeColorKey,
  resolveDetectionMode,
  samplePixelHex,
  sortBoxes,
} = require("../animation_tuner/public/scatter_slice_core");

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
 * Writes one RGBA pixel into a test image.
 * @param {Uint8ClampedArray} rgba Pixel buffer.
 * @param {number} width Image width.
 * @param {number} x Horizontal coordinate.
 * @param {number} y Vertical coordinate.
 * @param {[number,number,number,number]} color RGBA color.
 * @returns {void}
 */
function setPixel(rgba, width, x, y, color) {
  rgba.set(color, (y * width + x) * 4);
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
      setPixel(rgba, width, column, row, color);
    }
  }
}

test("scatter detector finds and sorts disconnected color-key regions", () => {
  const rgba = createImage(8, 6, [152, 215, 155, 255]);
  for (const [x, y] of [
    [5, 1],
    [6, 1],
    [5, 2],
    [1, 4],
    [2, 4],
  ]) {
    setPixel(rgba, 8, x, y, [20, 30, 40, 255]);
  }

  const result = detectScatterSlices(rgba, 8, 6, {
    colorKey: "#98d79b",
    minPixels: 2,
    threshold: 8,
  });

  assert.equal(result.mode, "colorkey");
  assert.equal(result.foregroundPixels, 5);
  assert.deepEqual(result.boxes, [
    { x: 1, y: 4, w: 2, h: 1, pixels: 2 },
    { x: 5, y: 1, w: 2, h: 2, pixels: 3 },
  ]);
});

test("scatter box sort remains transitive for staircase layouts", () => {
  const staircase = [
    { x: 50, y: 40, w: 8, h: 8 },
    { x: 10, y: 0, w: 8, h: 8 },
    { x: 30, y: 20, w: 8, h: 8 },
    { x: 40, y: 30, w: 8, h: 8 },
    { x: 20, y: 10, w: 8, h: 8 },
    { x: 60, y: 50, w: 8, h: 8 },
  ];
  const first = sortBoxes(staircase).map((box) => box.y);
  const second = sortBoxes([...staircase].reverse()).map((box) => box.y);
  const third = sortBoxes([
    staircase[2],
    staircase[5],
    staircase[0],
    staircase[3],
    staircase[1],
    staircase[4],
  ]).map((box) => box.y);
  assert.deepEqual(first, [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

test("automatic detection uses alpha and filters small noise", () => {
  const rgba = createImage(5, 5, [0, 0, 0, 0]);
  setPixel(rgba, 5, 1, 1, [255, 255, 255, 255]);
  setPixel(rgba, 5, 1, 2, [255, 255, 255, 255]);
  setPixel(rgba, 5, 4, 4, [255, 255, 255, 255]);

  const result = detectScatterSlices(rgba, 5, 5, { minPixels: 2 });

  assert.equal(result.mode, "alpha");
  assert.deepEqual(result.boxes, [{ x: 1, y: 1, w: 1, h: 2, pixels: 2 }]);
});

test("automatic detection stays on color-key when only a stray AA pixel is semi-transparent", () => {
  const width = 20;
  const height = 10;
  const rgba = createImage(width, height, [255, 255, 255, 255]);
  fillRect(rgba, width, 2, 2, 4, 6, [20, 30, 40, 255]);
  fillRect(rgba, width, 12, 2, 4, 6, [20, 30, 40, 255]);
  rgba[3] = 200;

  const expectedBoxes = [
    { x: 2, y: 2, w: 4, h: 6, pixels: 24 },
    { x: 12, y: 2, w: 4, h: 6, pixels: 24 },
  ];
  const colorKeyResult = detectScatterSlices(rgba, width, height, {
    mode: "colorkey",
    colorKey: "#ffffff",
  });
  const autoResult = detectScatterSlices(rgba, width, height, { mode: "auto" });

  assert.equal(resolveDetectionMode(rgba, "auto", width, height), "colorkey");
  assert.equal(autoResult.mode, "colorkey");
  assert.deepEqual(autoResult.boxes, expectedBoxes);
  assert.deepEqual(colorKeyResult.boxes, expectedBoxes);
  assert.equal(autoResult.boxes.length, 2);
  assert.notEqual(autoResult.boxes.length, 1);
  assert.ok(
    !(autoResult.boxes.length === 1 && autoResult.boxes[0].w === 20 && autoResult.boxes[0].h === 10),
    "a stray a=200 pixel must not collapse the white plate into one 20×10 box",
  );
});

/**
 * Tight real-alpha sprite: 1px a=0 gutter and cream clothing that colorkey
 * would treat as the white plate.
 * @param {number} size Edge length.
 * @returns {Uint8ClampedArray} RGBA pixels.
 */
function tightAlphaCreamCharacter(size) {
  const rgba = createImage(size, size, [0, 0, 0, 0]);
  const cream = [250, 240, 220, 255];
  const ink = [40, 28, 22, 255];
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      setPixel(rgba, size, x, y, cream);
    }
  }
  const mid = Math.floor(size / 2);
  fillRect(rgba, size, mid - 8, 8, 16, size - 20, ink);
  return rgba;
}

test("AUTO treats a tight real-alpha cream character as alpha and finds the subject", () => {
  for (const size of [128, 256]) {
    const rgba = tightAlphaCreamCharacter(size);
    const outerRing = 4 * (size - 1);
    assert.ok((outerRing / (size * size)) * 100 < 5, `${size}×${size} gutter is under the old 5% bar`);
    assert.equal(resolveDetectionMode(rgba, "auto", size, size), "alpha", `${size}×${size} must pick alpha`);
    const result = detectScatterSlices(rgba, size, size, { mode: "auto", minPixels: 16 });
    assert.equal(result.mode, "alpha");
    assert.ok(result.boxes.length >= 1, `${size}×${size} must find a subject box`);
    assert.ok(result.foregroundPixels > 100, `${size}×${size} cream clothing must stay foreground`);
    assert.notEqual(result.boxes.length, 0);
  }
});

test("AUTO stays colorkey when just-over-5% of a white plate is punched corners", () => {
  const width = 20;
  const height = 10;
  const rgba = createImage(width, height, [255, 255, 255, 255]);
  fillRect(rgba, width, 2, 2, 4, 6, [20, 30, 40, 255]);
  fillRect(rgba, width, 12, 2, 4, 6, [20, 30, 40, 255]);
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [width - 1, 0],
    [width - 2, 0],
    [width - 1, 1],
    [0, height - 1],
    [1, height - 1],
    [0, height - 2],
    [width - 1, height - 1],
    [width - 2, height - 1],
  ];
  for (const [x, y] of corners) setPixel(rgba, width, x, y, [255, 255, 255, 0]);
  assert.ok(corners.length * 20 > width * height, "punched corners exceed the old 5% bar");

  assert.equal(resolveDetectionMode(rgba, "auto", width, height), "colorkey");
  const result = detectScatterSlices(rgba, width, height, { mode: "auto" });
  assert.equal(result.mode, "colorkey");
  assert.equal(result.boxes.length, 2);
  assert.ok(
    !(result.boxes.length === 1 && result.boxes[0].w === width && result.boxes[0].h === height),
    "just-over-5% punched corners must not merge the plate into one box",
  );
});

test("color-key detection removes thin editor guides before finding subjects", () => {
  const width = 100;
  const height = 80;
  const background = [40, 160, 140, 255];
  const rgba = createImage(width, height, background);
  for (const y of [20, 60]) {
    for (let x = 0; x < width; x += 1) setPixel(rgba, width, x, y, [148, 214, 255, 255]);
  }
  for (const x of [25, 75]) {
    for (let y = 0; y < height; y += 1) setPixel(rgba, width, x, y, [148, 214, 255, 255]);
  }
  for (const left of [8, 42]) {
    for (let y = 32; y < 42; y += 1) {
      for (let x = left; x < left + 6; x += 1) setPixel(rgba, width, x, y, [20, 30, 40, 255]);
    }
  }

  const result = detectScatterSlices(rgba, width, height, {
    colorKey: "#28a08c",
    minPixels: 10,
    threshold: 8,
  });

  assert.ok(result.ignoredGuidePixels > 300);
  assert.deepEqual(result.boxes, [
    { x: 8, y: 32, w: 6, h: 10, pixels: 60 },
    { x: 42, y: 32, w: 6, h: 10, pixels: 60 },
  ]);
});

test("three-view sheets with a shared ground line split into separate boxes", () => {
  const width = 48;
  const height = 20;
  const rgba = createImage(width, height, [255, 255, 255, 255]);
  for (const left of [2, 20, 38]) {
    for (let y = 2; y < 14; y += 1) {
      for (let x = left; x < left + 8; x += 1) setPixel(rgba, width, x, y, [20, 30, 40, 255]);
    }
  }
  for (let x = 2; x < 46; x += 1) setPixel(rgba, width, x, 14, [20, 30, 40, 255]);

  const result = detectScatterSlices(rgba, width, height, {
    mode: "colorkey",
    colorKey: "#ffffff",
    mergeGap: 0,
    minPixels: 8,
    threshold: 8,
  });

  assert.equal(result.boxes.length, 3, "the shared ground must not collapse three views into one box");
  assert.deepEqual(
    result.boxes.map((box) => [box.x, box.w]),
    [
      [2, 8],
      [20, 8],
      [38, 8],
    ],
  );
});

test("color sampling clamps coordinates and transparency removal keeps source immutable", () => {
  const rgba = createImage(2, 1, [152, 215, 155, 255]);
  setPixel(rgba, 2, 1, 0, [250, 80, 40, 255]);

  assert.equal(samplePixelHex(rgba, 2, 1, 99, -4), "#fa5028");
  const output = removeColorKey(rgba, "#98d79b", 4);
  assert.equal(output[3], 0);
  assert.equal(output[7], 255);
  assert.equal(rgba[3], 255);
});

test("detector validates dimensions and normalizes untrusted options", () => {
  assert.throws(() => detectScatterSlices(new Uint8ClampedArray(3), 1, 1), /RGBA/);
  assert.deepEqual(normalizeOptions({ mode: "unknown", minPixels: Number.NaN }), {
    mode: "auto",
    colorKey: "#ffffff",
    threshold: 24,
    mergeGap: 0,
    minPixels: 4,
    minSide: 1,
    sortOrder: "row-major",
  });
});
