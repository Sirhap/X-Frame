"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  decodeDataUrl,
  normalizeManifest,
  normalizeTuningScaleValues,
  safeResolve,
  sanitizeSegment,
} = require("../animation_tuner/server_validation");

test("server path validation rejects traversal and sanitizes segments", () => {
  const basePath = path.resolve("/tmp/frame-tuner-validation");

  assert.equal(safeResolve(basePath, "frames/run.png"), path.join(basePath, "frames/run.png"));
  assert.equal(safeResolve(basePath, "../outside.png"), null);
  assert.equal(sanitizeSegment("../Boss: Run"), "Boss__Run");
});

test("server validation decodes data URLs and normalizes manifests", () => {
  const decoded = decodeDataUrl("data:text/plain;base64,aGVsbG8=");
  assert.equal(decoded.mime, "text/plain");
  assert.equal(decoded.buffer.toString("utf8"), "hello");
  assert.deepEqual(normalizeManifest(null, ["frame_transform"]), {
    schemaVersion: 1,
    profiles: [],
  });
  assert.deepEqual(normalizeManifest({ profiles: [{ name: "hero" }] }, ["frame_transform"]).profiles[0], {
    id: "hero",
    label: "hero",
    kind: "actor",
    bodyScale: 1,
    runtimeScale: 1,
    supports: ["frame_transform"],
    animations: [],
  });
});

test("tuning normalization removes only redundant uniform visual scale", () => {
  const values = {
    "hero.character.visual_scale": { x: 2, y: 2 },
    "hero.character.visual_size": 2,
    "boss.character.visual_scale": { x: 2, y: 3 },
  };

  assert.deepEqual(normalizeTuningScaleValues(values), {
    "hero.character.visual_size": 2,
    "boss.character.visual_scale": { x: 2, y: 3 },
  });
});
