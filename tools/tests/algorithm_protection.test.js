"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  hashedFilename,
  listFiles,
  resolveOutputAsset,
  resolvePublicAsset,
  sha256,
  writeArtifact,
} = require("../algorithm_protection/artifact_utils");
const {
  aliasSensitiveSymbols,
  createSymbolAliases,
  extractAssetUrls,
} = require("../algorithm_protection/source_transform");
const { readWasmCustomSections } = require("../algorithm_protection/audit_production");
const { redactWasmSourcePaths } = require("../algorithm_protection/wasm_transform");
const { createProductionAlgorithmWorkerSource } = require("../algorithm_protection/production_ui_transform");
const {
  RUNTIME_PROTOCOL_VERSION,
  createDevelopmentJsAdapter,
  createCutoutAnalysisExecutor,
  createFrameAnalysisExecutor,
  createProductExecutor,
  createProductionWorkerAdapter,
  createRuntime,
  createSelectionRepairExecutor,
} = require("../animation_tuner/public/protected_algorithm_runtime");

test("artifact hashing is deterministic and content addressed", () => {
  assert.equal(sha256("same"), sha256("same"));
  assert.notEqual(sha256("same"), sha256("different"));
  assert.match(hashedFilename("ui", "js", "source"), /^ui\.[a-f0-9]{16}\.js$/);
});

test("public and output path helpers reject traversal", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-protection-"));
  assert.throws(() => resolvePublicAsset(temporaryRoot, "/../secret"), /Unsafe|escaped/);
  assert.throws(() => writeArtifact(temporaryRoot, "../secret", "value"), /Unsafe/);
  assert.throws(() => resolveOutputAsset(temporaryRoot, "../secret"), /Unsafe/);
  assert.doesNotThrow(() => writeArtifact(temporaryRoot, "assets/ui.js", "value"));
});

test("artifact walking rejects symlinks", (context) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-protection-link-"));
  context.after(() => fs.rmSync(temporaryRoot, { force: true, recursive: true }));
  fs.symlinkSync(os.tmpdir(), path.join(temporaryRoot, "external"));
  assert.throws(() => listFiles(temporaryRoot), /symlink/);
});

test("HTML asset extraction retains order and removes duplicates", () => {
  const html = '<script src="/a.js"></script><script src="/b.js"></script><script src="/a.js"></script>';
  assert.deepEqual(extractAssetUrls(html, /<script src="([^"]+)"><\/script>/g), ["/a.js", "/b.js"]);
});

test("sensitive aliases are stable per seed and differ between seeds", () => {
  const first = createSymbolAliases("seed-a");
  const repeated = createSymbolAliases("seed-a");
  const second = createSymbolAliases("seed-b");
  assert.deepEqual(Array.from(first), Array.from(repeated));
  assert.notDeepEqual(Array.from(first), Array.from(second));
  const transformed = aliasSensitiveSymbols("root.BatchCutoutCore", first);
  assert.doesNotMatch(transformed, /BatchCutoutCore/);
});

test("WASM section reader identifies debug names and rejects truncated sections", () => {
  const wasmWithNameSection = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x00, 0x05, 0x04, 0x6e, 0x61, 0x6d, 0x65,
  ]);
  assert.deepEqual(readWasmCustomSections(wasmWithNameSection), ["name"]);
  assert.throws(
    () => readWasmCustomSections(Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, 5, 4])),
    /exceeds|truncated/,
  );
});

test("WASM source-path redaction preserves byte offsets", () => {
  const prefix = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1]);
  const diagnostic = Buffer.from("src/private_kernel.rs");
  const input = Buffer.concat([prefix, diagnostic, Buffer.from([0])]);
  const output = redactWasmSourcePaths(input);
  assert.equal(output.length, input.length);
  assert.equal(output.subarray(0, 8).toString("hex"), input.subarray(0, 8).toString("hex"));
  assert.doesNotMatch(output.toString("latin1"), /private_kernel\.rs/u);
});

test("production Worker transform removes protected JavaScript kernel bodies", () => {
  const functionNames = [
    "applyReferenceColorReplace",
    "applyReferenceFloodFillDespill",
    "selectReferenceProtectedColors",
    "computeDevelopmentLocalFrame",
    "checkDevelopmentShapeMatch",
    "applyDevelopmentReferenceEdgeColorRestore",
    "chamfer345Distance",
  ];
  const source = functionNames
    .map(
      (name) =>
        `function ${name}(options = {}, callback = () => ({ok:true})){return ${JSON.stringify(name)}}`,
    )
    .join(";");
  const transformed = createProductionAlgorithmWorkerSource(source);
  for (const functionName of functionNames) {
    assert.doesNotMatch(transformed, new RegExp(`return [\"']${functionName}[\"']`, "u"));
  }
  assert.match(transformed, /ENGINE_PRODUCTION_DEPENDENCY_MISSING/u);
});

