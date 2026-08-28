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
const {
  createProjectPersistence,
  tuningFileForClient,
} = require("../animation_tuner/server_project_persistence");

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
    normalizeReferenceFrameDescriptor: (value) => value || null,
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

test("tuning persistence retains the normalized reference-frame descriptor", () => {
  const fixture = createFixture();
  try {
    fixture.persistence.saveTuningPayload(
      {
        values: {},
        reference_frame: {
          profile_id: "hero",
          animation_id: "idle",
          frame_index: 1,
          transform: { scale: 2 },
        },
      },
      fixture.project,
    );
    const saved = JSON.parse(fs.readFileSync(fixture.paths.tuning, "utf8"));
    assert.deepEqual(saved.reference_frame, {
      profile_id: "hero",
      animation_id: "idle",
      frame_index: 1,
      transform: { scale: 2 },
    });
  } finally {
    fixture.dispose();
  }
});

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

test("asset-library persistence removes metadata without deleting content-addressed image files", () => {
  const fixture = createFixture();
  try {
    const bytes = createPng(32, 24, 7);
    const image = fixture.persistence.saveFrameAttachmentImage(
      {
        name: "slash.png",
        data: `data:image/png;base64,${bytes.toString("base64")}`,
      },
      fixture.project,
    );
    const asset = {
      id: "asset-slash",
      name: image.name,
      path: image.path,
      assetHash: image.assetHash,
      type: image.type,
      width: image.width,
      height: image.height,
      groupKey: "hero/run",
    };
    const physicalFile = path.join(fixture.root, image.path);

    fixture.persistence.saveAttachmentAssets([asset], fixture.project);
    fixture.persistence.saveAttachmentAssets([], fixture.project);

    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.paths.attachmentAssets, "utf8")), []);
    assert.equal(fs.existsSync(physicalFile), true);
    assert.deepEqual(fs.readFileSync(physicalFile), bytes);
  } finally {
    fixture.dispose();
  }
});

test("tuning persistence retains attack VFX frame and playback overrides through save and client reload", () => {
  const fixture = createFixture();
  try {
    const payload = {
      values: { "profiles.hero.groups.slash.visual_size": 1 },
      scene_settings: { scene: "main" },
      reference_frame: null,
      frame_visual_overrides: { "hero/idle#0": { offset: { x: 1, y: 2 } } },
      frame_playback_overrides: { "hero/idle#0": { hold: 2 } },
      frame_box_overrides: { "hero/idle#0": { hitbox: { enabled: true } } },
      attack_vfx_frame_overrides: {
        "hero/slash_fx#0": { offset: { x: 7, y: 9 }, visual_size: 1.4, rotation: 15 },
      },
      attack_vfx_playback_overrides: {
        "hero/slash_fx#0": { hold: 3, disabled: false },
      },
    };
    fixture.persistence.saveTuningPayload(payload, fixture.project);
    const saved = JSON.parse(fs.readFileSync(fixture.paths.tuning, "utf8"));
    assert.deepEqual(saved.attack_vfx_frame_overrides, payload.attack_vfx_frame_overrides);
    assert.deepEqual(saved.attack_vfx_playback_overrides, payload.attack_vfx_playback_overrides);
    assert.deepEqual(saved.frame_visual_overrides, payload.frame_visual_overrides);
    assert.deepEqual(saved.frame_playback_overrides, payload.frame_playback_overrides);
    assert.deepEqual(saved.frame_box_overrides, payload.frame_box_overrides);

    const clientTuning = tuningFileForClient(saved);
    assert.deepEqual(clientTuning.attack_vfx_frame_overrides, payload.attack_vfx_frame_overrides);
    assert.deepEqual(clientTuning.attack_vfx_playback_overrides, payload.attack_vfx_playback_overrides);
    assert.equal(clientTuning["profiles.hero.groups.slash.visual_size"], 1);
    assert.deepEqual(clientTuning.frame_visual_overrides, payload.frame_visual_overrides);

    fixture.persistence.saveTuningPayload({ values: {} }, fixture.project);
    const emptySaved = JSON.parse(fs.readFileSync(fixture.paths.tuning, "utf8"));
    assert.deepEqual(emptySaved.attack_vfx_frame_overrides, {});
    assert.deepEqual(emptySaved.attack_vfx_playback_overrides, {});

    fixture.persistence.saveTuningPayload(
      {
        values: {},
        attack_vfx_frame_overrides: "nope",
        attack_vfx_playback_overrides: 3,
      },
      fixture.project,
    );
    const invalidSaved = JSON.parse(fs.readFileSync(fixture.paths.tuning, "utf8"));
    assert.deepEqual(invalidSaved.attack_vfx_frame_overrides, {});
    assert.deepEqual(invalidSaved.attack_vfx_playback_overrides, {});
    const invalidClient = tuningFileForClient(invalidSaved);
    assert.deepEqual(invalidClient.attack_vfx_frame_overrides, {});
    assert.deepEqual(invalidClient.attack_vfx_playback_overrides, {});
  } finally {
    fixture.dispose();
  }
});
