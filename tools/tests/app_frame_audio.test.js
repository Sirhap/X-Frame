const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_frame_audio");

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
