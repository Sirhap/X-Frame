"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function processAlive(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) return false;
  try {
    process.kill(numeric, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function waitForRetry(signal, delayMs) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("MCP request cancelled."));
      return;
    }
    const timer = setTimeout(done, delayMs);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal.reason || new Error("MCP request cancelled."));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Creates a filesystem-backed reader/writer lock shared by independent MCP processes.
 * @param {{root:string,retryMs?:number}} options Lock options.
 * @returns {{acquire:(projectId:string,mode:string,signal?:AbortSignal)=>Promise<Function>}} Lock manager.
 */
function createMcpFileLock(options) {
  const root = path.resolve(options.root);
  const retryMs = Math.max(5, Number(options.retryMs || 20));
  fs.mkdirSync(root, { recursive: true });

  function projectDirectory(projectId) {
    const digest = crypto.createHash("sha256").update(String(projectId)).digest("hex").slice(0, 24);
    const directory = path.join(root, digest);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  function owner(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  function removeStale(directory) {
    const writerPath = path.join(directory, "writer.lock");
    if (fs.existsSync(writerPath) && !processAlive(owner(writerPath)?.pid)) {
      fs.rmSync(writerPath, { force: true });
    }
    for (const name of fs.readdirSync(directory)) {
      if (!/^reader-.*\.lock$/u.test(name)) continue;
      const filePath = path.join(directory, name);
      if (!processAlive(owner(filePath)?.pid)) fs.rmSync(filePath, { force: true });
    }
  }

  function writeOwner(filePath, token) {
    const temporary = `${filePath}.pending-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
    try {
      fs.writeFileSync(
        temporary,
        `${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`,
        { flag: "wx", mode: 0o600 },
      );
      fs.linkSync(temporary, filePath);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  function releaseOwned(filePath, token) {
    if (owner(filePath)?.token === token) fs.rmSync(filePath, { force: true });
  }

  async function acquireRead(directory, signal) {
    const token = crypto.randomBytes(12).toString("hex");
    const readerPath = path.join(directory, `reader-${process.pid}-${token}.lock`);
    const writerPath = path.join(directory, "writer.lock");
    while (true) {
      if (signal?.aborted) throw signal.reason || new Error("MCP request cancelled.");
      removeStale(directory);
      if (fs.existsSync(writerPath)) {
        await waitForRetry(signal, retryMs);
        continue;
      }
      writeOwner(readerPath, token);
      removeStale(directory);
      if (!fs.existsSync(writerPath)) return () => releaseOwned(readerPath, token);
      releaseOwned(readerPath, token);
      await waitForRetry(signal, retryMs);
    }
  }

  async function acquireWrite(directory, signal) {
    const token = crypto.randomBytes(12).toString("hex");
    const writerPath = path.join(directory, "writer.lock");
    while (true) {
      if (signal?.aborted) throw signal.reason || new Error("MCP request cancelled.");
      removeStale(directory);
      try {
        writeOwner(writerPath, token);
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        await waitForRetry(signal, retryMs);
      }
    }
    try {
      while (true) {
        if (signal?.aborted) throw signal.reason || new Error("MCP request cancelled.");
        removeStale(directory);
        const readers = fs.readdirSync(directory).filter((name) => /^reader-.*\.lock$/u.test(name));
        if (!readers.length) return () => releaseOwned(writerPath, token);
        await waitForRetry(signal, retryMs);
      }
    } catch (error) {
      releaseOwned(writerPath, token);
      throw error;
    }
  }

  async function acquire(projectId, mode, signal) {
    const directory = projectDirectory(projectId);
    return mode === "write" ? acquireWrite(directory, signal) : acquireRead(directory, signal);
  }

  return { acquire };
}

module.exports = { createMcpFileLock };
