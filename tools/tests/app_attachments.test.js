"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_attachments");
const { buildOneToOneSequencePlan } = require("../animation_tuner/public/app_attachment_sequence");

test("attachment controller validates browser integration dependencies", () => {
  assert.throws(() => createController(), /dependencies are required/);
  assert.throws(
    () => createController({ fetchImpl: fetch, fileReaderConstructor: class {} }),
    /dependencies are required/,
  );
});

/**
 * Creates an attachment controller focused on reusable asset-library lifecycle behavior.
 * @param {{browserSession?:boolean,failPersistence?:boolean,deferPersistence?:boolean}} [options] Persistence mode and failure behavior.
 * @returns {object} Mutable fixture state and controller.
 */
function createAssetLifecycleFixture(options = {}) {
  let assets = [
    {
      id: "asset-a",
      name: "slash-a.png",
      path: "workspace/attachments/hash-a.png",
      assetHash: "hash-a",
      groupKey: "hero/run",
    },
    {
      id: "asset-b",
      name: "slash-b.png",
      path: "workspace/attachments/hash-b.png",
      assetHash: "hash-b",
      groupKey: "hero/run",
    },
    {
      id: "asset-other",
      name: "idle.png",
      path: "workspace/attachments/hash-other.png",
      assetHash: "hash-other",
      groupKey: "hero/idle",
    },
  ];
  const frameAttachments = [
    {
      id: "layer-a",
      assetId: "asset-a",
      path: "workspace/attachments/hash-a.png",
      assetHash: "hash-a",
      key: "hero/run:0",
    },
  ];
  const requests = [];
  const persistedLibraries = [];
  const statuses = [];
  let renderCount = 0;
  let activeProjectId = "project-a";
  let config = { dataRevision: "revision-1" };
  let releasePersistence = () => {};
  const persistenceGate = options.deferPersistence
    ? new Promise((resolve) => {
        releasePersistence = resolve;
      })
    : null;
  const persistAssetLibrary = options.browserSession
    ? async (nextAssets) => {
        if (options.failPersistence) throw new Error("session persistence failed");
        persistedLibraries.push(nextAssets.map((asset) => asset.id));
      }
    : undefined;
  const controller = createController({
    fetchImpl: async (url, requestOptions = {}) => {
      requests.push({ url, body: JSON.parse(requestOptions.body || "{}") });
      if (persistenceGate) await persistenceGate;
      return {
        ok: !options.failPersistence,
        text: async () => "project persistence failed",
        json: async () => ({ dataRevision: "revision-2" }),
      };
    },
    fileReaderConstructor: class {},
    imageConstructor: class {},
    getActiveProjectId: () => activeProjectId,
    getConfig: () => config,
    getCurrentGroup: () => ({ profileId: "hero", animationId: "run", frames: [] }),
    getLanguage: () => "zh",
    getAttachmentAssets: () => assets,
    setAttachmentAssets: (nextAssets) => {
      assets = nextAssets;
    },
    getFrameImageAttachments: () => frameAttachments,
    setFrameImageAttachments: () => {},
    getSelectedAttachmentId: () => "",
    selectedFrameIndexes: () => [],
    getSelectedFrame: () => 0,
    newLocalId: () => "unused",
    normalizeFrameImageAttachment: (value) => value,
    attachmentLayerOrder: () => 1,
    frameImageAttachmentKey: () => "hero/run:0",
    frameImageAttachmentMetadata: () => ({}),
    nextAboveAttachmentLayerOrder: () => 1,
    clampFrameIndex: (index) => index,
    pushUndo: () => {},
    clearSelectedAttachment: () => {},
    loadImageCached: async () => null,
    selectFrameImageAttachment: () => {},
    markDirty: () => {},
    renderFilmstrip: () => {
      renderCount += 1;
    },
    syncFrameInputs: () => {},
    draw: () => {},
    status: (message) => statuses.push(message),
    translate: (key, values = {}) => `${key}:${values.count || ""}`,
    buildOneToOneSequencePlan,
    persistAssetLibrary,
  });
  return {
    controller,
    assets: () => assets,
    get config() {
      return config;
    },
    frameAttachments,
    persistedLibraries,
    releasePersistence,
    renderCount: () => renderCount,
    requests,
    statuses,
    switchProject(projectId, nextAssets, nextConfig = { dataRevision: "revision-other" }) {
      activeProjectId = projectId;
      assets = nextAssets;
      config = nextConfig;
    },
  };
}

