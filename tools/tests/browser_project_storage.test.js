"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createStore } = require("../animation_tuner/public/browser_project_storage");

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

test("browser project storage reports an unavailable IndexedDB fallback", async () => {
  const store = createStore({ indexedDBRef: null });

  assert.equal(await store.load(), null);
  assert.equal(await store.save({ activeProjectId: "browser-session", projects: [] }, new Map()), false);
});
