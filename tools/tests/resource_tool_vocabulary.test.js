"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const organizerText = require("../animation_tuner/public/frame_organizer_text");
const cutoutText = require("../animation_tuner/public/batch_cutout_text");

const PUBLIC_DIR = path.resolve(__dirname, "../animation_tuner/public");

test("the resource tools name the same commit action with the same words", () => {
  // 导入与整理 / 智能抠图 / 零散切片 all write into a project animation. Three different
  // verbs for one act is the reason the stage reads as three unrelated products.
  for (const language of ["zh", "en"]) {
    assert.equal(
      organizerText.TEXT[language].apply,
      cutoutText.TEXT[language].applyGroup,
      `${language}: organizer and cutout should name "overwrite the current animation" identically`,
    );
    assert.equal(
      organizerText.TEXT[language].addToProject,
      cutoutText.TEXT[language].addToProject,
      `${language}: both tools should name the project handoff identically`,
    );
  }
});

test("every resource tool offers the shared project handoff wording", () => {
  const handoffLabel = organizerText.TEXT.zh.addToProject;
  assert.equal(handoffLabel, "加入动画项目");

  const scatter = fs.readFileSync(path.join(PUBLIC_DIR, "scatter_slice.js"), "utf8");
  assert.ok(scatter.includes(handoffLabel), "scatter slice should offer the same project handoff wording");
});

/**
 * Pulls the first run of visible text inside a button that starts at `id`.
 * @param {string} html Workbench markup.
 * @param {string} id Button id without the hash.
 * @returns {string} Collapsed inner text.
 */
function buttonFallback(html, id) {
  const match = html.match(new RegExp(`id="${id}"[\\s\\S]*?</button>`, "u"));
  assert.ok(match, `index.html is missing #${id}`);
  return match[0]
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

test("HTML fallbacks use the same commit verbs as the shared text tables", () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
  const applyLabel = organizerText.TEXT.zh.apply;
  const handoffLabel = organizerText.TEXT.zh.addToProject;

  assert.equal(applyLabel, "替换当前动画");
  assert.match(buttonFallback(html, "organizerApply"), new RegExp(applyLabel, "u"));
  assert.match(buttonFallback(html, "cutoutApplyGroup"), new RegExp(applyLabel, "u"));
  assert.match(buttonFallback(html, "organizerAddProject"), new RegExp(handoffLabel, "u"));
  assert.match(buttonFallback(html, "cutoutAddProject"), new RegExp(handoffLabel, "u"));
  assert.match(buttonFallback(html, "scatterAddProject"), new RegExp(handoffLabel, "u"));
  assert.match(html, /data-organizer-i18n="moreTools"/);
});

test("deleted A/B compare leaves no leftover cutout UI", () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
  const cutoutTextSource = fs.readFileSync(path.join(PUBLIC_DIR, "batch_cutout_text.js"), "utf8");
  for (const leftover of ["智能对比", "方案 A", "方案 B", "生成候选", "compareSplit", "cutoutCompareSplit"]) {
    assert.doesNotMatch(html, new RegExp(leftover, "u"), `index.html still has leftover A/B UI: ${leftover}`);
    assert.doesNotMatch(
      cutoutTextSource,
      new RegExp(leftover, "u"),
      `batch_cutout_text.js still has leftover A/B copy: ${leftover}`,
    );
  }
});
