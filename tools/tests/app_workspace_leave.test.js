"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_workspace_leave");

/** Creates a leave-protect fixture with inspectable persist and restore calls. */
function createFixture(initial = { baseX: 2 }) {
  const events = [];
  let state = structuredClone(initial);
  const controller = createController({
    cloneState: () => structuredClone(state),
    restoreState: (snapshot) => {
      events.push(`restore:${snapshot.baseX}`);
      state = structuredClone(snapshot);
    },
    abandonUnsaved: () => events.push("abandon"),
    saveAfterIdle: async () => {
      events.push(`save:${state.baseX}`);
    },
    bumpEditRevision: () => events.push("bump"),
    loadConfigFallback: async () => {
      events.push("reload");
    },
  });
  return { controller, events, getState: () => state, setState: (next) => (state = structuredClone(next)) };
}

test("discard restores the snapshot frozen at dialog open after a later autosave", async () => {
  const fixture = createFixture({ baseX: 2 });
  fixture.controller.captureSavedSnapshot();
  fixture.setState({ baseX: 3 });

  fixture.controller.beginLeaveDecision();
  fixture.controller.captureSavedSnapshot();
  assert.equal(fixture.controller.getSavedSnapshot().baseX, 3);
  assert.equal(fixture.controller.getLeaveSnapshot().baseX, 2);

  const restored = await fixture.controller.discardChanges();
  assert.equal(restored.baseX, 2);
  assert.equal(fixture.getState().baseX, 2);
  assert.deepEqual(fixture.events, ["abandon", "abandon", "bump", "restore:2", "save:2"]);
});

test("beginLeaveDecision cancels pending persist before the user chooses", () => {
  const fixture = createFixture({ baseX: 2 });
  fixture.controller.captureSavedSnapshot();
  fixture.setState({ baseX: 3 });

  fixture.controller.beginLeaveDecision();
  fixture.controller.cancelLeaveDecision();

  assert.deepEqual(fixture.events, ["abandon"]);
  assert.equal(fixture.getState().baseX, 3);
  assert.equal(fixture.controller.getLeaveSnapshot(), null);
});

test("discard persists the restored value after restore, not the dirty in-memory value", async () => {
  const fixture = createFixture({ baseX: 2 });
  fixture.controller.captureSavedSnapshot();
  fixture.setState({ baseX: 3 });
  fixture.controller.beginLeaveDecision();

  await fixture.controller.discardChanges();

  const restoreAt = fixture.events.indexOf("restore:2");
  const saveAt = fixture.events.indexOf("save:2");
  assert.ok(restoreAt >= 0, "discard must restore the last-saved snapshot");
  assert.ok(saveAt > restoreAt, "discard must persist only after restoring");
  assert.equal(fixture.events.includes("save:3"), false);
  assert.equal(fixture.events.includes("reload"), false);
});
