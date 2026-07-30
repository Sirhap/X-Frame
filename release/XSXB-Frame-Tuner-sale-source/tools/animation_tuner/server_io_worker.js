"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { createProjectStore } = require("../project_store");
const { syncFrameAudio, syncGodotProject } = require("../godot_sync");

/**
 * Executes blocking Godot filesystem synchronization outside the HTTP event loop.
 * @returns {void}
 */
function run() {
  const { action, root, project, options } = workerData || {};
  const projectStore = createProjectStore(root);
  if (action === "syncProject") {
    parentPort.postMessage({
      ok: true,
      result: syncGodotProject(root, projectStore, project, options || {}),
    });
    return;
  }
  if (action === "syncAudio") {
    parentPort.postMessage({
      ok: true,
      result: syncFrameAudio(projectStore, project, options?.bindings || []),
    });
    return;
  }
  throw new Error(`Unsupported server I/O action: ${action}`);
}

try {
  run();
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
