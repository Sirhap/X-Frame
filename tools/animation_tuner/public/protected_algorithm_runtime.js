(function attachProtectedAlgorithmRuntime(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ProtectedAlgorithmRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const RUNTIME_PROTOCOL_VERSION = 1;
  const DEFAULT_RUNTIME_KEY = "__xsxbAlgorithmRuntime";
  const SAFE_ERROR_CODES = new Set([
    "ENGINE_CANCELLED",
    "ENGINE_DISPOSED",
    "ENGINE_EXECUTION_FAILED",
    "ENGINE_INTEGRITY_FAILED",
    "ENGINE_INVALID_CAPABILITIES",
    "ENGINE_INVALID_CANCELLATION_ID",
    "ENGINE_INVALID_REQUEST",
    "ENGINE_PRODUCTION_DEPENDENCY_MISSING",
    "ENGINE_TRANSPORT_FAILED",
    "ENGINE_UNSUPPORTED_OPERATION",
    "ENGINE_VERSION_MISMATCH",
  ]);

  class ProtectedAlgorithmError extends Error {
    /**
     * Creates a stable public runtime failure.
     * @param {string} code Machine-readable error code.
     * @param {string} [message] Safe public message.
     * @param {unknown} [cause] Private development cause.
     */
    constructor(code, message = code, cause) {
      super(message, cause === undefined ? undefined : { cause });
      this.name = "ProtectedAlgorithmError";
      this.code = code;
    }
  }

  /**
   * Validates and normalizes a product image request.
   * @param {object} image Image request.
   * @returns {{data:Uint8ClampedArray,width:number,height:number}} Normalized request.
   */
  function normalizeImage(image) {
    const width = Number(image?.width);
    const height = Number(image?.height);
    const data = image?.data;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new ProtectedAlgorithmError("ENGINE_INVALID_REQUEST");
    }
    if (!(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) {
      throw new ProtectedAlgorithmError("ENGINE_INVALID_REQUEST");
    }
    const expectedLength = width * height * 4;
    if (!Number.isSafeInteger(expectedLength) || data.length !== expectedLength) {
      throw new ProtectedAlgorithmError("ENGINE_INVALID_REQUEST");
    }
    return { data: new Uint8ClampedArray(data), width, height };
  }

  /**
   * Converts internal failures to stable production-safe errors.
   * @param {unknown} reason Failure value.
   * @param {boolean} includeDetails Whether development details are allowed.
   * @returns {ProtectedAlgorithmError} Stable failure.
   */
  function normalizeRuntimeError(reason, includeDetails) {
    if (reason instanceof ProtectedAlgorithmError) return reason;
    if (reason?.name === "AbortError") {
      return new ProtectedAlgorithmError("ENGINE_CANCELLED", "ENGINE_CANCELLED", reason);
    }
    const reportedCode = [reason?.code, reason?.message].find((value) => SAFE_ERROR_CODES.has(value));
    if (reportedCode) return new ProtectedAlgorithmError(reportedCode, reportedCode, reason);
    const code =
      reason?.code === "CUTOUT_WORKER_TRANSPORT_ERROR"
        ? "ENGINE_TRANSPORT_FAILED"
        : "ENGINE_EXECUTION_FAILED";
    const message = includeDetails && reason?.message ? `${code}: ${reason.message}` : code;
    return new ProtectedAlgorithmError(code, message, reason);
  }

  /**
   * Validates runtime initialization negotiation.
   * @param {number} runtimeVersion Requested protocol version.
   * @param {object} capabilities Capability object.
   * @returns {object} Frozen capability snapshot.
   */
  function validateInitialization(runtimeVersion, capabilities) {
    if (runtimeVersion !== RUNTIME_PROTOCOL_VERSION) {
      throw new ProtectedAlgorithmError("ENGINE_VERSION_MISMATCH");
    }
    if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
      throw new ProtectedAlgorithmError("ENGINE_INVALID_CAPABILITIES");
    }
    return Object.freeze({ ...capabilities });
  }

  /**
   * Adds tracking and quality metadata to a development product result.
   * @param {object} dependencies Development algorithm dependencies.
   * @param {object} result Product cutout result.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {object} parameters Product parameters.
   * @returns {object} Complete product result.
   */
  function decorateDevelopmentResult(dependencies, result, width, height, parameters) {
    const shapeCandidates = dependencies.tracking.createShapeCandidates(result.automaticData, width, height);
    const shapeDescriptor =
      shapeCandidates[0] || dependencies.tracking.createShapeDescriptor(result.automaticData, width, height);
    const qualityMetrics = dependencies.quality.createCutoutQualityMetrics(result.data, width, height, {
      backgroundColors: parameters?.backgroundColors,
      backgroundTolerance: Number(parameters?.tolerance || 0) + Number(parameters?.feather || 0),
    });
    return { ...result, qualityMetrics, shapeCandidates, shapeDescriptor };
  }

  /**
   * Runs one product-level repair tracking request for the development adapter.
   * @param {object} dependencies Tracking and local-tracking dependencies.
   * @param {{data:Uint8ClampedArray,width:number,height:number}} image Target image.
   * @param {object} parameters Product repair-tracking parameters.
   * @returns {object} Serializable tracking result.
   */
  function analyzeDevelopmentRepairTracking(dependencies, image, parameters) {
    const { tracking, localTracking } = dependencies;
    if (parameters.kind === "capture") {
      const localAnchor = localTracking.createLocalAnchor(
        image.data,
        image.width,
        image.height,
        parameters.point,
      );
      const sourceRegion = parameters.includeRegion
        ? localTracking.measureConnectedRegion(
            image.data,
            image.width,
            image.height,
            parameters.point,
            parameters.regionOptions || {},
          )
        : undefined;
      return { localAnchor, ...(parameters.includeRegion ? { sourceRegion } : {}) };
    }
    if (parameters.kind !== "map-target") {
      throw new ProtectedAlgorithmError("ENGINE_UNSUPPORTED_OPERATION");
    }
    const trackingState =
      parameters.trackingState || tracking.createTrackingState(parameters.sourceDescriptor);
    const sourceDescriptor = parameters.sourceDescriptor;
    const repair = parameters.repair;
    const repairCenter = parameters.repairCenter;
    const useCanvasMapping = parameters.useCanvasMapping === true;
    const isBrushRepair = parameters.isBrushRepair === true;
    const isPointRepair = parameters.isPointRepair === true;
    const match = useCanvasMapping
      ? { candidate: parameters.targetDescriptor || sourceDescriptor, reacquisitionLevel: 0 }
      : tracking.selectTrackedCandidate(sourceDescriptor, parameters.targetCandidates, trackingState);
    if (!match) {
      tracking.advanceTrackingState(trackingState, null);
      return {
        accepted: false,
        trackingState,
        localFailureStreak: Number(parameters.localFailureStreak || 0) + 1,
      };
    }
    tracking.advanceTrackingState(trackingState, match.candidate);
    const targetDescriptor = match.candidate;
    const pointGeometry = isPointRepair ? { ...repair, points: [{ x: repair.x, y: repair.y }] } : repair;
    let mappedGeometry =
      useCanvasMapping && (isBrushRepair || isPointRepair)
        ? tracking.mapCanvasBrushStroke(pointGeometry, parameters.sourceImage, image)
        : useCanvasMapping
          ? tracking.mapCanvasRectangle(repair, parameters.sourceImage, image)
          : isBrushRepair || isPointRepair
            ? tracking.mapBrushStroke(pointGeometry, sourceDescriptor, targetDescriptor)
            : tracking.mapRectangle(repair, sourceDescriptor, targetDescriptor);
    if ((isBrushRepair || isPointRepair) && !mappedGeometry.points.length) {
      return {
        accepted: false,
        trackingState,
        localFailureStreak: Number(parameters.localFailureStreak || 0) + 1,
      };
    }
    let mappedCenter = useCanvasMapping
      ? tracking.mapCanvasPoint(repairCenter, parameters.sourceImage, image)
      : isBrushRepair || isPointRepair
        ? mappedGeometry.points.reduce(
            (center, point) => ({
              x: center.x + point.x / mappedGeometry.points.length,
              y: center.y + point.y / mappedGeometry.points.length,
            }),
            { x: 0, y: 0 },
          )
        : {
            x: (mappedGeometry.x1 + mappedGeometry.x2) / 2,
            y: (mappedGeometry.y1 + mappedGeometry.y2) / 2,
          };
    const localFailureStreak = Number(parameters.localFailureStreak || 0);
    const localPrediction = useCanvasMapping
      ? mappedCenter
      : parameters.localAnchor && parameters.localAnchorDescriptor
        ? tracking.mapPoint(parameters.localAnchor.point, parameters.localAnchorDescriptor, targetDescriptor)
        : mappedCenter;
    const transparentRegionMatch =
      !useCanvasMapping && parameters.trackTransparentRegion
        ? localTracking.findMatchingTransparentRegion(
            image.data,
            image.width,
            image.height,
            parameters.sourceRegion,
            localPrediction,
            {
              tolerance: repair.tolerance,
              searchRadius: Math.min(
                180,
                Math.max(72, targetDescriptor.minorLength * 0.75 + localFailureStreak * 20),
              ),
            },
          )
        : null;
    const localMatch = useCanvasMapping
      ? { matched: true, point: mappedCenter }
      : transparentRegionMatch
        ? { matched: true, point: transparentRegionMatch.point }
        : parameters.localAnchor && !parameters.trackTransparentRegion
          ? localTracking.trackLocalAnchor(
              parameters.localAnchor,
              image.data,
              image.width,
              image.height,
              localPrediction,
              {
                searchRadius: Math.min(
                  96,
                  Math.max(32, targetDescriptor.minorLength * 0.4 + localFailureStreak * 16),
                ),
              },
            )
          : null;
    if ((isPointRepair || match.reacquisitionLevel > 0) && !localMatch?.matched) {
      return { accepted: false, trackingState, localFailureStreak: localFailureStreak + 1 };
    }
    let nextLocalAnchor = parameters.localAnchor;
    let nextLocalAnchorDescriptor = parameters.localAnchorDescriptor;
    let nextFailureStreak = localFailureStreak + 1;
    if (localMatch?.matched) {
      const offsetX = localMatch.point.x - mappedCenter.x;
      const offsetY = localMatch.point.y - mappedCenter.y;
      mappedGeometry =
        isBrushRepair || isPointRepair
          ? {
              ...mappedGeometry,
              points: mappedGeometry.points.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY })),
            }
          : {
              ...mappedGeometry,
              x1: mappedGeometry.x1 + offsetX,
              y1: mappedGeometry.y1 + offsetY,
              x2: mappedGeometry.x2 + offsetX,
              y2: mappedGeometry.y2 + offsetY,
            };
      mappedCenter = { ...localMatch.point };
      nextLocalAnchor = localTracking.createLocalAnchor(image.data, image.width, image.height, mappedCenter);
      nextLocalAnchorDescriptor = targetDescriptor;
      nextFailureStreak = 0;
    }
    const backgroundColor = tracking.sampleMatchingColor(
      parameters.originalData || image.data,
      image.width,
      image.height,
      parameters.backgroundColor,
      mappedCenter,
      15,
    );
    const sourceOffset =
      (Math.max(0, Math.min(image.height - 1, Math.round(mappedCenter.y))) * image.width +
        Math.max(0, Math.min(image.width - 1, Math.round(mappedCenter.x)))) *
      4;
    const targetSourceColor = isPointRepair
      ? {
          r: image.data[sourceOffset],
          g: image.data[sourceOffset + 1],
          b: image.data[sourceOffset + 2],
          a: image.data[sourceOffset + 3],
        }
      : null;
    let propagatedRegion = null;
    if (isPointRepair && repair.scope !== "global") {
      const regionLimit = parameters.sourceRegion
        ? Math.max(parameters.sourceRegion.count * 6 + 1, parameters.sourceRegion.count + 257)
        : Math.round(image.width * image.height * 0.08);
      propagatedRegion =
        transparentRegionMatch?.region ||
        localTracking.measureConnectedRegion(image.data, image.width, image.height, mappedCenter, {
          sourceColor: targetSourceColor,
          tolerance: repair.tolerance,
          maximumPixels: regionLimit,
        });
      if (!localTracking.compareConnectedRegions(parameters.sourceRegion, propagatedRegion).accepted) {
        return { accepted: false, trackingState, localFailureStreak: nextFailureStreak };
      }
    }
    return {
      accepted: true,
      trackingState,
      targetDescriptor,
      mappedGeometry,
      mappedCenter,
      localAnchor: nextLocalAnchor,
      localAnchorDescriptor: nextLocalAnchorDescriptor,
      localFailureStreak: nextFailureStreak,
      backgroundColor,
      targetSourceColor,
      propagatedRegion,
    };
  }

  /**
   * Creates the readable JavaScript adapter used only by development and tests.
   * @param {object} dependencies Core JavaScript dependencies.
   * @returns {object} Development adapter.
   */
  function createDevelopmentJsAdapter(dependencies) {
    if (
      typeof dependencies?.cutout?.applyProductCutout !== "function" ||
      typeof dependencies?.cutout?.createProtectedRegionMask !== "function" ||
      typeof dependencies?.cutout?.selectProtectedColorsInRectangle !== "function" ||
      typeof dependencies?.tracking?.createShapeCandidates !== "function" ||
      typeof dependencies?.localTracking?.createLocalAnchor !== "function" ||
      typeof dependencies?.quality?.createCutoutQualityMetrics !== "function" ||
      typeof dependencies?.quality?.analyzeCutoutQualitySequence !== "function" ||
      typeof dependencies?.frame?.createSignature !== "function" ||
      typeof dependencies?.frame?.findLoopCandidatesAsync !== "function"
    ) {
      throw new ProtectedAlgorithmError("ENGINE_DEVELOPMENT_DEPENDENCY_MISSING");
    }
    let disposed = false;
    return Object.freeze({
      mode: "development-js",
      async initialize(runtimeVersion, capabilities) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        return validateInitialization(runtimeVersion, capabilities);
      },
      async applyProductCutout(image, parameters = {}) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        const normalized = normalizeImage(image);
        const repairs = Array.isArray(parameters.repairs) ? parameters.repairs : [];
        const options = parameters.processingOptions || parameters;
        const result = dependencies.cutout.applyProductCutout(
          normalized.data,
          normalized.width,
          normalized.height,
          options,
          repairs,
        );
        return decorateDevelopmentResult(dependencies, result, normalized.width, normalized.height, options);
      },
      async applySelectionRepair(image, mask, parameters = {}) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        const normalized = normalizeImage(image);
        if (!(mask instanceof Uint8Array) || mask.length !== normalized.width * normalized.height) {
          throw new ProtectedAlgorithmError("ENGINE_INVALID_REQUEST");
        }
        const rectangle = parameters.rectangle;
        if (![rectangle?.x1, rectangle?.y1, rectangle?.x2, rectangle?.y2].every(Number.isFinite)) {
          throw new ProtectedAlgorithmError("ENGINE_INVALID_REQUEST");
        }
        if (parameters.mode === "protect-range") {
          return dependencies.cutout.createProtectedRegionMask(
            normalized.data,
            parameters.previewData || null,
            normalized.width,
            normalized.height,
            rectangle,
            parameters.options || {},
          );
        }
        if (parameters.mode === "protect-color") {
          return dependencies.cutout.selectProtectedColorsInRectangle(
            normalized.data,
            normalized.width,
            normalized.height,
            rectangle,
            { ...(parameters.options || {}), previewData: parameters.previewData || null },
          );
        }
        throw new ProtectedAlgorithmError("ENGINE_UNSUPPORTED_OPERATION");
      },
      async analyzeCutoutSequence(metrics, parameters = {}) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        if (!Array.isArray(metrics)) throw new ProtectedAlgorithmError("ENGINE_INVALID_REQUEST");
        return dependencies.quality.analyzeCutoutQualitySequence(metrics, parameters);
      },
      async analyzeRepairTracking(image, parameters = {}) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        return analyzeDevelopmentRepairTracking(dependencies, normalizeImage(image), parameters);
      },
      async analyzeFrameSequence(frames, parameters = {}, _cancellationId, callbacks = {}) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        const operation = parameters.operation || "loop";
        const signatures = frames.map((frame) =>
          dependencies.frame.createSignature(frame.data || frame, frame.width, frame.height),
        );
        if (operation === "loop") {
          return dependencies.frame.findLoopCandidatesAsync(signatures, parameters, callbacks);
        }
        const context = dependencies.frame.createSequenceAnalysisContext(signatures);
        if (operation === "jump") {
          return dependencies.frame.analyzeJumpFrames(signatures, parameters.threshold, context);
        }
        if (operation === "duplicate") {
          return dependencies.frame.analyzeDuplicateFrames(signatures, parameters.threshold, context);
        }
        throw new ProtectedAlgorithmError("ENGINE_UNSUPPORTED_OPERATION");
      },
      cancel() {},
      dispose() {
        disposed = true;
      },
    });
  }

  /**
   * Creates the production Worker adapter without any JavaScript algorithm fallback.
   * @param {object} dependencies Worker client dependencies.
   * @returns {object} Production adapter.
   */
  function createProductionWorkerAdapter(dependencies) {
    if (
      typeof dependencies?.cutoutClient?.createExecutor !== "function" ||
      typeof dependencies?.frameClient?.createExecutor !== "function"
    ) {
      throw new ProtectedAlgorithmError("ENGINE_PRODUCTION_DEPENDENCY_MISSING");
    }
    const cutoutExecutor = dependencies.cutoutClient.createExecutor({
      WorkerConstructor: dependencies.WorkerConstructor,
      workerUrl: dependencies.cutoutWorkerUrl,
      allowSyncFallback: false,
      syncProcess: null,
    });
    const frameExecutor = dependencies.frameClient.createExecutor({
      WorkerConstructor: dependencies.WorkerConstructor,
      workerUrl: dependencies.frameWorkerUrl,
      fallback: null,
    });
    if (
      typeof cutoutExecutor.selectionRepair !== "function" ||
      typeof cutoutExecutor.analyzeQuality !== "function" ||
      typeof cutoutExecutor.analyzeRepairTracking !== "function"
    ) {
      cutoutExecutor.dispose?.();
      frameExecutor.dispose?.();
      throw new ProtectedAlgorithmError("ENGINE_PRODUCTION_DEPENDENCY_MISSING");
    }
    const activeCutoutRequests = new Set();
    const activeFrameRequests = new Set();
    let disposed = false;
    return Object.freeze({
      mode: "production-worker",
      async initialize(runtimeVersion, capabilities) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        return validateInitialization(runtimeVersion, capabilities);
      },
      async applyProductCutout(image, parameters = {}, cancellationId) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        const normalized = normalizeImage(image);
        activeCutoutRequests.add(cancellationId);
        try {
          return await cutoutExecutor.process(
            normalized.data,
            normalized.width,
            normalized.height,
            parameters.processingOptions || parameters,
            parameters.repairs || [],
            { cancellationId, protocolVersion: RUNTIME_PROTOCOL_VERSION },
          );
        } finally {
          activeCutoutRequests.delete(cancellationId);
        }
      },
      async applySelectionRepair(image, mask, parameters = {}, cancellationId) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        const normalized = normalizeImage(image);
        if (!(mask instanceof Uint8Array) || mask.length !== normalized.width * normalized.height) {
          throw new ProtectedAlgorithmError("ENGINE_INVALID_REQUEST");
        }
        activeCutoutRequests.add(cancellationId);
        try {
          return await cutoutExecutor.selectionRepair(
            normalized.data,
            normalized.width,
            normalized.height,
            mask,
            parameters,
            { cancellationId, protocolVersion: RUNTIME_PROTOCOL_VERSION },
          );
        } finally {
          activeCutoutRequests.delete(cancellationId);
        }
      },
      async analyzeCutoutSequence(metrics, parameters = {}, cancellationId) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        activeCutoutRequests.add(cancellationId);
        try {
          return await cutoutExecutor.analyzeQuality(metrics, parameters, {
            cancellationId,
            protocolVersion: RUNTIME_PROTOCOL_VERSION,
          });
        } finally {
          activeCutoutRequests.delete(cancellationId);
        }
      },
      async analyzeRepairTracking(image, parameters = {}, cancellationId) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        const normalized = normalizeImage(image);
        activeCutoutRequests.add(cancellationId);
        try {
          return await cutoutExecutor.analyzeRepairTracking(
            normalized.data,
            normalized.width,
            normalized.height,
            parameters,
            { cancellationId, protocolVersion: RUNTIME_PROTOCOL_VERSION },
          );
        } finally {
          activeCutoutRequests.delete(cancellationId);
        }
      },
      async analyzeFrameSequence(frames, parameters = {}, cancellationId, callbacks = {}) {
        if (disposed) throw new ProtectedAlgorithmError("ENGINE_DISPOSED");
        activeFrameRequests.add(cancellationId);
        try {
          return await frameExecutor.analyze(frames, parameters, {
            ...callbacks,
            cancellationId,
            protocolVersion: RUNTIME_PROTOCOL_VERSION,
          });
        } finally {
          activeFrameRequests.delete(cancellationId);
        }
      },
      cancel(cancellationId) {
        if (activeCutoutRequests.has(cancellationId)) cutoutExecutor.cancelAll();
        if (activeFrameRequests.has(cancellationId)) frameExecutor.cancelAll();
      },
      dispose() {
        disposed = true;
        activeCutoutRequests.clear();
        activeFrameRequests.clear();
        cutoutExecutor.dispose();
        frameExecutor.dispose();
      },
    });
  }

  /**
   * Creates the product-level protected runtime facade.
   * @param {{adapter:object,includeErrorDetails?:boolean,capabilities?:object}} options Runtime options.
   * @returns {object} Protected runtime facade.
   */
  function createRuntime(options) {
    if (!options?.adapter) throw new TypeError("Protected runtime adapter is required.");
    const adapter = options.adapter;
    const activeRequests = new Set();
    let initialization = null;
    let disposed = false;

    /** @returns {Promise<object>} Initialization result. */
    function ensureInitialized() {
      if (disposed) return Promise.reject(new ProtectedAlgorithmError("ENGINE_DISPOSED"));
      if (!initialization) {
        initialization = Promise.resolve()
          .then(() => adapter.initialize(RUNTIME_PROTOCOL_VERSION, options.capabilities || {}))
          .catch((error) => {
            initialization = null;
            throw normalizeRuntimeError(error, options.includeErrorDetails === true);
          });
      }
      return initialization;
    }

    /**
     * Executes and tracks one cancellable request.
     * @template T
     * @param {string} cancellationId Request cancellation identifier.
     * @param {()=>Promise<T>} operation Adapter operation.
     * @returns {Promise<T>} Operation result.
     */
    async function execute(cancellationId, operation) {
      const id = String(cancellationId || "").trim();
      if (!id || activeRequests.has(id)) {
        throw new ProtectedAlgorithmError("ENGINE_INVALID_CANCELLATION_ID");
      }
      activeRequests.add(id);
      try {
        await ensureInitialized();
        return await operation();
      } catch (error) {
        throw normalizeRuntimeError(error, options.includeErrorDetails === true);
      } finally {
        activeRequests.delete(id);
      }
    }

    return Object.freeze({
      mode: adapter.mode,
      initialize: ensureInitialized,
      applyProductCutout(image, parameters, cancellationId) {
        return execute(cancellationId, () => adapter.applyProductCutout(image, parameters, cancellationId));
      },
      applySelectionRepair(image, mask, parameters, cancellationId) {
        return execute(cancellationId, () =>
          adapter.applySelectionRepair(image, mask, parameters, cancellationId),
        );
      },
      analyzeCutoutSequence(metrics, parameters, cancellationId) {
        return execute(cancellationId, () =>
          adapter.analyzeCutoutSequence(metrics, parameters, cancellationId),
        );
      },
      analyzeRepairTracking(image, parameters, cancellationId) {
        return execute(cancellationId, () =>
          adapter.analyzeRepairTracking(image, parameters, cancellationId),
        );
      },
      analyzeFrameSequence(frames, parameters, cancellationId, callbacks) {
        return execute(cancellationId, () =>
          adapter.analyzeFrameSequence(frames, parameters, cancellationId, callbacks),
        );
      },
      cancel(cancellationId) {
        const id = String(cancellationId || "").trim();
        if (!activeRequests.has(id)) return false;
        adapter.cancel(id);
        return true;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        activeRequests.clear();
        adapter.dispose();
      },
    });
  }

  /**
   * Returns the shared browser runtime selected by the protected build flag.
   * @param {object} browserRoot Browser global containing runtime dependencies.
   * @returns {object} Shared protected runtime.
   */
  function getDefaultRuntime(browserRoot = root) {
    if (!browserRoot) throw new ProtectedAlgorithmError("ENGINE_BROWSER_CONTEXT_MISSING");
    if (browserRoot[DEFAULT_RUNTIME_KEY]) return browserRoot[DEFAULT_RUNTIME_KEY];
    const production = browserRoot.__XSXB_PRODUCTION__ === true;
    const adapter = production
      ? createProductionWorkerAdapter({
          WorkerConstructor: browserRoot.Worker,
          cutoutClient: browserRoot.BatchCutoutWorkerClient,
          frameClient: browserRoot.FrameOrganizerWorkerClient,
        })
      : createDevelopmentJsAdapter({
          cutout: browserRoot.BatchCutoutCore,
          tracking: browserRoot.CutoutTrackingCore,
          localTracking: browserRoot.CutoutLocalTrackingCore,
          quality: browserRoot.CutoutQualityCore,
          frame: browserRoot.FrameOrganizerCore,
        });
    browserRoot[DEFAULT_RUNTIME_KEY] = createRuntime({
      adapter,
      capabilities: { transferableArrayBuffer: true },
      includeErrorDetails: !production,
    });
    return browserRoot[DEFAULT_RUNTIME_KEY];
  }

  /**
   * Adapts the product-level runtime to the existing batch controller executor contract.
   * @param {object} runtime Protected runtime.
   * @returns {{process:Function,cancelAll:()=>void,dispose:()=>void}} Batch executor.
   */
  function createProductExecutor(runtime) {
    const activeIds = new Set();
    let requestSequence = 0;
    return Object.freeze({
      async process(source, width, height, processingOptions = {}, repairs = []) {
        const cancellationId = `cutout-${++requestSequence}`;
        activeIds.add(cancellationId);
        try {
          return await runtime.applyProductCutout(
            { data: source, width, height },
            { processingOptions, repairs },
            cancellationId,
          );
        } finally {
          activeIds.delete(cancellationId);
        }
      },
      cancelAll() {
        for (const cancellationId of activeIds) runtime.cancel(cancellationId);
        activeIds.clear();
      },
      dispose() {
        for (const cancellationId of activeIds) runtime.cancel(cancellationId);
        activeIds.clear();
      },
    });
  }

  /**
   * Adapts selection analysis to the batch repair-controller contract.
   * @param {object} runtime Protected runtime.
   * @returns {{analyze:Function,cancelAll:()=>void,dispose:()=>void}} Selection executor.
   */
  function createSelectionRepairExecutor(runtime) {
    const activeIds = new Set();
    let requestSequence = 0;
    return Object.freeze({
      async analyze(source, width, height, mask, parameters = {}) {
        const cancellationId = `selection-${++requestSequence}`;
        activeIds.add(cancellationId);
        try {
          return await runtime.applySelectionRepair(
            { data: source, width, height },
            mask,
            parameters,
            cancellationId,
          );
        } finally {
          activeIds.delete(cancellationId);
        }
      },
      cancelAll() {
        for (const cancellationId of activeIds) runtime.cancel(cancellationId);
        activeIds.clear();
      },
      dispose() {
        for (const cancellationId of activeIds) runtime.cancel(cancellationId);
        activeIds.clear();
      },
    });
  }

  /**
   * Adapts quality and repair-tracking analysis to batch UI contracts.
   * @param {object} runtime Protected runtime.
   * @returns {{analyzeQuality:Function,captureRepairContext:Function,mapRepairTarget:Function,cancelAll:()=>void,dispose:()=>void}}
   */
  function createCutoutAnalysisExecutor(runtime) {
    const activeIds = new Set();
    let requestSequence = 0;
    async function execute(prefix, operation) {
      const cancellationId = `${prefix}-${++requestSequence}`;
      activeIds.add(cancellationId);
      try {
        return await operation(cancellationId);
      } finally {
        activeIds.delete(cancellationId);
      }
    }
    return Object.freeze({
      analyzeQuality(metrics, parameters = {}) {
        return execute("quality", (id) => runtime.analyzeCutoutSequence(metrics, parameters, id));
      },
      captureRepairContext(source, width, height, parameters = {}) {
        return execute("repair-context", (id) =>
          runtime.analyzeRepairTracking(
            { data: source, width, height },
            { ...parameters, kind: "capture" },
            id,
          ),
        );
      },
      mapRepairTarget(source, width, height, parameters = {}) {
        return execute("repair-map", (id) =>
          runtime.analyzeRepairTracking(
            { data: source, width, height },
            { ...parameters, kind: "map-target" },
            id,
          ),
        );
      },
      cancelAll() {
        for (const cancellationId of activeIds) runtime.cancel(cancellationId);
        activeIds.clear();
      },
      dispose() {
        for (const cancellationId of activeIds) runtime.cancel(cancellationId);
        activeIds.clear();
      },
    });
  }

  /**
   * Adapts the product-level runtime to the frame loop controller executor contract.
   * @param {object} runtime Protected runtime.
   * @returns {{analyze:Function,cancelAll:()=>void,dispose:()=>void}} Frame executor.
   */
  function createFrameAnalysisExecutor(runtime) {
    const activeIds = new Set();
    let requestSequence = 0;
    return Object.freeze({
      async analyze(frames, parameters = {}, callbacks = {}) {
        const cancellationId = `frames-${++requestSequence}`;
        activeIds.add(cancellationId);
        try {
          return await runtime.analyzeFrameSequence(
            frames,
            { ...parameters, operation: parameters.operation || "loop" },
            cancellationId,
            callbacks,
          );
        } finally {
          activeIds.delete(cancellationId);
        }
      },
      cancelAll() {
        for (const cancellationId of activeIds) runtime.cancel(cancellationId);
        activeIds.clear();
      },
      dispose() {
        for (const cancellationId of activeIds) runtime.cancel(cancellationId);
        activeIds.clear();
      },
    });
  }

  return Object.freeze({
    ProtectedAlgorithmError,
    RUNTIME_PROTOCOL_VERSION,
    analyzeDevelopmentRepairTracking,
    createDevelopmentJsAdapter,
    createCutoutAnalysisExecutor,
    createFrameAnalysisExecutor,
    createProductExecutor,
    createSelectionRepairExecutor,
    createProductionWorkerAdapter,
    createRuntime,
    getDefaultRuntime,
  });
});
