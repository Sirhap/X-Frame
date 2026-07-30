#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { spawnSync } = require("node:child_process");
const {
  applyCutoutBrushStroke,
  applyCutoutRepairs,
  applyProductCutout,
  createProtectedRegionMask,
  estimateBackgroundColor,
  selectReferenceProtectedColors,
} = require("./animation_tuner/public/batch_cutout_core");
const { createCutoutQualityMetrics } = require("./animation_tuner/public/cutout_quality_core");
const { createShapeCandidates } = require("./animation_tuner/public/cutout_tracking_core");
const {
  createLocalAnchor,
  trackLocalAnchor,
} = require("./animation_tuner/public/cutout_local_tracking_core");
const {
  analyzeDuplicateFrames,
  analyzeJumpFrames,
  createSequenceAnalysisContext,
  createSignature,
  findLoopCandidates,
} = require("./animation_tuner/public/frame_organizer_core");
const { createOpaqueBoundsCache, opaqueBoundsForPng } = require("./box_estimator");
const { estimateInitialCharacterScale } = require("./import_scale");

const ROOT = path.resolve(__dirname, "..");
const REAL_INPUT_DIRECTORY = path.resolve(
  process.env.XSXB_PERF_INPUT_DIR || path.join(ROOT, ".codex-artifacts/run-cutout-review/input-frames-v2"),
);
const REAL_OUTPUT_DIRECTORY = path.resolve(
  process.env.XSXB_PERF_OUTPUT_DIR || path.join(ROOT, ".codex-artifacts/run-cutout-review/final-frames"),
);
const REAL_PROJECT_DIRECTORY = path.resolve(
  process.env.XSXB_PERF_PROJECT_DIR || path.join(ROOT, "workspace/projects/Goblin_Run_Test"),
);
const REAL_EXTRACTOR_SCRIPT = path.resolve(
  process.env.XSXB_PERF_EXTRACTOR || path.join(ROOT, "..", "scripts", "extract_sprite_animation.py"),
);
const PYTHON_RGBA_DECODER = [
  "from PIL import Image",
  "import struct, sys",
  "image = Image.open(sys.argv[1]).convert('RGBA')",
  "size = int(sys.argv[2])",
  "if size > 0:",
  "    image = image.resize((size, size), Image.Resampling.LANCZOS)",
  "sys.stdout.buffer.write(struct.pack('>II', *image.size))",
  "sys.stdout.buffer.write(image.tobytes())",
].join("\n");

const CONDITIONAL_CANDIDATES = Object.freeze([
  [4, "参考色键清理", "reference-cutout"],
  [7, "去溢色", "normal-cutout"],
  [9, "通用边缘恢复", "normal-cutout"],
  [10, "参考边缘恢复", "reference-cutout"],
  [17, "连通替换与去溢色", "reference-cutout"],
  [18, "边缘层扩张", "reference-cutout"],
  [19, "保护范围连通扩张", "protect-range"],
  [23, "长笔划", "brush-repair"],
  [25, "修复重放", "repair-replay-cold"],
  [26, "批量传播历史", "repair-replay-cache-hit"],
  [27, "PCA 局部帧", "tracking"],
  [28, "形状描述", "tracking"],
  [36, "局部模板跟踪", "local-tracking"],
  [40, "帧签名缓存", "sequence-analysis"],
  [41, "稳定背景 mask", "sequence-analysis"],
  [42, "帧对相似度", "sequence-analysis"],
  [48, "视频抽帧保留", "video-extraction"],
  [53, "编辑器框体几何", "browser-geometry"],
  [54, "PNG Alpha bounds", "png-bounds-cold"],
  [58, "导入缩放估计", "import-scale"],
  [68, "Godot 播放时序", "godot-runtime"],
  [72, "Python 抠图", "python-extractor"],
]);

/**
 * Returns naturally ordered PNG paths from one real corpus directory.
 * @param {string} directory Corpus directory.
 * @returns {string[]} Ordered absolute paths.
 */
function pngPaths(directory) {
  return fs
    .readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((name) => path.join(directory, name));
}

