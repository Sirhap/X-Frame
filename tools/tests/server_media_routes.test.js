"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createMediaRoutes } = require("../animation_tuner/server_media_routes");

function createHarness(overrides = {}) {
  const responses = [];
  const project = { id: "project-a", projectRoot: "/tmp/project-a" };
  const projectStore = {
    projectPaths: () => ({ frameAudio: "/tmp/project-a/frame-audio.json" }),
    slug: (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "-"),
    readRegistry: () => ({ activeProjectId: project.id, projects: [project] }),
    addProject: () => ({ activeProjectId: project.id, projects: [project] }),
    setActiveProject: () => ({ activeProjectId: project.id, projects: [project] }),
    resolveProject: () => project,
  };
  const routes = createMediaRoutes({
    send: (_res, status, payload) => {
      responses.push({ status, payload });
      return true;
    },
    readJsonBody:
      overrides.readJsonBody ||
      (async () => ({ projectId: project.id, frameAudioBindings: [{ key: "walk:0" }] })),
    withProjectWrite: async (_projectId, operation) => operation(),
    projectStore,
    projectFromRequest: () => ({ project }),
    requiredProjectFromRequest: () => ({ project }),
    projectDataRevision: overrides.projectDataRevision || (() => "revision-a"),
    createFilesystemSnapshot: async () => ({
      dispose: async () => {},
      restore: async () => {},
    }),
    managedProjectPaths: () => ["/tmp/project-a"],
    rollbackFilesystemSnapshot: async (_transaction, error) => {
      throw error;
    },
    fs: { promises: { rm: async () => {} } },
    path: require("node:path"),
    root: "/tmp/root",
    decodeDataUrl: () => null,
    saveFrameAudioBindings: overrides.saveFrameAudioBindings || (() => []),
    saveFrameAttachmentImage: overrides.saveFrameAttachmentImage || (() => ({ path: "frame.png" })),
    saveAttachmentAssets: overrides.saveAttachmentAssets || (() => []),
    replaceFrameImage: () => ({ path: "frame.png" }),
    replaceAnimationImages: () => ({ frames: [] }),
    deleteAnimation: overrides.deleteAnimation || (() => ({ removedFrames: [] })),
    importAnimation: () => ({ profileId: "profile-a", animationId: "walk", frameCount: 1 }),
    reorganizeAnimation: () => ({ frameCount: 1, targetDir: "", manifest: {}, tuning: {} }),
    syncGodotProjectAsync: overrides.syncGodotProjectAsync || (async () => ({ ok: true })),
    syncFrameAudioAsync: async () => ({ ok: true }),
    syncGodotRuntimeProjectId: () => [],
    godotMirrorPath: () => "",
    validateProject: () => [],
    godotHandoffService: { status: () => ({ state: "synced" }) },
  });
  return { routes, responses, project };
}

test("media route dispatcher preserves frame-audio transaction response", async () => {
  let savedBindings = null;
  const { routes, responses, project } = createHarness({
    saveFrameAudioBindings: (bindings, savedProject) => {
      savedBindings = { bindings, project: savedProject };
      return bindings;
    },
  });
  const handled = await routes.handleMediaRoute(
    { method: "POST" },
    {},
    new URL("http://127.0.0.1/api/frame-audio"),
  );
  assert.equal(handled, true);
  assert.deepEqual(savedBindings, { bindings: [{ key: "walk:0" }], project });
  assert.deepEqual(responses, [
    {
      status: 200,
      payload: {
        ok: true,
        frameAudioCount: 1,
        godotAudioSync: { ok: true },
        dataRevision: "revision-a",
        godotHandoff: { state: "synced" },
      },
    },
  ]);
});

test("media route dispatcher keeps attachment responses and ignores unrelated paths", async () => {
  const { routes, responses } = createHarness();
  const handled = await routes.handleMediaRoute(
    { method: "POST" },
    {},
    new URL("http://127.0.0.1/api/frame-attachment-image"),
  );
  assert.equal(handled, true);
  assert.equal(responses[0].status, 200);
  assert.deepEqual(responses[0].payload, {
    ok: true,
    image: { path: "frame.png" },
    dataRevision: "revision-a",
    godotHandoff: { state: "synced" },
  });

  const unmatched = await routes.handleMediaRoute(
    { method: "GET" },
    {},
    new URL("http://127.0.0.1/api/unknown"),
  );
  assert.equal(unmatched, false);
});

test("attachment asset persistence rejects a stale full-library replacement", async () => {
  let saveCount = 0;
  const { routes, responses } = createHarness({
    readJsonBody: async () => ({
      projectId: "project-a",
      baseRevision: "revision-stale",
      assets: [{ id: "asset-a", path: "workspace/attachments/a.png" }],
    }),
    saveAttachmentAssets: () => {
      saveCount += 1;
      return [];
    },
  });

  const handled = await routes.handleMediaRoute(
    { method: "POST" },
    {},
    new URL("http://127.0.0.1/api/attachment-assets"),
  );

  assert.equal(handled, true);
  assert.equal(saveCount, 0);
  assert.deepEqual(responses, [
    {
      status: 409,
      payload: {
        error: "Project data changed in another window. Reload before updating attachment assets.",
        code: "revision_conflict",
        dataRevision: "revision-a",
      },
    },
  ]);
});

test("animation deletion synchronizes and returns the filtered attack-trail document", async () => {
  const attackTrails = { schemaVersion: 8, bindings: { "other/idle": [] } };
  const syncCalls = [];
  const { routes, responses } = createHarness({
    readJsonBody: async () => ({
      projectId: "project-a",
      profileId: "hero",
      animationId: "run",
      baseRevision: "revision-a",
    }),
    deleteAnimation: () => ({
      removedFrames: 2,
      removedDirectory: "",
      manifest: { profiles: [] },
      tuning: { values: {} },
      frameAudioBindings: [],
      frameImageAttachments: [],
      attackTrails,
    }),
    syncGodotProjectAsync: async (_project, options) => {
      syncCalls.push(options);
      return { ok: true };
    },
  });

  const handled = await routes.handleMediaRoute(
    { method: "POST" },
    {},
    new URL("http://127.0.0.1/api/delete-animation"),
  );

  assert.equal(handled, true);
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0].attackTrails, attackTrails);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].payload.attackTrails, attackTrails);
});
