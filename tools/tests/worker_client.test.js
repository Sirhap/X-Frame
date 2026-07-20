"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createExecutor } = require("../animation_tuner/public/batch_cutout_worker_client");
const {
  createExecutor: createLoopExecutor,
} = require("../animation_tuner/public/frame_organizer_worker_client");

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

test("synchronous fallback isolates caller-owned pixels", async () => {
  const source = Uint8ClampedArray.from([20, 40, 60, 255]);
  const executor = createExecutor({
    WorkerConstructor: null,
    syncProcess(receivedSource) {
      receivedSource[0] = 99;
      return { data: receivedSource };
    },
  });

  const result = await executor.process(source, 1, 1);

  assert.deepEqual(Array.from(source), [20, 40, 60, 255]);
  assert.deepEqual(Array.from(result.data), [99, 40, 60, 255]);
});

test("cutout executor rebuilds its Worker and retries one transport failure", async () => {
  const instances = [];
  const receivedBuffers = [];
  const receivedRequests = [];
  class RecoveringWorker {
    constructor() {
      this.instanceIndex = instances.length;
      this.terminated = false;
      instances.push(this);
    }

    postMessage(message) {
      receivedBuffers.push(message.sourceBuffer);
      const received = Array.from(new Uint8ClampedArray(message.sourceBuffer));
      receivedRequests.push({
        source: received,
        options: structuredClone(message.options),
        repairs: structuredClone(message.repairs),
      });
      if (this.instanceIndex === 0) {
        queueMicrotask(() =>
          this.onerror({
            message: "worker script crashed",
            filename: "batch_cutout_worker.js",
            lineno: 17,
            colno: 9,
          }),
        );
        return;
      }
      queueMicrotask(() =>
        this.onmessage({
          data: {
            id: message.id,
            ok: true,
            dataBuffer: Uint8ClampedArray.from(received).buffer,
            automaticBuffer: Uint8ClampedArray.from(received).buffer,
          },
        }),
      );
    }

    terminate() {
      this.terminated = true;
    }
  }

  const executor = createExecutor({ WorkerConstructor: RecoveringWorker });
  const source = Uint8ClampedArray.from([20, 40, 60, 255]);
  const processingOptions = { threshold: 12, nested: { mode: "automatic" } };
  const repairs = [{ radius: 4, point: { x: 1, y: 2 } }];
  const pendingResult = executor.process(source, 1, 1, processingOptions, repairs);
  source[0] = 99;
  processingOptions.threshold = 99;
  processingOptions.nested.mode = "manual";
  repairs[0].radius = 99;
  repairs.push({ radius: 8 });
  const result = await pendingResult;

  assert.deepEqual(Array.from(result.data), [20, 40, 60, 255]);
  assert.deepEqual(Array.from(source), [99, 40, 60, 255]);
  assert.deepEqual(receivedRequests, [
    {
      source: [20, 40, 60, 255],
      options: { threshold: 12, nested: { mode: "automatic" } },
      repairs: [{ radius: 4, point: { x: 1, y: 2 } }],
    },
    {
      source: [20, 40, 60, 255],
      options: { threshold: 12, nested: { mode: "automatic" } },
      repairs: [{ radius: 4, point: { x: 1, y: 2 } }],
    },
  ]);
  assert.equal(receivedBuffers.length, 2);
  assert.notEqual(receivedBuffers[0], source.buffer);
  assert.notEqual(receivedBuffers[1], source.buffer);
  assert.equal(instances.length, 2);
  assert.equal(instances[0].terminated, true);
});

test("cutout executor exposes diagnostics after its transport retry is exhausted", async () => {
  const instances = [];
  class FailingWorker {
    constructor() {
      instances.push(this);
    }

    postMessage() {
      queueMicrotask(() =>
        this.onerror({
          message: "worker script crashed",
          filename: "batch_cutout_worker.js",
          lineno: 23,
          colno: 5,
        }),
      );
    }

    terminate() {}
  }

  const executor = createExecutor({ WorkerConstructor: FailingWorker });
  await assert.rejects(executor.process(Uint8ClampedArray.from([0, 0, 0, 255]), 1, 1), (error) => {
    assert.equal(error.name, "CutoutWorkerTransportError");
    assert.equal(error.code, "CUTOUT_WORKER_TRANSPORT_ERROR");
    assert.equal(error.filename, "batch_cutout_worker.js");
    assert.equal(error.lineno, 23);
    assert.equal(error.colno, 5);
    assert.equal(error.message, "worker script crashed (batch_cutout_worker.js:23:5)");
    return true;
  });
  assert.equal(instances.length, 2);
});

