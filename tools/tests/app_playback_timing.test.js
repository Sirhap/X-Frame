const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_playback_timing");

function createFixture() {
  const group = { uiId: "idle", speed: 10, frames: [{}, {}, {}] };
  const playbackStore = {};
  const events = [];
  const controller = createController({
    groupPlaybackFrameKey: "__group",
    minFrameDurationMs: 1,
    getCurrentGroup: () => group,
    getConfig: () => ({ groups: [group] }),
    getSelectedFrame: () => 0,
    getPlaybackStore: () => playbackStore,
    getTuningFrameKey: (index) => `idle:${index}`,
    getGroupPlaybackKey: () => "idle:__group",
    groupOwnsFrameKey: (_group, key) => key.startsWith("idle:") && key !== "idle:__group",
    getClampInteger: (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max),
    cloneVector: (value) => ({ x: Number(value?.x || 0), y: Number(value?.y || 0) }),
    nearlyEqual: (left, right) => Math.abs(left - right) < 0.0001,
    markDirty: () => events.push("dirty"),
    canEditFramePlayback: () => true,
    pushUndo: (label) => events.push(`undo:${label}`),
    syncFrameInputs: () => events.push("frame-inputs"),
    syncGroupPlaybackInputs: () => events.push("group-inputs"),
    renderFilmstrip: () => events.push("filmstrip"),
    updateGroupMeta: () => events.push("meta"),
    updateWorkbenchHud: () => events.push("hud"),
    draw: () => events.push("draw"),
  });
  return { controller, events, group, playbackStore };
}

test("playback timing calculates frame durations and skips disabled frames", () => {
  const { controller, group, playbackStore } = createFixture();
  playbackStore["idle:1"] = { duration: 2, disabled: true };

  assert.deepEqual(controller.framePlayback(1, group), { duration: 2, disabled: true });
  assert.equal(controller.playableFrameCount(group), 2);
  assert.equal(controller.groupPlaybackDurationUnits(group), 2);
  assert.equal(controller.groupPlaybackDurationSeconds(group), 0.2);
  assert.equal(controller.groupPlaybackFps(group), 10);
  assert.equal(controller.frameDurationMs(0, group), 100);
});

test("playback timing writes no-op-safe frame and group overrides", () => {
  const { controller, events, group, playbackStore } = createFixture();

  controller.setFramePlayback(0, { duration: 1, disabled: false }, group);
  assert.equal(playbackStore["idle:0"], undefined);
  controller.setFramePlayback(0, { duration: 1.5, disabled: false }, group);
  controller.setGroupPlaybackData({ fps: 20, root_motion: { x: 2, y: 0 } }, group);

  assert.deepEqual(playbackStore["idle:0"], { duration: 1.5, disabled: false });
  assert.deepEqual(playbackStore["idle:__group"], { fps: 20, root_motion: { x: 2, y: 0 } });
  assert.equal(events.filter((event) => event === "dirty").length, 3);
});

test("attached VFX timing follows the owner window", () => {
  const owner = { name: "attack", tuningTarget: "soul", speed: 10, frames: [{}, {}, {}, {}] };
  const vfx = {
    name: "attack_vfx",
    tuningTarget: "soul",
    type: "vfx",
    attachTo: "attack",
    frames: [{}, {}],
  };
  const { controller, playbackStore } = createFixture();
  const timing = createController({
    groupPlaybackFrameKey: "__group",
    minFrameDurationMs: 1,
    getCurrentGroup: () => vfx,
    getConfig: () => ({ groups: [owner, vfx] }),
    getPlaybackStore: () => playbackStore,
    getTuningFrameKey: (index, group) => `${group.name}:${index}`,
    getGroupPlaybackKey: (group) => `${group.name}:__group`,
    groupOwnsFrameKey: (group, key) => key.startsWith(`${group.name}:`),
    getClampInteger: (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max),
    cloneVector: (value) => ({ x: Number(value?.x || 0), y: Number(value?.y || 0) }),
    nearlyEqual: (left, right) => left === right,
  });
  playbackStore["attack_vfx:__group"] = { start_frame: 1, end_frame: 2 };

  assert.equal(timing.attachedPlaybackOwnerGroup(vfx), owner);
  assert.deepEqual(timing.attachedVfxPlaybackWindow(vfx), { owner, start: 1, end: 2 });
  assert.equal(timing.groupPlaybackFps(vfx), 10);
  assert.equal(controller.groupPlaybackFps({ frames: [] }), 12);
});

test("group timing conflict waits for warning confirmation before clearing frame overrides", async () => {
  const group = { uiId: "idle", speed: 10, frames: [{}, {}] };
  const playbackStore = { "idle:0": { duration: 2, disabled: false } };
  const events = [];
  const controller = createController({
    minFrameDurationMs: 1,
    getCurrentGroup: () => group,
    getConfig: () => ({ groups: [group] }),
    getPlaybackStore: () => playbackStore,
    getTuningFrameKey: (index) => `idle:${index}`,
    getGroupPlaybackKey: () => "idle:__group",
    groupOwnsFrameKey: (_group, key) => key.startsWith("idle:") && key !== "idle:__group",
    getClampInteger: (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max),
    cloneVector: (value) => ({ x: Number(value?.x || 0), y: Number(value?.y || 0) }),
    nearlyEqual: (left, right) => left === right,
    elements: { groupTimeMs: { value: "500" } },
    canEditFramePlayback: () => true,
    confirm: async (message, options) => {
      events.push([message, options]);
      return false;
    },
    translate: (key) => key,
    syncGroupPlaybackInputs: () => events.push("sync"),
    pushUndo: () => events.push("undo"),
  });

  await controller.applyGroupTimeFromInput();

  assert.deepEqual(events, [["groupTimeConflict", { tone: "warning" }]]);
  assert.equal(controller.groupTimeMs(group), 300);
  assert.deepEqual(playbackStore, { "idle:0": { duration: 2, disabled: false } });
});

test("group time input does not push a second undo entry when arming already recorded one", async () => {
  const group = { uiId: "idle", speed: 10, frames: [{}, {}] };
  const events = [];
  const playbackStore = {};
  const groupTimeMs = { value: "400", dataset: { undoUsed: "1" } };
  const controller = createController({
    minFrameDurationMs: 1,
    getCurrentGroup: () => group,
    getConfig: () => ({ groups: [group] }),
    getPlaybackStore: () => playbackStore,
    getTuningFrameKey: (index) => `idle:${index}`,
    getGroupPlaybackKey: () => "idle:__group",
    groupOwnsFrameKey: (_group, key) => key.startsWith("idle:") && key !== "idle:__group",
    getClampInteger: (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max),
    cloneVector: (value) => ({ x: Number(value?.x || 0), y: Number(value?.y || 0) }),
    nearlyEqual: (left, right) => left === right,
    elements: { groupTimeMs },
    canEditFramePlayback: () => true,
    pushUndo: (label) => events.push(`undo:${label}`),
    syncFrameInputs: () => {},
    renderFilmstrip: () => {},
    updateGroupMeta: () => {},
    updateWorkbenchHud: () => {},
    draw: () => {},
  });

  await controller.applyGroupTimeFromInput();

  assert.deepEqual(events, []);
  assert.equal(controller.groupTimeMs(group), 400);
});