/**
 * Creates deterministic JavaScript core doubles for runtime contract tests.
 * @returns {object} Adapter dependency doubles.
 */
function createDevelopmentDependencies() {
  return {
    cutout: {
      applyProductCutout(source) {
        return {
          data: new Uint8ClampedArray(source),
          automaticData: new Uint8ClampedArray(source),
          removedPixels: 0,
          partialPixels: 0,
        };
      },
      createProtectedRegionMask() {
        return { mask: new Uint8Array([1]), count: 1 };
      },
      selectProtectedColorsInRectangle() {
        return { colors: [], count: 0 };
      },
    },
    tracking: {
      createShapeCandidates() {
        return [{ area: 1 }];
      },
      createShapeDescriptor() {
        return { area: 1 };
      },
    },
    localTracking: {
      createLocalAnchor() {
        return { point: { x: 0, y: 0 } };
      },
      measureConnectedRegion() {
        return { count: 1 };
      },
    },
    quality: {
      createCutoutQualityMetrics() {
        return { opaquePixels: 1 };
      },
      analyzeCutoutQualitySequence(metrics) {
        return metrics.map(() => ({ codes: [] }));
      },
    },
    frame: {
      createSignature(data, width, height) {
        return { data, width, height };
      },
      async findLoopCandidatesAsync() {
        return [{ start: 0, end: 3 }];
      },
      createSequenceAnalysisContext() {
        return {};
      },
      analyzeJumpFrames() {
        return { matches: [] };
      },
      analyzeDuplicateFrames() {
        return { matches: [] };
      },
    },
  };
}

test("development adapter and facade expose the product-level contract", async () => {
  const adapter = createDevelopmentJsAdapter(createDevelopmentDependencies());
  const runtime = createRuntime({ adapter, capabilities: { transferableArrayBuffer: true } });
  await runtime.initialize(RUNTIME_PROTOCOL_VERSION, {});
  const source = Uint8ClampedArray.from([10, 20, 30, 255]);
  const result = await runtime.applyProductCutout({ data: source, width: 1, height: 1 }, {}, "product-1");
  assert.deepEqual(Array.from(result.data), Array.from(source));
  assert.deepEqual(result.shapeDescriptor, { area: 1 });
  assert.deepEqual(result.qualityMetrics, { opaquePixels: 1 });
});

test("runtime preserves abort semantics when normalizing a cancelled request", async () => {
  const runtime = createRuntime({
    adapter: {
      mode: "test",
      async initialize() {},
      async applyProductCutout() {
        throw new DOMException("Superseded preview.", "AbortError");
      },
      cancel() {},
      dispose() {},
    },
  });

  await assert.rejects(
    runtime.applyProductCutout({}, {}, "cancelled-preview"),
    (error) => error.name === "AbortError" && error.code === "ENGINE_CANCELLED",
  );
});

test("runtime expands packed RGB buffers to RGBA before processing", async () => {
  const runtime = createRuntime({
    adapter: createDevelopmentJsAdapter(createDevelopmentDependencies()),
  });
  const rgb = Uint8Array.from([0, 255, 0, 10, 20, 30]);
  const result = await runtime.applyProductCutout(
    { data: rgb, width: 2, height: 1 },
    { automaticCutout: false },
    "rgb-expand",
  );
  assert.equal(result.data.length, 8);
  assert.equal(result.data[3], 255);
  assert.equal(result.data[7], 255);
});

test("runtime rejects protocol mismatch, duplicate ids, and invalid image buffers", async () => {
  const runtime = createRuntime({
    adapter: createDevelopmentJsAdapter(createDevelopmentDependencies()),
  });
  await assert.rejects(
    runtime.applyProductCutout({ data: Uint8Array.from([1]), width: 1, height: 1 }, {}, "invalid-image"),
    (error) => error.code === "ENGINE_INVALID_REQUEST",
  );

  let releaseRequest;
  const pending = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  const blockingRuntime = createRuntime({
    adapter: {
      mode: "test",
      async initialize() {},
      async applyProductCutout() {
        return pending;
      },
      cancel() {},
      dispose() {},
    },
  });
  const first = blockingRuntime.applyProductCutout({}, {}, "duplicate");
  await assert.rejects(
    blockingRuntime.applyProductCutout({}, {}, "duplicate"),
    (error) => error.code === "ENGINE_INVALID_CANCELLATION_ID",
  );
  releaseRequest({ ok: true });
  await first;
});

