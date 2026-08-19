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
  assert.equal(messages.zh.browserModeLocalProcessing, "网页模式 / 本地处理");
  assert.equal(messages.zh.currentProjectEyebrow, "当前项目");
  assert.equal(messages.zh.rootX, "根 X");
  assert.equal(messages.zh.desktopRecommended, "建议在桌面端使用");
  assert.equal(messages.en.desktopRecommended, "Best used on a desktop");
  assert.equal(messages.zh.deliveryTitle, "交付与导出");
  assert.equal(messages.en.mediaExportFilename, "File name");
  assert.equal(messages.zh.scatterResultsTitle, "动画分组与切片");
  assert.equal(messages.en.scatterResultsTitle, "Animation groups and slices");
  assert.equal(messages.en.exportNeedSequence, "Import an image sequence to export first");
  assert.equal(messages.en.handoffSubmit, "Check and add");
  assert.doesNotMatch(messages.en.scatterResultsTitle, /[\u4e00-\u9fff]/u);
  assert.doesNotMatch(messages.en.handoffHint, /[\u4e00-\u9fff]/u);
});

test("main workbench translations retain the shared key set", () => {
  assert.deepEqual(Object.keys(messages.zh).sort(), Object.keys(messages.en).sort());
});
