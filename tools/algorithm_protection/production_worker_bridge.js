"use strict";

const WORKER_KIND = "__XSXB_WORKER_KIND__";
const WASM_URL = "__XSXB_WASM_URL__";
const EXPECTED_WASM_SHA256 = "__XSXB_WASM_SHA256__";
const EXPECTED_BUILD_ID = "__XSXB_BUILD_ID__";
const PROTOCOL_VERSION = 1;
const MAX_WASM_BYTES = 64 * 1024 * 1024;
const REQUIRED_EXPORTS = Object.freeze([
  "memory",
  "protected_core_reserve",
  "protected_core_release",
  "protected_core_apply_cutout",
  "protected_core_select_protection_colors",
  "protected_core_restore_edges",
  "protected_core_local_frame",
  "protected_core_shape_match",
  "protected_core_distance_field",
]);
let corePromise = null;

/**
 * Converts a digest to lowercase hexadecimal.
 * @param {ArrayBuffer} bytes Digest bytes.
 * @returns {string} Hex digest.
 */
function digestHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Compares equal-length digests without an early exit.
 * @param {string} actual Actual digest.
 * @param {string} expected Expected digest.
 * @returns {boolean} Whether the digests match.
 */
function equalDigest(actual, expected) {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Loads and verifies the immutable WASM core once per Worker.
 * @returns {Promise<WebAssembly.Exports>} Validated exports.
 */
async function loadCore() {
  if (corePromise) return corePromise;
  corePromise = (async () => {
    if (!/^[a-f0-9]{64}$/u.test(EXPECTED_WASM_SHA256) || !/^[a-f0-9]{20}$/u.test(EXPECTED_BUILD_ID)) {
      throw new Error("ENGINE_INTEGRITY_FAILED");
    }
    const response = await fetch(WASM_URL, { cache: "force-cache", credentials: "same-origin" });
    if (!response.ok) throw new Error("ENGINE_TRANSPORT_FAILED");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_WASM_BYTES) {
      throw new Error("ENGINE_INTEGRITY_FAILED");
    }
    const actualHash = digestHex(await crypto.subtle.digest("SHA-256", buffer));
    if (!equalDigest(actualHash, EXPECTED_WASM_SHA256)) throw new Error("ENGINE_INTEGRITY_FAILED");
    const instantiated = await WebAssembly.instantiate(buffer, {});
    const exports = instantiated.instance?.exports || instantiated.exports;
    if (!exports || REQUIRED_EXPORTS.some((name) => !(name in exports))) {
      throw new Error("ENGINE_VERSION_MISMATCH");
    }
    return exports;
  })().catch((error) => {
    corePromise = null;
    throw error;
  });
  return corePromise;
}

/**
 * Encodes the stable 64-byte product-cutout ABI record.
 * @param {object} values Validated product values.
 * @returns {Uint8Array} ABI bytes.
 */
function encodeCutoutConfiguration(values) {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1;
  bytes[1] = values.connected === true ? 1 : 0;
  bytes[2] = Number(values.blendMode || 0);
  bytes[3] = Number(values.edgeMode || 0);
  bytes[4] = values.reference ? 1 : 0;
  if (values.despillReference) bytes[4] |= 2;
  bytes[6] = Number(values.alphaHigh || 0);
  bytes[7] = Number(values.alphaLow || 0);
  view.setInt32(8, Number(values.seedX || 0), true);
  view.setInt32(12, Number(values.seedY || 0), true);
  for (const [offset, color] of [
    [16, values.reference],
    [20, values.replacement],
    [24, values.despillReference],
  ]) {
    if (color) bytes.set([color.r, color.g, color.b, color.a ?? 255], offset);
  }
  for (const [offset, value] of [
    [28, values.tolerance],
    [32, values.edgeEnhance],
    [36, values.blendStrength],
    [40, values.despillStrength],
    [44, values.edgeRadius],
  ]) {
    view.setInt32(offset, Number(value || 0), true);
  }
  return bytes;
}

/**
 * Maps unknown failures to the public error vocabulary.
 * @param {unknown} reason Failure value.
 * @returns {string} Stable error code.
 */
function errorCode(reason) {
  const candidate = String(reason?.message || reason || "");
  return [
    "ENGINE_INTEGRITY_FAILED",
    "ENGINE_TRANSPORT_FAILED",
    "ENGINE_UNSUPPORTED_OPERATION",
    "ENGINE_VERSION_MISMATCH",
  ].includes(candidate)
    ? candidate
    : "ENGINE_EXECUTION_FAILED";
}

/**
 * Creates a response compatible with the selected existing Worker client.
 * @param {number} id Request identifier.
 * @param {boolean} ok Success state.
 * @param {string} [error] Stable error code.
 * @returns {object} Serializable response.
 */
function responseMessage(id, ok, error) {
  return WORKER_KIND === "frame"
    ? { id, type: "result", ok, ...(error ? { error } : {}) }
    : { id, ok, ...(error ? { error } : {}) };
}

self.onmessage = async (event) => {
  const request = event.data || {};
  const id = Number(request.id);
  if (!Number.isSafeInteger(id) || id < 0) return;
  if (request.protocolVersion !== PROTOCOL_VERSION) {
    self.postMessage(responseMessage(id, false, "ENGINE_VERSION_MISMATCH"));
    return;
  }
  try {
    await loadCore();
    // The current Rust ABI does not yet produce every product-level metadata
    // record required by these clients. Never fabricate a partial success.
    void encodeCutoutConfiguration;
    throw new Error("ENGINE_UNSUPPORTED_OPERATION");
  } catch (error) {
    self.postMessage(responseMessage(id, false, errorCode(error)));
  }
};
