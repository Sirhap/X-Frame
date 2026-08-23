"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");

/**
 * Runs destructive smart-cutout CPU work off the STDIO event loop so cancellation remains responsive.
 * @param {{filePaths:string[],options:object,metrics?:boolean,signal?:AbortSignal,onProgress?:(update:object)=>void}} task Task.
 * @returns {Promise<object>} Cutout receipt.
 */
function runCutoutTask(task) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "xsxb_mcp_cutout_worker.js"), {
      workerData: {
        filePaths: task.filePaths,
        options: task.options,
        metrics: task.metrics === true,
      },
    });
    let settled = false;
    let terminating = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      task.signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const terminateAndReject = (reason) => {
      if (settled || terminating) return;
      terminating = true;
      task.signal?.removeEventListener("abort", abort);
      worker.terminate().then(
        () => {
          terminating = false;
          finish(reject, reason);
        },
        (terminationError) => {
          terminating = false;
          finish(reject, terminationError);
        },
      );
    };
    const abort = () => {
      terminateAndReject(task.signal.reason || new Error("MCP request cancelled."));
    };
    if (task.signal?.aborted) {
      abort();
      return;
    }
    task.signal?.addEventListener("abort", abort, { once: true });
    worker.on("message", (message) => {
      if (settled || terminating) return;
      if (message.type === "progress") {
        try {
          task.onProgress?.(message.update);
        } catch (error) {
          terminateAndReject(error);
        }
      } else if (message.type === "result") finish(resolve, message.result);
      else if (message.type === "error") {
        const error = new Error(message.error?.message || "Cutout worker failed.");
        error.code = message.error?.code;
        finish(reject, error);
      }
    });
    worker.on("error", (error) => {
      if (!terminating) finish(reject, error);
    });
    worker.on("exit", (code) => {
      if (!settled && !terminating) {
        finish(reject, new Error(`Cutout worker exited with code ${code} before returning a result.`));
      }
    });
  });
}

module.exports = { runCutoutTask };