test("attachment controller applies a confirmed one-to-one sequence as one undo step", async () => {
  const attachments = [];
  const confirmations = [];
  const undoLabels = [];
  const group = {
    frames: [
      { width: 256, height: 256 },
      { width: 256, height: 256 },
    ],
  };
  let localId = 0;
  const controller = createController({
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    fileReaderConstructor: class {},
    imageConstructor: class {},
    getActiveProjectId: () => "project",
    getConfig: () => null,
    getCurrentGroup: () => group,
    getLanguage: () => "zh",
    getAttachmentAssets: () => [],
    setAttachmentAssets: () => {},
    getFrameImageAttachments: () => attachments,
    setFrameImageAttachments: () => {},
    getSelectedAttachmentId: () => "",
    selectedFrameIndexes: () => [1, 0],
    getSelectedFrame: () => 0,
    newLocalId: () => `layer-${++localId}`,
    normalizeFrameImageAttachment: (value) => value,
    attachmentLayerOrder: () => 1,
    frameImageAttachmentKey: (frameIndex) => `frame-${frameIndex}`,
    frameImageAttachmentMetadata: (frameIndex) => ({ frame: frameIndex }),
    nextAboveAttachmentLayerOrder: () => 1,
    clampFrameIndex: (index) => index,
    pushUndo: (label) => undoLabels.push(label),
    clearSelectedAttachment: () => {},
    loadImageCached: async () => null,
    selectFrameImageAttachment: () => {},
    markDirty: () => {},
    renderFilmstrip: () => {},
    syncFrameInputs: () => {},
    draw: () => {},
    status: () => {},
    translate: (key, values = {}) =>
      Object.entries(values).reduce(
        (message, [name, value]) => message.replace(`{${name}}`, String(value)),
        key,
      ),
    buildOneToOneSequencePlan,
    requestConfirmation: async (message, details) => {
      confirmations.push({ message, details });
      return true;
    },
  });

  const created = await controller.applyAttachmentAssetSequence([
    { id: "two", name: "slash_2.png", path: "/2.png", width: 256, height: 256 },
    { id: "one", name: "slash_1.png", path: "/1.png", width: 256, height: 256 },
  ]);

  assert.equal(created, 2);
  assert.deepEqual(undoLabels, ["apply attachment sequence"]);
  assert.deepEqual(
    attachments.map((attachment) => [attachment.key, attachment.id, attachment.name]),
    [
      ["frame-0", "layer-1", "slash_1.png"],
      ["frame-1", "layer-2", "slash_2.png"],
    ],
  );
  assert.equal(confirmations.length, 1);
  assert.ok(confirmations[0].details.some(([, value]) => value === "assetSequenceCanvasShared"));
});

test("asset library removes one or many references and restores them without touching placed instances", async () => {
  const fixture = createAssetLifecycleFixture();
  const originalFrameAttachments = structuredClone(fixture.frameAttachments);

  const removed = await fixture.controller.removeAttachmentAssets(
    ["asset-a", "asset-b", "asset-other"],
    "hero/run",
  );

  assert.equal(removed, 2);
  assert.deepEqual(
    fixture.assets().map((asset) => asset.id),
    ["asset-other"],
  );
  assert.deepEqual(fixture.frameAttachments, originalFrameAttachments);
  assert.equal(fixture.controller.canUndoAttachmentAssetRemoval("hero/run"), true);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].url, "/api/attachment-assets");
  assert.deepEqual(
    fixture.requests[0].body.assets.map((asset) => asset.id),
    ["asset-other"],
  );
  assert.equal(fixture.requests[0].body.baseRevision, "revision-1");
  assert.equal(fixture.config.dataRevision, "revision-2");

  fixture.assets().push({ id: "asset-new", groupKey: "hero/run", path: "data:image/png,new" });
  const restored = await fixture.controller.undoAttachmentAssetRemoval("hero/run");

  assert.equal(restored, 2);
  assert.deepEqual(
    fixture.assets().map((asset) => asset.id),
    ["asset-a", "asset-b", "asset-other", "asset-new"],
  );
  assert.deepEqual(fixture.frameAttachments, originalFrameAttachments);
  assert.equal(fixture.controller.canUndoAttachmentAssetRemoval("hero/run"), false);
  assert.equal(fixture.requests.length, 2);
  assert.deepEqual(fixture.statuses, ["assetRemovedFromLibrary:2", "assetRestoredToLibrary:2"]);
});