test("batch compatibility executor routes through the protected runtime", async () => {
  const calls = [];
  const executor = createProductExecutor({
    async applyProductCutout(image, parameters, cancellationId) {
      calls.push({ image, parameters, cancellationId });
      return { data: image.data };
    },
    cancel() {},
  });
  const source = Uint8ClampedArray.from([1, 2, 3, 255]);
  const result = await executor.process(source, 1, 1, { tolerance: 10 }, [{ mode: "clear" }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].cancellationId, /^cutout-\d+$/);
  assert.deepEqual(calls[0].parameters.repairs, [{ mode: "clear" }]);
  assert.equal(result.data, source);
});

test("selection repair executor routes product-level protection analysis", async () => {
  const calls = [];
  const executor = createSelectionRepairExecutor({
    async applySelectionRepair(image, mask, parameters, cancellationId) {
      calls.push({ image, mask, parameters, cancellationId });
      return { count: 1, mask: Uint8Array.from(mask) };
    },
    cancel() {},
  });
  const result = await executor.analyze(Uint8ClampedArray.from([1, 2, 3, 255]), 1, 1, Uint8Array.from([1]), {
    mode: "protect-range",
    rectangle: { x1: 0, y1: 0, x2: 0, y2: 0 },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].cancellationId, /^selection-\d+$/);
  assert.equal(calls[0].parameters.mode, "protect-range");
  assert.deepEqual(Array.from(result.mask), [1]);
});

test("development adapter executes selection analysis behind the runtime seam", async () => {
  const runtime = createRuntime({ adapter: createDevelopmentJsAdapter(createDevelopmentDependencies()) });
  const result = await runtime.applySelectionRepair(
    { data: Uint8Array.from([1, 2, 3, 255]), width: 1, height: 1 },
    Uint8Array.from([1]),
    { mode: "protect-range", rectangle: { x1: 0, y1: 0, x2: 0, y2: 0 } },
    "selection-development",
  );

  assert.equal(result.count, 1);
  assert.deepEqual(Array.from(result.mask), [1]);
});

test("development color selection excludes pixels outside the subject mask", async () => {
  const dependencies = createDevelopmentDependencies();
  let sampledSource = null;
  dependencies.cutout.selectProtectedColorsInRectangle = (source) => {
    sampledSource = source;
    return { colors: [{ r: 1, g: 2, b: 3 }], count: 1 };
  };
  const runtime = createRuntime({ adapter: createDevelopmentJsAdapter(dependencies) });

  await runtime.applySelectionRepair(
    {
      data: Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]),
      width: 2,
      height: 1,
    },
    Uint8Array.from([1, 0]),
    { mode: "protect-color", rectangle: { x1: 0, y1: 0, x2: 1, y2: 0 } },
    "selection-color-mask",
  );

  assert.deepEqual(Array.from(sampledSource), [1, 2, 3, 255, 4, 5, 6, 0]);
});

test("frame analysis executor routes jump analysis through the shared runtime", async () => {
  const calls = [];
  const executor = createFrameAnalysisExecutor({
    async analyzeFrameSequence(frames, parameters, cancellationId) {
      calls.push({ frames, parameters, cancellationId });
      return { matches: [{ index: 1 }] };
    },
    cancel() {},
  });
  const result = await executor.analyze([Uint8Array.from([1])], {
    operation: "jump",
    threshold: 12,
  });

  assert.deepEqual(result.matches, [{ index: 1 }]);
  assert.equal(calls[0].parameters.operation, "jump");
  assert.match(calls[0].cancellationId, /^frames-\d+$/);
});

test("development runtime routes sequence quality and repair context analysis", async () => {
  const runtime = createRuntime({ adapter: createDevelopmentJsAdapter(createDevelopmentDependencies()) });
  const quality = await runtime.analyzeCutoutSequence([{ opaquePixels: 1 }], {}, "quality-development");
  const context = await runtime.analyzeRepairTracking(
    { data: Uint8Array.from([1, 2, 3, 255]), width: 1, height: 1 },
    { kind: "capture", point: { x: 0, y: 0 } },
    "repair-development",
  );

  assert.deepEqual(quality, [{ codes: [] }]);
  assert.deepEqual(context.localAnchor, { point: { x: 0, y: 0 } });
});

