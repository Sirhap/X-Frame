"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TEXT, createTranslator } = require("../animation_tuner/public/frame_organizer_text");

test("organizer text keeps language fallback and interpolation behavior", () => {
  let language = "zh";
  const text = createTranslator(() => language);

  assert.equal(text("loaded", { name: "待机", count: 3 }), "已载入 待机，共 3 帧");
  assert.equal(text("missing"), "missing");

  language = "en";
  assert.equal(text("loaded", { name: "idle", count: 3 }), "Loaded idle (3 frames)");
  assert.equal(text("loopStartSuffix"), "帧开始搜索");
});

test("organizer text exposes the original bilingual keys", () => {
  assert.ok(Object.keys(TEXT.zh).length > 100);
  assert.deepEqual(Object.keys(TEXT.zh), Object.keys(TEXT.en));
  assert.equal(TEXT.zh.discardTitle, "尚未加入项目");
  assert.equal(TEXT.en.discardTitle, "Results are not in a project yet");
  assert.match(TEXT.zh.discardConfirm, /抠图/);
  assert.match(TEXT.en.discardConfirm, /cutout/);
});
