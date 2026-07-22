"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const premium = require("../animation_tuner/public/premium_features");

test("premium cutout detection reports only features that affect included output", () => {
  const features = premium.detectCutoutFeatures([
    {
      processingParameters: {
        edgeBoost: 10,
        despillStrength: 12,
        feather: 3,
        connected: true,
      },
      protectedColors: [{ r: 1, g: 2, b: 3 }],
      repairs: [{ mode: "brush" }, { mode: "clear", propagatedFrom: "repair-1" }],
    },
    {
      excluded: true,
      processingParameters: { perceptual: true },
    },
  ]);

  assert.deepEqual(features, [
    "cutout.edge-refinement",
    "cutout.alpha-control",
    "cutout.color-protection",
    "cutout.local-repair",
    "cutout.repair-propagation",
  ]);
});

test("premium tuner detection ignores empty containers and labels supported ids", () => {
  const features = premium.detectTunerFeatures({
    frameAudioBindings: [],
    frameImageAttachments: [{ id: "attachment" }],
    framePlaybackOverrides: { hero: { frame_1: { duration: 120 } } },
    frameBoxOverrides: {},
  });

  assert.deepEqual(features, ["tuner.image-attachments", "tuner.frame-playback"]);
  assert.deepEqual(
    premium.describeFeatures([...features, "unknown"], "zh").map((entry) => entry.label),
    ["图片挂件与 VFX 图层", "逐帧时长与高级播放覆盖"],
  );
});

test("premium catalog labels final cutout output for route-level authorization", () => {
  assert.deepEqual(premium.normalizeFeatureIds(["cutout.alpha-control", "cutout.output"]), [
    "cutout.output",
    "cutout.alpha-control",
  ]);
  assert.equal(premium.describeFeatures(["cutout.output"], "zh")[0].label, "最终图片导出与动画替换");
  assert.equal(premium.describeFeatures(["organizer.output"], "zh")[0].label, "帧工作集导出与应用");
});

test("workbench export gates only advanced features actually used", () => {
  assert.deepEqual(
    premium.detectExportFeatures({
      sourceFeatures: ["organizer.output", "cutout.output", "cutout.edge-refinement"],
      tuner: { frameImageAttachments: [{ id: "layer" }] },
    }),
    ["cutout.edge-refinement", "tuner.image-attachments"],
  );
  assert.deepEqual(premium.detectExportFeatures({ sourceFeatures: ["organizer.output"] }), []);
});
