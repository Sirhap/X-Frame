#!/usr/bin/env node

const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { applyProductCutout } = require("./animation_tuner/public/batch_cutout_core");

const BENCHMARK_CASES = Object.freeze([
  Object.freeze({ size: 512, iterations: 3 }),
  Object.freeze({ size: 1024, iterations: 2 }),
  Object.freeze({ size: 2048, iterations: 1 }),
]);

const BENCHMARK_MODES = Object.freeze([
  Object.freeze({
    name: "normal",
    options: Object.freeze({
      backgroundColor: Object.freeze({ r: 24, g: 190, b: 70 }),
      backgroundColors: Object.freeze([Object.freeze({ r: 24, g: 190, b: 70 })]),
      tolerance: 20,
      feather: 6,
      connected: false,
      perceptual: true,
      edgeBoost: 15,
      despillStrength: 35,
      despillMode: "chroma",
      edgeRecoveryStrength: 20,
      edgeRecoveryTolerance: 24,
      blurRadius: 1,
    }),
  }),
  Object.freeze({
    name: "referenceChromaKey",
    options: Object.freeze({
      referenceChromaKey: true,
      backgroundColor: Object.freeze({ r: 24, g: 190, b: 70 }),
      backgroundColors: Object.freeze([Object.freeze({ r: 24, g: 190, b: 70 })]),
      tolerance: 20,
      chromaCleanup: 40,
      chromaFeather: 1,
      connected: false,
      perceptual: true,
      edgeBoost: 15,
      alphaLow: 0,
      alphaHigh: 255,
      despillStrength: 35,
      despillMode: "chroma",
      edgeDespillRadius: 1,
      edgeRecoveryStrength: 20,
      edgeRecoveryTolerance: 24,
      blurRadius: 1,
    }),
  }),
]);
const EXPECTED_RESULTS = Object.freeze({
  "512:normal": Object.freeze({ maxMs: 300, hash: "6cfeae9fb985b7fc" }),
  "512:referenceChromaKey": Object.freeze({ maxMs: 160, hash: "f16fbfdf2c46c418" }),
  "1024:normal": Object.freeze({ maxMs: 1000, hash: "34b83eaecc6330c0" }),
  "1024:referenceChromaKey": Object.freeze({ maxMs: 450, hash: "abf0797336f73fa2" }),
  "2048:normal": Object.freeze({ maxMs: 4000, hash: "4214e9bb1086286e" }),
  "2048:referenceChromaKey": Object.freeze({ maxMs: 1600, hash: "d94f901d2c2edb78" }),
});

/**
 * Advances a deterministic 32-bit linear congruential generator.
 * @param {number} state Current unsigned generator state.
 * @returns {number} Next unsigned generator state.
 */
function nextRandomState(state) {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

/**
 * Creates deterministic RGBA pixels containing a keyed background and a
 * foreground ellipse with noisy, partially transparent edges.
 * @param {number} width Fixture width.
 * @param {number} height Fixture height.
 * @returns {Uint8ClampedArray} Deterministic RGBA fixture.
 */
function createFixture(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const radiusX = width * 0.31;
  const radiusY = height * 0.38;
  let randomState = (width * 2654435761 + height) >>> 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      randomState = nextRandomState(randomState);
      const noise = (randomState >>> 28) - 8;
      const normalizedX = (x - centerX) / radiusX;
      const normalizedY = (y - centerY) / radiusY;
      const distance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
      const offset = (y * width + x) * 4;

      if (distance < 0.97) {
        const edgeAlpha = Math.min(1, Math.max(0, (1.02 - distance) / 0.05));
        data[offset] = 190 + ((x * 37 + y * 11) % 55);
        data[offset + 1] = 58 + ((x * 13 + y * 17) % 55);
        data[offset + 2] = 42 + ((x * 7 + y * 29) % 65);
        data[offset + 3] = Math.round(255 * edgeAlpha);
      } else {
        data[offset] = 24 + noise;
        data[offset + 1] = 190 + Math.trunc(noise / 2);
        data[offset + 2] = 70 - noise;
        data[offset + 3] = 255;
      }
    }
  }
  return data;
}

/**
 * Produces a compact stable digest for one benchmark output.
 * @param {Uint8ClampedArray} data Output RGBA pixels.
 * @returns {string} First sixteen hexadecimal SHA-256 characters.
 */
