"use strict";

const zlib = require("node:zlib");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Computes a PNG CRC32 checksum.
 * @param {Buffer} buffer Input bytes.
 * @returns {number} Unsigned checksum.
 */
function crc32(buffer) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buffer) >>> 0;
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Encodes one PNG chunk.
 * @param {string} type Chunk type.
 * @param {Buffer} data Chunk payload.
 * @returns {Buffer} Length, type, payload, and CRC.
 */
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

/**
 * Encodes an 8-bit RGBA image as a PNG buffer.
 * @param {Uint8ClampedArray|Uint8Array|Buffer} rgba Source pixels.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @returns {Buffer} PNG file bytes.
 */
function encodePngRgba(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("PNG dimensions must be positive integers.");
  }
  if (rgba.length !== width * height * 4) throw new RangeError("RGBA length does not match the PNG size.");
  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    filtered[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + rowStart, stride).copy(filtered, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(filtered)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

module.exports = { encodePngRgba };
