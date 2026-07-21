(function attachBatchCutoutWorkerClient(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BatchCutoutWorkerClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Resolves the Worker beside this client script instead of against the page
   * route. Tool routes such as `/tools/cutout` must not turn the request into
   * `/tools/batch_cutout_worker.js`.
   * @returns {string} Route-safe Worker URL.
   */
  function defaultWorkerUrl() {
    const scriptUrl = root.document?.currentScript?.src;
    if (!scriptUrl || typeof root.URL !== "function") return "batch_cutout_worker.js";
    return new root.URL("batch_cutout_worker.js", scriptUrl).toString();
  }

  const DEFAULT_WORKER_URL = defaultWorkerUrl();

  /**
   * Creates an Error compatible with DOM AbortError checks.
   * @returns {Error|DOMException} Abort error.
   */
  function createAbortError() {
    if (typeof root.DOMException === "function") {
      return new root.DOMException("Cutout processing was cancelled.", "AbortError");
    }
    const error = new Error("Cutout processing was cancelled.");
    error.name = "AbortError";
    return error;
  }

  /**
   * Schedules recovery work without requiring queueMicrotask support.
   * @param {()=>void} callback Deferred callback.
   * @returns {void}
   */
  function scheduleMicrotask(callback) {
    if (typeof root.queueMicrotask === "function") {
      root.queueMicrotask(callback);
      return;
    }
    Promise.resolve().then(callback);
  }

  /**
   * Converts unknown failures into stable Error instances.
   * @param {unknown} value Error-like value.
   * @param {string} fallbackMessage Fallback message.
   * @returns {Error} Normalized error.
   */
  function normalizeError(value, fallbackMessage) {
    if (value instanceof Error) return value;
    return new Error(typeof value === "string" ? value : String(value?.message || fallbackMessage));
  }

  /**
   * Creates a distinguishable Worker transport failure with browser diagnostics.
   * @param {unknown} value Worker ErrorEvent, MessageEvent, or thrown value.
   * @param {string} fallbackMessage Fallback message.
   * @returns {Error & {code:string,filename:string,lineno:number,colno:number}} Transport error.
   */
  function createTransportError(value, fallbackMessage) {
    const source = value && typeof value === "object" ? value : {};
    const underlyingError = source.error instanceof Error ? source.error : null;
    const filename = typeof source.filename === "string" ? source.filename : "";
    const lineno = Number.isFinite(source.lineno) ? Number(source.lineno) : 0;
    const colno = Number.isFinite(source.colno) ? Number(source.colno) : 0;
    const reportedMessage =
      source.message || underlyingError?.message || (typeof value === "string" ? value : "");
    const baseMessage =
      reportedMessage || `${String(fallbackMessage).replace(/\.$/, "")} after one automatic retry.`;
    const locationParts = filename ? [filename] : [];
    if (locationParts.length > 0 && lineno > 0) locationParts.push(String(lineno));
    if (locationParts.length > 1 && colno > 0) locationParts.push(String(colno));
    const error = new Error(
      locationParts.length > 0 ? `${baseMessage} (${locationParts.join(":")})` : baseMessage,
    );
    error.name = "CutoutWorkerTransportError";
    error.code = "CUTOUT_WORKER_TRANSPORT_ERROR";
    error.filename = filename;
    error.lineno = lineno;
    error.colno = colno;
    if (underlyingError) error.cause = underlyingError;
    return error;
  }

  /**
   * Validates one RGBA source without allocating another pixel buffer.
   * @param {Uint8ClampedArray|Uint8Array} source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @returns {void}
   */
  function validateSourcePixels(source, width, height) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new RangeError("Cutout dimensions must be positive integers.");
    }
    if (!(source instanceof Uint8ClampedArray) && !(source instanceof Uint8Array)) {
      throw new TypeError("Cutout source must be a Uint8ClampedArray or Uint8Array.");
    }
    const expectedLength = width * height * 4;
    if (!Number.isSafeInteger(expectedLength) || source.length !== expectedLength) {
      throw new RangeError(`Expected ${expectedLength} RGBA values, received ${source.length}.`);
    }
  }

  /**
   * Deep-copies serializable request metadata at the process boundary.
   * @param {object} processingOptions Product options.
   * @param {object[]} repairs Repair list.
   * @returns {{processingOptions:object,repairs:object[]}} Immutable request metadata snapshot.
   */
  function copyRequestMetadata(processingOptions, repairs) {
    const metadata = { processingOptions, repairs };
    if (typeof root.structuredClone === "function") return root.structuredClone(metadata);
    return JSON.parse(JSON.stringify(metadata));
  }

  /**
   * Deserializes one successful Worker response.
   * @param {object} message Worker response.
   * @returns {object} Product result and analysis metadata.
   */
  function deserializeResult(message) {
    if (!(message.dataBuffer instanceof ArrayBuffer) || !(message.automaticBuffer instanceof ArrayBuffer)) {
      throw new Error("Cutout Worker returned invalid pixel buffers.");
    }
    return {
      data: new Uint8ClampedArray(message.dataBuffer),
      automaticData: new Uint8ClampedArray(message.automaticBuffer),
      removedPixels: Number(message.removedPixels || 0),
      partialPixels: Number(message.partialPixels || 0),
      shapeCandidates: Array.isArray(message.shapeCandidates) ? message.shapeCandidates : null,
      shapeDescriptor: message.shapeDescriptor || null,
      qualityMetrics: message.qualityMetrics || null,
    };
  }

  /**
   * Deserializes a protected selection-analysis response.
   * @param {object} message Worker response.
   * @returns {object} Selection result with an owned mask when present.
   */
  function deserializeSelectionResult(message) {
    const result = message.result && typeof message.result === "object" ? { ...message.result } : {};
    if (message.maskBuffer !== undefined) {
      if (!(message.maskBuffer instanceof ArrayBuffer)) {
        throw new Error("Cutout Worker returned an invalid selection mask.");
      }
      result.mask = new Uint8Array(message.maskBuffer);
    }
    return result;
  }

  /**
   * Safely terminates a Worker-like object.
   * @param {object|null} worker Worker instance.
   * @returns {void}
   */
  function terminateWorker(worker) {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    try {
      worker.terminate();
    } catch {
      // Cancellation must still settle callers when custom teardown fails.
    }
  }

  /**
   * Creates a reusable cutout Worker executor.
   * The Worker is retained between frames and terminated only on cancellation or
   * failure. Synchronous processing is allowed only when explicitly requested,
   * preventing a silent multi-second main-thread freeze in unsupported browsers.
   * @param {{
   *   WorkerConstructor?:Function|null,
   *   workerUrl?:string,
   *   syncProcess?:Function|null,
   *   allowSyncFallback?:boolean
   * }} [options] Executor dependencies.
   * @returns {{process:Function,cancelAll:()=>void,dispose:()=>void}} Executor.
   */
  function createExecutor(options = {}) {
    const hasWorkerOverride = Object.prototype.hasOwnProperty.call(options, "WorkerConstructor");
    const WorkerConstructor = hasWorkerOverride ? options.WorkerConstructor : root.Worker;
    const workerUrl = String(options.workerUrl || DEFAULT_WORKER_URL);
    const syncProcess = options.syncProcess || root.BatchCutoutCore?.applyProductCutout || null;
    const allowSyncFallback =
      options.allowSyncFallback === true || (hasWorkerOverride && WorkerConstructor === null);
    const tasks = new Map();
    let worker = null;
    let requestId = 0;

    /**
     * Settles one tracked task exactly once.
     * @param {number} id Request id.
     * @param {"resolve"|"reject"} outcome Promise outcome.
     * @param {unknown} value Result or error.
     * @returns {void}
     */
    function settle(id, outcome, value) {
      const task = tasks.get(id);
      if (!task) return;
      tasks.delete(id);
      task[outcome](value);
    }

    /**
     * Rejects every in-flight request after a shared Worker failure.
     * @param {object} failedWorker Worker instance that emitted the failure.
     * @param {unknown} error Worker error.
     * @returns {void}
     */
    function failWorker(failedWorker, error) {
      if (worker === failedWorker) worker = null;
      terminateWorker(failedWorker);
      const transportError = createTransportError(error, "Cutout Worker failed.");
      const affectedTasks = Array.from(tasks.entries()).filter(([, task]) => task.worker === failedWorker);
      affectedTasks.forEach(([id, task]) => {
        task.worker = null;
        if (task.transportRetryCount >= 1) {
          settle(id, "reject", transportError);
          return;
        }
        task.transportRetryCount += 1;
      });
      scheduleMicrotask(() => {
        affectedTasks.forEach(([id, task]) => {
          if (tasks.get(id) === task && task.worker === null) postTask(id, task);
        });
      });
    }

    /**
     * Lazily creates and configures the reusable Worker.
     * @returns {object} Worker instance.
     */
    function ensureWorker() {
      if (worker) return worker;
      worker = new WorkerConstructor(workerUrl);
      const configuredWorker = worker;
      worker.onmessage = (event) => {
        const message = event.data || {};
        const id = Number(message.id);
        const task = tasks.get(id);
        if (!task || task.worker !== configuredWorker) return;
        if (!message.ok) {
          settle(id, "reject", new Error(message.error || "Cutout Worker failed."));
          return;
        }
        try {
          settle(
            id,
            "resolve",
            task.request.operation === "selection-repair"
              ? deserializeSelectionResult(message)
              : ["quality-analysis", "repair-tracking"].includes(task.request.operation)
                ? message.result
                : deserializeResult(message),
          );
        } catch (error) {
          settle(id, "reject", normalizeError(error, "Cutout Worker returned an invalid result."));
        }
      };
      worker.onerror = (event) => failWorker(configuredWorker, event);
      worker.onmessageerror = (event) =>
        failWorker(configuredWorker, event || "Cutout Worker response could not be decoded.");
      return worker;
    }

    /**
     * Posts one task using a transferable copy of its request snapshot.
     * @param {number} id Request id.
     * @param {object} task Tracked task.
     * @returns {void}
     */
    function postTask(id, task) {
      let activeWorker;
      try {
        activeWorker = ensureWorker();
        task.worker = activeWorker;
        const transferableSource = new Uint8ClampedArray(task.request.source);
        const transferableSelectionMask = task.request.selectionMask
          ? new Uint8Array(task.request.selectionMask)
          : null;
        const transferablePreview = task.request.previewData
          ? new Uint8ClampedArray(task.request.previewData)
          : null;
        const transferableAnalysisOriginal = task.request.analysisOriginalData
          ? new Uint8ClampedArray(task.request.analysisOriginalData)
          : null;
        activeWorker.postMessage(
          {
            id,
            operation: task.request.operation,
            sourceBuffer: transferableSource.buffer,
            width: task.request.width,
            height: task.request.height,
            options: task.request.processingOptions,
            repairs: task.request.repairs,
            cancellationId: task.request.cancellationId,
            protocolVersion: task.request.protocolVersion,
            selectionMaskBuffer: transferableSelectionMask?.buffer,
            selectionParameters: task.request.selectionParameters,
            analysisParameters: task.request.analysisParameters,
            analysisOriginalBuffer: transferableAnalysisOriginal?.buffer,
            previewBuffer: transferablePreview?.buffer,
          },
          [
            transferableSource.buffer,
            ...(transferableSelectionMask ? [transferableSelectionMask.buffer] : []),
            ...(transferablePreview ? [transferablePreview.buffer] : []),
            ...(transferableAnalysisOriginal ? [transferableAnalysisOriginal.buffer] : []),
          ],
        );
      } catch (error) {
        if (activeWorker) {
          failWorker(activeWorker, error);
          return;
        }
        if (task.transportRetryCount < 1) {
          task.transportRetryCount += 1;
          scheduleMicrotask(() => {
            if (tasks.get(id) === task) postTask(id, task);
          });
          return;
        }
        settle(id, "reject", createTransportError(error, "Cutout Worker could not be created."));
      }
    }

    /**
     * Runs the explicitly enabled synchronous compatibility path.
     * @param {Uint8ClampedArray} source Snapshotted pixels.
     * @param {number} width Image width.
     * @param {number} height Image height.
     * @param {object} processingOptions Product options.
     * @param {object[]} repairs Repair list.
     * @returns {Promise<object>} Product result.
     */
    async function runSynchronously(source, width, height, processingOptions, repairs) {
      if (!allowSyncFallback || typeof syncProcess !== "function") {
        throw new Error("This browser cannot run the cutout Worker. Use a browser with Web Worker support.");
      }
      return syncProcess(source, width, height, processingOptions, repairs);
    }

    /**
     * Processes one RGBA image while preserving caller-owned pixels.
     * @param {Uint8ClampedArray|Uint8Array} source Source pixels.
     * @param {number} width Image width.
     * @param {number} height Image height.
     * @param {object} [processingOptions] Product options.
     * @param {object[]} [repairs] Serialized repairs.
     * @param {{cancellationId?:string,protocolVersion?:number}} [requestContext] Runtime protocol metadata.
     * @returns {Promise<object>} Cutout result.
     */
    function process(source, width, height, processingOptions = {}, repairs = [], requestContext = {}) {
      const normalizedRepairs = Array.isArray(repairs) ? repairs : [];
      let request;
      try {
        validateSourcePixels(source, width, height);
        const metadata = copyRequestMetadata(processingOptions || {}, normalizedRepairs);
        request = {
          operation: "product-cutout",
          source: new Uint8ClampedArray(source),
          width,
          height,
          processingOptions: metadata.processingOptions,
          repairs: metadata.repairs,
          cancellationId: String(requestContext.cancellationId || ""),
          protocolVersion: Number(requestContext.protocolVersion || 1),
        };
      } catch (error) {
        return Promise.reject(normalizeError(error, "Invalid cutout request."));
      }
      if (typeof WorkerConstructor !== "function") {
        return Promise.resolve().then(() =>
          runSynchronously(
            request.source,
            request.width,
            request.height,
            request.processingOptions,
            request.repairs,
          ),
        );
      }
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        const task = {
          resolve,
          reject,
          request,
          transportRetryCount: 0,
          worker: null,
        };
        tasks.set(id, task);
        postTask(id, task);
      });
    }

    /**
     * Runs one protected selection analysis without exposing its kernels to UI code.
     * @param {Uint8ClampedArray|Uint8Array} source Source pixels.
     * @param {number} width Image width.
     * @param {number} height Image height.
     * @param {Uint8Array} mask Selection mask.
     * @param {object} [parameters] Product-level selection parameters.
     * @param {{cancellationId?:string,protocolVersion?:number}} [requestContext] Runtime metadata.
     * @returns {Promise<object>} Selection analysis result.
     */
    function selectionRepair(source, width, height, mask, parameters = {}, requestContext = {}) {
      let request;
      try {
        validateSourcePixels(source, width, height);
        if (!(mask instanceof Uint8Array) || mask.length !== width * height) {
          throw new RangeError("Selection mask dimensions do not match the source image.");
        }
        const previewData = parameters.previewData;
        if (
          previewData != null &&
          !(previewData instanceof Uint8Array) &&
          !(previewData instanceof Uint8ClampedArray)
        ) {
          throw new TypeError("Selection preview must contain RGBA bytes.");
        }
        if (previewData != null && previewData.length !== width * height * 4) {
          throw new RangeError("Selection preview dimensions do not match the source image.");
        }
        const serializableParameters = { ...parameters };
        delete serializableParameters.previewData;
        const metadata = copyRequestMetadata(serializableParameters, []);
        request = {
          operation: "selection-repair",
          source: new Uint8ClampedArray(source),
          width,
          height,
          processingOptions: {},
          repairs: [],
          selectionMask: new Uint8Array(mask),
          selectionParameters: metadata.processingOptions,
          previewData: previewData ? new Uint8ClampedArray(previewData) : null,
          cancellationId: String(requestContext.cancellationId || ""),
          protocolVersion: Number(requestContext.protocolVersion || 1),
        };
      } catch (error) {
        return Promise.reject(normalizeError(error, "Invalid selection repair request."));
      }
      if (typeof WorkerConstructor !== "function") {
        return Promise.reject(new Error("This browser cannot run protected selection analysis."));
      }
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        const task = { resolve, reject, request, transportRetryCount: 0, worker: null };
        tasks.set(id, task);
        postTask(id, task);
      });
    }

    /**
     * Posts a non-pixel-result analysis through the protected cutout Worker.
     * @param {"quality-analysis"|"repair-tracking"} operation Product analysis operation.
     * @param {Uint8ClampedArray} source Source bytes, or an empty array for metadata analysis.
     * @param {number} width Source width.
     * @param {number} height Source height.
     * @param {object} parameters Serializable analysis parameters.
     * @param {{cancellationId?:string,protocolVersion?:number}} requestContext Runtime metadata.
     * @param {Uint8ClampedArray|null} [analysisOriginalData] Optional original pixels for tracking.
     * @returns {Promise<object|Array<object>>} Analysis result.
     */
    function postAnalysis(
      operation,
      source,
      width,
      height,
      parameters,
      requestContext,
      analysisOriginalData = null,
    ) {
      if (typeof WorkerConstructor !== "function") {
        return Promise.reject(new Error("This browser cannot run protected cutout analysis."));
      }
      let analysisParameters;
      try {
        analysisParameters = copyRequestMetadata(parameters || {}, []).processingOptions;
      } catch (error) {
        return Promise.reject(normalizeError(error, "Invalid cutout analysis request."));
      }
      const request = {
        operation,
        source: new Uint8ClampedArray(source || 0),
        width,
        height,
        processingOptions: {},
        repairs: [],
        analysisParameters,
        analysisOriginalData,
        cancellationId: String(requestContext?.cancellationId || ""),
        protocolVersion: Number(requestContext?.protocolVersion || 1),
      };
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        const task = { resolve, reject, request, transportRetryCount: 0, worker: null };
        tasks.set(id, task);
        postTask(id, task);
      });
    }

    /** @returns {Promise<Array<object>>} Sequence quality result. */
    function analyzeQuality(metrics, parameters = {}, requestContext = {}) {
      return postAnalysis(
        "quality-analysis",
        new Uint8ClampedArray(),
        0,
        0,
        { metrics, parameters },
        requestContext,
      );
    }

    /** @returns {Promise<object>} Repair tracking result. */
    function analyzeRepairTracking(source, width, height, parameters = {}, requestContext = {}) {
      try {
        validateSourcePixels(source, width, height);
      } catch (error) {
        return Promise.reject(normalizeError(error, "Invalid repair tracking request."));
      }
      const { originalData, ...serializableParameters } = parameters;
      if (
        originalData != null &&
        (!ArrayBuffer.isView(originalData) || originalData.length !== width * height * 4)
      ) {
        return Promise.reject(
          new RangeError("Repair tracking original pixels do not match the target image."),
        );
      }
      return postAnalysis(
        "repair-tracking",
        source,
        width,
        height,
        serializableParameters,
        requestContext,
        originalData ? new Uint8ClampedArray(originalData) : null,
      );
    }

    /**
     * Cancels all work and resets the reusable Worker.
     * @returns {void}
     */
    function cancelAll() {
      const activeIds = Array.from(tasks.keys());
      terminateWorker(worker);
      worker = null;
      activeIds.forEach((id) => settle(id, "reject", createAbortError()));
    }

    return Object.freeze({
      cancelAll,
      analyzeQuality,
      analyzeRepairTracking,
      dispose: cancelAll,
      process,
      selectionRepair,
    });
  }

  return { createExecutor };
});