test("cutout analysis executor supplies unique cancellable product requests", async () => {
  const calls = [];
  const executor = createCutoutAnalysisExecutor({
    async analyzeCutoutSequence(metrics, parameters, id) {
      calls.push({ operation: "quality", metrics, parameters, id });
      return [];
    },
    async analyzeRepairTracking(image, parameters, id) {
      calls.push({ operation: parameters.kind, image, parameters, id });
      return { accepted: true };
    },
    cancel(id) {
      calls.push({ operation: "cancel", id });
    },
  });
  await executor.analyzeQuality([], { circular: true });
  await executor.captureRepairContext(Uint8Array.from([1, 2, 3, 255]), 1, 1, { point: { x: 0, y: 0 } });
  await executor.mapRepairTarget(Uint8Array.from([1, 2, 3, 255]), 1, 1, {});

  assert.deepEqual(
    calls.map((call) => call.operation),
    ["quality", "capture", "map-target"],
  );
  assert.match(calls[0].id, /^quality-\d+$/);
  assert.match(calls[1].id, /^repair-context-\d+$/);
  assert.match(calls[2].id, /^repair-map-\d+$/);
});

test("cutout analysis executor cancels active quality work", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const cancelled = [];
  const executor = createCutoutAnalysisExecutor({
    analyzeCutoutSequence() {
      return pending;
    },
    cancel(id) {
      cancelled.push(id);
    },
  });
  const request = executor.analyzeQuality([]);
  executor.cancelAll();
  assert.equal(cancelled.length, 1);
  assert.match(cancelled[0], /^quality-\d+$/);
  release([]);
  await request;
});

test("production adapter disables fallbacks and routes cancellation by operation", async () => {
  const calls = [];
  let releaseCutout;
  const cutoutPending = new Promise((resolve) => {
    releaseCutout = resolve;
  });
  const adapter = createProductionWorkerAdapter({
    WorkerConstructor: function WorkerFixture() {},
    cutoutClient: {
      createExecutor(options) {
        assert.equal(options.allowSyncFallback, false);
        assert.equal(options.syncProcess, null);
        return {
          process() {
            return cutoutPending;
          },
          async selectionRepair(_source, _width, _height, mask, parameters, context) {
            calls.push({ type: "selection", mask, parameters, context });
            return { count: 0 };
          },
          async analyzeQuality() {
            calls.push({ type: "quality" });
            return [];
          },
          async analyzeRepairTracking(_source, _width, _height, parameters, context) {
            calls.push({ type: "repair-tracking", parameters, context });
            return { accepted: false };
          },
          cancelAll() {
            calls.push("cutout-cancel");
          },
          dispose() {},
        };
      },
    },
    frameClient: {
      createExecutor(options) {
        assert.equal(options.fallback, null);
        return {
          async analyze() {
            return [];
          },
          cancelAll() {
            calls.push("frame-cancel");
          },
          dispose() {},
        };
      },
    },
  });
  const request = adapter.applyProductCutout(
    { data: Uint8Array.from([1, 2, 3, 255]), width: 1, height: 1 },
    {},
    "cutout-request",
  );
  adapter.cancel("cutout-request");
  assert.deepEqual(calls, ["cutout-cancel"]);
  releaseCutout({ data: Uint8Array.from([1, 2, 3, 255]) });
  await request;
  await adapter.applySelectionRepair(
    { data: Uint8Array.from([1, 2, 3, 255]), width: 1, height: 1 },
    Uint8Array.from([1]),
    { mode: "protect-range", rectangle: { x1: 0, y1: 0, x2: 0, y2: 0 } },
    "selection-request",
  );
  assert.equal(calls[1].type, "selection");
  assert.equal(calls[1].context.protocolVersion, RUNTIME_PROTOCOL_VERSION);
  await adapter.analyzeCutoutSequence([], {}, "quality-request");
  await adapter.analyzeRepairTracking(
    { data: Uint8Array.from([1, 2, 3, 255]), width: 1, height: 1 },
    { kind: "capture", point: { x: 0, y: 0 } },
    "repair-request",
  );
  assert.equal(calls[2].type, "quality");
  assert.equal(calls[3].type, "repair-tracking");
  assert.equal(calls[3].context.protocolVersion, RUNTIME_PROTOCOL_VERSION);
});

test("runtime preserves safe Worker protocol errors", async () => {
  const runtime = createRuntime({
    adapter: {
      mode: "test",
      async initialize() {},
      async applyProductCutout() {
        throw new Error("ENGINE_VERSION_MISMATCH");
      },
      cancel() {},
      dispose() {},
    },
  });
  await assert.rejects(
    runtime.applyProductCutout({}, {}, "version-error"),
    (error) => error.code === "ENGINE_VERSION_MISMATCH" && error.message === "ENGINE_VERSION_MISMATCH",
  );
});
