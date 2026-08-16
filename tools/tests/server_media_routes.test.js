"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createMediaRoutes } = require("../animation_tuner/server_media_routes");

function createHarness(overrides = {}) {
  const responses = [];
  const project = { id: "project-a", projectRoot: "/tmp/project-a" };
  const projectStore = {
    projectPaths: () => ({
      manifest: "/tmp/project-a/manifest.json",
      tuning: "/tmp/project-a/tuning.json",
      frameAudio: "/tmp/project-a/frame-audio.json",
      frameImageAttachments: "/tmp/project-a/frame-images.json",
      attackTrails: "/tmp/project-a/attack-trails.json",
    }),
    slug: (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "-"),
    readRegistry: () => ({ activeProjectId: project.id, projects: [project] }),
    path: "/tmp/projects.json",
    addProject: () => ({ activeProjectId: project.id, projects: [project] }),
    setActiveProject: () => ({ activeProjectId: project.id, projects: [project] }),
    resolveProject: () => project,
    readJson: overrides.readProjectJson || ((_filename, fallback) => fallback),
  };
  const routes = createMediaRoutes({
    send:
      overrides.send ||
      ((_res, status, payload) => {
        responses.push({ status, payload });
        return true;
      }),
    readJsonBody:
      overrides.readJsonBody ||
      (async () => ({ projectId: project.id, frameAudioBindings: [{ key: "walk:0" }] })),
    withProjectWrite: async (_projectId, operation) => operation(),
    projectStore,
    projectFromRequest: () => ({ project }),
    requiredProjectFromRequest: () => ({ project }),
    projectDataRevision: overrides.projectDataRevision || (() => "revision-a"),
    createFilesystemSnapshot:
      overrides.createFilesystemSnapshot ||
      (async () => ({
        dispose: async () => {},
        restore: async () => {},
      })),
    managedProjectPaths: () => ["/tmp/project-a"],
    rollbackFilesystemSnapshot:
      overrides.rollbackFilesystemSnapshot ||
      (async (_transaction, error) => {
        throw error;
      }),
    fs: { promises: { rm: async () => {} } },
    path: require("node:path"),
    root: "/tmp/root",
    decodeDataUrl: overrides.decodeDataUrl || (() => null),
    saveFrameAudioBindings: overrides.saveFrameAudioBindings || (() => []),
    saveFrameAttachmentImage: overrides.saveFrameAttachmentImage || (() => ({ path: "frame.png" })),
    saveAttachmentAssets: overrides.saveAttachmentAssets || (() => []),
    replaceFrameImage: () => ({ path: "frame.png" }),
    replaceAnimationImages: () => ({ frames: [] }),
    deleteAnimation: overrides.deleteAnimation || (() => ({ removedFrames: [] })),
    importAnimation:
      overrides.importAnimation || (() => ({ profileId: "profile-a", animationId: "walk", frameCount: 1 })),
    reorganizeAnimation:
      overrides.reorganizeAnimation || (() => ({ frameCount: 1, targetDir: "", manifest: {}, tuning: {} })),
    syncGodotProjectAsync: overrides.syncGodotProjectAsync || (async () => ({ ok: true })),
    syncFrameAudioAsync: async () => ({ ok: true }),
    syncGodotRuntimeProjectId: () => [],
    godotMirrorPath: () => "",
    validateProject: overrides.validateProject || (() => []),
    godotHandoffService: overrides.godotHandoffService || {
      status: () => ({ state: "synced" }),
    },
  });
  return { routes, responses, project };
}

test("animation import snapshots local state before Godot sync and rolls it back on failure", async () => {
  const events = [];
  const { routes, responses } = createHarness({
    readJsonBody: async () => ({
      projectId: "project-a",
      profileId: "hero",
      profileLabel: "Hero",
      animationId: "idle",
      animationName: "Idle",
      items: [{ data: "data:image/png;base64,valid" }],
    }),
    decodeDataUrl: () => ({
      mime: "image/png",
      buffer: Buffer.from("\x89PNG\r\n\x1a\n" + "0".repeat(32), "binary"),
    }),
    createFilesystemSnapshot: async (paths) => {
      events.push(["snapshot", paths]);
      return {
        dispose: async () => events.push("dispose"),
        restore: async () => events.push("restore"),
      };
    },
    rollbackFilesystemSnapshot: async (transaction, error) => {
      events.push("rollback");
      await transaction.restore();
      throw error;
    },
    syncGodotProjectAsync: async () => {
      throw new Error("simulated Godot sync failure");
    },
  });

  await assert.rejects(
    routes.handleMediaRoute({ method: "POST" }, {}, new URL("http://127.0.0.1/api/import-animation")),
    /simulated Godot sync failure/u,
  );
  assert.equal(responses.length, 0);
  assert.equal(events[0][0], "snapshot");
  assert.equal(events[1][0], "snapshot");
  assert.deepEqual(events.slice(2), ["restore", "restore", "dispose", "dispose"]);
});

test("animation import does not roll back disposed snapshots when response delivery fails", async () => {
  const events = [];
  const { routes } = createHarness({
    readJsonBody: async () => ({
      projectId: "project-a",
      profileId: "hero",
      profileLabel: "Hero",
      animationId: "idle",
      animationName: "Idle",
      items: [{ data: "data:image/png;base64,valid" }],
    }),
    decodeDataUrl: () => ({
      mime: "image/png",
      buffer: Buffer.from("\x89PNG\r\n\x1a\n" + "0".repeat(32), "binary"),
    }),
    createFilesystemSnapshot: async () => ({
      dispose: async () => events.push("dispose"),
      restore: async () => events.push("restore"),
    }),
    send: () => {
      events.push("send");
      throw new Error("response socket closed");
    },
  });

  await assert.rejects(
    routes.handleMediaRoute({ method: "POST" }, {}, new URL("http://127.0.0.1/api/import-animation")),
    /response socket closed/u,
  );
  assert.deepEqual(events, ["dispose", "dispose", "send"]);
});

