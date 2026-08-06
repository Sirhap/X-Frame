"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const workspaceCore = require("../animation_tuner/public/scatter_slice_workspace_core");

/**
 * Creates a detected box fixture.
 * @param {number} x Horizontal position.
 * @param {number} y Vertical position.
 * @param {number} [w] Width.
 * @param {number} [h] Height.
 * @returns {{x:number,y:number,w:number,h:number,pixels:number}}
 */
function box(x, y, w = 10, h = 12) {
  return { x, y, w, h, pixels: w * h };
}

/**
 * Creates a two-row workspace with deterministic frame identities.
 * @returns {object}
 */
function createWorkspace() {
  const first = box(4, 5);
  const second = box(24, 6, 12, 10);
  const third = box(8, 40, 8, 14);
  return workspaceCore.createDetectedWorkspace(
    [first, second, third],
    [{ boxes: [first, second] }, { boxes: [third] }],
  );
}

test("detected workspaces assign stable frame and group identities", () => {
  const workspace = createWorkspace();

  assert.deepEqual(
    workspace.frames.map((frame) => frame.id),
    ["frame-1", "frame-2", "frame-3"],
  );
  assert.deepEqual(workspace.groups, [
    { id: "group-1", name: "动画组 01", frameIds: ["frame-1", "frame-2"], enabled: true },
    { id: "group-2", name: "动画组 02", frameIds: ["frame-3"], enabled: true },
  ]);
  assert.equal(workspace.uniformOutput, true);
});

test("geometry updates preserve manual group membership and order", () => {
  const workspace = createWorkspace();
  const moved = workspaceCore.updateFrameBox(workspace, "frame-1", {
    x: 90,
    y: 80,
    w: 11,
    h: 13,
    pixels: 143,
  });

  assert.deepEqual(moved.groups, workspace.groups);
  assert.deepEqual(moved.frames[0], {
    id: "frame-1",
    x: 90,
    y: 80,
    w: 11,
    h: 13,
    pixels: 143,
  });
  assert.notStrictEqual(moved, workspace);
  assert.deepEqual(workspace.frames[0], { id: "frame-1", x: 4, y: 5, w: 10, h: 12, pixels: 120 });
});

test("explicit regroup preserves frame identities and reuses the strongest matching group identity", () => {
  const workspace = createWorkspace();
  const regrouped = workspaceCore.regroupWorkspace(workspace, [
    { frameIds: ["frame-1"] },
    { frameIds: ["frame-2", "frame-3"] },
  ]);

  assert.deepEqual(regrouped.frames, workspace.frames);
  assert.deepEqual(regrouped.groups, [
    { id: "group-1", name: "动画组 01", frameIds: ["frame-1"], enabled: true },
    { id: "group-2", name: "动画组 02", frameIds: ["frame-2", "frame-3"], enabled: true },
  ]);
  assert.deepEqual(workspace.groups[0].frameIds, ["frame-1", "frame-2"]);
});

test("selection supports toggle and same-group ranges in visual order", () => {
  let workspace = createWorkspace();
  workspace = workspaceCore.selectFrame(workspace, "frame-1");
  workspace = workspaceCore.selectFrame(workspace, "frame-2", { toggle: true });
  assert.deepEqual(workspace.selection, {
    ids: ["frame-1", "frame-2"],
    primaryId: "frame-2",
    anchorId: "frame-1",
  });

  workspace = workspaceCore.selectFrame(workspace, "frame-2");
  workspace = workspaceCore.selectFrame(workspace, "frame-1", { range: true });
  assert.deepEqual(workspace.selection.ids, ["frame-1", "frame-2"]);

  workspace = workspaceCore.selectFrame(workspace, "frame-3", { range: true });
  assert.deepEqual(workspace.selection.ids, ["frame-3"]);
});

