"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { cutoutFrameFiles } = require("./xsxb_mcp_cutout");
const { measureFrame } = require("./xsxb_mcp_visual_qa");

try {
  const result = cutoutFrameFiles(workerData.filePaths, {
    ...workerData.options,
    metricsImpl: workerData.metrics ? measureFrame : undefined,
    progressImpl(update) {
      parentPort.postMessage({ type: "progress", update });
    },
  });
  parentPort.postMessage({ type: "result", result });
} catch (error) {
  parentPort.postMessage({
    type: "error",
    error: { message: String(error?.message || error), code: error?.code || "xsxb_cutout_worker_error" },
  });
}
