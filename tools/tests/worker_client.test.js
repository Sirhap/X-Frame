"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createExecutor } = require("../animation_tuner/public/batch_cutout_worker_client");

test("cutout executor reuses one Worker and terminates it on cancellation", async () => {
  const instances = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.terminated = false;
      instances.push(this);
    }

    postMessage(message) {
      const source = new Uint8ClampedArray(message.sourceBuffer);
      queueMicrotask(() => {
        this.onmessage({
          data: {
            id: message.id,
            ok: true,
            dataBuffer: new Uint8ClampedArray(source).buffer,
            automaticBuffer: new Uint8ClampedArray(source).buffer,
            removedPixels: 0,
            partialPixels: 0,
          },
        });
      });
    }

    terminate() {
      this.terminated = true;
    }
  }

  const executor = createExecutor({
    WorkerConstructor: FakeWorker,
    workerUrl: "nested/batch_cutout_worker.js",
  });
  const source = Uint8ClampedArray.from([20, 40, 60, 255]);
  await executor.process(source, 1, 1);
  await executor.process(source, 1, 1);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].url, "nested/batch_cutout_worker.js");
  assert.equal(instances[0].terminated, false);
  executor.cancelAll();
  assert.equal(instances[0].terminated, true);
});

test("unsupported browsers do not silently run the synchronous kernel", async () => {
  const executor = createExecutor({
    WorkerConstructor: undefined,
    syncProcess() {
      throw new Error("must not run");
    },
  });
  await assert.rejects(executor.process(Uint8ClampedArray.from([0, 0, 0, 255]), 1, 1), /Web Worker support/);
});
