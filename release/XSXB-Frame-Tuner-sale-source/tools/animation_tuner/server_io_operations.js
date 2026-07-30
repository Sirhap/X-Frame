"use strict";

const defaultFs = require("node:fs");
const defaultOs = require("node:os");
const defaultPath = require("node:path");
const defaultCrypto = require("node:crypto");
const { Worker: defaultWorker } = require("node:worker_threads");

const DEFAULT_GDSCRIPT_SKIP_DIRS = new Set([".git", ".godot", "addons", "node_modules", "_external_vfx"]);

/**
 * Creates the server-side I/O and transaction helpers.
 *
 * The helper factory keeps project write serialization, worker-based Godot
 * synchronization, revision hashing, and rollback snapshots together.  These
 * operations were previously declared in server.js; dependency injection
 * keeps their behavior and call signatures unchanged while making the server
 * entry point easier to navigate and test.
 *
 * @param {{root:string,projectStore:object,fs?:typeof import("node:fs"),os?:typeof import("node:os"),path?:typeof import("node:path"),crypto?:typeof import("node:crypto"),Worker?:typeof import("node:worker_threads").Worker,workerScriptPath?:string,gdscriptSkipDirs?:Set<string>}} dependencies Server I/O dependencies.
 * @returns {{withProjectWrite:Function,runServerIoWorker:Function,syncGodotProjectAsync:Function,syncFrameAudioAsync:Function,projectDataRevision:Function,createFilesystemSnapshot:Function,rollbackFilesystemSnapshot:Function,runtimeProjectIdFiles:Function,saveTransactionPaths:Function}} Server I/O operations.
 */
