const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_playback");

function createPlaybackFixture(overrides = {}) {
  const group = { uiId: "idle", frames: [{}, {}, {}] };
  const state = {
    playing: true,
    animationFrame: 0,
    currentGroup: group,
    lastPlay: 0,
    selectedFrame: 0,
    switching: false,
  };
  const events = [];
  const controller = createController({
    getPlaying: () => state.playing,
    getPlaybackAnimationFrame: () => state.animationFrame,
    setPlaybackAnimationFrame: (value) => {
      state.animationFrame = value;
    },
    getCurrentGroup: () => state.currentGroup,
    getImages: () => [{}, {}, {}],
    getPlaybackSwitching: () => state.switching,
    getLastPlay: () => state.lastPlay,
    setLastPlay: (value) => {
      state.lastPlay = value;
    },
    getSelectedFrame: () => state.selectedFrame,
    setPlaybackSwitching: (value) => {
      state.switching = value;
    },
    getFramePlayback: (index) => ({ disabled: index === 1 }),
    getGroupPlaybackFps: () => 10,
    getEffectiveFrameDurationMultiplier: () => 1,
    setSingleFrameSelection: (index) => {
      state.selectedFrame = index;
      events.push(`select:${index}`);
    },
    syncFrameInputs: () => events.push("sync-inputs"),
    renderFilmstrip: () => events.push("filmstrip"),
    draw: () => events.push("draw"),
    playFrameAudio: (index) => events.push(`audio:${index}`),
    documentRef: { visibilityState: "visible" },
    requestAnimationFrameRef: (callback) => {
      events.push("request-frame");
      state.callback = callback;
      return 7;
    },
    ...overrides,
  });
  return { controller, events, group, state };
}

test("playback frame helpers skip disabled frames and report wrapping", () => {
  const { controller, group } = createPlaybackFixture();

  assert.equal(controller.firstPlayableFrame(group), 0);
  assert.deepEqual(controller.nextPlayableFrameInGroup(group, 0), { index: 2, wrapped: false });
  assert.deepEqual(controller.nextPlayableFrameInGroup(group, 2), { index: 0, wrapped: true });
  assert.deepEqual(controller.nextPlayableFrameInGroup({ frames: [] }, 0), { index: 0, wrapped: true });
});

test("playback animation advances on interval and schedules the next tick", () => {
  const { controller, events, state } = createPlaybackFixture();

  controller.schedulePlaybackAnimation();
  assert.equal(state.animationFrame, 7);
  assert.deepEqual(events, ["request-frame"]);

  state.callback(101);
  assert.equal(state.selectedFrame, 2);
  assert.equal(state.lastPlay, 101);
  assert.deepEqual(events, [
    "request-frame",
    "select:2",
    "sync-inputs",
    "filmstrip",
    "draw",
    "audio:2",
    "request-frame",
  ]);
});

test("playback group switching clears its busy flag after a recoverable failure", async () => {
  const errors = [];
  const { controller, group, state } = createPlaybackFixture({
    selectGroup: async () => {
      throw new Error("group load failed");
    },
    onError: (error) => errors.push(error.message),
  });

  assert.equal(await controller.switchPlaybackGroup(group, 0), false);
  assert.equal(state.switching, false);
  assert.deepEqual(errors, ["group load failed"]);
});

test("chained playback switches to the secondary group at the primary loop boundary", async () => {
  const primary = { uiId: "primary", frames: [{}, {}] };
  const secondary = { uiId: "secondary", frames: [{}] };
  const chainGroupSelect = { value: "secondary" };
  const events = [];
  let currentGroup = primary;
  let selectedFrame = 1;
  const controller = createController({
    getPlaying: () => true,
    getCurrentGroup: () => currentGroup,
    getImages: () => [{}],
    getSelectedFrame: () => selectedFrame,
    getPlaybackPrimaryGroup: () => primary,
    getPlaybackSecondaryGroup: () => secondary,
    getFramePlayback: () => ({ disabled: false }),
    getPlaybackChainGroup: () => secondary,
    chainGroupSelect,
    selectGroup: async (group) => {
      currentGroup = group;
      events.push(`group:${group.uiId}`);
    },
    playFrameAudio: (index, group) => events.push(`audio:${group.uiId}:${index}`),
  });

  controller.advancePlayback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, ["group:secondary", "audio:secondary:0"]);
  assert.equal(chainGroupSelect.value, "primary");
});
