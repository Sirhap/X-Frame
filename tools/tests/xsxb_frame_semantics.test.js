"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { estimateFrameBoxes } = require("../box_estimator");
const { mergeBox } = require("../xsxb_mcp_arguments");
const { analyzeFrameSequence } = require("../xsxb_frame_semantics");
const { encodePngRgba } = require("../xsxb_mcp_cutout");

function frame(withArc = false) {
  const width = 64;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 22; y <= 56; y += 1) {
    for (let x = 27; x <= 36; x += 1) data.set([30, 90, 50, 255], (y * width + x) * 4);
  }
  if (withArc) {
    for (let y = 10; y <= 18; y += 1) {
      for (let x = 42; x <= 61; x += 1) data.set([255, 235, 170, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

function translatedFrame(left, top, bodyWidth = 8) {
  const width = 72;
  const height = 72;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = top; y < top + 30; y += 1) {
    for (let x = left; x < left + bodyWidth; x += 1) {
      data.set([35, 95, 55, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

test("box patches preserve unspecified rotation and geometry", () => {
  const existing = {
    enabled: true,
    offset: { x: 4, y: -8 },
    size: { x: 30, y: 12 },
    rotation: 37,
  };
  assert.deepEqual(mergeBox(existing, { enabled: false }), { ...existing, enabled: false });
});

test("frame semantics keeps temporal votes when translated body widths change parity", () => {
  const analyzed = analyzeFrameSequence([
    translatedFrame(6, 24, 8),
    translatedFrame(30, 18, 9),
    translatedFrame(55, 30, 10),
  ]);
  assert.ok(analyzed.persistentPixelCount >= 150, JSON.stringify(analyzed));
  assert.ok(
    analyzed.frames.every((entry) => entry.confidence >= 0.7),
    JSON.stringify(analyzed),
  );
  assert.ok(
    analyzed.frames.every((entry) => entry.body.height === 30),
    JSON.stringify(analyzed),
  );
});

test("frame semantics separates one-frame baked FX from the persistent body", () => {
  const analyzed = analyzeFrameSequence([frame(false), frame(true), frame(false)]);
  assert.equal(analyzed.frames.length, 3);
  assert.ok(analyzed.frames[1].body.width <= 12, JSON.stringify(analyzed.frames[1]));
  assert.ok(analyzed.frames[1].sourceFxPixels >= 100);
  assert.ok(analyzed.frames[1].confidence >= 0.7);
  assert.equal(analyzed.provenance.body, "temporal_persistent_core");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-frame-semantics-box-"));
  try {
    const filePath = path.join(root, "attack.png");
    const source = frame(true);
    fs.writeFileSync(filePath, encodePngRgba(source.data, source.width, source.height));
    const boxes = estimateFrameBoxes(filePath, {
      animationId: "attack",
      animationName: "attack",
      frameIndex: 1,
      frameCount: 3,
      groupCanvasWidth: 64,
      groupCanvasHeight: 64,
      semanticFrame: analyzed.frames[1],
    });
    assert.ok(boxes.hurtbox.size.x <= 12, JSON.stringify(boxes));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("frame semantics aligns a translated body before temporal voting", () => {
  const analyzed = analyzeFrameSequence([
    translatedFrame(6, 24),
    translatedFrame(30, 18),
    translatedFrame(56, 30),
  ]);
  assert.ok(analyzed.persistentPixelCount >= 200, JSON.stringify(analyzed));
  assert.equal(analyzed.provenance.alignment, "feet_center_translation");
  assert.deepEqual(
    analyzed.frames.map((entry) => entry.body.x),
    [6, 30, 56],
  );
  assert.ok(analyzed.frames.every((entry) => entry.body.width === 8 && entry.body.height === 30));
  assert.ok(analyzed.frames.every((entry) => entry.confidence >= 0.7));
});

test("box estimation ignores unusable low-confidence semantic bodies", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-frame-semantics-confidence-"));
  try {
    const source = translatedFrame(20, 25);
    const filePath = path.join(root, "actor.png");
    fs.writeFileSync(filePath, encodePngRgba(source.data, source.width, source.height));
    const boxes = estimateFrameBoxes(filePath, {
      animationId: "idle",
      animationName: "idle",
      semanticFrame: { body: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.4 },
    });
    assert.ok(boxes.hurtbox.size.x > 1, JSON.stringify(boxes));
    assert.ok(boxes.hurtbox.size.y > 1, JSON.stringify(boxes));
    assert.ok(Math.abs(boxes.hurtbox.offset.x) < 20, JSON.stringify(boxes));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
