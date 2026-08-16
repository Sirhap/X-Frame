"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createTemporaryWorkset } = require("../animation_tuner/public/scatter_temporary_workset");

test("scatter groups become one ordered temporary workset with stable frame ids", () => {
  const canvases = new Map([
    ["frame-a", { width: 32, height: 48 }],
    ["frame-b", { width: 40, height: 48 }],
  ]);
  const workset = createTemporaryWorkset({
    name: "hero",
    groups: [
      { id: "idle", name: "Idle", enabled: true, frames: [{ id: "frame-a" }] },
      { id: "disabled", name: "Unused", enabled: false, frames: [{ id: "ignored" }] },
      { id: "run", name: "Run", enabled: true, frames: [{ id: "frame-b" }] },
    ],
    createCanvas: (frame) => canvases.get(frame.id),
  });

  assert.equal(workset.name, "hero");
  assert.equal(workset.sourceTool, "scatter-slice");
  assert.deepEqual(
    workset.frames.map((frame) => frame.id),
    ["scatter:idle:frame-a", "scatter:run:frame-b"],
  );
  assert.deepEqual(
    workset.frames.map((frame) => frame.groupName),
    ["Idle", "Run"],
  );
  assert.equal(workset.frames[0].image, canvases.get("frame-a"));
});

test("scatter workset rejects empty selections and invalid canvas outputs", () => {
  assert.throws(
    () => createTemporaryWorkset({ name: "empty", groups: [], createCanvas: () => null }),
    /至少选择一个动画组/,
  );
  assert.throws(
    () =>
      createTemporaryWorkset({
        groups: [{ id: "idle", frames: [{ id: "frame-a" }] }],
        createCanvas: () => null,
      }),
    /无法生成切片画布/,
  );
});
