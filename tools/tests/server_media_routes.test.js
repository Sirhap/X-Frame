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
    readJsonBody: async () => ({ projectId: project.id, frameAudioBindings: [{ key: "walk:0" }] }),
    withProjectWrite: async (_projectId, operation) => operation(),
    projectStore,
    projectFromRequest: () => ({ project }),
    requiredProjectFromRequest: () => ({ project }),
    projectDataRevision: () => "revision-a",
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
    saveAttachmentAssets: () => [],
    replaceFrameImage: () => ({ path: "frame.png" }),
    replaceAnimationImages: () => ({ frames: [] }),
    deleteAnimation: () => ({ removedFrames: [] }),
    importAnimation: () => ({ profileId: "profile-a", animationId: "walk", frameCount: 1 }),
    reorganizeAnimation: () => ({ frameCount: 1, targetDir: "", manifest: {}, tuning: {} }),
    syncGodotProjectAsync: async () => ({ ok: true }),
    syncFrameAudioAsync: async () => ({ ok: true }),
    syncGodotRuntimeProjectId: () => [],
    godotMirrorPath: () => "",
    validateProject: () => [],
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
  });

  const unmatched = await routes.handleMediaRoute(
    { method: "GET" },
    {},
    new URL("http://127.0.0.1/api/unknown"),
  );
  assert.equal(unmatched, false);
});
