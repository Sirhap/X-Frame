const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_scene_settings");

function createFixture() {
  const sceneSelect = { innerHTML: "", value: "", disabled: false };
  const sceneScale = { value: "1", disabled: false };
  const state = {
    config: {
      scenes: [
        { id: "arena", label: "Arena" },
        { id: "forest", path: "forest.tscn" },
      ],
    },
    selectedSceneId: "forest",
    sceneSettings: { arena: { scale: 1.5 }, invalid: { scale: "bad" } },
  };
  const storageValues = new Map();
  const events = [];
  const controller = createController({
    elements: { sceneSelect, sceneScale },
    getConfig: () => state.config,
    getSelectedSceneId: () => state.selectedSceneId,
    setSelectedSceneId: (value) => {
      state.selectedSceneId = value;
    },
    getSceneSettings: () => state.sceneSettings,
    escapeHtml: (value) => `escaped:${value}`,
    round: (value) => Number(value.toFixed(2)),
    nearlyEqual: (left, right) => Math.abs(left - right) < 0.0001,
    translate: (key) => key,
    markDirty: () => events.push("dirty"),
    updateSaveState: () => events.push("save-state"),
    draw: () => events.push("draw"),
    storage: {
      setItem(key, value) {
        storageValues.set(key, value);
      },
    },
  });
  return { controller, events, sceneScale, sceneSelect, state, storageValues };
}

test("scene selection keeps a valid configured scene", () => {
  const { controller, sceneScale, sceneSelect, state } = createFixture();

  assert.equal(controller.activeSceneId(), "forest");
  controller.renderSceneSelect();

  assert.equal(state.selectedSceneId, "forest");
  assert.equal(sceneSelect.disabled, false);
  assert.match(sceneSelect.innerHTML, /escaped:forest\.tscn/);
  assert.equal(sceneScale.value, "1");
});

test("scene scale input removes defaults and clamps invalid values", () => {
  const { controller, events, sceneScale, state } = createFixture();

  state.selectedSceneId = "arena";
  sceneScale.value = "0";
  controller.updateSceneScaleFromInput();
  assert.equal(state.sceneSettings.arena.scale, 0.01);
  assert.deepEqual(events, ["dirty", "save-state", "draw"]);

  sceneScale.value = "not-a-number";
  controller.updateSceneScaleFromInput();
  assert.equal(state.sceneSettings.arena, undefined);
});

test("scene settings persistence excludes default and invalid values", () => {
  const { controller } = createFixture();

  assert.deepEqual(controller.collectSceneSettings(), { arena: { scale: 1.5 } });
});

test("scene selector disables itself when no scenes are available", () => {
  const { controller, sceneScale, sceneSelect, state } = createFixture();
  state.config.scenes = [];

  controller.renderSceneSelect();

  assert.equal(sceneSelect.disabled, true);
  assert.equal(sceneSelect.value, "");
  assert.equal(sceneScale.disabled, true);
  assert.equal(state.selectedSceneId, "");
});
