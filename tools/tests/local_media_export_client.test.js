"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  STORAGE_KEY,
  exportMedia,
  getLastJobId,
  readResponse,
  resumeLastExport,
} = require("../animation_tuner/public/local_media_export_client");

/** Creates a deterministic localStorage-compatible adapter. */
function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("local media export response reader preserves server errors", async () => {
  await assert.rejects(
    () =>
      readResponse({
        ok: false,
        status: 413,
        json: async () => ({ error: "frame too large" }),
      }),
    /frame too large/,
  );
});

test("local media export response reader returns successful payloads", async () => {
  assert.deepEqual(
    await readResponse({ ok: true, status: 200, json: async () => ({ status: "completed" }) }),
    { status: "completed" },
  );
});

test("local media export sends server cancellation without reusing an aborted signal", async () => {
  const abortController = new AbortController();
  const requests = [];
  const fetchImpl = async (pathname, options) => {
    requests.push({ pathname, signal: options.signal });
    if (pathname === "/api/media-export/jobs") {
      return { ok: true, status: 201, json: async () => ({ id: "job-1" }) };
    }
    if (pathname === "/api/media-export/frame") {
      abortController.abort();
      throw new DOMException("cancelled", "AbortError");
    }
    return { ok: true, status: 200, json: async () => ({ status: "cancelled" }) };
  };
  const document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ clearRect() {}, drawImage() {} }),
      toDataURL: () => "data:image/png;base64,AA==",
    }),
  };

  await assert.rejects(
    exportMedia(
      { animationName: "Idle", fps: 12 },
      [{ image: { width: 16, height: 16 }, width: 16, height: 16 }],
      { gif: true },
      { fetchImpl, document, signal: abortController.signal },
    ),
    { name: "AbortError" },
  );

  assert.equal(requests.at(-1).pathname, "/api/media-export/cancel");
  assert.equal(requests.at(-1).signal, undefined);
});

test("local media export reconnects to the stored job through completion", async () => {
  const storage = createStorage();
  storage.setItem(STORAGE_KEY, "restored-job");
  const observed = [];
  const statuses = [
    { id: "restored-job", status: "queued", progress: 0.25 },
    { id: "restored-job", status: "running", progress: 0.6 },
    {
      id: "restored-job",
      status: "completed",
      progress: 1,
      downloads: [{ filename: "idle.gif", url: "/file" }],
    },
  ];
  const result = await resumeLastExport({
    storage,
    pollMs: 1,
    onStatus: (status) => observed.push(status.status),
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => statuses.shift() }),
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(observed, ["queued", "running", "completed"]);
  assert.equal(getLastJobId(storage), "restored-job");
});

test("local media export reports interrupted uploads and clears missing jobs", async () => {
  const storage = createStorage();
  storage.setItem(STORAGE_KEY, "upload-job");
  const interrupted = await resumeLastExport({
    storage,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "upload-job", status: "uploading", progress: 0.1 }),
    }),
  });
  assert.equal(interrupted.status, "failed");
  assert.equal(interrupted.serverStatus, "uploading");
  assert.equal(interrupted.errorCode, "upload_interrupted");

  const missing = await resumeLastExport({
    storage,
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    }),
  });
  assert.equal(missing, null);
  assert.equal(getLastJobId(storage), "");
});

test("local media export remembers failed encoding for reload recovery", async () => {
  const storage = createStorage();
  const responses = [
    { id: "failed-job", status: "uploading" },
    { uploaded: 1, frameCount: 1 },
    { id: "failed-job", status: "queued" },
    {
      id: "failed-job",
      status: "failed",
      error: "encoder failed",
      errorCode: "encoding_failed",
    },
  ];
  const paths = [];
  const document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ clearRect() {}, drawImage() {} }),
      toDataURL: () => "data:image/png;base64,AA==",
    }),
  };
  await assert.rejects(
    exportMedia(
      { animationName: "Idle", fps: 12 },
      [{ image: { width: 2, height: 2 }, width: 2, height: 2 }],
      { gif: true },
      {
        document,
        pollMs: 1,
        storage,
        fetchImpl: async (pathname) => {
          paths.push(pathname);
          return { ok: true, status: 200, json: async () => responses.shift() };
        },
      },
    ),
    /encoder failed/,
  );
  assert.equal(getLastJobId(storage), "failed-job");
  assert.equal(paths.includes("/api/media-export/cancel"), false);
});
