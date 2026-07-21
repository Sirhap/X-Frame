"use strict";

const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/**
 * Returns whether one byte belongs to a printable ASCII diagnostic string.
 * @param {number} value Byte value.
 * @returns {boolean} Whether the byte is printable.
 */
function isPrintableAscii(value) {
  return value >= 0x20 && value <= 0x7e;
}

/**
 * Redacts Rust source paths embedded in panic-location data while preserving
 * every byte offset and therefore the WebAssembly binary layout.
 * @param {Buffer|Uint8Array} input Release WASM bytes.
 * @returns {Buffer} Independently owned sanitized bytes.
 */
function redactWasmSourcePaths(input) {
  const output = Buffer.from(input);
  if (output.length < WASM_HEADER.length || !output.subarray(0, WASM_HEADER.length).equals(WASM_HEADER)) {
    throw new Error("Cannot sanitize an invalid WebAssembly artifact.");
  }
  const original = Buffer.from(input);
  for (let index = WASM_HEADER.length; index + 2 < original.length; index += 1) {
    if (original[index] !== 0x2e || original[index + 1] !== 0x72 || original[index + 2] !== 0x73) {
      continue;
    }
    let start = index;
    const minimum = Math.max(WASM_HEADER.length, index - 512);
    while (start > minimum && isPrintableAscii(original[start - 1])) start -= 1;
    const candidate = original.subarray(start, index + 3).toString("ascii");
    if (!/(?:^|\/)(?:src|library|rustc|Users|home|workspace|build|\.cargo)(?:\/|$)/u.test(candidate)) {
      continue;
    }
    output.fill(0x78, start, index + 3);
  }
  return output;
}

module.exports = Object.freeze({ redactWasmSourcePaths });
