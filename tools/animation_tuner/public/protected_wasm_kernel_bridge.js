(function attachProtectedWasmKernelBridge(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ProtectedWasmKernelBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const PRODUCT_CONFIGURATION_BYTES = 64;
  const STATUS_OK = 0;

  /**
   * Converts one unknown channel value to an unsigned byte.
   * @param {unknown} value Candidate channel.
   * @param {number} fallback Fallback channel.
   * @returns {number} Normalized channel.
   */
  function byte(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(255, Math.round(numeric))) : fallback;
  }

  /**
   * Converts one unknown scalar to a bounded integer.
   * @param {unknown} value Candidate value.
   * @param {number} minimum Lower bound.
   * @param {number} maximum Upper bound.
   * @param {number} fallback Fallback value.
   * @returns {number} Normalized integer.
   */
  function integer(value, minimum, maximum, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, Math.trunc(numeric))) : fallback;
  }

  /**
   * Resolves the reference color used by the JavaScript compatibility contract.
   * @param {Uint8Array|Uint8ClampedArray} source Source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {object} seed Seed coordinate.
   * @param {object} options Kernel options.
   * @returns {{r:number,g:number,b:number,a:number}} Reference RGBA.
   */
  function referenceColor(source, width, height, seed, options) {
    if (options?.referenceColor) {
      return {
        r: byte(options.referenceColor.r),
        g: byte(options.referenceColor.g),
        b: byte(options.referenceColor.b),
        a: byte(options.referenceColor.a, 255),
      };
    }
    const x = integer(seed?.x, 0, width - 1);
    const y = integer(seed?.y, 0, height - 1);
    const offset = (y * width + x) * 4;
    return {
      r: source[offset],
      g: source[offset + 1],
      b: source[offset + 2],
      a: source[offset + 3],
    };
  }

  /**
   * Encodes the stable 64-byte Rust product configuration.
   * @param {object} values Normalized product values.
   * @returns {Uint8Array} ABI configuration bytes.
   */
  function encodeConfiguration(values) {
    const bytes = new Uint8Array(PRODUCT_CONFIGURATION_BYTES);
    const view = new DataView(bytes.buffer);
    bytes[0] = 1;
    bytes[1] = values.connected ? 1 : 0;
    bytes[2] = integer(values.blendMode, 0, 3);
    bytes[3] = integer(values.edgeMode, 0, 2);
    bytes[4] = 1 | (values.explicitDespill ? 2 : 0);
    bytes[6] = byte(values.alphaHigh);
    bytes[7] = byte(values.alphaLow);
    view.setInt32(8, values.seedX, true);
    view.setInt32(12, values.seedY, true);
    bytes.set([values.reference.r, values.reference.g, values.reference.b, values.reference.a], 16);
    bytes.set([values.replacement.r, values.replacement.g, values.replacement.b, values.replacement.a], 20);
    bytes.set([values.despill.r, values.despill.g, values.despill.b], 24);
    view.setInt32(28, values.tolerance, true);
    view.setInt32(32, values.edgeEnhance, true);
    view.setInt32(36, values.blendStrength, true);
    view.setInt32(40, values.despillStrength, true);
    view.setInt32(44, values.edgeRadius, true);
    return bytes;
  }

  /**
   * Creates an isolated bridge so tests and Workers do not share allocation state.
   * @param {{artifactLoader?:object,WebAssembly?:typeof WebAssembly}} [injected] Runtime dependencies.
   * @returns {object} WASM kernel bridge.
   */
  function createBridge(injected = {}) {
    const WebAssemblyApi = injected.WebAssembly || root?.WebAssembly;
    let exports = null;
    let initialization = null;

    /**
     * Loads and instantiates the verified protected artifact exactly once.
     * @param {{loader?:object,loadOptions?:object,bytes?:ArrayBuffer}} options Initialization options.
     * @returns {Promise<void>} Initialization completion.
     */
    function initialize(options = {}) {
      if (exports) return Promise.resolve();
      if (initialization) return initialization;
      initialization = Promise.resolve()
        .then(async () => {
          if (!WebAssemblyApi?.instantiate) throw new Error("ENGINE_PRODUCTION_DEPENDENCY_MISSING");
          const loader = options.loader || injected.artifactLoader;
          const bytes = options.bytes || (await loader?.load(options.loadOptions));
          if (!(bytes instanceof ArrayBuffer)) throw new Error("ENGINE_ARTIFACT_PROTOCOL_INVALID");
          const result = await WebAssemblyApi.instantiate(bytes, {});
          const instance = result?.instance || result;
          if (
            typeof instance?.exports?.protected_core_reserve !== "function" ||
            typeof instance?.exports?.protected_core_release !== "function" ||
            typeof instance?.exports?.protected_core_apply_cutout !== "function" ||
            !(instance?.exports?.memory instanceof WebAssemblyApi.Memory)
          ) {
            throw new Error("ENGINE_ARTIFACT_PROTOCOL_INVALID");
          }
          exports = instance.exports;
        })
        .catch((error) => {
          initialization = null;
          throw error;
        });
      return initialization;
    }

    /**
     * Allocates and initializes one owned WASM buffer.
     * @param {Uint8Array|Uint8ClampedArray|number} input Bytes or required length.
     * @returns {{pointer:number,length:number}} Allocation record.
     */
    function allocate(input) {
      const bytes = typeof input === "number" ? new Uint8Array(input) : new Uint8Array(input);
      const pointer = exports.protected_core_reserve(bytes.length);
      if (!pointer) throw new Error("ENGINE_EXECUTION_FAILED");
      if (bytes.length) new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes);
      return { pointer, length: bytes.length };
    }

    /**
     * Releases owned buffers in reverse allocation order.
     * @param {Array<{pointer:number,length:number}>} allocations Allocation records.
     * @returns {void}
     */
    function releaseAll(allocations) {
      for (const allocation of allocations.reverse()) {
        const status = exports.protected_core_release(allocation.pointer, allocation.length);
        if (status !== STATUS_OK) throw new Error("ENGINE_EXECUTION_FAILED");
      }
    }

    /**
     * Runs global color replacement or connected selection repair in WASM.
     * @param {boolean} connected Whether to use connected selection semantics.
     * @param {Uint8Array|Uint8ClampedArray} source Source RGBA bytes.
     * @param {number} width Image width.
     * @param {number} height Image height.
     * @param {object} seed Seed coordinate.
     * @param {object} replacement Replacement RGBA.
     * @param {number} tolerance Color tolerance.
     * @param {object} options Kernel options.
     * @returns {Uint8ClampedArray} Owned result bytes.
     */
    function applyCutout(connected, source, width, height, seed, replacement, tolerance, options = {}) {
      if (!exports) throw new Error("ENGINE_PRODUCTION_DEPENDENCY_MISSING");
      if (
        (!(source instanceof Uint8Array) && !(source instanceof Uint8ClampedArray)) ||
        source.length !== width * height * 4
      ) {
        throw new Error("ENGINE_INVALID_REQUEST");
      }
      const reference = referenceColor(source, width, height, seed, options);
      const despillSource = options.despillRefColor || reference;
      const configuration = encodeConfiguration({
        connected,
        blendMode: options.despillMode,
        edgeMode: options.edgeRestoreMode,
        alphaHigh: options.alphaThresholdHigh,
        alphaLow: options.alphaThresholdLow,
        seedX: integer(seed?.x, 0, width - 1),
        seedY: integer(seed?.y, 0, height - 1),
        reference,
        replacement: {
          r: byte(replacement?.r),
          g: byte(replacement?.g),
          b: byte(replacement?.b),
          a: byte(replacement?.a, 255),
        },
        explicitDespill: Boolean(options.despillRefColor),
        despill: {
          r: byte(despillSource.r),
          g: byte(despillSource.g),
          b: byte(despillSource.b),
        },
        tolerance: integer(tolerance, -1, 100),
        edgeEnhance: integer(options.edgeEnhance, 0, 100),
        blendStrength: integer(options.blendStrength, 0, 100),
        despillStrength: integer(options.despillStrength, 0, 100),
        edgeRadius: integer(options.edgeRestoreRadius, 0, 600),
      });
      const mask = options.mask ? new Uint8Array(options.mask) : null;
      const protectedColors = connected
        ? null
        : Uint8Array.from(
            (Array.isArray(options.protectColors) ? options.protectColors.slice(0, 32) : []).flatMap(
              (color) => [byte(color?.r), byte(color?.g), byte(color?.b)],
            ),
          );
      const allocations = [allocate(source), allocate(configuration), allocate(source.length)];
      if (mask) allocations.push(allocate(mask));
      if (protectedColors?.length) allocations.push(allocate(protectedColors));
      const [input, config, output] = allocations;
      const maskAllocation = mask ? allocations[3] : { pointer: 0, length: 0 };
      const colorsAllocation = protectedColors?.length
        ? allocations[mask ? 4 : 3]
        : { pointer: 0, length: 0 };
      try {
        const status = exports.protected_core_apply_cutout(
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
        );
        if (status !== STATUS_OK) throw new Error("ENGINE_EXECUTION_FAILED");
        return new Uint8ClampedArray(
          exports.memory.buffer.slice(output.pointer, output.pointer + output.length),
        );
      } finally {
        releaseAll(allocations);
      }
    }

    /**
     * Selects representative protection colors inside one source rectangle.
     * @param {Uint8Array|Uint8ClampedArray} source Full source RGBA bytes.
     * @param {number} width Full source width.
     * @param {number} height Full source height.
     * @param {object} rectangle Selection rectangle.
     * @param {object} options Product selection options.
     * @returns {{colors:Array<object>,count:number,coverage:number,status:number,sampleCount:number}} Selection result.
     */
    function selectProtectionColors(source, width, height, rectangle, options = {}) {
      if (!exports) throw new Error("ENGINE_PRODUCTION_DEPENDENCY_MISSING");
      if (
        (!(source instanceof Uint8Array) && !(source instanceof Uint8ClampedArray)) ||
        source.length !== width * height * 4 ||
        ![rectangle?.x1, rectangle?.y1, rectangle?.x2, rectangle?.y2].every(Number.isFinite)
      ) {
        throw new Error("ENGINE_INVALID_REQUEST");
      }
      const startX = Math.max(0, Math.floor(Math.min(rectangle.x1, rectangle.x2)));
      const endX = Math.min(width - 1, Math.ceil(Math.max(rectangle.x1, rectangle.x2)));
      const startY = Math.max(0, Math.floor(Math.min(rectangle.y1, rectangle.y2)));
      const endY = Math.min(height - 1, Math.ceil(Math.max(rectangle.y1, rectangle.y2)));
      const regionWidth = Math.max(0, endX - startX + 1);
      const regionHeight = Math.max(0, endY - startY + 1);
      if (!regionWidth || !regionHeight) {
        return { colors: [], count: 0, coverage: 100, status: 0, sampleCount: 0 };
      }
      const preview = options.previewData || null;
      if (preview && preview.length !== source.length) throw new Error("ENGINE_INVALID_REQUEST");
      const region = new Uint8Array(regionWidth * regionHeight * 4);
      const regionPreview = preview ? new Uint8Array(region.length) : null;
      for (let y = startY; y <= endY; y += 1) {
        const sourceOffset = (y * width + startX) * 4;
        const targetOffset = (y - startY) * regionWidth * 4;
        region.set(source.subarray(sourceOffset, sourceOffset + regionWidth * 4), targetOffset);
        if (regionPreview) {
          regionPreview.set(preview.subarray(sourceOffset, sourceOffset + regionWidth * 4), targetOffset);
        }
      }
      const maximumColors = integer(options.maximumColors, 1, 32, 32);
      const coverageThreshold = integer(Math.round(Number(options.coverage ?? 0.95) * 100), 0, 100, 95);
      const background = options.excludeColors?.[0] || options.backgroundColor || { r: 0, g: 255, b: 0 };
      const existingBytes = Uint8Array.from(
        (Array.isArray(options.existingColors) ? options.existingColors.slice(0, 32) : []).flatMap(
          (color) => [
            byte(color?.r ?? color?.[0]),
            byte(color?.g ?? color?.[1]),
            byte(color?.b ?? color?.[2]),
          ],
        ),
      );
      const allocations = [];
      const own = (value) => {
        const allocation = allocate(value);
        allocations.push(allocation);
        return allocation;
      };
      const input = own(region);
      const previewAllocation = regionPreview ? own(regionPreview) : { pointer: 0, length: 0 };
      const existingAllocation = existingBytes.length ? own(existingBytes) : { pointer: 0, length: 0 };
      const fullInput = regionPreview ? own(source) : { pointer: 0, length: 0 };
      const fullPreview = regionPreview ? own(preview) : { pointer: 0, length: 0 };
      const output = own(16 + maximumColors * 8);
      try {
        const status = exports.protected_core_select_protection_colors(
          input.pointer,
          input.length,
          previewAllocation.pointer,
          previewAllocation.length,
          regionWidth,
          regionHeight,
          byte(background.r) | (byte(background.g) << 8) | (byte(background.b) << 16),
          maximumColors,
          coverageThreshold,
          existingAllocation.pointer,
          existingAllocation.length,
          fullInput.pointer,
          fullInput.length,
          fullPreview.pointer,
          fullPreview.length,
          regionPreview ? width : 0,
          regionPreview ? height : 0,
          output.pointer,
          output.length,
        );
        if (status !== STATUS_OK) throw new Error("ENGINE_EXECUTION_FAILED");
        const bytes = new Uint8Array(
          exports.memory.buffer.slice(output.pointer, output.pointer + output.length),
        );
        const view = new DataView(bytes.buffer);
        const colors = Array.from({ length: bytes[2] }, (_, index) => {
          const offset = 16 + index * 8;
          return {
            r: bytes[offset],
            g: bytes[offset + 1],
            b: bytes[offset + 2],
            count: view.getUint32(offset + 4, true),
          };
        });
        return {
          colors,
          count: bytes[2],
          coverage: bytes[3],
          status: bytes[1],
          sampleCount: view.getUint32(4, true),
        };
      } finally {
        releaseAll(allocations);
      }
    }

    /**
     * Computes a PCA local frame through the protected Rust kernel.
     * @param {Uint8Array|Uint8ClampedArray} mask Binary subject mask.
     * @param {number} width Mask width.
     * @param {number} height Mask height.
     * @param {{ux:number,uy:number}|null} previousFrame Optional previous direction.
     * @returns {object|null} Local frame, or null for degenerate input.
     */
    function computeLocalFrame(mask, width, height, previousFrame = null) {
      if (!exports) throw new Error("ENGINE_PRODUCTION_DEPENDENCY_MISSING");
      const allocations = [allocate(mask), allocate(72)];
      const [input, output] = allocations;
      try {
        const hasPrevious = Number.isFinite(previousFrame?.ux) && Number.isFinite(previousFrame?.uy);
        const status = exports.protected_core_local_frame(
          input.pointer,
          input.length,
          width,
          height,
          hasPrevious ? 1 : 0,
          hasPrevious ? previousFrame.ux : 0,
          hasPrevious ? previousFrame.uy : 0,
          output.pointer,
          output.length,
        );
        if (status === 6) return null;
        if (status !== STATUS_OK) throw new Error("ENGINE_EXECUTION_FAILED");
        const bytes = new Uint8Array(exports.memory.buffer.slice(output.pointer, output.pointer + 72));
        const view = new DataView(bytes.buffer);
        const values = Array.from({ length: 8 }, (_, index) => view.getFloat64(8 + index * 8, true));
        return {
          ux: values[0],
          uy: values[1],
          vx: values[2],
          vy: values[3],
          cx: values[4],
          cy: values[5],
          majorLen: values[6],
          minorLen: values[7],
          ...(bytes[1] ? { isotropic: true } : {}),
        };
      } finally {
        releaseAll(allocations);
      }
    }

    /**
     * Applies the protected layered shape gate to one binary mask.
     * @param {Uint8Array|Uint8ClampedArray} mask Candidate mask.
     * @param {number} width Mask width.
     * @param {number} height Mask height.
     * @param {object|null} seed Seed shape statistics.
     * @returns {object} Shape comparison result.
     */
    function checkShapeMatch(mask, width, height, seed = null) {
      if (!exports) throw new Error("ENGINE_PRODUCTION_DEPENDENCY_MISSING");
      const allocations = [allocate(mask), allocate(64)];
      const [input, output] = allocations;
      try {
        const hasCompactness = seed?.compactness != null && Number.isFinite(Number(seed.compactness));
        const status = exports.protected_core_shape_match(
          input.pointer,
          input.length,
          width,
          height,
          seed ? 1 : 0,
          integer(seed?.area, -0x80000000, 0x7fffffff),
          Number(seed?.pcaMajor || 0),
          Number(seed?.pcaMinor || 0),
          hasCompactness ? 1 : 0,
          hasCompactness ? Number(seed.compactness) : 0,
          output.pointer,
          output.length,
        );
        if (status !== STATUS_OK) throw new Error("ENGINE_EXECUTION_FAILED");
        const bytes = new Uint8Array(exports.memory.buffer.slice(output.pointer, output.pointer + 64));
        const view = new DataView(bytes.buffer);
        const value = (index) => (bytes[7] & (1 << index) ? view.getFloat64(8 + index * 8, true) : null);
        const layerValue = (raw) => (raw === 255 ? null : Boolean(raw));
        const segments = [null, "degenerate", "elongated", "mid", "compact"];
        return {
          passed: Boolean(bytes[1]),
          ratioA: value(0),
          rSeed: value(1),
          rCand: value(2),
          rSegment: segments[bytes[5]] || null,
          ratioC: value(3),
          layerPassed: [layerValue(bytes[2]), layerValue(bytes[3]), layerValue(bytes[4])],
          candArea: value(4),
          candPerimeter: value(5),
          candCompactness: value(6),
        };
      } finally {
        releaseAll(allocations);
      }
    }

    /**
     * Restores contaminated edge colors through the protected Rust kernel.
     * @param {Uint8Array|Uint8ClampedArray} source Source RGBA bytes.
     * @param {number} width Image width.
     * @param {number} height Image height.
     * @param {object} correctColor Desired edge color.
     * @param {object} contaminatedColor Contaminated edge color.
     * @param {object} options Restoration options.
     * @returns {Uint8ClampedArray} Restored result.
     */
    function restoreEdges(source, width, height, correctColor, contaminatedColor, options = {}) {
      if (!exports) throw new Error("ENGINE_PRODUCTION_DEPENDENCY_MISSING");
      const mask = options.mask ? new Uint8Array(options.mask) : null;
      const allocations = [allocate(source), allocate(source.length)];
      if (mask) allocations.push(allocate(mask));
      const [input, output] = allocations;
      const maskAllocation = mask ? allocations[2] : { pointer: 0, length: 0 };
      const packColor = (color) => byte(color?.r) | (byte(color?.g) << 8) | (byte(color?.b) << 16);
      try {
        const status = exports.protected_core_restore_edges(
          input.pointer,
          input.length,
          width,
          height,
          packColor(correctColor),
          packColor(contaminatedColor),
          integer(options.tolerance, 0, 100, 30),
          integer(options.edgeRadius, 0, Math.max(width, height), 0),
          integer(options.backgroundRadius, 0, 255, 30),
          maskAllocation.pointer,
          maskAllocation.length,
          output.pointer,
          output.length,
        );
        if (status === 6) throw new RangeError("Protected edge restoration colors are too similar.");
        if (status !== STATUS_OK) throw new Error("ENGINE_EXECUTION_FAILED");
        return new Uint8ClampedArray(
          exports.memory.buffer.slice(output.pointer, output.pointer + output.length),
        );
      } finally {
        releaseAll(allocations);
      }
    }

    return Object.freeze({
      initialize,
      isReady: () => Boolean(exports),
      applyReferenceColorReplace(source, width, height, seed, replacement, tolerance, options) {
        return applyCutout(false, source, width, height, seed, replacement, tolerance, options);
      },
      applyReferenceFloodFillDespill(source, width, height, seed, replacement, tolerance, options) {
        return applyCutout(true, source, width, height, seed, replacement, tolerance, options);
      },
      selectProtectionColors,
      computeLocalFrame,
      checkShapeMatch,
      restoreEdges,
    });
  }

  const sharedBridge = createBridge();
  return Object.freeze({ createBridge, ...sharedBridge });
});
