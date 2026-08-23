"use strict";

const { createMcpFileLock } = require("./xsxb_mcp_file_lock");

/**
 * Coordinates cancellable MCP work with per-project write serialization.
 * @param {{maxLongJobs?:number,maxQueue?:number}} [options] Limits.
 * @returns {{run:Function,cancel:Function,stats:Function,close:Function}} Coordinator.
 */
function createMcpExecutionCoordinator(options = {}) {
  const maxLongJobs = Math.max(1, Number(options.maxLongJobs || 2));
  const maxQueue = Math.max(1, Number(options.maxQueue || 32));
  const fileLock =
    options.fileLock || (options.lockRoot ? createMcpFileLock({ root: options.lockRoot }) : null);
  const projectLocks = new Map();
  const inFlight = new Map();
  const longWaiters = [];
  let activeLongJobs = 0;
  let queued = 0;
  let projectQueued = 0;
  let closed = false;

  function lockState(projectId) {
    if (!projectLocks.has(projectId)) {
      projectLocks.set(projectId, { readers: 0, writer: false, queue: [] });
    }
    return projectLocks.get(projectId);
  }

  function grantProjectLock(projectId, state, waiter) {
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    if (waiter.queued) {
      projectQueued = Math.max(0, projectQueued - 1);
      waiter.queued = false;
    }
    if (waiter.mode === "write") state.writer = true;
    else state.readers += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      if (waiter.mode === "write") state.writer = false;
      else state.readers = Math.max(0, state.readers - 1);
      drainProjectLock(projectId, state);
    });
  }

  function drainProjectLock(projectId, state) {
    if (state.writer || state.readers > 0) return;
    if (!state.queue.length) {
      projectLocks.delete(projectId);
      return;
    }
    if (state.queue[0].mode === "write") {
      grantProjectLock(projectId, state, state.queue.shift());
      return;
    }
    while (state.queue[0]?.mode === "read") {
      grantProjectLock(projectId, state, state.queue.shift());
    }
  }

  async function acquireProject(projectId, mode, signal) {
    const normalizedMode = mode === "write" ? "write" : "read";
    const state = lockState(projectId);
    return new Promise((resolve, reject) => {
      const waiter = {
        mode: normalizedMode,
        resolve,
        reject,
        signal,
        queued: false,
        onAbort: null,
      };
      waiter.onAbort = () => {
        const index = state.queue.indexOf(waiter);
        if (index >= 0) state.queue.splice(index, 1);
        if (waiter.queued) {
          projectQueued = Math.max(0, projectQueued - 1);
          waiter.queued = false;
        }
        reject(signal.reason || new Error("MCP request cancelled."));
        drainProjectLock(projectId, state);
      };
      if (signal?.aborted) {
        waiter.onAbort();
        return;
      }
      const immediatelyAvailable =
        state.queue.length === 0 && !state.writer && (normalizedMode === "read" || state.readers === 0);
      if (immediatelyAvailable) {
        grantProjectLock(projectId, state, waiter);
        return;
      }
      if (queued + projectQueued >= maxQueue) {
        const error = new Error("MCP request queue is full; retry later.");
        error.code = "xsxb_queue_full";
        error.retryable = true;
        reject(error);
        return;
      }
      waiter.queued = true;
      projectQueued += 1;
      state.queue.push(waiter);
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
    });
  }

  async function acquireLong(signal) {
    if (activeLongJobs < maxLongJobs) {
      activeLongJobs += 1;
      return;
    }
    if (queued + projectQueued >= maxQueue) {
      const error = new Error("MCP long-job queue is full; retry later.");
      error.code = "xsxb_queue_full";
      error.retryable = true;
      throw error;
    }
    queued += 1;
    await new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal };
      longWaiters.push(waiter);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            const index = longWaiters.indexOf(waiter);
            if (index >= 0) longWaiters.splice(index, 1);
            queued = Math.max(0, queued - 1);
            reject(signal.reason || new Error("MCP request cancelled."));
          },
          { once: true },
        );
      }
    });
    activeLongJobs += 1;
  }

  function releaseLong() {
    activeLongJobs = Math.max(0, activeLongJobs - 1);
    const waiter = longWaiters.shift();
    if (waiter) {
      queued = Math.max(0, queued - 1);
      waiter.resolve();
    }
  }

  async function run(metadata, operation) {
    if (closed) throw new Error("MCP execution coordinator is closed.");
    const requestId = metadata.requestId;
    const controller = new AbortController();
    if (requestId !== undefined && requestId !== null) inFlight.set(String(requestId), controller);
    const projectId = String(metadata.projectId || "__global__");
    const requestedLocks = Array.isArray(metadata.locks)
      ? metadata.locks
      : [{ projectId, mode: metadata.mode }];
    const lockModes = new Map();
    for (const lock of requestedLocks) {
      const id = String(lock.projectId || "__global__");
      const mode = lock.mode === "write" ? "write" : "read";
      if (mode === "write" || !lockModes.has(id)) lockModes.set(id, mode);
    }
    const locks = [...lockModes.entries()]
      .map(([id, mode]) => ({ projectId: id, mode }))
      .sort((left, right) => left.projectId.localeCompare(right.projectId));
    const releaseProjects = [];
    const releaseFiles = [];
    let longAcquired = false;
    try {
      for (const lock of locks) {
        releaseProjects.push(await acquireProject(lock.projectId, lock.mode, controller.signal));
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      if (metadata.long === true) {
        await acquireLong(controller.signal);
        longAcquired = true;
      }
      if (fileLock) {
        for (const lock of locks) {
          releaseFiles.push(await fileLock.acquire(lock.projectId, lock.mode, controller.signal));
        }
      }
      return await operation({
        signal: controller.signal,
        progress: typeof metadata.progress === "function" ? metadata.progress : () => {},
      });
    } finally {
      for (const release of releaseFiles.reverse()) release();
      if (longAcquired) releaseLong();
      for (const release of releaseProjects.reverse()) release();
      if (requestId !== undefined && requestId !== null) inFlight.delete(String(requestId));
    }
  }

  function cancel(requestId, reason = "MCP request cancelled.") {
    const controller = inFlight.get(String(requestId));
    if (!controller) return false;
    controller.abort(new Error(String(reason || "MCP request cancelled.")));
    return true;
  }

  function stats() {
    return { inFlight: inFlight.size, activeLongJobs, queued, projectQueued, maxLongJobs, maxQueue };
  }

  function close() {
    closed = true;
    for (const controller of inFlight.values()) controller.abort(new Error("MCP server closed."));
    inFlight.clear();
    while (longWaiters.length) longWaiters.shift().reject(new Error("MCP server closed."));
    queued = 0;
    projectQueued = 0;
  }

  return { cancel, close, run, stats };
}

module.exports = { createMcpExecutionCoordinator };
