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
   * Copies and validates one RGBA source before transferring it.
   * @param {Uint8ClampedArray|Uint8Array} source RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @returns {Uint8ClampedArray} Transferable copy.
   */
  function copySourcePixels(source, width, height) {
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
    return new Uint8ClampedArray(source);
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
     * @param {unknown} error Worker error.
     * @returns {void}
     */
    function failWorker(error) {
      const normalized = normalizeError(error, "Cutout Worker failed.");
      const activeIds = Array.from(tasks.keys());
      terminateWorker(worker);
      worker = null;
      activeIds.forEach((id) => settle(id, "reject", normalized));
    }

    /**
     * Lazily creates and configures the reusable Worker.
     * @returns {object} Worker instance.
     */
    function ensureWorker() {
      if (worker) return worker;
      worker = new WorkerConstructor(workerUrl);
      worker.onmessage = (event) => {
        const message = event.data || {};
        const id = Number(message.id);
        if (!tasks.has(id)) return;
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
      worker.onerror = (event) => failWorker(event);
      worker.onmessageerror = () => failWorker(new Error("Cutout Worker response could not be decoded."));
      return worker;
    }

    /**
     * Runs the explicitly enabled synchronous compatibility path.
     * @param {Uint8ClampedArray} source Copied pixels.
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
      let transferableSource;
      try {
        transferableSource = copySourcePixels(source, width, height);
      } catch (error) {
        return Promise.reject(normalizeError(error, "Invalid cutout request."));
      }
      const normalizedRepairs = Array.isArray(repairs) ? repairs : [];
      if (typeof WorkerConstructor !== "function") {
        return Promise.resolve().then(() =>
          runSynchronously(transferableSource, width, height, processingOptions || {}, normalizedRepairs),
        );
      }
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        tasks.set(id, { resolve, reject });
        try {
          ensureWorker().postMessage(
            {
              id,
              sourceBuffer: transferableSource.buffer,
              width,
              height,
              options: processingOptions || {},
              repairs: normalizedRepairs,
            },
            [transferableSource.buffer],
          );
        } catch (error) {
          settle(id, "reject", normalizeError(error, "Cutout Worker request failed."));
        }
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
