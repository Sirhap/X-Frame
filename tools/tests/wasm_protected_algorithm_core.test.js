"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const connectivity = require("../animation_tuner/public/batch_cutout_connectivity_core.js");
const batchCore = require("../animation_tuner/public/batch_cutout_core.js");
const tracking = require("../animation_tuner/public/cutout_tracking_core.js");

const defaultWasmPath = path.resolve(
  __dirname,
  "../../crates/protected_algorithm_core/target/wasm32-unknown-unknown/release/protected_algorithm_core.wasm",
);
const wasmPath = process.env.PROTECTED_CORE_WASM_PATH
  ? path.resolve(process.env.PROTECTED_CORE_WASM_PATH)
  : defaultWasmPath;
const allowMissingWasm = process.env.ALLOW_MISSING_PROTECTED_CORE === "1";
const skipReason =
  !fs.existsSync(wasmPath) && allowMissingWasm
    ? `Rust/WASM artifact is unavailable and explicitly allowed: ${wasmPath}`
    : false;

/** @type {Promise<WebAssembly.Exports>|null} */
let exportsPromise = null;

/**
 * Loads the dependency-free WASM module once.
 * @returns {Promise<WebAssembly.Exports>}
 */
async function loadExports() {
  if (!exportsPromise) {
    exportsPromise = fs.promises
      .readFile(wasmPath)
      .then((bytes) => WebAssembly.instantiate(bytes, {}))
      .then(({ instance }) => instance.exports);
  }
  return exportsPromise;
}

/**
 * Allocates initialized bytes in WASM linear memory.
 * @param {WebAssembly.Exports} wasm Module exports.
 * @param {Uint8Array|number} input Initial bytes or allocation length.
 * @returns {{pointer:number,length:number}}
 */
function allocate(wasm, input) {
  const bytes = typeof input === "number" ? new Uint8Array(input) : Uint8Array.from(input);
  const pointer = wasm.protected_core_reserve(bytes.length);
  assert.notEqual(pointer, 0, `failed to reserve ${bytes.length} bytes`);
  new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
  return { pointer, length: bytes.length };
}

/**
 * Releases each successfully allocated buffer.
 * @param {WebAssembly.Exports} wasm Module exports.
 * @param {Array<{pointer:number,length:number}>} allocations Owned allocations.
 * @returns {void}
 */
function releaseAll(wasm, allocations) {
  for (const allocation of allocations.reverse()) {
    assert.equal(wasm.protected_core_release(allocation.pointer, allocation.length), 0);
  }
}

/**
 * Reads a little-endian float from a fixed record.
 * @param {Uint8Array} bytes Result bytes.
 * @param {number} offset Byte offset.
 * @returns {number}
 */
function readFloat64(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(offset, true);
}

/**
 * Compares nullable numeric fields with reference-friendly tolerance.
 * @param {number} actual Actual value.
 * @param {number} expected Reference value.
 * @returns {void}
 */
