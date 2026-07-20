const assert = require("node:assert/strict");
const test = require("node:test");

const { messages } = require("../animation_tuner/public/app_i18n");

test("main workbench translations expose both supported languages", () => {
  assert.ok(messages.zh);
  assert.ok(messages.en);
  assert.equal(messages.zh.languageChinese, "中文");
  assert.equal(messages.en.languageEnglish, "English");
  assert.equal(messages.zh.saveTuning, "保存调参");
  assert.equal(messages.en.saveTuning, "Save tuning");
});

test("main workbench translations retain the shared key set", () => {
  assert.deepEqual(Object.keys(messages.zh).sort(), Object.keys(messages.en).sort());
});
