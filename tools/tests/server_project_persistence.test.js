"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  decodeDataUrl,
  imageExtensionFromMime,
  isInside,
  safeResolve,
} = require("../animation_tuner/server_validation");
const { createProjectPersistence } = require("../animation_tuner/server_project_persistence");

/**
 * Creates a minimal valid PNG payload with predictable dimensions.
 * @param {number} width PNG width.
 * @param {number} height PNG height.
 * @param {number} marker Byte used to distinguish replacement content.
 * @returns {Buffer} PNG-like bytes accepted by replacement validation.
 */
function createPng(width, height, marker) {
  const bytes = Buffer.alloc(24, marker);
  bytes.write("PNG", 1, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/**
 * Creates persistence operations backed by an isolated temporary workspace.
 * @returns {{root:string,workspace:string,project:object,paths:object,persistence:object,dispose:()=>void}}
 */
function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-persistence-test-"));
  const workspace = path.join(root, "workspace", "projects", "demo");
  const data = path.join(root, "data", "projects", "demo");
  const paths = {
    tuning: path.join(data, "tuning.json"),
    frameAudio: path.join(data, "frame_audio_bindings.json"),
    frameImageAttachments: path.join(data, "frame_image_attachments.json"),
    attachmentAssets: path.join(data, "attachment_assets.json"),
  };
  const project = { id: "demo" };
  const projectStore = {
    projectPaths: () => paths,
    projectWorkspaceDir: () => workspace,
    writeJson(filePath, value) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
    },
  };
  const persistence = createProjectPersistence({
    fs,
    path,
    crypto,
    root,
    projectStore,
    decodeDataUrl,
    imageExtensionFromMime,
    isInside,
    safeResolve,
    reslash: (value) => String(value || "").replaceAll("\\", "/"),
    getPngSize(filePath) {
      const bytes = fs.readFileSync(filePath);
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    },
    normalizeTuningScaleValues: (values) => values || {},
    withFrameAttachmentHash: (_project, attachment) => ({
      ...attachment,
      assetHash: attachment.assetHash || "test-hash",
    }),
    HttpError: class HttpError extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    },
  });
  return {
    root,
    workspace,
    project,
    paths,
    persistence,
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("animation replacement validates PNG targets and supports explicit rollback", () => {
  const fixture = createFixture();
  try {
    const target = path.join(fixture.workspace, "frames", "idle.png");
    const original = createPng(1, 2, 1);
    const replacementBytes = createPng(4, 5, 2);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, original);

    const replacement = fixture.persistence.replaceAnimationImages(
      [{ path: "workspace/projects/demo/frames/idle.png" }],
      [{ data: `data:image/png;base64,${replacementBytes.toString("base64")}` }],
      fixture.project,
    );
    assert.deepEqual(replacement.frames, [
      { path: "workspace/projects/demo/frames/idle.png", width: 4, height: 5 },
    ]);
    assert.deepEqual(fs.readFileSync(target), replacementBytes);

    replacement.rollback();
    replacement.rollback();
    assert.deepEqual(fs.readFileSync(target), original);
  } finally {
    fixture.dispose();
  }
});

test("animation replacement rejects mismatched and unsafe payloads before mutation", () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => fixture.persistence.replaceAnimationImages([], [], fixture.project),
      (error) => error.status === 400,
    );
    assert.throws(
      () =>
        fixture.persistence.replaceAnimationImages(
          [{ path: "../outside.png" }],
          [{ data: "data:image/png;base64,AAAA" }],
          fixture.project,
        ),
      /active project workspace/,
    );
  } finally {
    fixture.dispose();
  }
});
