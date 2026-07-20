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
          settle(id, "resolve", deserializeResult(message));
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
        activeWorker.postMessage(
          {
            id,
            sourceBuffer: transferableSource.buffer,
            width: task.request.width,
            height: task.request.height,
            options: task.request.processingOptions,
            repairs: task.request.repairs,
          },
          [transferableSource.buffer],
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
     * @returns {Promise<object>} Cutout result.
     */
    function process(source, width, height, processingOptions = {}, repairs = []) {
      const normalizedRepairs = Array.isArray(repairs) ? repairs : [];
      let request;
      try {
        validateSourcePixels(source, width, height);
        const metadata = copyRequestMetadata(processingOptions || {}, normalizedRepairs);
        request = {
          source: new Uint8ClampedArray(source),
          width,
          height,
          processingOptions: metadata.processingOptions,
          repairs: metadata.repairs,
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
      dispose: cancelAll,
      process,
    });
  }

  return { createExecutor };
});
