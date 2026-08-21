"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SAVE_STATUS, createStore, normalizeFrame } = require("../animation_tuner/public/workspace_store");

test("workspace frames keep stable identity across reorder and asset replacement", () => {
  const store = createStore({ debounceMs: 60_000 });
  store.setProjectContext({
    projectId: "hero",
    frames: [
      { id: "idle-a", path: "idle/a.png" },
      { id: "idle-b", path: "idle/b.png" },
    ],
  });
  store.beginToolSession("organizer");
  store.commit({ type: "reorder-frames", frameIds: ["idle-b", "idle-a"] });
  store.commit({ type: "replace-asset", frameId: "idle-a", currentAssetRef: "edited/a.png" });

  const snapshot = store.getSnapshot();
  assert.deepEqual(
    snapshot.frames.map((frame) => frame.id),
    ["idle-b", "idle-a"],
  );
  assert.equal(snapshot.frames[1].sourcePath, "idle/a.png");
  assert.equal(snapshot.frames[1].currentAssetRef, "edited/a.png");
  assert.equal(snapshot.frames[1].assetRevision, 1);
});

test("tool history is isolated and ending a tool keeps committed data", () => {
  const store = createStore({ debounceMs: 60_000 });
  store.setProjectContext({ projectId: "hero", frames: [{ id: "a", path: "a.png" }] });
  store.beginToolSession("cutout");
  store.commit({ type: "set-enabled", frameIds: ["a"], enabled: false });
  assert.equal(store.undo(), true);
  assert.equal(store.getSnapshot().frames[0].enabled, true);
  assert.equal(store.redo(), true);
  store.endToolSession("cutout");
  assert.equal(store.getSnapshot().frames[0].enabled, false);
  assert.equal(store.undo(), false);
});

test("save flush includes edits made while an earlier revision is in flight", async () => {
  const saveResolvers = [];
  let saveCalls = 0;
  const save = () => {
    saveCalls += 1;
    return new Promise((resolve) => saveResolvers.push(resolve));
  };
  const store = createStore({ save, debounceMs: 60_000, now: () => new Date("2026-08-12T12:00:00Z") });
  store.setProjectContext({ projectId: "hero", frames: [{ id: "a", path: "a.png" }] });
  store.commit({ type: "set-enabled", frameIds: ["a"], enabled: false });
  const first = store.flushSave();
  store.commit({ type: "set-enabled", frameIds: ["a"], enabled: true });
  saveResolvers.shift()({ ok: true });
  while (saveCalls < 2) await Promise.resolve();
  saveResolvers.shift()({ ok: true });
  await first;
  assert.equal(store.getSnapshot().saveStatus, SAVE_STATUS.SAVED);
  assert.equal(store.getSnapshot().lastSavedRevision, store.getSnapshot().revision);

  const concurrentFlush = store.flushSave();
  assert.deepEqual(await concurrentFlush, { status: SAVE_STATUS.SAVED });
});

test("save flush reports revision conflicts", async () => {
  const conflictStore = createStore({
    debounceMs: 60_000,
    save: async () => {
      const error = new Error("stale revision");
      error.status = 409;
      throw error;
    },
  });
  conflictStore.setProjectContext({ projectId: "hero", frames: [{ id: "a", path: "a.png" }] });
  conflictStore.commit({ type: "set-enabled", frameIds: ["a"], enabled: false });
  await assert.rejects(conflictStore.flushSave(), /stale revision/);
  assert.equal(conflictStore.getSnapshot().saveStatus, SAVE_STATUS.CONFLICT);
});

test("normalization preserves original and current asset references", () => {
  assert.deepEqual(normalizeFrame({ id: "f", path: "frame.png", included: false }, 0), {
    id: "f",
    path: "frame.png",
    included: false,
    sourcePath: "frame.png",
    currentAssetRef: "frame.png",
    assetRevision: 0,
    enabled: false,
  });
});

test("autosave can be disabled so only flushSave persists", async () => {
  let saves = 0;
  const store = createStore({
    autosave: false,
    debounceMs: 1,
    save: async () => {
      saves += 1;
    },
  });
  store.setProjectContext({ projectId: "hero", frames: [{ id: "a", path: "a.png" }] });
  store.commit({ type: "set-enabled", frameIds: ["a"], enabled: false });
  store.markDirty();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(saves, 0);
  assert.equal(store.getSnapshot().saveStatus, SAVE_STATUS.DIRTY);
  await store.flushSave();
  assert.equal(saves, 1);
  assert.equal(store.getSnapshot().saveStatus, SAVE_STATUS.SAVED);
});

test("abandonUnsaved cancels a pending persist so flushSave does not write dirty data", async () => {
  let saves = 0;
  const store = createStore({
    debounceMs: 20,
    save: async () => {
      saves += 1;
    },
  });
  store.markDirty();
  store.abandonUnsaved();
  await new Promise((resolve) => setTimeout(resolve, 40));
  const result = await store.flushSave();
  assert.equal(saves, 0);
  assert.equal(result.status, store.getSnapshot().saveStatus);
  assert.equal(store.getSnapshot().lastSavedRevision, store.getSnapshot().revision);
});

test("legacy frames without ids retain identity when their array order changes", () => {
  const first = normalizeFrame({ path: "frames/idle_01.png" }, 0, "demo");
  const second = normalizeFrame({ path: "frames/idle_02.png" }, 1, "demo");
  const reorderedSecond = normalizeFrame({ path: "frames/idle_02.png" }, 0, "demo");
  const reorderedFirst = normalizeFrame({ path: "frames/idle_01.png" }, 1, "demo");

  assert.equal(first.id, reorderedFirst.id);
  assert.equal(second.id, reorderedSecond.id);
  assert.notEqual(first.id, second.id);
});