function createServerIoOperations(dependencies = {}) {
  const {
    root,
    projectStore,
    fs: fsApi = defaultFs,
    os: osApi = defaultOs,
    path: pathApi = defaultPath,
    crypto: cryptoApi = defaultCrypto,
    Worker: WorkerApi = defaultWorker,
    workerScriptPath = pathApi.join(__dirname, "server_io_worker.js"),
    gdscriptSkipDirs = DEFAULT_GDSCRIPT_SKIP_DIRS,
  } = dependencies;

  if (!root || !projectStore || typeof WorkerApi !== "function") {
    throw new TypeError("Server I/O requires a root, project store, and worker constructor.");
  }

  const fs = fsApi;
  const os = osApi;
  const path = pathApi;
  const crypto = cryptoApi;
  const Worker = WorkerApi;
  const GDSCRIPT_SKIP_DIRS = gdscriptSkipDirs;
  const projectWriteQueues = new Map();

  /**
   * Serializes filesystem mutations for one project without blocking unrelated projects.
   * @template T
   * @param {string} projectId Stable project identifier.
   * @param {()=>Promise<T>|T} operation Mutation to execute.
   * @returns {Promise<T>} Operation result.
   */
  function withProjectWrite(projectId, operation) {
    const key = String(projectId || "__registry__");
    const previous = projectWriteQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    projectWriteQueues.set(key, current);
    return current.finally(() => {
      if (projectWriteQueues.get(key) === current) projectWriteQueues.delete(key);
    });
  }

  /**
   * Runs blocking Godot synchronization in a worker thread.
   * @param {"syncProject"|"syncAudio"} action Worker action.
   * @param {object} project Project record.
   * @param {object} [options] Serializable action options.
   * @returns {Promise<object>} Synchronization result.
   */
  function runServerIoWorker(action, project, options = {}) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerScriptPath, {
        workerData: { action, root, project, options },
      });
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      worker.once("message", (message) => {
        if (message?.ok) finish(resolve, message.result);
        else finish(reject, new Error(message?.error || "Background filesystem operation failed."));
      });
      worker.once("error", (error) => finish(reject, error));
      worker.once("exit", (code) => {
        if (code !== 0) finish(reject, new Error(`Background filesystem worker exited with code ${code}.`));
      });
    });
  }

  /**
   * Synchronizes all Godot outputs without blocking unrelated HTTP requests.
   * @param {object} project Project record.
   * @param {object} [options] Synchronization inputs.
   * @returns {Promise<object>} Synchronization summary.
   */
  function syncGodotProjectAsync(project, options = {}) {
    return runServerIoWorker("syncProject", project, options);
  }

  /**
   * Synchronizes frame audio without blocking the HTTP event loop.
   * @param {object} project Project record.
   * @param {object[]} bindings Audio bindings.
   * @returns {Promise<object>} Synchronization summary.
   */
  function syncFrameAudioAsync(project, bindings) {
    return runServerIoWorker("syncAudio", project, { bindings });
  }

  /**
   * Computes an optimistic concurrency token from all persisted project JSON.
   * @param {object} project Project record.
   * @returns {string} SHA-256 revision token.
   */
  function projectDataRevision(project) {
    projectStore.ensureProjectFiles(project);
    const paths = projectStore.projectPaths(project);
    const files = [
      paths.manifest,
      paths.tuning,
      paths.frameAudio,
      paths.frameImageAttachments,
      paths.attachmentAssets,
    ];
    const hash = crypto.createHash("sha256");
    for (const filePath of files) {
      hash.update(path.basename(filePath));
      hash.update(fs.readFileSync(filePath));
    }
    return hash.digest("hex");
  }

  /**
   * Captures paths in a temporary directory for transactional rollback.
   * @param {string[]} inputPaths Files or directories to preserve.
   * @returns {Promise<{restore:()=>Promise<void>,dispose:()=>Promise<void>}>} Snapshot controls.
   */
  async function createFilesystemSnapshot(inputPaths) {
    const snapshotRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "xsxb-save-"));
    const entries = [];
    const targets = [...new Set(inputPaths.filter(Boolean).map((entry) => path.resolve(entry)))];
    for (let index = 0; index < targets.length; index += 1) {
      const targetPath = targets[index];
      const snapshotPath = path.join(snapshotRoot, String(index));
      const existed = await fs.promises
        .access(targetPath)
        .then(() => true)
        .catch(() => false);
      if (existed) await fs.promises.cp(targetPath, snapshotPath, { recursive: true });
      entries.push({ existed, snapshotPath, targetPath });
    }
    let disposed = false;
    return {
      async restore() {
        for (const entry of entries) {
          await fs.promises.rm(entry.targetPath, { recursive: true, force: true });
          if (entry.existed) {
            await fs.promises.mkdir(path.dirname(entry.targetPath), { recursive: true });
            await fs.promises.cp(entry.snapshotPath, entry.targetPath, { recursive: true });
          }
        }
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        await fs.promises.rm(snapshotRoot, { recursive: true, force: true });
      },
    };
  }

  /**
   * Restores and disposes a filesystem transaction while retaining both failures.
   * @param {{restore:()=>Promise<void>,dispose:()=>Promise<void>}} transaction Snapshot controls.
   * @param {Error} cause Mutation failure.
   * @param {string} message Aggregate rollback failure message.
   * @returns {Promise<never>} Always rejects with the mutation or aggregate failure.
   */
  async function rollbackFilesystemSnapshot(transaction, cause, message) {
    try {
      await transaction.restore();
    } catch (rollbackError) {
      await transaction.dispose();
      throw new AggregateError([cause, rollbackError], message);
    }
    await transaction.dispose();
    throw cause;
  }

  /**
   * Lists files that may be changed while updating the embedded runtime project id.
   * @param {object} project Project record.
   * @returns {string[]} Matching GDScript paths.
   */
  function runtimeProjectIdFiles(project) {
    const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
    const matches = [];
    if (!projectRoot || !fs.existsSync(projectRoot)) return matches;
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!GDSCRIPT_SKIP_DIRS.has(entry.name)) walk(fullPath);
        } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".gd") {
          const text = fs.readFileSync(fullPath, "utf8");
          if (/const\s+XSXB_PROJECT_ID\s*:\s*String\s*=/.test(text)) matches.push(fullPath);
        }
      }
    };
    walk(projectRoot);
    return matches;
  }

  /**
   * Returns all paths touched by a full Save synchronization.
   * @param {object} project Project record.
   * @returns {string[]} Transaction paths.
   */
  function saveTransactionPaths(project) {
    const paths = projectStore.projectPaths(project);
    const godotOutput = project?.projectRoot
      ? path.join(path.resolve(project.projectRoot), "xsxb_frame_tuner")
      : "";
    return [
      paths.tuning,
      paths.frameAudio,
      paths.frameImageAttachments,
      godotOutput,
      ...runtimeProjectIdFiles(project),
    ];
  }

  return {
    withProjectWrite,
    runServerIoWorker,
    syncGodotProjectAsync,
    syncFrameAudioAsync,
    projectDataRevision,
    createFilesystemSnapshot,
    rollbackFilesystemSnapshot,
    runtimeProjectIdFiles,
    saveTransactionPaths,
  };
}

module.exports = { createServerIoOperations };
