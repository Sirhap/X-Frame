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
    premiumFeatures: {
      normalizeFeatureIds: (featureIds) => Array.from(featureIds || []),
    },
  });

  await controller.applyCutoutOutputsToCurrentAnimation([{ data: "a" }, { data: "b" }], {
    premiumFeatures: ["cutout.alpha-control"],
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/replace-animation");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    projectId: "project-1",
    frameCount: 2,
    outputs: [{ data: "a" }, { data: "b" }],
  });
  assert.equal(requests[0].options.headers["x-xsxb-premium-features"], "cutout.alpha-control");
  assert.deepEqual(selected, [{ selectedGroup: group, options: { frameIndex: 1, preserveView: true } }]);
});

test("app tool actions wait for the shared danger confirmation before deleting frames", async () => {
  const group = {
    profileId: "hero",
    animationId: "idle",
    frames: [
      { path: "a.png", name: "a.png" },
      { path: "b.png", name: "b.png" },
    ],
  };
  const confirmations = [];
  let fetchCalls = 0;
  const controller = createController({
    getCurrentGroup: () => group,
    getSelectedFrameIndexes: () => [0],
    confirm: async (message, options) => {
      confirmations.push({ message, options });
      return false;
    },
    translate: (key, variables = {}) => (variables.count === undefined ? key : `${key}:${variables.count}`),
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true, text: async () => "{}" };
    },
  });

  assert.equal(await controller.deleteSelectedAnimationFrames(), false);
  assert.deepEqual(confirmations, [
    {
      message: "deleteFramesConfirm:1",
      options: {
        title: "deleteSelectedFrames",
        confirmLabel: "deleteSelectedFrames",
        tone: "danger",
      },
    },
  ]);
  assert.equal(fetchCalls, 0);
});

test("app tool actions delete browser-session frames without calling a local API", async () => {
  const group = {
    profileId: "hero",
    animationId: "idle",
    frames: [
      { path: "a.png", name: "a.png" },
      { path: "b.png", name: "b.png" },
    ],
  };
  const deletedIndexes = [];
  let fetchCalls = 0;
  const controller = createController({
    browserOnly: true,
    getCurrentGroup: () => group,
    getSelectedFrameIndexes: () => [1],
    confirm: async () => true,
    translate: (key) => key,
    deleteBrowserSessionFrames: async (indexes) => deletedIndexes.push(...indexes),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("browser deletion must not fetch");
    },
  });

  assert.equal(await controller.deleteSelectedAnimationFrames(), true);
  assert.deepEqual(deletedIndexes, [1]);
  assert.equal(fetchCalls, 0);
});

test("app tool actions delete a complete browser-session animation without calling a local API", async () => {
  const group = {
    profileId: "hero",
    animationId: "idle",
    name: "Idle",
    frames: [{ path: "a.png", name: "a.png" }],
  };
  const deletedGroups = [];
  let fetchCalls = 0;
  const controller = createController({
    browserOnly: true,
    getCurrentGroup: () => group,
    confirm: async () => true,
    translate: (key) => key,
    deleteBrowserSessionAnimation: async (target) => deletedGroups.push(target),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("browser deletion must not fetch");
    },
  });

  assert.equal(await controller.clearCurrentAnimation(), true);
  assert.deepEqual(deletedGroups, [group]);
  assert.equal(fetchCalls, 0);
});
