"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");
const {
  analyzePngAlpha,
  evenlySpacedIndexes,
  parsePng,
  recommendSpatialTransform,
  selectSequenceAssets,
} = require("../attachment_sequence_analysis");

/**
 * Computes a PNG CRC32 value.
 * @param {Buffer} buffer Chunk type and payload.
 * @returns {number} Unsigned CRC32.
 */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Creates one PNG chunk.
 * @param {string} type Four-character chunk type.
 * @param {Buffer} payload Chunk bytes.
 * @returns {Buffer} Encoded chunk.
 */
function pngChunk(type, payload) {
  const typeBuffer = Buffer.from(type, "ascii");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])));
  return Buffer.concat([header, typeBuffer, payload, checksum]);
}

/**
 * Writes a non-interlaced RGBA PNG fixture.
 * @param {string} filePath Destination path.
 * @param {number} width Width.
 * @param {number} height Height.
 * @param {(x:number,y:number)=>number} alphaAt Alpha callback.
 * @returns {void}
 */
function writeRgbaPng(filePath, width, height, alphaAt) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 4;
      rows[offset] = 255;
      rows[offset + 1] = 128;
      rows[offset + 2] = 0;
      rows[offset + 3] = alphaAt(x, y);
    }
  }
  fs.writeFileSync(
    filePath,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", zlib.deflateSync(rows)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

test("PNG alpha analysis reports visible mass, bounds, and centroid", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-sequence-analysis-"));
  try {
    const filePath = path.join(directory, "effect.png");
    writeRgbaPng(filePath, 4, 3, (x, y) => {
      if (x === 1 && y === 1) return 255;
      if (x === 2 && y === 1) return 128;
      return 0;
    });

    const analysis = analyzePngAlpha(filePath);

    assert.equal(analysis.visiblePixels, 2);
    assert.deepEqual(analysis.bounds, {
      x: 1,
      y: 1,
      width: 2,
      height: 1,
      centerX: 1.5,
      centerY: 1,
    });
    assert.ok(Math.abs(analysis.alphaMass - 383 / (255 * 12)) < 1e-9);
    assert.ok(Math.abs(analysis.centroid.x - 511 / 383) < 1e-9);
    assert.equal(analysis.centroid.y, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("PNG parsing rejects decompression-bomb dimensions before allocating pixels", () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(100_000, 0);
  header.writeUInt32BE(100_000, 4);
  header[8] = 8;
  header[9] = 6;
  const bomb = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.from([0]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  assert.throws(() => parsePng(bomb), /dimensions|pixel budget|too large/iu);
});

test("normalized resampling preserves endpoints for 18 assets and 8 target frames", () => {
  const assets = Array.from({ length: 18 }, (_value, index) => ({ name: `slash_${index + 1}` }));
  const selection = selectSequenceAssets({ assets, targetCount: 8, strategy: "resample" });

  assert.deepEqual(selection.sourceIndexes, [0, 2, 5, 7, 10, 12, 15, 17]);
  assert.deepEqual(
    selection.assets.map((asset) => asset.name),
    ["slash_1", "slash_3", "slash_6", "slash_8", "slash_11", "slash_13", "slash_16", "slash_18"],
  );
});

test("active sampling trims a low-alpha tail before selecting representative phases", () => {
  const scores = [0.8, 1, 0.9, 0.6, 0.2, 0.05];
  const assets = scores.map((score, index) => ({ name: `slash_${index + 1}`, score }));
  const selection = selectSequenceAssets({
    assets,
    targetCount: 3,
    strategy: "active",
    analyzeAsset: (asset) => ({ alphaMass: asset.score }),
  });

  assert.deepEqual(selection.analysis.activeRange, [1, 5]);
  assert.deepEqual(selection.analysis.selectedSourceFrames, [1, 3, 5]);
  assert.deepEqual(selection.sourceIndexes, [0, 2, 4]);
  assert.ok(selection.analysis.confidence >= 0.62);
});

test("strict sampling keeps the existing count-mismatch safety gate", () => {
  assert.throws(
    () => selectSequenceAssets({ assets: [{}, {}], targetCount: 1, strategy: "strict" }),
    /Unsafe one-to-one mapping \(count_mismatch\)/,
  );
  assert.deepEqual(evenlySpacedIndexes(0, 17, 8), [0, 2, 5, 7, 10, 12, 15, 17]);
});

test("spatial recommendation returns a finite reviewable transform in the attack direction", () => {
  const recommendation = recommendSpatialTransform({
    owner: {
      width: 960,
      height: 720,
      bounds: { x: 380, y: 250, width: 320, height: 400, centerX: 540, centerY: 450 },
      centroid: { x: 550, y: 460 },
    },
    attachment: {
      width: 960,
      height: 720,
      bounds: { x: 120, y: 100, width: 680, height: 520, centerX: 460, centerY: 360 },
      centroid: { x: 470, y: 370 },
    },
    direction: "right",
  });

  assert.equal(recommendation.direction, "right");
  assert.ok(recommendation.transform.scale > 0);
  assert.equal(recommendation.transform.rotation, 0);
  assert.ok(recommendation.transform.offset.x > 0);
  assert.ok(Number.isFinite(recommendation.transform.offset.y));
  assert.ok(recommendation.confidence >= 0.6);
});
