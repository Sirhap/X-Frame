"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createStore } = require("../animation_tuner/public/batch_cutout_preset_store.js");

function createStorage(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set("xsxb.frameTuner.cutoutPresets.v1", initialValue);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("cutout preset store saves, updates, lists, and removes normalized presets", () => {
  const store = createStore({
    storage: createStorage(),
    createId: () => "preset-1",
    now: () => "2026-08-02T10:00:00.000Z",
  });

  const saved = store.save({ name: "  绿幕  ", parameters: { tolerance: 120, connected: true } });
  assert.equal(saved.name, "绿幕");
  assert.equal(saved.parameters.tolerance, 100);
  assert.equal(saved.parameters.connected, true);
  assert.equal(store.list().length, 1);

  const updated = store.save({
    id: saved.id,
    name: "绿幕增强",
    parameters: { tolerance: -1 },
  });
  assert.equal(updated.createdAt, saved.createdAt);
  assert.equal(updated.updatedAt, "2026-08-02T10:00:00.000Z");
  assert.equal(store.remove(saved.id), true);
  assert.deepEqual(store.list(), []);
});

test("cutout preset store tolerates malformed storage and validates names", () => {
  const store = createStore({ storage: createStorage("not-json") });

  assert.deepEqual(store.list(), []);
  assert.throws(() => store.save({ name: "", parameters: {} }), /between 1 and 40/);
  assert.throws(() => store.save({ name: "x".repeat(41), parameters: {} }), /between 1 and 40/);
});

test("cutout preset store surfaces storage failures without corrupting memory", () => {
  const store = createStore({
    storage: {
      getItem: () => null,
      setItem() {
        throw new Error("quota");
      },
    },
    createId: () => "preset-2",
  });

  assert.throws(() => store.save({ name: "失败", parameters: { tolerance: 4 } }), /quota/);
  assert.deepEqual(store.list(), []);
});
