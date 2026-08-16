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

test("scatter-slice routes recoverable failures through one error boundary", () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/scatter_slice.js"),
    "utf8",
  );

  assert.match(script, /function reportFailure\(error, fallback\)/);
  assert.doesNotMatch(script, /console\.error\(error\)/);
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
