const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_playback_inputs");

function createElements() {
  return {
    frameDuration: { value: "90", dataset: {} },
    frameDisabled: { checked: true },
    fps: { value: "12" },
    fpsValue: { textContent: "" },
    rootMotionX: { value: "3" },
    rootMotionY: { value: "-2" },
    vfxStartFrame: { value: "1" },
    vfxEndFrame: { value: "4" },
  };
}

test("playback input controller preserves selected-frame mutation order", async () => {
  const calls = [];
  const updates = [];
  const group = { uiId: "group-a" };
  const controller = createController({
    elements: createElements(),
    getCurrentGroup: () => group,
    canEditFramePlayback: () => true,
    groupPlaybackDurationSeconds: () => 1.2,
    selectedFrameIndexes: () => [0, 1],
    frameDurationMs: () => 40,
    groupHasGroupTimeOverride: () => false,
    pushUndo: () => calls.push("undo"),
    clearGroupTimeOverride: () => calls.push("clear-group"),
    framePlayback: () => ({ duration: 1, disabled: false }),
    setFramePlayback: (index, value) => updates.push({ index, value }),
    frameDurationMultiplierFromMs: (value) => value / 100,
    preserveGroupPlaybackDuration: () => calls.push("preserve"),
    syncFrameInputs: () => calls.push("sync"),
    renderFilmstrip: () => calls.push("filmstrip"),
    updateWorkbenchHud: () => calls.push("hud"),
    draw: () => calls.push("draw"),
    minFrameDurationMs: 40,
  });

  await controller.updateSelectedPlaybackFromInputs();

  assert.deepEqual(updates, [
    { index: 0, value: { duration: 0.9, disabled: true } },
    { index: 1, value: { duration: 0.9, disabled: true } },
  ]);
  assert.deepEqual(calls, ["sync", "filmstrip", "hud", "draw"]);
});

test("playback input controller waits for conflict confirmation and restores cancelled input", async () => {
  const elements = createElements();
  const calls = [];
  const controller = createController({
    elements,
    getCurrentGroup: () => ({ uiId: "group-a" }),
    canEditFramePlayback: () => true,
    selectedFrameIndexes: () => [0],
    frameDurationMs: () => 40,
    groupHasGroupTimeOverride: () => true,
    confirm: async (message, options) => {
      calls.push([message, options]);
      return false;
    },
    translate: (key) => key,
    syncFrameInputs: () => calls.push("sync"),
    setFramePlayback: () => calls.push("mutated"),
    minFrameDurationMs: 40,
  });

  await controller.updateSelectedPlaybackFromInputs();

  assert.deepEqual(calls, [["frameTimeConflict", { tone: "warning" }], "sync"]);
});

test("playback input controller updates group FPS and root motion", () => {
  const elements = createElements();
  const updates = [];
  const controller = createController({
    elements,
    getCurrentGroup: () => ({ uiId: "group-a" }),
    canEditFramePlayback: () => true,
    usesAttachedPlaybackTiming: () => false,
    setGroupPlaybackData: (value) => updates.push(value),
    groupPlaybackFps: () => 12,
    round: (value) => Math.round(value),
    syncGroupPlaybackInputs: () => {},
    updateGroupMeta: () => {},
    updateWorkbenchHud: () => {},
    selectedFrameIndexes: () => [],
    frameDurationMs: () => 40,
    framePlayback: () => ({ duration: 1 }),
    setFramePlayback: () => {},
    syncFrameInputs: () => {},
    renderFilmstrip: () => {},
    draw: () => {},
  });

  controller.updateGroupPlaybackFromInputs();

  assert.deepEqual(updates, [{ fps: 12, root_motion: { x: 3, y: -2 } }]);
  assert.equal(elements.fpsValue.textContent, 12);
});