function assertNear(actual, expected) {
  const tolerance = Math.max(1e-10, Math.abs(expected) * 1e-10);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

/**
 * Encodes the stable product cutout configuration.
 * @param {object} values Product pipeline values.
 * @returns {Uint8Array}
 */
function encodeCutoutConfiguration(values) {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1;
  bytes[1] = values.connected ? 1 : 0;
  bytes[2] = values.blendMode || 0;
  bytes[3] = values.edgeMode || 0;
  bytes[4] = 1 | (values.despillReference ? 2 : 0);
  bytes[6] = values.alphaHigh || 0;
  bytes[7] = values.alphaLow || 0;
  view.setInt32(8, values.seedX, true);
  view.setInt32(12, values.seedY, true);
  bytes.set([values.reference.r, values.reference.g, values.reference.b, values.reference.a ?? 255], 16);
  bytes.set(
    [values.replacement.r, values.replacement.g, values.replacement.b, values.replacement.a ?? 255],
    20,
  );
  if (values.despillReference) {
    bytes.set([values.despillReference.r, values.despillReference.g, values.despillReference.b], 24);
  }
  view.setInt32(28, values.tolerance, true);
  view.setInt32(32, values.edgeEnhance || 0, true);
  view.setInt32(36, values.blendStrength || 0, true);
  view.setInt32(40, values.despillStrength || 0, true);
  view.setInt32(44, values.edgeRadius || 0, true);
  return bytes;
}

/**
 * Executes the product cutout ABI with isolated owned buffers.
 * @param {WebAssembly.Exports} wasm Module exports.
 * @param {Uint8Array} source RGBA input.
 * @param {number} width Width.
 * @param {number} height Height.
 * @param {Uint8Array} configuration Encoded configuration.
 * @param {Uint8Array|null} mask Optional 255 operation mask.
 * @param {Uint8Array|null} protectedColors Packed RGB triples.
 * @returns {Uint8Array}
 */
function applyWasmCutout(wasm, source, width, height, configuration, mask = null, protectedColors = null) {
  const input = allocate(wasm, source);
  const config = allocate(wasm, configuration);
  const output = allocate(wasm, source.length);
  const optional = [];
  const maskAllocation = mask ? allocate(wasm, mask) : { pointer: 0, length: 0 };
  const colorsAllocation = protectedColors ? allocate(wasm, protectedColors) : { pointer: 0, length: 0 };
  if (mask) optional.push(maskAllocation);
  if (protectedColors) optional.push(colorsAllocation);
  try {
    assert.equal(
      wasm.protected_core_apply_cutout(
        input.pointer,
        input.length,
        width,
        height,
        config.pointer,
        config.length,
        maskAllocation.pointer,
        maskAllocation.length,
        colorsAllocation.pointer,
        colorsAllocation.length,
        output.pointer,
        output.length,
      ),
      0,
    );
    return new Uint8Array(wasm.memory.buffer.slice(output.pointer, output.pointer + output.length));
  } finally {
    releaseAll(wasm, [input, config, output, ...optional]);
  }
}

test(
  "WASM exports use product names rather than reference kernel identifiers",
  { skip: skipReason },
  async () => {
    const wasm = await loadExports();
    const names = Object.keys(wasm);
    assert.ok(names.includes("protected_core_distance_field"));
    assert.ok(names.includes("protected_core_local_frame"));
    assert.ok(names.includes("protected_core_shape_match"));
    assert.ok(names.includes("protected_core_restore_edges"));
    assert.ok(names.includes("protected_core_apply_cutout"));
    assert.ok(names.includes("protected_core_select_protection_colors"));
    assert.equal(
      names.some((name) => name.includes("fp_kernel")),
      false,
    );
  },
);

test(
  "private fp_kernel_07 product path matches blend modes, thresholds, masks, and protection",
  { skip: skipReason },
  async () => {
    const wasm = await loadExports();
    const source = Uint8Array.from([
      0, 240, 0, 255, 8, 225, 8, 230, 35, 190, 30, 180, 220, 40, 30, 255, 0, 250, 0, 255, 80, 150, 60, 150,
    ]);
    const reference = { r: 0, g: 240, b: 0, a: 255 };
    const replacement = { r: 0, g: 0, b: 0, a: 0 };
    const mask = Uint8Array.from([255, 255, 255, 255, 255, 0]);
    for (const blendMode of [0, 1, 2, 3]) {
      const options = {
        referenceColor: reference,
        mask,
        edgeEnhance: 35,
        blendStrength: blendMode === 0 ? 0 : 50,
        despillMode: blendMode,
        despillStrength: 25,
        despillRefColor: { r: 0, g: 250, b: 0 },
        alphaThresholdHigh: 245,
        alphaThresholdLow: 8,
        edgeRestoreRadius: 0,
        protectColors: [{ r: 220, g: 40, b: 30 }],
      };
      const expected = batchCore.applyReferenceColorReplace(
        source,
        3,
        2,
        { x: 0, y: 0 },
        replacement,
        18,
        options,
      );
      const configuration = encodeCutoutConfiguration({
        seedX: 0,
        seedY: 0,
        reference,
        replacement,
        tolerance: 18,
        edgeEnhance: 35,
        blendMode,
        blendStrength: options.blendStrength,
        despillStrength: 25,
        despillReference: options.despillRefColor,
        alphaHigh: 245,
        alphaLow: 8,
      });
      const actual = applyWasmCutout(wasm, source, 3, 2, configuration, mask, Uint8Array.from([220, 40, 30]));
      assert.deepEqual([...actual], [...expected], `blend mode ${blendMode}`);
    }
  },
);

test(
  "private fp_kernel_13 product path matches disconnected regions and edge modes",
  { skip: skipReason },
  async () => {
    const wasm = await loadExports();
    const source = Uint8Array.from([
      0, 255, 0, 255, 5, 245, 5, 240, 50, 180, 45, 180, 240, 20, 20, 255, 0, 250, 0, 255, 7, 240, 7, 220, 60,
      170, 50, 160, 0, 255, 0, 255,
    ]);
    const reference = { r: 0, g: 255, b: 0, a: 255 };
    const replacement = { r: 0, g: 0, b: 0, a: 0 };
    const mask = Uint8Array.from({ length: 8 }, () => 255);
    for (const edgeMode of [0, 1, 2]) {
      const options = {
        referenceColor: reference,
        mask,
        edgeRestoreRadius: edgeMode === 0 ? 0 : 2,
        edgeRestoreMode: edgeMode,
      };
      const expected = batchCore.applyReferenceFloodFillDespill(
        source,
        4,
        2,
        { x: 0, y: 0 },
        replacement,
        12,
        options,
      );
      const configuration = encodeCutoutConfiguration({
        connected: true,
        seedX: 0,
        seedY: 0,
        reference,
        replacement,
        tolerance: 12,
        edgeRadius: options.edgeRestoreRadius,
        edgeMode,
      });
      const actual = applyWasmCutout(wasm, source, 4, 2, configuration, mask);
      assert.deepEqual([...actual], [...expected], `edge mode ${edgeMode}`);
    }
  },
);

test(
  "private fp_kernel_13 ignores protection, Alpha, and directional-despill inputs",
  { skip: skipReason },
  async () => {
    const wasm = await loadExports();
    const source = Uint8Array.from([
      0, 255, 0, 255, 4, 248, 4, 220, 80, 160, 60, 120, 220, 30, 30, 255, 0, 255, 0, 255, 90, 150, 70, 100,
    ]);
    const reference = { r: 0, g: 255, b: 0, a: 255 };
    const replacement = { r: 0, g: 0, b: 0, a: 0 };
    const mask = Uint8Array.from({ length: 6 }, () => 255);
    const options = {
      referenceColor: reference,
      mask,
      protectColors: [{ r: 0, g: 255, b: 0 }],
      alphaThresholdHigh: 1,
      alphaThresholdLow: 254,
      despillStrength: 100,
      despillRefColor: { r: 0, g: 255, b: 0 },
    };
    const expected = batchCore.applyReferenceFloodFillDespill(
      source,
      3,
      2,
      { x: 0, y: 0 },
      replacement,
      10,
      options,
    );
    const configuration = encodeCutoutConfiguration({
      connected: true,
      seedX: 0,
      seedY: 0,
      reference,
      replacement,
      tolerance: 10,
      alphaHigh: 1,
      alphaLow: 254,
      despillStrength: 100,
      despillReference: options.despillRefColor,
    });
    const actual = applyWasmCutout(wasm, source, 3, 2, configuration, mask, Uint8Array.from([0, 255, 0]));
    assert.deepEqual([...actual], [...expected]);
  },
);

test(
  "private fp_kernel_14 product path matches directional greedy coverage and existing colors",
  { skip: skipReason },
  async () => {
    const wasm = await loadExports();
    const palette = [
      [220, 30, 30],
      [30, 30, 220],
      [150, 90, 35],
      [230, 210, 30],
      [120, 120, 120],
      [0, 255, 0],
    ];
    const source = new Uint8Array(8 * 8 * 4);
    const preview = new Uint8Array(source.length);
    for (let pixel = 0; pixel < 64; pixel += 1) {
      const color = palette[pixel % palette.length];
      source.set([...color, 255], pixel * 4);
      preview.set([...color, pixel % 7 === 0 ? 255 : 128], pixel * 4);
    }
    const existingColors = [{ r: 220, g: 30, b: 30 }];
    const expected = batchCore.selectReferenceProtectedColors(
      source,
      8,
      8,
      { r: 0, g: 255, b: 0 },
      {
        previewData: preview,
        maximumColors: 5,
        coverageThreshold: 82,
        existingColors,
        fullOriginalData: source,
        fullPreviewData: preview,
        fullWidth: 8,
        fullHeight: 8,
      },
    );
    const input = allocate(wasm, source);
    const previewAllocation = allocate(wasm, preview);
    const existing = allocate(wasm, Uint8Array.from([220, 30, 30]));
    const output = allocate(wasm, 16 + 5 * 8);
    try {
      assert.equal(
        wasm.protected_core_select_protection_colors(
          input.pointer,
          input.length,
          previewAllocation.pointer,
          previewAllocation.length,
          8,
          8,
          0x00ff00,
          5,
          82,
          existing.pointer,
          existing.length,
          input.pointer,
          input.length,
          previewAllocation.pointer,
          previewAllocation.length,
          8,
          8,
          output.pointer,
          output.length,
        ),
        0,
      );
      const bytes = new Uint8Array(wasm.memory.buffer.slice(output.pointer, output.pointer + output.length));
      assert.equal(bytes[1], expected.status);
      assert.equal(bytes[2], expected.count);
      assert.equal(bytes[3], expected.coverage);
      assert.equal(new DataView(bytes.buffer).getUint32(4, true), expected.sampleCount);
      const colors = Array.from({ length: bytes[2] }, (_, index) => {
        const offset = 16 + index * 8;
        return {
          r: bytes[offset],
          g: bytes[offset + 1],
          b: bytes[offset + 2],
          count: new DataView(bytes.buffer).getUint32(offset + 4, true),
        };
      });
      assert.deepEqual(colors, expected.colors);
    } finally {
      releaseAll(wasm, [input, previewAllocation, existing, output]);
    }
  },
);

test(
  "private fp_kernel_14 applies the 0.0005 cutoff and top-two full-image fallback",
  { skip: skipReason },
  async () => {
    const wasm = await loadExports();
    const regionColors = [
      [220, 30, 30],
      [30, 30, 220],
      [230, 210, 30],
      [220, 30, 30],
      [30, 30, 220],
      [230, 210, 30],
    ];
    const region = new Uint8Array(regionColors.length * 4);
    const regionPreview = new Uint8Array(region.length);
    regionColors.forEach((color, index) => {
      region.set([...color, 255], index * 4);
      regionPreview.set([...color, 128], index * 4);
    });
    for (const counts of [
      [10, 8, 1],
      [2, 1, 0],
    ]) {
      const full = new Uint8Array(100 * 100 * 4);
      const fullPreview = new Uint8Array(full.length);
      for (let pixel = 0; pixel < 10_000; pixel += 1) {
        full.set([0, 255, 0, 255], pixel * 4);
        fullPreview.set([0, 255, 0, 255], pixel * 4);
      }
      let cursor = 0;
      counts.forEach((count, colorIndex) => {
        for (let index = 0; index < count; index += 1) {
          full.set([...regionColors[colorIndex], 255], cursor * 4);
          fullPreview.set([...regionColors[colorIndex], 128], cursor * 4);
          cursor += 1;
        }
      });
      const expected = batchCore.selectReferenceProtectedColors(
        region,
        6,
        1,
        { r: 0, g: 255, b: 0 },
        {
          previewData: regionPreview,
          maximumColors: 5,
          coverageThreshold: 100,
          fullOriginalData: full,
          fullPreviewData: fullPreview,
          fullWidth: 100,
          fullHeight: 100,
        },
      );
      const allocations = [
        allocate(wasm, region),
        allocate(wasm, regionPreview),
        allocate(wasm, full),
        allocate(wasm, fullPreview),
        allocate(wasm, 16 + 5 * 8),
      ];
      const [input, preview, fullInput, fullPreviewAllocation, output] = allocations;
      try {
        assert.equal(
          wasm.protected_core_select_protection_colors(
            input.pointer,
            input.length,
            preview.pointer,
            preview.length,
            6,
            1,
            0x00ff00,
            5,
            100,
            0,
            0,
            fullInput.pointer,
            fullInput.length,
            fullPreviewAllocation.pointer,
            fullPreviewAllocation.length,
            100,
            100,
            output.pointer,
            output.length,
          ),
          0,
        );
        const bytes = new Uint8Array(
          wasm.memory.buffer.slice(output.pointer, output.pointer + output.length),
        );
        const colors = Array.from({ length: bytes[2] }, (_, index) => {
          const offset = 16 + index * 8;
          return {
            r: bytes[offset],
            g: bytes[offset + 1],
            b: bytes[offset + 2],
            count: new DataView(bytes.buffer).getUint32(offset + 4, true),
          };
        });
        assert.deepEqual(
          { colors, count: bytes[2], coverage: bytes[3], status: bytes[1] },
          {
            colors: expected.colors,
            count: expected.count,
            coverage: expected.coverage,
            status: expected.status,
          },
          `full counts ${counts.join("/")}`,
        );
      } finally {
        releaseAll(wasm, allocations);
      }
    }
  },
);

test(
  "private fp_kernel_04 semantics match fixed and deterministic random masks",
  { skip: skipReason },
  async () => {
    const wasm = await loadExports();
    let state = 0x9e3779b9;
    const nextByte = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 28 === 0 ? 1 : 0;
    };
    const fixtures = [{ width: 3, height: 3, mask: Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]) }];
    for (let fixture = 0; fixture < 40; fixture += 1) {
      const width = 1 + (fixture % 11);
      const height = 1 + ((fixture * 7) % 9);
      fixtures.push({ width, height, mask: Uint8Array.from({ length: width * height }, nextByte) });
    }
    for (const { width, height, mask } of fixtures) {
      const expected = connectivity.chamfer345Distance(mask, width, height);
      const input = allocate(wasm, mask);
      const output = allocate(wasm, expected.length * 2);
      try {
        assert.equal(
          wasm.protected_core_distance_field(
            input.pointer,
            input.length,
            width,
            height,
            output.pointer,
            output.length,
          ),
          0,
        );
        const actual = new Int16Array(
          wasm.memory.buffer.slice(output.pointer, output.pointer + output.length),
        );
        assert.deepEqual([...actual], [...expected]);
      } finally {
        releaseAll(wasm, [input, output]);
      }
    }
  },
);

