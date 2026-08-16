"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  decodeDataUrl,
  isManagedWorkspaceAsset,
  isServableAsset,
  normalizeManifest,
  normalizeReferenceFrameDescriptor,
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

test("server validation reports malformed percent-encoded data URLs as client errors", () => {
  assert.throws(
    () => decodeDataUrl("data:text/plain,%zz"),
    (error) => error?.status === 400 && /invalid data url encoding/i.test(error.message),
  );
});

test("asset validation only allows registered project workspace files", () => {
  const root = path.resolve("/tmp/frame-tuner-assets");
  const projects = [
    { workspaceDir: path.join(root, "workspace", "projects", "alpha") },
    { workspaceDir: path.join(root, "workspace", "projects", "beta") },
  ];

  assert.equal(
    isManagedWorkspaceAsset(
      path.join(root, "workspace", "projects", "alpha", "frames", "idle.png"),
      projects,
    ),
    true,
  );
  assert.equal(isManagedWorkspaceAsset(path.join(root, "reports", "evidence.png"), projects), false);
  assert.equal(
    isManagedWorkspaceAsset(path.join(root, "workspace", "projects", "alpha-old", "x.png"), projects),
    false,
  );
});

test("asset validation also serves built-in public assets", () => {
  const root = path.resolve("/tmp/frame-tuner-servable");
  const publicRoot = path.join(root, "tools", "animation_tuner", "public");
  const projects = [{ workspaceDir: path.join(root, "workspace", "projects", "alpha") }];

  assert.equal(
    isServableAsset(path.join(publicRoot, "presets", "attack_trails", "trail.png"), {
      publicRoot,
      projects,
    }),
    true,
  );
  assert.equal(
    isServableAsset(path.join(root, "workspace", "projects", "alpha", "frames", "idle.png"), {
      publicRoot,
      projects,
    }),
    true,
  );
  assert.equal(isServableAsset(path.join(root, "reports", "evidence.png"), { publicRoot, projects }), false);
  assert.equal(isServableAsset(path.join(root, "reports", "evidence.png"), { projects }), false);
  assert.equal(isServableAsset("", { publicRoot, projects }), false);
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

test("reference-frame validation keeps finite transform fields and rejects stale identities", () => {
  assert.deepEqual(
    normalizeReferenceFrameDescriptor({
      profile_id: " hero ",
      animation_id: "idle",
      frame_index: 2,
      transform: {
        scale: 1.5,
        scaleX: 2,
        scaleY: 3,
        offset: { x: 4, y: 5 },
        rotation: 6,
        ignored: "unsafe",
      },
    }),
    {
      profile_id: "hero",
      animation_id: "idle",
      frame_index: 2,
      transform: {
        scale: 1.5,
        scaleX: 2,
        scaleY: 3,
        offset: { x: 4, y: 5 },
        rotation: 6,
      },
    },
  );
  assert.equal(normalizeReferenceFrameDescriptor({ profile_id: "hero", frame_index: 0 }), null);
  assert.equal(
    normalizeReferenceFrameDescriptor({
      profile_id: "hero",
      animation_id: "idle",
      frame_index: -1,
      transform: {},
    }),
    null,
  );
});
