"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("scatter detection updates counters before preview and does not mask render failures", () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/scatter_slice.js"),
    "utf8",
  );

  assert.match(script, /function syncDetectionChrome\(\)/);
  assert.match(script, /Array\.isArray\(group\.boxes\) && group\.boxes\.length > 0/);
  const renderAll = script.slice(script.indexOf("function renderAll()"));
  assert.match(renderAll, /syncDetectionChrome\(\)/);
  assert.ok(
    renderAll.indexOf("syncDetectionChrome()") < renderAll.indexOf("renderPreview()"),
    "counters must update before preview",
  );
  const successIndex = script.indexOf("识别到 ${state.boxes.length} 个区域");
  const renderedGuard = script.indexOf("if (!rendered) return;");
  assert.ok(
    renderedGuard > 0 && renderedGuard < successIndex,
    "success status requires renderAll to succeed",
  );
});

test("scatter detection keeps the group list even when preview rendering fails", () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/scatter_slice.js"),
    "utf8",
  );
  const renderAll = script.slice(
    script.indexOf("function renderAll()"),
    script.indexOf("function runDetection()"),
  );
  const previewTry = renderAll.indexOf("renderPreview()");
  const listCall = renderAll.indexOf("renderSliceList()");
  assert.ok(previewTry > 0 && listCall > previewTry, "the group list renders after preview");
  assert.match(renderAll, /catch \(error\) \{[^}]*reportFailure/);
  const previewCatch = renderAll.indexOf("reportFailure", previewTry);
  assert.ok(previewCatch > 0 && listCall > previewCatch, "preview failures must not skip the group list");
});

test("scatter detection mode exposes a threshold and retriggers recognition", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/index.html"), "utf8");
  const script = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/scatter_slice.js"),
    "utf8",
  );
  assert.match(html, /id="scatterThreshold"/);
  assert.match(script, /elements\.modeInput\.addEventListener\("change"/);
  assert.match(script, /runDetection\(\)/);
  assert.match(script, /threshold:\s*Number\(elements\.thresholdInput/);
  assert.match(script, /mergeGap:\s*Math\.max\(0,/);
});

test("scatter-slice routes recoverable failures through one error boundary", () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/scatter_slice.js"),
    "utf8",
  );

  assert.match(script, /function reportFailure\(error, fallback\)/);
  assert.doesNotMatch(script, /console\.error\(error\)/);
});

test("scatter-slice rail includes video watermark repair", () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/scatter-slice.html"),
    "utf8",
  );
  assert.match(html, /href="\/tools\/watermark"/);
  assert.match(html, /aria-label="视频去水印"/);
});

test("scatter-slice exposes a confirmed full-source clear action", () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/scatter-slice.html"),
    "utf8",
  );
  const script = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/scatter_slice.js"),
    "utf8",
  );

  assert.match(html, /id="scatterClearSource"/);
  assert.match(html, /id="scatterClearDialog"/);
  assert.match(script, /function clearSource\(\)/);
  assert.match(script, /state\.source = null/);
});

test("scatter-slice exposes history, grouping, multi-selection, and sizing controls", () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/scatter-slice.html"),
    "utf8",
  );

  for (const id of [
    "scatterUndo",
    "scatterRedo",
    "scatterRegroup",
    "scatterNormalizeBoxes",
    "scatterSmallSliceRatio",
    "scatterSelectSmallSlices",
    "scatterUniformOutput",
    "scatterInteractionStatus",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /src="\/app_history\.js"/);
  assert.match(html, /src="\/scatter_slice_workspace_core\.js"/);
  assert.match(html, /src="\/scatter_slice_group_controller\.js"/);
  assert.match(html, /src="\/batch_cutout_background_estimator\.js"/);
  assert.match(html, /id="scatterTransparent"[^>]+aria-label="智能抠图"/u);
  assert.match(html, /id="scatterUniformOutput"[^>]+aria-label="统一输出画布"/u);
});

test("scatter-slice degrades missing cloud transparency into a human export path", () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/scatter_slice.js"),
    "utf8",
  );

  assert.match(script, /网页版没有云端透明切片/);
  assert.match(script, /transparentInput\.checked = false/);
  assert.match(script, /link\.download = fileName/);
  assert.match(script, /document\.body\.append\(link\)|document\.body\.appendChild\(link\)/);
});

test("scatter results title and threshold markup are localized from the shared table", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/index.html"), "utf8");
  assert.match(html, /id="scatterResultsTitle"[^>]*data-i18n="scatterResultsTitle"/);
  assert.match(html, /id="scatterThreshold"/);
  assert.match(html, /data-i18n="scatterThreshold"/);
  assert.match(html, /data-i18n="scatterAlphaHint"/);
});
