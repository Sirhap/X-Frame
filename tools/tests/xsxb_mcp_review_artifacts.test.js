"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore } = require("../project_store");
const { encodePngRgba } = require("../xsxb_mcp_cutout");
const { createReviewArtifactStore } = require("../xsxb_mcp_review_artifacts");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-review-artifact-"));
  const projectStore = createProjectStore(root);
  projectStore.addProject({ id: "review", label: "Review" });
  return {
    root,
    projectStore,
    project: projectStore.activeProject("review"),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function widePng(width = 2048, height = 512) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = (x * 17 + y * 3) % 256;
      rgba[offset + 1] = (x * 5 + y * 11) % 256;
      rgba[offset + 2] = (x + y * 7) % 256;
      rgba[offset + 3] = 255;
    }
  }
  return encodePngRgba(rgba, width, height);
}

test("review artifacts return a bounded inline PNG and a full MCP resource", () => {
  const current = fixture();
  try {
    const sourcePath = path.join(current.root, "wide.png");
    fs.writeFileSync(sourcePath, widePng());
    const store = createReviewArtifactStore({ root: current.root, projectStore: current.projectStore });
    const artifact = store.create({
      project: current.project,
      kind: "weapon_plan",
      sourcePath,
      revision: "revision-a",
      parameters: { frames: 10 },
    });
    assert.match(artifact.artifactId, /^review_[a-f0-9]{24}$/u);
    assert.equal(artifact.thumbnail.width, 1024);
    assert.equal(artifact.thumbnail.height, 256);
    assert.ok(artifact.thumbnail.bytes <= 1_500_000);
    assert.equal(artifact.content[0].type, "image");
    assert.equal(artifact.content[0].mimeType, "image/png");
    assert.equal(artifact.content[1].type, "resource_link");
    assert.match(artifact.content[1].uri, /^xsxb:\/\/projects\/review\/reviews\//u);

    const full = store.read(artifact.content[1].uri);
    assert.equal(full.mimeType, "image/png");
    assert.deepEqual(Buffer.from(full.blob, "base64"), fs.readFileSync(sourcePath));
    const repeated = store.create({
      project: current.project,
      kind: "weapon_plan",
      sourcePath,
      revision: "revision-a",
      parameters: { frames: 10 },
    });
    assert.equal(repeated.artifactId, artifact.artifactId);
    assert.equal(repeated.reused, true);
  } finally {
    current.cleanup();
  }
});

test("review resource reads reject foreign projects and unsafe asset names", () => {
  const current = fixture();
  try {
    const store = createReviewArtifactStore({ root: current.root, projectStore: current.projectStore });
    assert.throws(
      () => store.read("xsxb://projects/other/reviews/review_deadbeef/full.png"),
      /project|resource/i,
    );
    assert.throws(
      () => store.read("xsxb://projects/review/reviews/review_deadbeef/..%2Fsecret"),
      /resource|asset|invalid/i,
    );
  } finally {
    current.cleanup();
  }
});

test("expired unpinned review artifacts are recreated and omitted from resource listings", () => {
  const current = fixture();
  let clock = Date.UTC(2026, 0, 1);
  try {
    const sourcePath = path.join(current.root, "review.png");
    fs.writeFileSync(sourcePath, widePng(64, 64));
    const store = createReviewArtifactStore({
      root: current.root,
      projectStore: current.projectStore,
      now: () => clock,
    });
    const created = store.create({
      project: current.project,
      kind: "cutout_review",
      sourcePath,
      revision: "revision-a",
      parameters: {},
    });
    const originalCreatedAt = created.createdAtMs;
    clock += 8 * 24 * 60 * 60 * 1000;

    assert.equal(store.list().resources.length, 0);
    assert.throws(() => store.read(created.uri), /expired|not found/u);
    const recreated = store.create({
      project: current.project,
      kind: "cutout_review",
      sourcePath,
      revision: "revision-a",
      parameters: {},
    });
    assert.equal(recreated.artifactId, created.artifactId);
    assert.equal(recreated.reused, false);
    assert.ok(recreated.createdAtMs > originalCreatedAt);
    assert.equal(store.list().resources.length, 1);
  } finally {
    current.cleanup();
  }
});

test("artifact reads verify full and thumbnail bytes and reuse can promote a pin", () => {
  const current = fixture();
  try {
    const sourcePath = path.join(current.root, "verified.png");
    fs.writeFileSync(sourcePath, widePng(64, 64));
    const store = createReviewArtifactStore({ root: current.root, projectStore: current.projectStore });
    const created = store.create({
      project: current.project,
      kind: "weapon_plan",
      sourcePath,
      revision: "revision-a",
      parameters: {},
    });
    const promoted = store.create({
      project: current.project,
      kind: "weapon_plan",
      sourcePath,
      revision: "revision-a",
      parameters: {},
      pinned: true,
    });
    assert.equal(promoted.pinned, true);
    assert.match(promoted.thumbnail.hash, /^[a-f0-9]{64}$/u);

    const fullPath = path.join(
      current.projectStore.projectWorkspaceDir(current.project),
      ".xsxb",
      "reviews",
      created.artifactId,
      created.full.name,
    );
    fs.appendFileSync(fullPath, "tampered");
    assert.throws(() => store.read(created.uri), /hash|integrity/iu);
  } finally {
    current.cleanup();
  }
});

test("failed artifact creation leaves no partially readable deterministic directory", () => {
  const current = fixture();
  try {
    const sourcePath = path.join(current.root, "animation.gif");
    fs.writeFileSync(sourcePath, "GIF89a");
    const store = createReviewArtifactStore({ root: current.root, projectStore: current.projectStore });
    assert.throws(
      () =>
        store.create({
          project: current.project,
          kind: "animation_gif",
          sourcePath,
          revision: "revision-a",
          parameters: {},
        }),
      /thumbnailSourcePath/u,
    );
    const reviews = path.join(current.projectStore.projectWorkspaceDir(current.project), ".xsxb", "reviews");
    const artifactDirectories = fs.existsSync(reviews)
      ? fs.readdirSync(reviews).filter((name) => name.startsWith("review_"))
      : [];
    assert.deepEqual(artifactDirectories, []);
  } finally {
    current.cleanup();
  }
});

test("artifact size is rejected from stat before hashing or copying", () => {
  const current = fixture();
  try {
    const sourcePath = path.join(current.root, "oversized.gif");
    fs.writeFileSync(sourcePath, "GIF89a-too-large");
    const store = createReviewArtifactStore({
      root: current.root,
      projectStore: current.projectStore,
      maxArtifactBytes: 8,
    });
    assert.throws(
      () =>
        store.create({
          project: current.project,
          kind: "animation_gif",
          sourcePath,
          revision: "revision-a",
          parameters: {},
        }),
      /too large|8-byte limit/iu,
    );
  } finally {
    current.cleanup();
  }
});