test("cutout executor reports retry exhaustion when the browser omits an error message", async () => {
  class UndecodableWorker {
    postMessage() {
      queueMicrotask(() => this.onmessageerror({ filename: "batch_cutout_worker.js", lineno: 31, colno: 7 }));
    }

    terminate() {}
  }

  const executor = createExecutor({ WorkerConstructor: UndecodableWorker });
  await assert.rejects(
    executor.process(Uint8ClampedArray.from([0, 0, 0, 255]), 1, 1),
    /Cutout Worker failed after one automatic retry\. \(batch_cutout_worker\.js:31:7\)/,
  );
});

test("cutout executor does not retry algorithm failures", async () => {
  const instances = [];
  class AlgorithmFailureWorker {
    constructor() {
      instances.push(this);
    }

    postMessage(message) {
      queueMicrotask(() =>
        this.onmessage({ data: { id: message.id, ok: false, error: "algorithm rejected image" } }),
      );
    }

    terminate() {}
  }

  const executor = createExecutor({ WorkerConstructor: AlgorithmFailureWorker });
  await assert.rejects(
    executor.process(Uint8ClampedArray.from([0, 0, 0, 255]), 1, 1),
    /algorithm rejected image/,
  );
  assert.equal(instances.length, 1);
});

test("loop executor forwards progress, transfers copies, and reuses its Worker", async () => {
  const instances = [];
  class FakeLoopWorker {
    constructor(url) {
      this.url = url;
      this.terminated = false;
      instances.push(this);
    }

    postMessage(message) {
      const received = message.signatureBuffers.map((buffer) => Array.from(new Uint8Array(buffer)));
      const dimensions = message.signatureDimensions;
      queueMicrotask(() =>
        this.onmessage({ data: { id: message.id, type: "progress", current: 2, total: 3 } }),
      );
      queueMicrotask(() =>
        this.onmessage({
          data: { id: message.id, type: "result", ok: true, candidates: [{ received, dimensions }] },
        }),
      );
    }

    terminate() {
      this.terminated = true;
    }
  }

  const executor = createLoopExecutor({
    WorkerConstructor: FakeLoopWorker,
    workerUrl: "nested/frame_organizer_worker.js",
  });
  const source = Uint8Array.from([1, 2, 3]);
  const progress = [];
  const candidates = await executor.analyze(
    [source],
    {},
    { onProgress: (current, total) => progress.push([current, total]) },
  );
  await executor.analyze([source]);

  assert.deepEqual(candidates, [{ received: [[1, 2, 3]], dimensions: [{ width: 1, height: 1 }] }]);
  assert.deepEqual(progress, [[2, 3]]);
  assert.deepEqual(Array.from(source), [1, 2, 3]);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].url, "nested/frame_organizer_worker.js");
  executor.cancelAll();
  assert.equal(instances[0].terminated, true);
});

test("loop executor preserves object-signature dimensions", async () => {
  class DimensionWorker {
    postMessage(message) {
      queueMicrotask(() =>
        this.onmessage({
          data: {
            id: message.id,
            type: "result",
            ok: true,
            candidates: message.signatureDimensions,
          },
        }),
      );
    }

    terminate() {}
  }

  const executor = createLoopExecutor({ WorkerConstructor: DimensionWorker });
  const candidates = await executor.analyze([
    {
      data: Uint8ClampedArray.from(new Array(16).fill(0)),
      width: 2,
      height: 2,
    },
  ]);
  assert.deepEqual(candidates, [{ width: 2, height: 2 }]);
});

test("loop executor rejects pending requests when the panel is closed", async () => {
  class PendingLoopWorker {
    postMessage() {}

    terminate() {}
  }

  const executor = createLoopExecutor({ WorkerConstructor: PendingLoopWorker });
  const pending = executor.analyze([Uint8Array.from([1])]);
  executor.cancelAll();
  await assert.rejects(pending, { name: "AbortError" });
});
