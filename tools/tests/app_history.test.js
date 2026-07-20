const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_history");

function createFixture() {
  const state = { value: 0 };
  let undoStack = [];
  let redoStack = [];
  const elements = {
    undo: { disabled: true },
    undoTop: { disabled: true },
    redoTop: { disabled: true },
  };
  const statuses = [];
  const controller = createController({
    elements,
    getUndoStack: () => undoStack,
    setUndoStack: (value) => {
      undoStack = value;
    },
    getRedoStack: () => redoStack,
    setRedoStack: (value) => {
      redoStack = value;
    },
    getSnapshot: () => ({ value: state.value }),
    restoreSnapshot: async (snapshot) => {
      state.value = snapshot.value;
    },
    markDirty: () => statuses.push("dirty"),
    status: (message) => statuses.push(message),
    translate: (key, variables = {}) => `${key}:${variables.label || ""}`,
    maxDepth: 2,
  });
  return {
    controller,
    elements,
    getRedoStack: () => redoStack,
    getUndoStack: () => undoStack,
    state,
    statuses,
  };
}

test("history pushes snapshots, clears redo, and enforces depth", () => {
  const { controller, elements, getRedoStack, getUndoStack, state } = createFixture();
  getRedoStack().push({ label: "old", state: { value: -1 } });

  controller.pushUndo("one");
  state.value = 1;
  controller.pushUndo("two");
  state.value = 2;
  controller.pushUndo("three");

  assert.deepEqual(
    getUndoStack().map((item) => item.label),
    ["two", "three"],
  );
  assert.deepEqual(getRedoStack(), []);
  assert.equal(elements.undo.disabled, false);
  assert.equal(elements.redoTop.disabled, true);
});

test("history undo and redo restore snapshots and mark the editor dirty", async () => {
  const { controller, state, statuses } = createFixture();
  controller.pushUndo("edit");
  state.value = 10;

  controller.undo();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.value, 0);
  assert.ok(statuses.includes("dirty"));
  assert.ok(statuses.includes("undone:edit"));

  state.value = 20;
  controller.redo();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.value, 10);
  assert.ok(statuses.includes("redone:edit"));
});

test("history reports empty-stack actions and restore errors", async () => {
  const { controller, statuses } = createFixture();
  controller.undo();
  controller.redo();
  assert.ok(statuses.includes("undoNothing:"));
  assert.ok(statuses.includes("redoNothing:"));

  const failing = createController({
    getUndoStack: () => [{ label: "bad", state: {} }],
    getRedoStack: () => [],
    getSnapshot: () => ({}),
    restoreSnapshot: async () => {
      throw new Error("restore failed");
    },
    status: (message) => statuses.push(message),
    translate: (key, variables = {}) => `${key}:${variables.message || ""}`,
  });
  failing.undo();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(statuses.includes("loadFailed:restore failed"));
});
