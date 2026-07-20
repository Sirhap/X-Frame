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
  assert.equal(controller.normalizeTheme("light"), "light");
  assert.equal(controller.normalizeTheme("unknown"), "dark");
  assert.equal(controller.normalizeColor("#123456"), "#123456");
  assert.equal(controller.normalizeColor("invalid"), "#000000");
  assert.equal(controller.keyFor("idle", 2), "idle:2");

  controller.markDirty();
  assert.equal(state.dirty, true);
  assert.equal(state.editRevision, 1);
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