test("private fp_kernel_05 semantics match PCA frames and degeneracy", { skip: skipReason }, async () => {
  const wasm = await loadExports();
  const fixtures = [
    { width: 4, height: 3, mask: Uint8Array.from([0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0]), previous: null },
    { width: 3, height: 3, mask: Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1]), previous: { ux: 0, uy: -1 } },
    { width: 5, height: 1, mask: Uint8Array.from([1, 1, 1, 1, 1]), previous: { ux: -1, uy: 0 } },
  ];
  for (const fixture of fixtures) {
    const expected = tracking.computeReferenceLocalFrame(
      fixture.mask,
      fixture.width,
      fixture.height,
      fixture.previous,
    );
    assert.ok(expected);
    const input = allocate(wasm, fixture.mask);
    const output = allocate(wasm, 72);
    try {
      const previous = fixture.previous || { ux: 0, uy: 0 };
      assert.equal(
        wasm.protected_core_local_frame(
          input.pointer,
          input.length,
          fixture.width,
          fixture.height,
          Number(Boolean(fixture.previous)),
          previous.ux,
          previous.uy,
          output.pointer,
          output.length,
        ),
        0,
      );
      const bytes = new Uint8Array(wasm.memory.buffer.slice(output.pointer, output.pointer + output.length));
      assert.equal(bytes[0], 1);
      assert.equal(Boolean(bytes[1] & 1), expected.isotropic === true);
      [
        expected.ux,
        expected.uy,
        expected.vx,
        expected.vy,
        expected.cx,
        expected.cy,
        expected.majorLen,
        expected.minorLen,
      ].forEach((value, index) => assertNear(readFloat64(bytes, 8 + index * 8), value));
    } finally {
      releaseAll(wasm, [input, output]);
    }
  }

  const input = allocate(wasm, Uint8Array.from([1, 1]));
  const output = allocate(wasm, 72);
  try {
    assert.equal(
      wasm.protected_core_local_frame(input.pointer, input.length, 2, 1, 0, 0, 0, output.pointer, 72),
      6,
    );
  } finally {
    releaseAll(wasm, [input, output]);
  }
});

