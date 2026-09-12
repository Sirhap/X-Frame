"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DATABASE_NAME,
  LEGACY_DATABASE_NAME,
  createStore,
} = require("../animation_tuner/public/browser_project_storage");

const LEGACY_SNAPSHOT = Object.freeze({
  version: 1,
  registry: {
    activeProjectId: "legacy-project",
    projects: [{ id: "legacy-project", label: "旧项目" }],
  },
  projects: [["legacy-project", { groups: [{ animationId: "idle", frames: [{ name: "frame_0001.png" }] }] }]],
});

test("browser project storage restores the registry and project frames", async () => {
  let persisted = null;
  const store = createStore({
    adapter: {
      read: async () => persisted,
      write: async (snapshot) => {
        persisted = snapshot;
      },
    },
  });
  const projects = new Map([
    [
      "slice-project",
      {
        groups: [
          {
            animationId: "idle",
            frames: [{ name: "frame_0001.png", path: "data:image/png;base64,c2xpY2U=" }],
          },
        ],
      },
    ],
  ]);

  assert.equal(
    await store.save(
      {
        activeProjectId: "slice-project",
        projects: [{ id: "slice-project", label: "切片项目" }],
      },
      projects,
    ),
    true,
  );
  projects.get("slice-project").groups.length = 0;

  const restored = await store.load();
  assert.equal(restored.registry.activeProjectId, "slice-project");
  assert.equal(restored.projects[0][1].groups[0].frames[0].name, "frame_0001.png");
});

test("browser project storage serializes writes and keeps the newest snapshot", async () => {
  const writes = [];
  const store = createStore({
    adapter: {
      read: async () => writes.at(-1) || null,
      write: async (snapshot) => {
        await Promise.resolve();
        writes.push(snapshot);
      },
    },
  });

  await Promise.all([
    store.save({ activeProjectId: "first", projects: [{ id: "first" }] }, new Map()),
    store.save({ activeProjectId: "second", projects: [{ id: "second" }] }, new Map()),
  ]);

  assert.deepEqual(
    writes.map((snapshot) => snapshot.registry.activeProjectId),
    ["first", "second"],
  );
  assert.equal((await store.load()).registry.activeProjectId, "second");
});

test("renamed project database still loads a snapshot stored under the old name", async () => {
  assert.equal(DATABASE_NAME, "x-frame-projects");
  assert.equal(LEGACY_DATABASE_NAME, "xsxb-frame-tuner-projects");
  let current = null;
  const writes = [];
  const store = createStore({
    adapter: {
      read: async () => current,
      write: async (snapshot) => {
        current = snapshot;
        writes.push(snapshot);
      },
    },
    legacyAdapter: {
      read: async () => LEGACY_SNAPSHOT,
      write: async () => {
        throw new Error("legacy store is read-only during migration");
      },
    },
  });

  const restored = await store.load();
  assert.equal(restored.registry.activeProjectId, "legacy-project");
  assert.equal(restored.projects[0][1].groups[0].frames[0].name, "frame_0001.png");
  assert.equal(writes.length, 1, "migration must copy the snapshot into the renamed database");
  assert.equal(current.registry.activeProjectId, "legacy-project");
});

test("a populated renamed project database is not replaced by leftover legacy data", async () => {
  const current = {
    version: 1,
    registry: {
      activeProjectId: "new-project",
      projects: [{ id: "new-project", label: "新项目" }],
    },
    projects: [["new-project", { groups: [] }]],
  };
  const writes = [];
  const store = createStore({
    adapter: {
      read: async () => current,
      write: async (snapshot) => writes.push(snapshot),
    },
    legacyAdapter: {
      read: async () => LEGACY_SNAPSHOT,
      write: async () => {},
    },
  });

  const restored = await store.load();
  assert.equal(restored.registry.activeProjectId, "new-project");
  assert.equal(writes.length, 0);
});

test("browser project storage reports an unavailable IndexedDB fallback", async () => {
  const store = createStore({ indexedDBRef: null });

  assert.equal(await store.load(), null);
  assert.equal(await store.save({ activeProjectId: "browser-session", projects: [] }, new Map()), false);
});