function hashPixels(data) {
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}

/**
 * Measures one FramePacker product cutout path.
 * @param {Uint8ClampedArray} source Deterministic source pixels.
 * @param {number} size Square image dimension.
 * @param {number} iterations Number of measured executions.
 * @param {{name:string,options:object}} mode Benchmark mode definition.
 * @returns {{size:number,mode:string,iterations:number,ms:number,megapixelsPerSecond:number,hash:string}}
 * Benchmark result.
 */
function runBenchmark(source, size, iterations, mode) {
  let output = null;
  const memoryBefore = process.memoryUsage();
  const startedAt = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    output = applyProductCutout(source, size, size, mode.options);
  }
  const elapsedMilliseconds = performance.now() - startedAt;
  const averageMilliseconds = elapsedMilliseconds / iterations;
  const megapixels = (size * size) / 1_000_000;
  const memoryAfter = process.memoryUsage();

  return {
    size,
    mode: mode.name,
    iterations,
    ms: Number(averageMilliseconds.toFixed(2)),
    megapixelsPerSecond: Number((megapixels / (averageMilliseconds / 1000)).toFixed(2)),
    hash: hashPixels(output.data),
    rssDeltaMb: Number(((memoryAfter.rss - memoryBefore.rss) / 1024 / 1024).toFixed(2)),
    heapDeltaMb: Number(((memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024).toFixed(2)),
  };
}

/**
 * Runs all deterministic FramePacker performance baseline cases.
 * @returns {Array<{size:number,mode:string,iterations:number,ms:number,megapixelsPerSecond:number,hash:string}>}
 * Ordered benchmark results.
 */
function runBaseline() {
  const results = [];
  const warmupSource = createFixture(128, 128);
  for (const mode of BENCHMARK_MODES) {
    applyProductCutout(warmupSource, 128, 128, mode.options);
  }
  for (const benchmarkCase of BENCHMARK_CASES) {
    const source = createFixture(benchmarkCase.size, benchmarkCase.size);
    for (const mode of BENCHMARK_MODES) {
      results.push(runBenchmark(source, benchmarkCase.size, benchmarkCase.iterations, mode));
    }
  }
  return results;
}

/**
 * Prints results as JSON or a compact terminal table.
 * @param {ReturnType<typeof runBaseline>} results Benchmark results.
 * @param {boolean} jsonOutput Whether machine-readable JSON was requested.
 * @returns {void}
 */
function printResults(results, jsonOutput) {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }
  console.table(
    results.map((result) => ({
      size: `${result.size}x${result.size}`,
      mode: result.mode,
      iterations: result.iterations,
      ms: result.ms,
      "MP/s": result.megapixelsPerSecond,
      "RSS Δ MB": result.rssDeltaMb,
      hash: result.hash,
    })),
  );
}

/**
 * Executes the command-line benchmark.
 * @returns {void}
 */
function main() {
  const supportedArguments = new Set(["--json", "--check"]);
  const unknownArgument = process.argv.slice(2).find((argument) => !supportedArguments.has(argument));
  if (unknownArgument) {
    process.stderr.write(
      `Unknown argument: ${unknownArgument}\nUsage: node tools/framepacker_perf_baseline.js [--json] [--check]\n`,
    );
    process.exitCode = 1;
    return;
  }

  const results = runBaseline();
  printResults(results, process.argv.includes("--json"));
  if (process.argv.includes("--check")) {
    const failures = results.flatMap((result) => {
      const expected = EXPECTED_RESULTS[`${result.size}:${result.mode}`];
      if (!expected) return [`Missing performance expectation for ${result.size}:${result.mode}.`];
      const messages = [];
      if (result.hash !== expected.hash) {
        messages.push(`${result.size}:${result.mode} hash ${result.hash} != ${expected.hash}.`);
      }
      if (result.ms > expected.maxMs) {
        messages.push(`${result.size}:${result.mode} ${result.ms}ms exceeds ${expected.maxMs}ms.`);
      }
      return messages;
    });
    if (failures.length) throw new Error(`Performance regression:\n${failures.join("\n")}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`FramePacker performance baseline failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  createFixture,
  hashPixels,
  EXPECTED_RESULTS,
  runBaseline,
  runBenchmark,
};
