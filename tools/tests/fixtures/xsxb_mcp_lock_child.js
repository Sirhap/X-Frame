"use strict";

const { createMcpExecutionCoordinator } = require("../../xsxb_mcp_execution");

const [lockRoot, mode] = process.argv.slice(2);
const coordinator = createMcpExecutionCoordinator({ lockRoot });
let release;
const gate = new Promise((resolve) => {
  release = resolve;
});

process.on("message", (message) => {
  if (message === "release") release();
});

coordinator
  .run({ projectId: "shared-process-project", mode }, async () => {
    process.send?.({ type: "started", mode });
    await gate;
  })
  .then(() => {
    process.send?.({ type: "done", mode });
    coordinator.close();
    process.disconnect?.();
  })
  .catch((error) => {
    process.send?.({ type: "error", message: error.message });
    process.exitCode = 1;
    process.disconnect?.();
  });