test("browser-session asset removal and undo use the injected in-memory persistence adapter", async () => {
  const fixture = createAssetLifecycleFixture({ browserSession: true });

  await fixture.controller.removeAttachmentAssets("asset-a", "hero/run");
  await fixture.controller.undoAttachmentAssetRemoval("hero/run");

  assert.equal(fixture.requests.length, 0);
  assert.deepEqual(fixture.persistedLibraries, [
    ["asset-b", "asset-other"],
    ["asset-a", "asset-b", "asset-other"],
  ]);
  assert.deepEqual(
    fixture.assets().map((asset) => asset.id),
    ["asset-a", "asset-b", "asset-other"],
  );
});

test("asset removal rolls the in-memory library back when persistence fails", async () => {
  const fixture = createAssetLifecycleFixture({ failPersistence: true });
  const originalAssets = structuredClone(fixture.assets());
  const originalFrameAttachments = structuredClone(fixture.frameAttachments);

  await assert.rejects(
    fixture.controller.removeAttachmentAssets(["asset-a"], "hero/run"),
    /project persistence failed/,
  );

  assert.deepEqual(fixture.assets(), originalAssets);
  assert.deepEqual(fixture.frameAttachments, originalFrameAttachments);
  assert.equal(fixture.controller.canUndoAttachmentAssetRemoval("hero/run"), false);
  assert.equal(fixture.renderCount(), 1);
});

test("asset removal never applies a late success snapshot to a newly active project", async () => {
  const fixture = createAssetLifecycleFixture({ deferPersistence: true });
  const pendingRemoval = fixture.controller.removeAttachmentAssets(["asset-a"], "hero/run");
  const projectBAssets = [{ id: "asset-b-only", path: "workspace/attachments/b.png", groupKey: "hero/run" }];
  fixture.switchProject("project-b", projectBAssets, { dataRevision: "revision-b" });

  fixture.releasePersistence();
  assert.equal(await pendingRemoval, 1);

  assert.equal(fixture.requests[0].body.projectId, "project-a");
  assert.equal(fixture.requests[0].body.baseRevision, "revision-1");
  assert.equal(fixture.config.dataRevision, "revision-b");
  assert.deepEqual(fixture.assets(), projectBAssets);
  assert.equal(fixture.controller.canUndoAttachmentAssetRemoval("hero/run"), false);
  assert.equal(fixture.renderCount(), 0);
});

test("asset removal never rolls an old project library into a newly active project", async () => {
  const fixture = createAssetLifecycleFixture({ deferPersistence: true, failPersistence: true });
  const pendingRemoval = fixture.controller.removeAttachmentAssets(["asset-a"], "hero/run");
  const projectBAssets = [{ id: "asset-b-only", path: "workspace/attachments/b.png", groupKey: "hero/run" }];
  fixture.switchProject("project-b", projectBAssets, { dataRevision: "revision-b" });

  fixture.releasePersistence();
  await assert.rejects(pendingRemoval, /project persistence failed/);

  assert.deepEqual(fixture.assets(), projectBAssets);
  assert.equal(fixture.controller.canUndoAttachmentAssetRemoval("hero/run"), false);
  assert.equal(fixture.renderCount(), 0);
});
