const assert = require("node:assert/strict");
const test = require("node:test");

const { constants, createInitialState, parseBoxSelection } = require("../animation_tuner/public/app_state");

/**
 * Creates deterministic storage for state initialization tests.
 * @param {Record<string,string>} values Persisted preference values.
 * @returns {{getItem:(key:string)=>string|null}}
 */
function createStorage(values = {}) {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
  };
}

test("parseBoxSelection keeps supported names in stable unique order", () => {
  assert.deepEqual(parseBoxSelection("hitbox hurtbox hitbox unknown collisionbox"), [
    "hitbox",
    "hurtbox",
    "collisionbox",
  ]);
});

test("createInitialState combines URL and persisted preferences", () => {
  const state = createInitialState({
    location: { search: "?project=url-project&profile=hero&frame=4" },
    storage: createStorage({
      "xsxbFrameTuner.project": "stored-project",
      "xsxbFrameTuner.language": "en",
      "xsxbFrameTuner.languageExplicit": "true",
      "xsxbFrameTuner.theme": "light",
      "xsxbFrameTuner.canvasColor": "#123456",
      "xsxbFrameTuner.selectedBox": "hurtbox",
      "xsxbFrameTuner.checkedBoxes": "hitbox,hitbox",
      "xsxbFrameTuner.adjustmentMode": "frame",
      "xsxbFrameTuner.sidebarCollapsed": "true",
      "xsxbFrameTuner.activePanelTab": "effects",
      "xsxbFrameTuner.filmstripLayout": "grid",
      "xsxbFrameTuner.kunkunUnlocked": "true",
    }),
  });

  assert.equal(state.selectedProjectId, "url-project");
  assert.equal(state.selectedProfileId, "all");
  assert.equal(state.selectedFrame, 4);
  assert.equal(state.language, "en");
  assert.equal(state.uiTheme, "light");
  assert.equal(state.canvasColor, "#123456");
  assert.deepEqual([...state.selectedBoxes], ["hitbox"]);
  assert.equal(state.selectedBox, "hurtbox");
  assert.equal(state.adjustmentMode, "frame");
  assert.equal(state.sidebarCollapsed, true);
  assert.equal(state.activePanelTab, "effects");
  assert.equal(state.filmstripLayout, "grid");
  assert.equal(state.kunkunUnlocked, true);
  assert.deepEqual(state.view, { zoom: 1, x: 0, y: 0 });
});

test("createInitialState migrates an unconfirmed legacy English preference to Chinese", () => {
  const state = createInitialState({
    location: { search: "" },
    storage: createStorage({
      "xsxbFrameTuner.language": "en",
    }),
  });

  assert.equal(state.language, "zh");
});

test("createInitialState falls back safely when storage access throws", () => {
  const state = createInitialState({
    location: { search: "" },
    storage: {
      getItem() {
        throw new Error("storage unavailable");
      },
    },
  });

  assert.equal(state.language, "zh");
  assert.equal(state.uiTheme, "dark");
  assert.equal(state.sidebarCollapsed, false);
  assert.equal(state.activePanelTab, "transform");
  assert.equal(state.filmstripLayout, "single");
  assert.equal(state.canvasColor, "#000000");
  assert.equal(state.adjustmentMode, "group");
  assert.equal(constants.FRAME_AUDIO_DB_VERSION, 1);
});