test("private fp_kernel_11 semantics match layered shape decisions", { skip: skipReason }, async () => {
  const wasm = await loadExports();
  const fixtures = [
    {
      width: 4,
      height: 2,
      mask: Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1]),
      seed: { area: 8, pcaMajor: 3, pcaMinor: 1, compactness: null },
    },
    {
      width: 3,
      height: 1,
      mask: Uint8Array.from([1, 1, 1]),
      seed: { area: 10, pcaMajor: 2, pcaMinor: 0, compactness: null },
    },
  ];
  for (const fixture of fixtures) {
    const expected = tracking.checkReferenceShapeMatch(
      fixture.mask,
      fixture.width,
      fixture.height,
      fixture.seed,
    );
    const input = allocate(wasm, fixture.mask);
    const output = allocate(wasm, 64);
    try {
      assert.equal(
        wasm.protected_core_shape_match(
          input.pointer,
          input.length,
          fixture.width,
          fixture.height,
          1,
          fixture.seed.area,
          fixture.seed.pcaMajor,
          fixture.seed.pcaMinor,
          Number(fixture.seed.compactness != null),
          fixture.seed.compactness || 0,
          output.pointer,
          output.length,
        ),
        0,
      );
      const bytes = new Uint8Array(wasm.memory.buffer.slice(output.pointer, output.pointer + output.length));
      assert.equal(Boolean(bytes[1]), expected.passed);
      assert.deepEqual(
        [...bytes.slice(2, 5)].map((value) => (value === 255 ? null : Boolean(value))),
        expected.layerPassed,
      );
      if (expected.ratioA != null) assertNear(readFloat64(bytes, 8), expected.ratioA);
    } finally {
      releaseAll(wasm, [input, output]);
    }
  }
});

