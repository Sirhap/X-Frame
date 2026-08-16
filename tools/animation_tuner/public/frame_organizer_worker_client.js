(function attachFrameOrganizerWorkerClient(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerWorkerClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Resolves the Worker next to this script instead of against the active tool route.
   * @returns {string} Route-safe Worker URL.
   */
  function defaultWorkerUrl() {
    const scriptUrl = root.document?.currentScript?.src;
    if (!scriptUrl || typeof root.URL !== "function") return "frame_organizer_worker.js";
    return new root.URL("frame_organizer_worker.js", scriptUrl).toString();
  }

  const DEFAULT_WORKER_URL = defaultWorkerUrl();

  /**
   * Creates an AbortError compatible with organizer cancellation handling.
   * @returns {Error|DOMException} Abort error.
   */
  function createAbortError() {
    if (typeof root.DOMException === "function") {
      return new root.DOMException("Loop analysis was cancelled.", "AbortError");
    }
    const error = new Error("Loop analysis was cancelled.");
    error.name = "AbortError";
    return error;
  }

  /**
   * Copies a signature before transfer so frame-local cached samples remain usable by other diagnostics.
   * @param {object|Uint8Array|Uint8ClampedArray} signature Frame signature.
   * @returns {{data:Uint8Array,width:number,height:number}} Transferable copy and dimensions.
   */
  function copySignature(signature) {
    const source = ArrayBuffer.isView(signature) ? signature : signature?.data;
    if (!ArrayBuffer.isView(source)) {
      throw new TypeError("Loop analysis requires typed-array frame signatures.");
    }
    const hasCompleteRgbaPixels = source.length > 0 && source.length % 4 === 0;
    const pixelCount = source.length / 4;
    const inferredWidth = Math.max(1, Math.round(pixelCount));
    let width = Number.isFinite(signature?.width) ? Math.max(1, Math.round(signature.width)) : inferredWidth;
    let height = Number.isFinite(signature?.height) ? Math.max(1, Math.round(signature.height)) : 1;
    if (hasCompleteRgbaPixels && width * height !== pixelCount) {
      width = pixelCount;
      height = 1;
    }
    return { data: new Uint8Array(source), width, height };
  }

  /**
   * Creates a reusable Worker executor for the expensive loop self-similarity matrix.
   * @param {{WorkerConstructor?:Function|null,workerUrl?:string,fallback?:Function|null}} [options] Executor dependencies.
   * @returns {{analyze:Function,cancelAll:()=>void,dispose:()=>void}} Loop analysis executor.
   */
  function createExecutor(options = {}) {
    const hasWorkerOverride = Object.prototype.hasOwnProperty.call(options, "WorkerConstructor");
    const WorkerConstructor = hasWorkerOverride ? options.WorkerConstructor : root.Worker;
    const workerUrl = String(options.workerUrl || DEFAULT_WORKER_URL);
    const fallback = typeof options.fallback === "function" ? options.fallback : null;
    const tasks = new Map();
    let worker = null;
    let requestId = 0;

    /**
     * Resolves or rejects one tracked task exactly once.
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
     * Terminates the shared Worker and settles all active callers as cancelled.
     * @returns {void}
     */
    function cancelAll() {
      const activeIds = Array.from(tasks.keys());
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        try {
          worker.terminate();
        } catch {
          // The caller still receives cancellation below.
        }
      }
      worker = null;
      activeIds.forEach((id) => settle(id, "reject", createAbortError()));
    }

    /**
     * Tears down the shared Worker after a transport failure without changing the failure reason.
     * @param {Error} error Worker failure.
     * @returns {void}
     */
    function failWorker(error) {
      const activeIds = Array.from(tasks.keys());
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        try {
          worker.terminate();
        } catch {
          // Preserve the original worker error for every caller.
        }
      }
      worker = null;
      activeIds.forEach((id) => settle(id, "reject", error));
    }

    /**
     * Lazily creates a Worker and wires its message protocol to pending promises.
     * @returns {Worker} Active Worker.
     */
    function ensureWorker() {
      if (worker) return worker;
      worker = new WorkerConstructor(workerUrl);
      worker.onmessage = (event) => {
        const message = event.data || {};
        const id = Number(message.id);
        const task = tasks.get(id);
        if (!task) return;
        if (message.type === "progress") {
          task.onProgress?.(Number(message.current || 0), Number(message.total || 0));
          return;
        }
        if (message.type !== "result") return;
        if (message.cancelled) {
          settle(id, "reject", createAbortError());
        } else if (message.ok) {
          settle(
            id,
            "resolve",
            message.result !== undefined
              ? message.result
              : Array.isArray(message.candidates)
                ? message.candidates
                : [],
          );
        } else {
          settle(id, "reject", new Error(message.error || "Loop Worker failed."));
        }
      };
      worker.onerror = (event) => {
        const error = new Error(event?.message || "Loop Worker failed.");
        failWorker(error);
      };
      worker.onmessageerror = () => {
        const error = new Error("Loop Worker response could not be decoded.");
        failWorker(error);
      };
      return worker;
    }

    /**
     * Calculates loop candidates without blocking the main thread when Workers are available.
     * @param {Uint8Array[]} signatures Cached frame signatures.
     * @param {object} [loopOptions] Loop-ranking options.
     * @param {{onProgress?:(current:number,total:number)=>void,isCancelled?:()=>boolean}} [callbacks] Progress and cancellation hooks.
     * @returns {Promise<object[]>} Ranked loop candidates.
     */
    function analyze(signatures, loopOptions = {}, callbacks = {}) {
      const copiedSignatures = Array.from(signatures || [], copySignature);
      const operation = ["jump", "duplicate", "loop"].includes(loopOptions.operation)
        ? loopOptions.operation
        : "loop";
      if (typeof WorkerConstructor !== "function") {
        if (!fallback) return Promise.reject(new Error("This browser cannot run the loop analysis Worker."));
        return fallback(copiedSignatures, loopOptions, callbacks);
      }
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        tasks.set(id, { resolve, reject, onProgress: callbacks.onProgress });
        try {
          const activeWorker = ensureWorker();
          const signatureBuffers = copiedSignatures.map((signature) => signature.data.buffer);
          const signatureDimensions = copiedSignatures.map(({ width, height }) => ({ width, height }));
          activeWorker.postMessage(
            {
              id,
              type: operation,
              signatureBuffers,
              signatureDimensions,
              options: loopOptions || {},
              cancellationId: String(callbacks.cancellationId || ""),
              protocolVersion: Number(callbacks.protocolVersion || 1),
            },
            signatureBuffers,
          );
        } catch (error) {
          settle(id, "reject", error instanceof Error ? error : new Error(String(error)));
        }
      });
    }

    return Object.freeze({ analyze, cancelAll, dispose: cancelAll });
  }

  return { DEFAULT_WORKER_URL, createExecutor };
});
