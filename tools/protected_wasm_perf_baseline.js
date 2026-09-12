#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const batchCorePath = require.resolve("./animation_tuner/public/batch_cutout_core");
const developmentBatchCore = require(batchCorePath);
const { createBridge } = require("./animation_tuner/public/protected_wasm_kernel_bridge");

const CASES = Object.freeze([
  Object.freeze({ size: 512, samples: 20 }),
  Object.freeze({ size: 1024, samples: 15 }),
  Object.freeze({ size: 2048, samples: 10 }),
]);
const MAXIMUM_P50_RATIO = 1.15;
const GATED_MINIMUM_SIZE = 1024;
const WASM_PATH = path.resolve(
  __dirname,
  "../crates/protected_algorithm_core/target/wasm32-unknown-unknown/release/protected_algorithm_core.wasm",
);
const OPTIONS = Object.freeze({
  automaticCutout: true,
  backgroundColor: Object.freeze({ r: 24, g: 190, b: 70 }),
  backgroundColors: Object.freeze([Object.freeze({ r: 24, g: 190, b: 70 })]),
  referenceChromaKey: true,
  connected: false,
  tolerance: 20,
  chromaCleanup: 40,
  chromaFeather: 1,
  perceptual: true,
  alphaHigh: 255,
  alphaLow: 0,
  blendStrength: 0,
  despillMode: "chroma",
  despillStrength: 35,
  edgeBoost: 15,
  edgeDespillRadius: 1,
  edgeRecoveryStrength: 20,
  edgeRecoveryTolerance: 24,
  blurRadius: 1,
});

/**
 * Advances a deterministic unsigned 32-bit generator.
 * @param {number} state Current state.
 * @returns {number} Next state.
 */
function nextRandomState(state) {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

/**
 * Creates a deterministic keyed-background fixture with a foreground ellipse.
 * @param {number} size Square image dimension.
 * @returns {Uint8ClampedArray} RGBA fixture.
 */
function createFixture(size) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const center = (size - 1) / 2;
  const radiusX = size * 0.31;
  const radiusY = size * 0.38;
  let randomState = (size * 2654435761) >>> 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      randomState = nextRandomState(randomState);
      const noise = (randomState >>> 28) - 8;
      const distance = Math.hypot((x - center) / radiusX, (y - center) / radiusY);
      const offset = (y * size + x) * 4;
      if (distance < 0.98) {
        pixels.set([210 + ((x + y) % 35), 55 + ((x * 3 + y) % 45), 48, 255], offset);
      } else {
        pixels.set([24 + noise, 190 + Math.trunc(noise / 2), 70 - noise, 255], offset);
      }
    }
  }
  return pixels;
}

/**
 * Returns the nearest-rank percentile from ascending millisecond samples.
 * @param {number[]} samples Timing samples.
 * @param {number} percentile Percentile in the inclusive 0..1 range.
 * @returns {number} Rounded percentile.
 */
function percentile(samples, percentile) {
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * percentile) - 1);
  return Number(ordered[index].toFixed(2));
}

/**
 * Measures a synchronous protected-kernel implementation.
 * @param {()=>Uint8ClampedArray} execute One execution.
 * @param {number} sampleCount Measured sample count.
 * @returns {{p50Ms:number,p95Ms:number,minimumMs:number,maximumMs:number,output:Uint8ClampedArray}}
 * Timing summary and final output.
 */
function measure(execute, sampleCount) {
  execute();
  const samples = [];
  let output = null;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    global.gc?.();
    const startedAt = performance.now();
    output = execute();
    samples.push(performance.now() - startedAt);
  }
  return {
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    minimumMs: Number(Math.min(...samples).toFixed(2)),
    maximumMs: Number(Math.max(...samples).toFixed(2)),
    output,
  };
}

/**
 * Creates a compact output digest for parity evidence.
 * @param {Uint8ClampedArray} pixels Output pixels.
 * @returns {string} Truncated SHA-256.
 */
function digest(pixels) {
  return crypto.createHash("sha256").update(pixels).digest("hex").slice(0, 16);
}

/**
 * Runs the local JavaScript-versus-WASM P95 comparison.
 * @returns {Promise<object>} Machine-readable report.
 */
async function run() {
  const wasmBytes = await fs.promises.readFile(WASM_PATH);
  const bridge = createBridge();
  const initializationStartedAt = performance.now();
  await bridge.initialize({
    bytes: wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength),
  });
  const initializationMs = performance.now() - initializationStartedAt;
  globalThis.ProtectedWasmKernelBridge = bridge;
  delete require.cache[batchCorePath];
  const protectedBatchCore = require(batchCorePath);
  const results = [];
  try {
    for (const benchmarkCase of CASES) {
      const source = createFixture(benchmarkCase.size);
      const executeJavaScript = () =>
        developmentBatchCore.applyProductCutout(source, benchmarkCase.size, benchmarkCase.size, OPTIONS, [])
          .data;
      const executeWasm = () =>
        protectedBatchCore.applyProductCutout(source, benchmarkCase.size, benchmarkCase.size, OPTIONS, [])
          .data;
      const javascript = measure(executeJavaScript, benchmarkCase.samples);
      const wasm = measure(executeWasm, benchmarkCase.samples);
      const javascriptDigest = digest(javascript.output);
      const wasmDigest = digest(wasm.output);
      if (javascriptDigest !== wasmDigest) {
        throw new Error(`Protected WASM output mismatch at ${benchmarkCase.size}x${benchmarkCase.size}.`);
      }
      results.push({
        size: benchmarkCase.size,
        samples: benchmarkCase.samples,
        javascript: { ...javascript, output: undefined },
        wasm: { ...wasm, output: undefined },
        p50Ratio: Number((wasm.p50Ms / javascript.p50Ms).toFixed(3)),
        p95Ratio: Number((wasm.p95Ms / javascript.p95Ms).toFixed(3)),
        outputSha256: javascriptDigest,
      });
    }
  } finally {
    delete globalThis.ProtectedWasmKernelBridge;
    delete require.cache[batchCorePath];
  }
  return {
    generatedAt: new Date().toISOString(),
    environment: { platform: process.platform, architecture: process.arch, node: process.version },
    wasm: { bytes: wasmBytes.byteLength, initializationMs: Number(initializationMs.toFixed(2)) },
    maximumP50Ratio: MAXIMUM_P50_RATIO,
    gatedMinimumSize: GATED_MINIMUM_SIZE,
    results,
  };
}

run()
  .then((report) => {
    if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else console.table(report.results);
    if (
      process.argv.includes("--check") &&
      report.results.some(
        (result) => result.size >= report.gatedMinimumSize && result.p50Ratio > report.maximumP50Ratio,
      )
    ) {
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
