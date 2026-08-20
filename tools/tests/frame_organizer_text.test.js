"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TEXT, createTranslator } = require("../animation_tuner/public/frame_organizer_text");

test("organizer text keeps language fallback and interpolation behavior", () => {
  let language = "zh";
  const text = createTranslator(() => language);

  assert.equal(text("loaded", { name: "待机", count: 3 }), "已载入 待机，共 3 帧");
  assert.equal(text("loopStartOutOfRange", { max: 10 }), "起始帧必须在 1 到 10 之间");
  assert.equal(text("missing"), "missing");

  language = "en";
  assert.equal(text("loaded", { name: "idle", count: 3 }), "Loaded idle (3 frames)");
  assert.equal(text("loopStartSuffix"), "帧开始搜索");
  assert.equal(text("loopStartOutOfRange", { max: 10 }), "Start frame must be between 1 and 10");
});

test("organizer text exposes the original bilingual keys", () => {
  assert.ok(Object.keys(TEXT.zh).length > 100);
  assert.deepEqual(Object.keys(TEXT.zh), Object.keys(TEXT.en));
  assert.equal(TEXT.zh.discardTitle, "尚未加入项目");
  assert.equal(TEXT.en.discardTitle, "Results are not in a project yet");
  assert.match(TEXT.zh.discardConfirm, /抠图/);
  assert.match(TEXT.en.discardConfirm, /cutout/);
  assert.equal(TEXT.zh.moreTools, "更多工具");
  assert.equal(TEXT.en.moreTools, "More Tools");
  assert.equal(TEXT.en.duplicateBadge, "DUP");
  assert.equal(TEXT.en.previewPrimary.includes("{current}"), true);
  assert.doesNotMatch(TEXT.en.cutoutScopeWorkset, /[\u4e00-\u9fff]/u);
});

test("ORG-033 loop dialog title uses 段 / Segments, matching the find-loop button", () => {
  assert.equal(TEXT.zh.findLoop, "寻找循环段");
  assert.equal(TEXT.zh.loopDialogTitle, "寻找循环段");
  assert.equal(TEXT.zh.loopDialogTitle, TEXT.zh.findLoop);
  assert.equal(TEXT.en.loopDialogTitle, "Find Loop Segments");
  assert.doesNotMatch(TEXT.zh.loopDialogTitle, /循环帧/u);
  assert.doesNotMatch(TEXT.en.loopDialogTitle, /Frames/u);
});

test("ORG-034 empty loop search copy is 没有循环段 and keeps the preference hint", () => {
  assert.equal(TEXT.zh.loopNoResult, "没有循环段");
  assert.match(TEXT.zh.loopNoResultHint, /循环偏好/);
  assert.match(TEXT.zh.loopNoResultHint, /起始帧/);
  assert.equal(TEXT.en.loopNoResult, "No loop segments");
  assert.match(TEXT.en.loopNoResultHint, /preference/i);
  assert.match(TEXT.en.loopNoResultHint, /starting frame/i);
});

test("ORG-033/034 workbench HTML fallbacks match the zh i18n strings", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "../animation_tuner/public/index.html"), "utf8");
  const title = html.match(/id="organizerLoopTitle"[^>]*>([^<]+)</u);
  const empty = html.match(/data-organizer-i18n="loopNoResult"[^>]*>([^<]+)</u);
  assert.equal(title?.[1].trim(), "寻找循环段");
  assert.equal(empty?.[1].trim(), "没有循环段");
  assert.equal(title?.[1].trim(), TEXT.zh.loopDialogTitle);
  assert.equal(empty?.[1].trim(), TEXT.zh.loopNoResult);
});

test("ORG-035 reduce confirmation copy names the keep-1-of-N step", () => {
  const text = createTranslator(() => "zh");
  const english = createTranslator(() => "en");
  assert.match(text("reduceConfirm", { step: 3 }), /每 3 帧保留 1 帧/);
  assert.match(english("reduceConfirm", { step: 3 }), /1 of every 3/);
  assert.ok(TEXT.zh.reduceTitle);
  assert.ok(TEXT.en.reduceTitle);
});
