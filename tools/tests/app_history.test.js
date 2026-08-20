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

test("history commits a pending field edit before snapshotting undo and redo", async () => {
  const commits = [];
  let current = { value: 4 };
  let pending = null;
  let undoStack = [];
  let redoStack = [];
  const controller = createController({
    getUndoStack: () => undoStack,
    setUndoStack: (value) => {
      undoStack = value;
    },
    getRedoStack: () => redoStack,
    setRedoStack: (value) => {
      redoStack = value;
    },
    getSnapshot: () => ({ ...current }),
    restoreSnapshot: async (snapshot) => {
      current = { ...snapshot };
    },
    commitPending: () => {
      if (pending != null) current = { value: pending };
      commits.push(current.value);
    },
    markDirty: () => {},
    status: () => {},
    translate: (key) => key,
  });

  controller.pushUndo("position");
  assert.deepEqual(commits, [4]);
  assert.equal(undoStack[0].state.value, 4);

  current = { value: 5 };
  pending = 6;
  await controller.undo();
  assert.deepEqual(commits, [4, 6]);
  assert.equal(redoStack[0].state.value, 6);
  assert.equal(current.value, 4);
});

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

  await controller.undo();
  assert.equal(state.value, 0);
  assert.ok(statuses.includes("dirty"));
  assert.ok(statuses.includes("undone:edit"));

  state.value = 20;
  await controller.redo();
  assert.equal(state.value, 10);
  assert.ok(statuses.includes("redone:edit"));
});

test("history serializes undo so a second press keeps the intermediate snapshot", async () => {
  const states = [];
  let current = { name: "C" };
  let undoStack = [
    { label: "A", state: { name: "A" } },
    { label: "B", state: { name: "B" } },
  ];
  let redoStack = [];
  const controller = createController({
    getUndoStack: () => undoStack,
    setUndoStack: (value) => {
      undoStack = value;
    },
    getRedoStack: () => redoStack,
    setRedoStack: (value) => {
      redoStack = value;
    },
    getSnapshot: () => ({ ...current }),
    restoreSnapshot: async (snapshot) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = { ...snapshot };
      states.push(current.name);
    },
    markDirty: () => {},
    status: () => {},
    translate: (key) => key,
  });

  const first = controller.undo();
  const second = controller.undo();
  await Promise.all([first, second]);

  assert.deepEqual(states, ["B", "A"]);
  assert.deepEqual(
    redoStack.map((item) => item.state.name),
    ["C", "B"],
  );
  assert.equal(current.name, "A");
});

test("history reports empty-stack actions and restore errors", async () => {
  const { controller, statuses } = createFixture();
  await controller.undo();
  await controller.redo();
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
  await failing.undo();
  assert.ok(statuses.includes("loadFailed:restore failed"));
});