/**
 * Decodes a real PNG as RGBA using the Pillow dependency already used by the root extractor.
 * @param {string} filePath Source image path.
 * @param {number} [sampleSize=0] Optional square analysis size.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}}
 */
function decodeRealPng(filePath, sampleSize = 0) {
  const decoded = spawnSync("python3", ["-c", PYTHON_RGBA_DECODER, filePath, String(sampleSize)], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (decoded.status !== 0 || decoded.stdout.length < 8) {
    throw new Error(`Cannot decode ${filePath}: ${decoded.stderr.toString("utf8").trim()}`);
  }
  const width = decoded.stdout.readUInt32BE(0);
  const height = decoded.stdout.readUInt32BE(4);
  const data = new Uint8ClampedArray(
    decoded.stdout.buffer,
    decoded.stdout.byteOffset + 8,
    decoded.stdout.length - 8,
  );
  if (data.length !== width * height * 4) throw new Error(`Unexpected RGBA size for ${filePath}.`);
  return { data: new Uint8ClampedArray(data), width, height };
}

/**
 * Calculates a compact stable digest for output-equivalence comparisons.
 * @param {Uint8Array|Uint8ClampedArray} data Pixel data.
 * @returns {string} First sixteen SHA-256 hexadecimal characters.
 */
function pixelHash(data) {
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}

/**
 * Measures one real-material operation after one warm-up run.
 * @param {string} name Operation identifier.
 * @param {number} iterations Measured invocation count.
 * @param {() => Uint8Array|Uint8ClampedArray|object|void} operation Work to measure.
 * @returns {{name:string,iterations:number,ms:number,rssDeltaMb:number,hash:string}}
 */
function measure(name, iterations, operation) {
  operation();
  const memoryBefore = process.memoryUsage();
  const startedAt = performance.now();
  let result = null;
  for (let iteration = 0; iteration < iterations; iteration += 1) result = operation();
  const elapsedMilliseconds = (performance.now() - startedAt) / iterations;
  const memoryAfter = process.memoryUsage();
  const data = result?.data || result;
  const hash = ArrayBuffer.isView(data)
    ? pixelHash(data)
    : pixelHash(Buffer.from(JSON.stringify(result || {})));
  return {
    name,
    iterations,
    ms: Number(elapsedMilliseconds.toFixed(2)),
    rssDeltaMb: Number(((memoryAfter.rss - memoryBefore.rss) / 1024 / 1024).toFixed(2)),
    hash,
  };
}

/**
 * Labels a candidate that cannot be decided from an in-memory PNG benchmark.
 * @param {number} candidateId Architecture-review candidate id.
 * @param {boolean} hasMeasurement Whether this report contains a direct result.
 * @returns {"measured"|"requires-browser-trace"|"requires-real-project-trace"|"requires-real-godot-trace"}
 */
function candidateTraceStatus(candidateId, hasMeasurement) {
  if (hasMeasurement) return "measured";
  if (candidateId === 48 || candidateId === 53) return "requires-browser-trace";
  if (candidateId === 58) return "requires-real-project-trace";
  return "requires-real-godot-trace";
}

/**
 * Runs the root Python extractor on the real input corpus and cleans its private temp output.
 * @returns {{count:number}}
 */
function runPythonExtractor() {
  if (!fs.existsSync(REAL_EXTRACTOR_SCRIPT)) {
    throw new Error(
      `Missing extractor script: ${REAL_EXTRACTOR_SCRIPT}. Set XSXB_PERF_EXTRACTOR to its path.`,
    );
  }
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-real-extractor-"));
  try {
    const result = spawnSync(
      "python3",
      [
        REAL_EXTRACTOR_SCRIPT,
        REAL_INPUT_DIRECTORY,
        temporaryDirectory,
        "--threshold",
        "32",
        "--softness",
        "16",
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return { count: pngPaths(temporaryDirectory).length };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * Builds and runs the benchmark matrix using the repository's real Goblin material.
 * @returns {{corpus:object,measurements:object[],candidates:object[]}}
 */
function runRealAssetBaseline() {
  if (!fs.existsSync(REAL_INPUT_DIRECTORY)) {
    throw new Error(
      `Missing input corpus: ${REAL_INPUT_DIRECTORY}. Set XSXB_PERF_INPUT_DIR to a PNG directory.`,
    );
  }
  if (!fs.existsSync(REAL_OUTPUT_DIRECTORY)) {
    throw new Error(
      `Missing output corpus: ${REAL_OUTPUT_DIRECTORY}. Set XSXB_PERF_OUTPUT_DIR to a PNG directory.`,
    );
  }
  if (!fs.existsSync(REAL_PROJECT_DIRECTORY)) {
    throw new Error(
      `Missing project corpus: ${REAL_PROJECT_DIRECTORY}. Set XSXB_PERF_PROJECT_DIR to the project directory.`,
    );
  }
  const inputPaths = pngPaths(REAL_INPUT_DIRECTORY);
  const outputPaths = pngPaths(REAL_OUTPUT_DIRECTORY);
  if (inputPaths.length < 3 || outputPaths.length < 3) {
    throw new Error("The real Goblin input and output frame corpora are required.");
  }
  const inputFrames = inputPaths.map((filePath) => ({ filePath, ...decodeRealPng(filePath) }));
  const outputFrames = outputPaths.map((filePath) => ({ filePath, ...decodeRealPng(filePath) }));
  const source = inputFrames[0];
  const backgroundColor = estimateBackgroundColor(source.data, source.width, source.height);
  const normalOptions = {
    backgroundColor,
    backgroundColors: [backgroundColor],
    tolerance: 20,
    feather: 6,
    connected: true,
    perceptual: true,
    edgeBoost: 10,
    despillStrength: 35,
    despillMode: "chroma",
    edgeDespillRadius: 1,
    edgeRecoveryStrength: 20,
    edgeRecoveryTolerance: 24,
    blurRadius: 1,
  };
  const referenceOptions = {
    ...normalOptions,
    referenceChromaKey: true,
    chromaCleanup: 40,
    chromaFeather: 1,
    alphaLow: 0,
    alphaHigh: 255,
  };
  const automatic = applyProductCutout(source.data, source.width, source.height, normalOptions);
  const subjectMask = new Uint8Array(source.width * source.height);
  for (let index = 0; index < subjectMask.length; index += 1) {
    subjectMask[index] = automatic.data[index * 4 + 3] > 16 ? 1 : 0;
  }
  const analysisSignatures = inputFrames.map(({ filePath }) => {
    const sample = decodeRealPng(filePath, 256);
    return createSignature(sample.data, sample.width, sample.height);
  });
  const repairs = [
    {
      mode: "brush",
      color: { r: 0, g: 200, b: 0 },
      size: 28,
      hardness: 0.75,
      opacity: 0.9,
      points: [
        { x: 500, y: 560 },
        { x: 560, y: 580 },
        { x: 620, y: 555 },
      ],
    },
    {
      mode: "smart",
      x1: 620,
      y1: 610,
      x2: 710,
      y2: 710,
      tolerance: 20,
      feather: 6,
    },
  ];
  const frameSamples = inputPaths.map((filePath, frameIndex) => ({
    filePath,
    animationId: "goblin_run",
    animationName: "Goblin Run",
    frameIndex,
  }));
  const descriptor = createShapeCandidates(automatic.data, source.width, source.height)[0] || null;
  const localAnchor = descriptor
    ? createLocalAnchor(automatic.data, source.width, source.height, descriptor.center, 10)
    : null;
  const warmBoundsCache = createOpaqueBoundsCache();
  inputPaths.forEach((filePath) => opaqueBoundsForPng(filePath, warmBoundsCache));
  const measurements = [
    measure(
      "normal-cutout",
      2,
      () => applyProductCutout(source.data, source.width, source.height, normalOptions).data,
    ),
    measure(
      "reference-cutout",
      2,
      () => applyProductCutout(source.data, source.width, source.height, referenceOptions).data,
    ),
    measure("protect-range", 2, () =>
      createProtectedRegionMask(
        source.data,
        automatic.data,
        source.width,
        source.height,
        { x1: 300, y1: 200, x2: 560, y2: 600 },
        { backgroundColors: [backgroundColor], boundaryStrength: 55, padding: 2 },
      ),
    ),
    measure("protection-colors", 1, () =>
      selectReferenceProtectedColors(
        source.data,
        source.width,
        source.height,
        { x1: 300, y1: 200, x2: 560, y2: 600 },
        { backgroundColor, previewData: automatic.data },
      ),
    ),
    measure("brush-repair", 3, () => {
      const data = new Uint8ClampedArray(automatic.data);
      applyCutoutBrushStroke(data, source.width, source.height, repairs[0], source.data);
      return data;
    }),
    measure("repair-replay-cold", 2, () => {
      const coldSource = new Uint8ClampedArray(source.data);
      const data = new Uint8ClampedArray(automatic.data);
      return applyCutoutRepairs(
        coldSource,
        data,
        source.width,
        source.height,
        normalOptions,
        repairs,
        automatic.data,
      );
    }),
    measure("repair-replay-cache-hit", 3, () => {
      const data = new Uint8ClampedArray(automatic.data);
      return applyCutoutRepairs(
        source.data,
        data,
        source.width,
        source.height,
        normalOptions,
        repairs,
        automatic.data,
      );
    }),
    measure("tracking", 2, () => createShapeCandidates(automatic.data, source.width, source.height)),
    measure("local-tracking", 1, () =>
      localAnchor && descriptor
        ? trackLocalAnchor(localAnchor, automatic.data, source.width, source.height, descriptor.center, {
            searchRadius: 48,
          })
        : null,
    ),
    measure("quality", 2, () =>
      createCutoutQualityMetrics(automatic.data, source.width, source.height, {
        backgroundColors: [backgroundColor],
      }),
    ),
    measure("sequence-analysis", 1, () => {
      const context = createSequenceAnalysisContext(analysisSignatures);
      return {
        duplicate: analyzeDuplicateFrames(analysisSignatures, 88, context),
        jump: analyzeJumpFrames(analysisSignatures, 88, context),
        loops: findLoopCandidates(analysisSignatures, { minPeriod: 2, maxPeriod: 10 }),
        comparisons: context.getComparisonCount(),
      };
    }),
    measure("png-bounds-cold", 1, () => inputPaths.map((filePath) => opaqueBoundsForPng(filePath))),
    measure("png-bounds-cached", 2, () =>
      inputPaths.map((filePath) => opaqueBoundsForPng(filePath, warmBoundsCache)),
    ),
    measure("import-scale", 2, () => estimateInitialCharacterScale(REAL_PROJECT_DIRECTORY, frameSamples)),
    measure("python-extractor", 1, () => runPythonExtractor()),
  ];
  const measurementByName = new Map(measurements.map((measurement) => [measurement.name, measurement]));
  return {
    corpus: {
      inputFrames: inputFrames.length,
      outputFrames: outputFrames.length,
      dimensions: `${source.width}x${source.height}`,
      backgroundColor,
      sourceHash: pixelHash(source.data),
      outputHash: pixelHash(outputFrames[0].data),
    },
    measurements,
    candidates: CONDITIONAL_CANDIDATES.map(([id, name, measurement]) => ({
      id,
      name,
      measurement,
      result: measurementByName.get(measurement) || null,
      status: candidateTraceStatus(id, measurementByName.has(measurement)),
    })),
  };
}

/**
 * Executes the CLI and prints one portable JSON report.
 * @returns {void}
 */
function main() {
  const unsupported = process.argv.slice(2).find((argument) => argument !== "--json");
  if (unsupported) throw new Error(`Unknown argument: ${unsupported}`);
  const report = runRealAssetBaseline();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Real asset benchmark failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONDITIONAL_CANDIDATES,
  candidateTraceStatus,
  decodeRealPng,
  runRealAssetBaseline,
};
