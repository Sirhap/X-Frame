"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  alreadyCutOut,
  cutoutFrameFiles,
  decodePngRgba,
  encodePngRgba,
  placeFramesOnCanvas,
  subjectAnchor,
} = require("../xsxb_mcp_cutout");

const GREEN = [0, 255, 0, 255];
const BODY = [210, 36, 42, 255];
const SLASH = [240, 250, 255, 255];

/**
 * Fills one RGBA pixel.
 * @param {Uint8ClampedArray} rgba Pixel buffer.
 * @param {number} width Image width.
 * @param {number} x Column.
 * @param {number} y Row.
 * @param {number[]} color RGBA color.
 * @returns {void}
 */
function setPixel(rgba, width, x, y, color) {
  rgba.set(color, (y * width + x) * 4);
}

/**
 * Builds a green-screen frame with a standing body and optional slash below the feet.
 * @param {{slash?:boolean,transparent?:boolean}} [options] Frame options.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}} RGBA frame.
 */
function greenScreenFrame(options = {}) {
  const width = 16;
  const height = 16;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (!options.transparent) {
    for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(GREEN, offset);
  }
  for (let y = 6; y <= 11; y += 1) {
    setPixel(rgba, width, 7, y, BODY);
    setPixel(rgba, width, 8, y, BODY);
  }
  if (options.slash) {
    for (let x = 6; x <= 14; x += 1) setPixel(rgba, width, x, 14, SLASH);
    for (let x = 8; x <= 14; x += 1) setPixel(rgba, width, x, 15, SLASH);
  }
  return { data: rgba, width, height };
}

test("PNG encode/decode keeps RGBA pixels", () => {
  const source = greenScreenFrame();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-cutout-png-"));
  const filePath = path.join(folder, "frame.png");
  try {
    fs.writeFileSync(filePath, encodePngRgba(source.data, source.width, source.height));
    const decoded = decodePngRgba(filePath);
    assert.equal(decoded.width, 16);
    assert.equal(decoded.height, 16);
    assert.deepEqual([...decoded.data.subarray(0, 4)], GREEN);
    assert.deepEqual([...decoded.data.subarray((6 * 16 + 7) * 4, (6 * 16 + 7) * 4 + 4)], BODY);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("subject anchor uses the standing body, not slash pixels below", () => {
  const idle = subjectAnchor(greenScreenFrame({ transparent: true }).data, 16, 16);
  const hit = subjectAnchor(greenScreenFrame({ slash: true, transparent: true }).data, 16, 16);
  assert.equal(idle.feetY, 11);
  assert.equal(hit.feetY, 11);
  assert.equal(idle.height, hit.height);
});

test("shared canvas placement keeps hit-frame feet on the same ground line", () => {
  const placed = placeFramesOnCanvas(
    [greenScreenFrame({ transparent: true }), greenScreenFrame({ slash: true, transparent: true })],
    16,
    16,
  );
  const idleFeet = subjectAnchor(placed[0].data, 16, 16);
  const hitFeet = subjectAnchor(placed[1].data, 16, 16);
  assert.equal(idleFeet.feetY, 15);
  assert.equal(hitFeet.feetY, 15);
  assert.ok(placed[0].data[(15 * 16 + 8) * 4 + 3] > 16, "idle feet land on the canvas bottom");
  assert.ok(placed[1].data[(15 * 16 + 8) * 4 + 3] > 16, "hit feet land on the same canvas bottom");
});

test("cutoutFrameFiles uses the tuner smart-cutout path and keeps source layout by default", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-cutout-smart-"));
  const idlePath = path.join(folder, "idle.png");
  const hitPath = path.join(folder, "hit.png");
  try {
    const idle = greenScreenFrame();
    const hit = greenScreenFrame({ slash: true });
    fs.writeFileSync(idlePath, encodePngRgba(idle.data, idle.width, idle.height));
    fs.writeFileSync(hitPath, encodePngRgba(hit.data, hit.width, hit.height));

    const result = cutoutFrameFiles([idlePath, hitPath]);
    assert.equal(result.pipeline, "smart_product");
    assert.equal(result.rematched, false);
    assert.equal(result.outputWidth, 16);
    assert.equal(result.outputHeight, 16);

    const cutIdle = decodePngRgba(idlePath);
    const cutHit = decodePngRgba(hitPath);
    assert.ok(cutIdle.data[3] <= 16, "green background becomes transparent");
    assert.equal(cutIdle.data[(6 * 16 + 7) * 4 + 3], 255, "body stays opaque");
    assert.ok(cutIdle.data[(6 * 16 + 7) * 4] > 180, "body red channel is preserved");
    assert.equal(subjectAnchor(cutIdle.data, 16, 16).feetY, 11);
    assert.equal(subjectAnchor(cutHit.data, 16, 16).feetY, 11);
    assert.ok(cutHit.data[(14 * 16 + 10) * 4 + 3] > 16, "slash stays in its source row when layout is kept");
    assert.equal(alreadyCutOut(cutIdle.data, 16, 16), true);

    const skipped = cutoutFrameFiles([idlePath, hitPath]);
    assert.equal(skipped.skippedFrameCount, 2);
    assert.equal(skipped.processedFrameCount, 0);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("explicit canvas rematch shares one scale and pins body feet to the bottom", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-cutout-canvas-"));
  const idlePath = path.join(folder, "idle.png");
  const hitPath = path.join(folder, "hit.png");
  try {
    const idle = greenScreenFrame();
    const hit = greenScreenFrame({ slash: true });
    fs.writeFileSync(idlePath, encodePngRgba(idle.data, idle.width, idle.height));
    fs.writeFileSync(hitPath, encodePngRgba(hit.data, hit.width, hit.height));

    const result = cutoutFrameFiles([idlePath, hitPath], { outputWidth: 20, outputHeight: 20 });
    assert.equal(result.rematched, true);
    assert.equal(result.outputWidth, 20);
    assert.equal(result.outputHeight, 20);

    const cutIdle = decodePngRgba(idlePath);
    const cutHit = decodePngRgba(hitPath);
    assert.equal(subjectAnchor(cutIdle.data, 20, 20).feetY, 19);
    assert.equal(subjectAnchor(cutHit.data, 20, 20).feetY, 19);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