test(
  "private fp_kernel_08 semantics preserve bytes for representative edge fixtures",
  { skip: skipReason },
  async () => {
    const wasm = await loadExports();
    const source = Uint8Array.from([220, 30, 30, 255, 130, 120, 30, 255, 20, 220, 20, 255, 40, 200, 40, 0]);
    const options = { tolerance: 30, edgeRadius: 1, backgroundRadius: 60 };
    const expected = batchCore.applyReferenceEdgeColorRestore(
      source,
      4,
      1,
      { r: 220, g: 30, b: 30 },
      { r: 20, g: 220, b: 20 },
      options,
    );
    const input = allocate(wasm, source);
    const output = allocate(wasm, source.length);
    try {
      const pack = ({ r, g, b }) => r | (g << 8) | (b << 16);
      assert.equal(
        wasm.protected_core_restore_edges(
          input.pointer,
          input.length,
          4,
          1,
          pack({ r: 220, g: 30, b: 30 }),
          pack({ r: 20, g: 220, b: 20 }),
          options.tolerance,
          options.edgeRadius,
          options.backgroundRadius,
          0,
          0,
          output.pointer,
          output.length,
        ),
        0,
      );
      const actual = new Uint8Array(wasm.memory.buffer.slice(output.pointer, output.pointer + output.length));
      assert.deepEqual([...actual], [...expected]);
    } finally {
      releaseAll(wasm, [input, output]);
    }
  },
);

