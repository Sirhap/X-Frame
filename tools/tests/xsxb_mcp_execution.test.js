"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const test = require("node:test");
const { createMcpExecutionCoordinator } = require("../xsxb_mcp_execution");

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("execution coordinator serializes project writes and permits foreign-project reads", async () => {
  const coordinator = createMcpExecutionCoordinator({ maxLongJobs: 2, maxQueue: 32 });
  const gate = deferred();
  const order = [];
  const first = coordinator.run({ projectId: "a", mode: "write", long: true }, async () => {
    order.push("write-start");
    await gate.promise;
    order.push("write-end");
  });
  const second = coordinator.run({ projectId: "a", mode: "write" }, async () => order.push("write-2"));
  const foreignRead = coordinator.run({ projectId: "b", mode: "read" }, async () => order.push("read-b"));
  await foreignRead;
  assert.ok(order.includes("read-b"));
  assert.ok(order.includes("write-start"));
  assert.equal(order.includes("write-2"), false);
  gate.resolve();
  await Promise.all([first, second]);
  assert.ok(order.indexOf("write-2") > order.indexOf("write-end"));
});

test("a project writer waits for active readers and blocks later readers until commit", async () => {
  const coordinator = createMcpExecutionCoordinator({ maxLongJobs: 2, maxQueue: 32 });
  const readGate = deferred();
  const writeGate = deferred();
  const order = [];
  const firstRead = coordinator.run({ projectId: "a", mode: "read" }, async () => {
    order.push("read-1-start");
    await readGate.promise;
    order.push("read-1-end");
  });
  await new Promise((resolve) => setImmediate(resolve));
  const write = coordinator.run({ projectId: "a", mode: "write" }, async () => {
    order.push("write-start");
    await writeGate.promise;
    order.push("write-end");
  });
  const laterRead = coordinator.run({ projectId: "a", mode: "read" }, async () => {
    order.push("read-2");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["read-1-start"]);
  readGate.resolve();
  await firstRead;
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(order.includes("write-start"));
  assert.equal(order.includes("read-2"), false);
  writeGate.resolve();
  await Promise.all([write, laterRead]);
  assert.ok(order.indexOf("read-2") > order.indexOf("write-end"));
});

test("execution coordinator cancels in-flight work with an AbortSignal", async () => {
  const coordinator = createMcpExecutionCoordinator({ maxLongJobs: 2, maxQueue: 32 });
  const started = deferred();
  const call = coordinator.run(
    { requestId: 42, projectId: "a", mode: "write", long: true },
    async ({ signal }) => {
      started.resolve();
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  );
  await started.promise;
  assert.equal(coordinator.cancel(42, "user cancelled"), true);
  await assert.rejects(call, /user cancelled/u);
  assert.equal(coordinator.stats().inFlight, 0);
});

test("execution coordinator bounds the long-job queue with a retryable error", async () => {
  const coordinator = createMcpExecutionCoordinator({ maxLongJobs: 1, maxQueue: 1 });
  const gate = deferred();
  const first = coordinator.run({ projectId: "a", mode: "read", long: true }, () => gate.promise);
  const second = coordinator.run({ projectId: "b", mode: "read", long: true }, async () => "second");
  const error = await coordinator
    .run({ projectId: "c", mode: "read", long: true }, async () => "third")
    .catch((reason) => reason);
  assert.equal(error.code, "xsxb_queue_full");
  assert.equal(error.retryable, true);
  gate.resolve();
  await Promise.all([first, second]);
});

test("filesystem locks serialize independent MCP coordinator instances", async () => {
  const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-locks-"));
  const first = createMcpExecutionCoordinator({ lockRoot });
  const second = createMcpExecutionCoordinator({ lockRoot });
  const gate = deferred();
  const order = [];
  try {
    const reader = first.run({ projectId: "shared", mode: "read" }, async () => {
      order.push("reader-start");
      await gate.promise;
      order.push("reader-end");
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const writer = second.run({ projectId: "shared", mode: "write" }, async () => {
      order.push("writer");
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(order, ["reader-start"]);
    gate.resolve();
    await Promise.all([reader, writer]);
    assert.deepEqual(order, ["reader-start", "reader-end", "writer"]);
  } finally {
    gate.resolve();
    first.close();
    second.close();
    fs.rmSync(lockRoot, { recursive: true, force: true });
  }
});

test("filesystem project lock serializes two independent Node MCP processes", async () => {
  const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-process-locks-"));
  const childPath = path.join(__dirname, "fixtures", "xsxb_mcp_lock_child.js");
  const children = [];
  const startChild = (mode) => {
    const child = fork(childPath, [lockRoot, mode], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const messages = [];
    const waiters = [];
    child.on("message", (message) => {
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (waiter.type !== message.type) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    });
    child.waitFor = (type) => {
      const existing = messages.find((message) => message.type === type);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => waiters.push({ type, resolve }));
    };
    children.push(child);
    return child;
  };
  try {
    const reader = startChild("read");
    await reader.waitFor("started");
    const writer = startChild("write");
    let writerStarted = false;
    writer.on("message", (message) => {
      if (message.type === "started") writerStarted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(writerStarted, false);
    reader.send("release");
    await reader.waitFor("done");
    await writer.waitFor("started");
    writer.send("release");
    await writer.waitFor("done");
    await Promise.all(
      children.map(
        (child) =>
          new Promise((resolve) => {
            if (child.exitCode !== null) resolve();
            else child.once("exit", resolve);
          }),
      ),
    );
  } finally {
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGTERM");
    }
    fs.rmSync(lockRoot, { recursive: true, force: true });
  }
});