test("selected frames move as one ordered block and empty groups disappear", () => {
  let workspace = createWorkspace();
  workspace = workspaceCore.selectFrame(workspace, "frame-1");
  workspace = workspaceCore.selectFrame(workspace, "frame-2", { toggle: true });
  workspace = workspaceCore.moveSelectedFrames(workspace, "group-2", 1);

  assert.deepEqual(workspace.groups, [
    {
      id: "group-2",
      name: "动画组 02",
      frameIds: ["frame-3", "frame-1", "frame-2"],
      enabled: true,
    },
  ]);
  assert.deepEqual(workspace.selection.ids, ["frame-1", "frame-2"]);
});

test("group operations rename, split, reorder, merge, and delete without losing frames", () => {
  let workspace = createWorkspace();
  workspace = workspaceCore.renameGroup(workspace, "group-1", "待机");
  workspace = workspaceCore.selectFrame(workspace, "frame-2");
  workspace = workspaceCore.splitSelectedFrames(workspace);
  assert.deepEqual(
    workspace.groups.map((group) => [group.name, group.frameIds]),
    [
      ["待机", ["frame-1"]],
      ["动画组 03", ["frame-2"]],
      ["动画组 02", ["frame-3"]],
    ],
  );

  workspace = workspaceCore.moveGroup(workspace, "group-2", 0);
  workspace = workspaceCore.mergeGroup(workspace, "group-3", "previous");
  assert.deepEqual(
    workspace.groups.map((group) => group.frameIds),
    [["frame-3"], ["frame-1", "frame-2"]],
  );

  workspace = workspaceCore.deleteGroup(workspace, "group-2");
  assert.deepEqual(
    workspace.frames.map((frame) => frame.id),
    ["frame-1", "frame-2"],
  );
  assert.deepEqual(
    workspace.groups.map((group) => group.frameIds),
    [["frame-1", "frame-2"]],
  );
});

test("deleting selected frames repairs selection to an adjacent visual frame", () => {
  let workspace = createWorkspace();
  workspace = workspaceCore.selectFrame(workspace, "frame-2");
  workspace = workspaceCore.deleteSelectedFrames(workspace);

  assert.deepEqual(
    workspace.frames.map((frame) => frame.id),
    ["frame-1", "frame-3"],
  );
  assert.deepEqual(workspace.selection, {
    ids: ["frame-3"],
    primaryId: "frame-3",
    anchorId: "frame-3",
  });
});

test("normalizing selected boxes expands around bottom center and clamps into bounds", () => {
  const first = box(0, 2, 4, 5);
  const second = box(15, 14, 8, 10);
  let workspace = workspaceCore.createDetectedWorkspace([first, second], [{ boxes: [first, second] }]);
  workspace = workspaceCore.selectFrame(workspace, "frame-1");
  workspace = workspaceCore.selectFrame(workspace, "frame-2", { toggle: true });
  workspace = workspaceCore.normalizeSelectedBoxes(workspace, { width: 20, height: 20 });

  assert.deepEqual(workspace.frames, [
    { id: "frame-1", x: 0, y: 0, w: 8, h: 10, pixels: 80 },
    { id: "frame-2", x: 12, y: 10, w: 8, h: 10, pixels: 80 },
  ]);
  assert.throws(() => workspaceCore.normalizeSelectedBoxes(workspace, { width: 0, height: 20 }), /bounds/);
});

test("snapshots are isolated and output layouts do not mutate crop boxes", () => {
  let workspace = createWorkspace();
  workspace = workspaceCore.selectFrame(workspace, "frame-1");
  workspace = workspaceCore.setUniformOutput(workspace, false);
  const snapshot = workspaceCore.snapshotWorkspace(workspace);
  const restored = workspaceCore.restoreWorkspace(snapshot);
  snapshot.frames[0].x = 999;

  assert.equal(restored.frames[0].x, 4);
  assert.equal(restored.uniformOutput, false);
  assert.deepEqual(workspaceCore.planOutputLayouts(restored, { padding: 2, scope: "per-group" }), [
    { groupId: "group-1", width: 16, height: 16 },
    { groupId: "group-2", width: 12, height: 18 },
  ]);
  assert.deepEqual(workspaceCore.planOutputLayouts(restored, { padding: 2, scope: "global" }), {
    width: 16,
    height: 18,
  });
  assert.equal(restored.frames[0].w, 10);
});