test(
  "WASM ABI rejects zero dimensions, undersized output, overlap, and oversized allocation",
  { skip: skipReason },
  async () => {
    const wasm = await loadExports();
    const input = allocate(wasm, Uint8Array.from([1]));
    const output = allocate(wasm, 2);
    try {
      assert.equal(wasm.protected_core_distance_field(input.pointer, 1, 0, 1, output.pointer, 2), 2);
      assert.equal(wasm.protected_core_distance_field(input.pointer, 1, 1, 1, output.pointer, 1), 4);
      assert.equal(wasm.protected_core_distance_field(input.pointer, 1, 1, 1, input.pointer, 2), 5);
      assert.equal(wasm.protected_core_reserve(128 * 1024 * 1024 + 1), 0);
      assert.equal(wasm.protected_core_distance_field(1, 1, 1, 1, output.pointer, 2), 8);
      assert.equal(wasm.protected_core_release(1, 1), 8);
      assert.equal(wasm.protected_core_release(input.pointer, input.length + 1), 8);
    } finally {
      releaseAll(wasm, [input, output]);
    }
  },
);

test(
  "WASM allocation registry rejects double-free and absent shape seeds ignore NaN fields",
  { skip: skipReason },
  async () => {
    const wasm = await loadExports();
    const input = allocate(wasm, Uint8Array.from([1, 1, 1]));
    const output = allocate(wasm, 64);
    assert.equal(
      wasm.protected_core_shape_match(
        input.pointer,
        input.length,
        3,
        1,
        0,
        0,
        Number.NaN,
        Number.NaN,
        0,
        Number.NaN,
        output.pointer,
        output.length,
      ),
      0,
    );
    assert.equal(wasm.protected_core_release(input.pointer, input.length), 0);
    assert.equal(wasm.protected_core_release(input.pointer, input.length), 8);
    assert.equal(wasm.protected_core_release(output.pointer, output.length), 0);
  },
);
