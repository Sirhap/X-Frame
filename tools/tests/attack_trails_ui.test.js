"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

/** Loads the browser attack-trail editor class without constructing DOM elements. */
function loadAttackTrailEditor() {
  const root = path.resolve(__dirname, "..");
  const script = fs.readFileSync(path.join(root, "animation_tuner/public/attack_trails.js"), "utf8");
  const browserWindow = {};
  vm.runInNewContext(script, { console, window: browserWindow }, { filename: "attack_trails.js" });
  return browserWindow.AttackTrailEditor;
}

/** Creates the Canvas 2D surface needed to record rendered key-stick labels. */
function makeRecordingContext(labels) {
  return {
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
    closePath() {},
    fillText(text) {
      labels.push({ text, alpha: this.globalAlpha });
    },
  };
}

/** Creates one normalized-enough attack-trail stick for guide rendering. */
function makeStick(id, frame, order, layer) {
  return {
    id,
    frame,
    order,
    layer,
    top: { x: order * 20, y: -10 },
    bottom: { x: order * 20, y: 10 },
  };
}

test("attack trail controls expose gradient-stop removal and default-texture recovery", () => {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "animation_tuner/public/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "animation_tuner/public/attack_trails.js"), "utf8");

  assert.match(html, /id="attackTrailGradientDelete"/);
  assert.match(html, /id="attackTrailTextureReset"/);
  assert.match(script, /_deleteGradientStop\(\)/);
  assert.match(script, /_resetTexture\(\)/);
});

test("attack trail reports Canvas fallback once and disables the failed GPU renderer", () => {
  const AttackTrailEditor = loadAttackTrailEditor();
  const statuses = [];
  const editor = Object.create(AttackTrailEditor.prototype);
  editor.hooks = { status: (message) => statuses.push(message) };
  editor.gpuFallbackNotified = false;
  editor.gpuRenderer = { gl: {} };
  editor.gpuTextures = new WeakMap();
  editor._drawGpuMesh = () => {
    throw new Error("context lost");
  };

  assert.equal(editor._tryDrawGpuMesh(), false);
  editor._activateCanvasFallback(new Error("second failure"));

  assert.equal(editor.gpuRenderer, null);
  assert.equal(editor.gpuFallbackReason, "context lost");
  assert.deepEqual(statuses, ["WebGL 预览不可用，已自动切换到兼容的 Canvas 渲染。"]);
});

test("attack trail guides show every key stick while hit testing stays on the current frame", () => {
  const AttackTrailEditor = loadAttackTrailEditor();
  const labels = [];
  const editor = Object.create(AttackTrailEditor.prototype);
  const sticks = [makeStick("start", 0, 0, "front"), makeStick("end", 1, 1, "behind")];
  editor.enabled = true;
  editor.guidesVisible = true;
  editor.stickId = "start";
  editor.hooks = {
    ctx: makeRecordingContext(labels),
    dpr: () => 1,
    localToScreen: (value) => value,
    selectedFrame: () => 0,
  };
  editor._segment = () => ({ sticks });
  editor._drawSelectedPathGuide = () => {};
  editor._directionHandleScreen = () => ({
    center: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
    arrow: { x: 10, y: 0 },
  });

  editor.drawGuides();

  assert.deepEqual(labels, [
    { text: "#1", alpha: 1 },
    { text: "#2", alpha: 0.32 },
  ]);
  assert.deepEqual(
    editor._frameSticks({ sticks }).map((stick) => stick.id),
    ["start"],
  );
});
