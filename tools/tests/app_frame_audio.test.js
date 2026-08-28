const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_frame_audio");

test("the audio tool ships the markup its already-wired controller queries", () => {
  // app_dom.js resolves these ids and every caller guards with `if (els.x)`, so a
  // missing panel silently turns the whole audio tool into a no-op nav entry.
  const html = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/index.html"), "utf8");
  const dom = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/app_dom.js"), "utf8");

  const requiredIds = [...dom.matchAll(/querySelector\("#(frameAudio\w+|clearFrameAudio)"\)/g)].map(
    (match) => match[1],
  );
  assert.ok(requiredIds.length >= 4, "app_dom should still resolve the frame-audio controls");
  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html is missing #${id}`);
  }
  assert.match(html, /data-panel="frame-audio"/, "the audio tool needs a sidebar panel to show");
});

function createAudioController(overrides = {}) {
  const bindings = {
    "project:idle:2": {
      key: "project:idle:2",
      name: "hit.wav",
      type: "audio/wav",
      size: 12,
      metadata: { projectId: "project", animation: "idle", frame: 2 },
      data: "data:audio/wav;base64,AA==",
    },
  };
  const config = {};
  const statuses = [];
  const controller = createController({
    dbName: "test-audio",
    dbVersion: 1,
    storeName: "audio",
    getBindings: () => bindings,
    getActiveProjectId: () => "project",
    getFrameAudioKey: (index) => `project:idle:${index}`,
    getFrameAudioMetadata: (index) => ({ projectId: "project", animation: "idle", frame: index }),
    getFrameAudioMetadataFromKey: () => null,
    revokeBinding: (binding) => {
      if (binding) binding.revoked = true;
    },
    status: (message) => statuses.push(message),
    translate: (key, variables = {}) => `${key}:${variables.message || variables.count || ""}`,
    getConfig: () => config,
    indexedDBRef: null,
    fetchImpl: async (_url, request) => ({
      ok: true,
      async json() {
        return { dataRevision: "r2", frameAudioCount: JSON.parse(request.body).frameAudioBindings.length };
      },
    }),
    ...overrides,
  });
  return { bindings, config, controller, statuses };
}

test("frame audio controller handles unavailable IndexedDB gracefully", async () => {
  const { controller } = createAudioController();
  assert.equal(await controller.open(), null);
  assert.deepEqual(await controller.collectForSave(), [
    {
      key: "project:idle:2",
      projectId: "project",
      animation: "idle",
      frame: 2,
      name: "hit.wav",
      type: "audio/wav",
      size: 12,
      data: "data:audio/wav;base64,AA==",
    },
  ]);
});

test("frame audio controller serializes sync payloads and updates revision", async () => {
  const { config, controller, statuses } = createAudioController();
  const result = await controller.syncToGame();

  assert.deepEqual(result, { dataRevision: "r2", frameAudioCount: 1 });
  assert.equal(config.dataRevision, "r2");
  assert.deepEqual(statuses, ["frameSfxSaved:1"]);
});

test("frame audio controller rejects unavailable FileReader for Blob export", async () => {
  const { controller } = createAudioController({
    fileReaderConstructor: null,
    getBindings: () => ({
      "project:idle:2": {
        metadata: { projectId: "project", animation: "idle", frame: 2 },
        blob: {},
      },
    }),
  });

  await assert.rejects(() => controller.collectForSave(), /FileReader is unavailable/);
});

/** Builds an in-memory IndexedDB that matches the frame-audio controller's request API. */
function createMemoryIndexedDb() {
  const records = new Map();

  function succeed(target, result) {
    target.result = result;
    queueMicrotask(() => target.onsuccess?.({ target }));
  }

  return {
    records,
    open() {
      const request = {
        result: {
          objectStoreNames: { contains: () => true },
          transaction() {
            const tx = { oncomplete: null, onerror: null };
            queueMicrotask(() => tx.oncomplete?.());
            tx.objectStore = () => ({
              put(value) {
                records.set(value.key, value);
                const putRequest = { result: value, onsuccess: null, onerror: null };
                succeed(putRequest, value);
                return putRequest;
              },
              delete(key) {
                records.delete(key);
                const deleteRequest = { result: undefined, onsuccess: null, onerror: null };
                succeed(deleteRequest, undefined);
                return deleteRequest;
              },
              getAll() {
                const getRequest = { result: [...records.values()], onsuccess: null, onerror: null };
                succeed(getRequest, [...records.values()]);
                return getRequest;
              },
            });
            return tx;
          },
        },
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
}

test("undo of a bind does not let loadFromDb resurrect an unsaved IDB write", async () => {
  const indexedDb = createMemoryIndexedDb();
  const blob = { name: "slash.wav", type: "audio/wav", size: 32 };
  const bindings = {};
  const { controller } = createAudioController({
    getBindings: () => bindings,
    getActiveProjectId: () => "project",
    getFrameAudioKey: (index, group) => `project:${group.animationId}:${index}`,
    getFrameAudioMetadata: (index, group) => ({
      projectId: "project",
      animation: group.animationId,
      frame: index,
    }),
    getFrameAudioMetadataFromKey: (key) => ({
      projectId: "project",
      animation: "idle",
      frame: 0,
      key,
    }),
    indexedDBRef: indexedDb,
    urlApi: {
      createObjectURL: (value) => `blob:live/${value.name || "audio"}`,
      revokeObjectURL() {},
    },
  });
  const group = { animationId: "idle" };
  await controller.setBinding(blob, 0, group);
  assert.ok(bindings["project:idle:0"], "bind stays in memory");
  delete bindings["project:idle:0"];
  await controller.loadFromDb();
  assert.equal(
    bindings["project:idle:0"],
    undefined,
    "IDB is write-through-on-save; undo of an unsaved bind must not resurrect",
  );

  await controller.setBinding(blob, 0, group);
  await controller.persistBindingsToDb();
  delete bindings["project:idle:0"];
  await controller.loadFromDb();
  assert.equal(bindings["project:idle:0"]?.name, "slash.wav", "save writes IDB so reload can restore");
});

test("SAV-011 loadFromDb restores imported WAV after reload with empty bindings", async () => {
  const indexedDb = createMemoryIndexedDb();
  const blob = { name: "beep.wav", type: "audio/wav", size: 24 };
  const bindings = {};
  const { controller } = createAudioController({
    getBindings: () => bindings,
    getActiveProjectId: () => "p0test2",
    getFrameAudioMetadataFromKey: (key) => ({
      projectId: "p0test2",
      animation: "assassin_jump",
      frame: 0,
      key,
    }),
    indexedDBRef: indexedDb,
    urlApi: {
      createObjectURL: (value) => `blob:restored/${value.name || "audio"}`,
      revokeObjectURL() {},
    },
  });

  await controller.saveToDb("p0test2:player:actor:assassin_jump::0", {
    name: "beep.wav",
    type: "audio/wav",
    size: 24,
    metadata: { projectId: "p0test2", animation: "assassin_jump", frame: 0 },
    blob,
  });
  assert.equal(indexedDb.records.size, 1);

  await controller.loadFromDb();

  const restored = bindings["p0test2:player:actor:assassin_jump::0"];
  assert.ok(restored, "reload must restore the imported WAV without a pre-existing binding");
  assert.equal(restored.name, "beep.wav");
  assert.equal(restored.blob, blob);
  assert.equal(restored.url, "blob:restored/beep.wav");
});