test("animation import rolls back when snapshot disposal fails before response delivery", async () => {
  const events = [];
  const { routes } = createHarness({
    readJsonBody: async () => ({
      projectId: "project-a",
      profileId: "hero",
      profileLabel: "Hero",
      animationId: "idle",
      animationName: "Idle",
      items: [{ data: "data:image/png;base64,valid" }],
    }),
    decodeDataUrl: () => ({
      mime: "image/png",
      buffer: Buffer.from("\x89PNG\r\n\x1a\n" + "0".repeat(32), "binary"),
    }),
    createFilesystemSnapshot: async () => ({
      dispose: async () => {
        events.push("dispose");
        if (events.filter((event) => event === "dispose").length === 1) {
          throw new Error("snapshot cleanup failed");
        }
      },
      restore: async () => events.push("restore"),
    }),
  });

  await assert.rejects(
    routes.handleMediaRoute({ method: "POST" }, {}, new URL("http://127.0.0.1/api/import-animation")),
    /snapshot cleanup failed/u,
  );
  assert.deepEqual(events, ["dispose", "restore", "restore", "dispose", "dispose"]);
});

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

test("workset preflight reports explicit overwrite impact without image payloads", async () => {
  const manifest = {
    profiles: [{ id: "hero", animations: [{ id: "idle", frames: [{}, {}] }] }],
  };
  const { routes, responses } = createHarness({
    readJsonBody: async () => ({
      projectId: "project-a",
      operations: [
        {
          id: "replace-idle",
          type: "replace",
          profileId: "hero",
          profileLabel: "Hero",
          animationId: "idle",
          animationName: "Idle",
          items: [{ sourceIndex: 0 }],
        },
      ],
    }),
    readProjectJson: (filename, fallback) => (filename.endsWith("manifest.json") ? manifest : fallback),
  });

  assert.equal(
    await routes.handleMediaRoute(
      { method: "POST" },
      {},
      new URL("http://127.0.0.1/api/project-worksets/plan"),
    ),
    true,
  );
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].payload.ok, true);
  assert.deepEqual(responses[0].payload.impacts[0].frames, { before: 2, after: 1 });
  assert.equal("items" in responses[0].payload.operations[0], false);
});

test("workset apply executes mixed operations in one ordered transaction", async () => {
  const calls = [];
  const manifest = {
    profiles: [{ id: "hero", animations: [{ id: "idle", frames: [{}, {}] }] }],
  };
  const operations = [
    {
      id: "replace-idle",
      type: "replace",
      profileId: "hero",
      profileLabel: "Hero",
      animationId: "idle",
      animationName: "Idle",
      items: [{ sourceIndex: 0, data: "data:image/png;base64,AA==" }],
    },
    {
      id: "create-run",
      type: "create",
      profileId: "hero",
      profileLabel: "Hero",
      animationId: "run",
      animationName: "Run",
      items: [{ data: "data:image/png;base64,AA==" }],
    },
  ];
  const { routes, responses } = createHarness({
    readJsonBody: async () => ({ projectId: "project-a", baseRevision: "revision-a", operations }),
    readProjectJson: (filename, fallback) => (filename.endsWith("manifest.json") ? manifest : fallback),
    reorganizeAnimation: (options) => {
      calls.push(`replace:${options.animationId}`);
      return { frameCount: options.items.length, targetDir: "", manifest, tuning: {} };
    },
    importAnimation: (options) => {
      calls.push(`create:${options.animationId}`);
      return {
        profileId: options.profileId,
        animationId: options.animationId,
        frameCount: options.items.length,
      };
    },
  });

  assert.equal(
    await routes.handleMediaRoute(
      { method: "POST" },
      {},
      new URL("http://127.0.0.1/api/project-worksets/apply"),
    ),
    true,
  );
  assert.deepEqual(calls, ["replace:idle", "create:run"]);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].payload.results.length, 2);
});

test("workset apply never rolls back a disposed snapshot when response delivery fails", async () => {
  const events = [];
  const operations = [
    {
      id: "create-idle",
      type: "create",
      profileId: "hero",
      profileLabel: "Hero",
      animationId: "idle",
      animationName: "Idle",
      items: [{ data: "data:image/png;base64,AA==" }],
    },
  ];
  const { routes } = createHarness({
    readJsonBody: async () => ({ projectId: "project-a", baseRevision: "revision-a", operations }),
    createFilesystemSnapshot: async () => ({
      dispose: async () => events.push("dispose"),
      restore: async () => events.push("restore"),
    }),
    rollbackFilesystemSnapshot: async (transaction, error) => {
      events.push("rollback");
      await transaction.restore();
      throw error;
    },
    send: () => {
      events.push("send");
      throw new Error("response socket closed");
    },
  });

  await assert.rejects(
    routes.handleMediaRoute({ method: "POST" }, {}, new URL("http://127.0.0.1/api/project-worksets/apply")),
    /response socket closed/,
  );
  assert.deepEqual(events, ["dispose", "send"]);
});
