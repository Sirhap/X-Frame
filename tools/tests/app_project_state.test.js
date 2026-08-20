const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_project_state");

test("project state helpers preserve localization and dirty-state semantics", () => {
  const state = {
    language: "zh",
    config: { activeProject: { label: "Project" } },
    dirty: false,
    editRevision: 0,
    saveInFlight: false,
  };
  const controller = createController({
    state,
    elements: {},
    messages: {
      zh: { greeting: "你好，{name}" },
      en: { greeting: "Hello, {name}" },
    },
    documentRef: { body: { classList: { toggle() {} } } },
    storage: null,
  });

  assert.equal(controller.t("greeting", { name: "Codex" }), "你好，Codex");
  assert.equal(controller.normalizeTheme("home"), "dark");
  assert.equal(controller.normalizeTheme("kunkun"), "kunkun");
  assert.equal(controller.normalizeTheme("light"), "light");
  assert.equal(controller.normalizeTheme("unknown"), "dark");
  assert.equal(controller.normalizeColor("#123456"), "#123456");
  assert.equal(controller.normalizeColor("invalid"), "#000000");
  assert.equal(controller.keyFor("idle", 2), "idle:2");

  controller.markDirty();
  assert.equal(state.dirty, true);
  assert.equal(state.editRevision, 1);
});

test("applyUiTheme keeps one supported class active and updates browser chrome", () => {
  const activeClasses = new Set(["theme-light"]);
  const metaAttributes = {};
  const themeButtons = ["dark", "light", "kunkun"].map((theme) => ({
    dataset: { theme },
    classList: {
      toggle(className, active) {
        this[className] = active;
      },
    },
    setAttribute(name, value) {
      this[name] = value;
    },
  }));
  const state = { uiTheme: "home" };
  const controller = createController({
    state,
    elements: { themeButtons },
    documentRef: {
      body: {
        classList: {
          toggle(className, active) {
            if (active) activeClasses.add(className);
            else activeClasses.delete(className);
          },
        },
      },
      querySelector() {
        return {
          setAttribute(name, value) {
            metaAttributes[name] = value;
          },
        };
      },
    },
    storage: null,
  });

  controller.applyUiTheme();

  assert.deepEqual([...activeClasses], ["theme-dark"]);
  assert.equal(metaAttributes.content, "#0c1117");
  assert.equal(themeButtons[0]["aria-pressed"], "true");
  assert.equal(themeButtons[1]["aria-pressed"], "false");
  assert.equal(themeButtons[2]["aria-pressed"], "false");

  state.uiTheme = "kunkun";
  controller.applyUiTheme();

  assert.deepEqual([...activeClasses], ["theme-kunkun"]);
  assert.equal(metaAttributes.content, "#09080d");
  assert.equal(themeButtons[0]["aria-pressed"], "false");
  assert.equal(themeButtons[1]["aria-pressed"], "false");
  assert.equal(themeButtons[2]["aria-pressed"], "true");
});

test("applyLanguage localizes playback and ghost controls", () => {
  /** Creates a minimal button used by the language renderer. */
  const button = () => ({
    textContent: "",
    title: "",
    setAttribute(name, value) {
      this[name] = value;
    },
  });
  const playPause = button();
  const ghostToggle = button();
  const controller = createController({
    state: { language: "en", playing: false, config: null },
    elements: { languageButtons: [], playPause, ghostToggle },
    messages: { zh: { play: "播放", ghost: "残影" }, en: { play: "Play", ghost: "Ghost" } },
    documentRef: {
      documentElement: {},
      querySelectorAll: () => [],
      body: { classList: { toggle() {} } },
    },
    storage: null,
  });

  controller.applyLanguage();

  assert.equal(playPause.textContent, "Play");
  assert.equal(playPause["aria-label"], "Play");
  assert.equal(ghostToggle.textContent, "Ghost");
  assert.equal(ghostToggle["aria-label"], "Ghost");
});

