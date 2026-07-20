"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_tool_actions");

test("app tool actions preserve cutout replacement payload and refresh selection", async () => {
  const group = { uiId: "group-1", frames: [{ path: "a.png" }, { path: "b.png" }] };
  const requests = [];
  const selected = [];
  const controller = createController({
    getCurrentGroup: () => group,
    getSelectedFrame: () => 1,
    getActiveProjectId: () => "project-1",
    outputCore: {
      createAnimationReplacementPayload: (projectId, frames, outputs) => ({
        projectId,
        frameCount: frames.length,
        outputs,
      }),
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, text: async () => "" };
    },
    selectGroup: async (selectedGroup, options) => {
      selected.push({ selectedGroup, options });
    },
    clearImageCache: () => {},
    clearImageElements: () => {},
    setOpaqueRectCache: () => {},
  });

  await controller.applyCutoutOutputsToCurrentAnimation([{ data: "a" }, { data: "b" }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/replace-animation");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    projectId: "project-1",
    frameCount: 2,
    outputs: [{ data: "a" }, { data: "b" }],
  });
  assert.deepEqual(selected, [{ selectedGroup: group, options: { frameIndex: 1, preserveView: true } }]);
});