test("markClean refreshes save controls without an injected UI callback", () => {
  const state = { dirty: true, saveInFlight: false, lastSavedAt: "" };
  const saveState = { textContent: "", classList: { toggle() {} } };
  const save = { disabled: true, textContent: "" };
  const controller = createController({
    state,
    elements: { saveState, save },
    messages: {
      zh: { savedAt: "已保存于 {time}", saveTuning: "保存调参", saving: "正在保存" },
    },
    documentRef: { body: { classList: { toggle() {} } } },
    storage: null,
  });

  controller.markClean();

  assert.equal(state.dirty, false);
  assert.match(saveState.textContent, /^已保存于 /);
  assert.equal(save.disabled, false);
  assert.equal(save.textContent, "保存调参");
});

test("SAV-011 loadFrameAudioBindingsFromProject restores blob-only object bindings", () => {
  const blob = { type: "audio/wav", size: 24 };
  const createdUrls = [];
  const previousUrl = globalThis.URL;
  globalThis.URL = {
    createObjectURL(value) {
      createdUrls.push(value);
      return "blob:project/beep.wav";
    },
    revokeObjectURL() {},
  };
  try {
    const state = {
      config: {
        activeProjectId: "p0test2",
        frameAudioBindings: {
          "p0test2:player:actor:animation:assassin_jump::0": {
            key: "p0test2:player:actor:animation:assassin_jump::0",
            name: "beep.wav",
            type: "audio/wav",
            size: 24,
            metadata: { projectId: "p0test2", animation: "assassin_jump", frame: 0 },
            blob,
          },
        },
      },
      frameAudioBindings: {},
      selectedProjectId: "p0test2",
    };
    const controller = createController({
      state,
      elements: {},
      messages: {},
      documentRef: { body: { classList: { toggle() {} } } },
      storage: null,
    });

    controller.loadFrameAudioBindingsFromProject();

    const restored = state.frameAudioBindings["p0test2:player:actor:animation:assassin_jump::0"];
    assert.ok(restored, "project blob WAV must survive reload even without data/path/file");
    assert.equal(restored.name, "beep.wav");
    assert.equal(restored.blob, blob);
    assert.equal(restored.url, "blob:project/beep.wav");
    assert.deepEqual(createdUrls, [blob]);
  } finally {
    globalThis.URL = previousUrl;
  }
});

test("SAV-011 loadFrameAudioBindingsFromProject still accepts saved array data URLs", () => {
  const state = {
    config: {
      activeProjectId: "p0test2",
      frameAudioBindings: [
        {
          key: "p0test2:player:actor:animation:assassin_jump::0",
          name: "beep.wav",
          type: "audio/wav",
          size: 8,
          projectId: "p0test2",
          animation: "assassin_jump",
          frame: 0,
          data: "data:audio/wav;base64,UklGRg==",
        },
      ],
    },
    frameAudioBindings: {},
    selectedProjectId: "p0test2",
  };
  const controller = createController({
    state,
    elements: {},
    messages: {},
    documentRef: { body: { classList: { toggle() {} } } },
    storage: null,
  });

  controller.loadFrameAudioBindingsFromProject();

  const restored = state.frameAudioBindings["p0test2:player:actor:animation:assassin_jump::0"];
  assert.equal(restored.name, "beep.wav");
  assert.equal(restored.data, "data:audio/wav;base64,UklGRg==");
});

test("project refresh awaits the injected confirmation before discarding edits", async () => {
  const state = { dirty: true, editRevision: 3, imageCache: new Map(), language: "zh" };
  const events = [];
  const controller = createController({
    state,
    elements: {},
    messages: { zh: { projectRefreshConfirm: "确认刷新？" } },
    documentRef: { body: { classList: { toggle() {} } } },
    storage: null,
    confirm: async (message, options) => {
      events.push([message, options]);
      return false;
    },
    resetProjectSession: () => events.push("reset"),
    loadConfig: async () => events.push("load"),
    resizeCanvas: () => events.push("resize"),
  });

  await controller.refreshActiveProject();

  assert.deepEqual(events, [["确认刷新？", { tone: "warning" }]]);
  assert.equal(state.dirty, true);
  assert.equal(state.editRevision, 3);
});
