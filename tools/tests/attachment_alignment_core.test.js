"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyAlignmentPlan,
  createAlignmentPlan,
  parseFrameSelection,
  validateAlignment,
} = require("../attachment_alignment_core");
const { createProjectStore } = require("../project_store");

/**
 * Writes the minimum PNG header required by the attachment planner.
 * @param {string} filePath Destination path.
 * @param {number} width Canvas width.
 * @param {number} height Canvas height.
 * @param {number} marker Content marker.
 * @returns {void}
 */
function writePng(filePath, width, height, marker) {
  const buffer = Buffer.alloc(32, marker);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

/**
 * Creates an isolated tuner project and two external attachment images.
 * @returns {{root:string,assetsDir:string,store:object,project:object,paths:object,dispose:()=>void}}
 */
function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-align-test-"));
  const store = createProjectStore(root);
  const registry = store.writeRegistry({
    schemaVersion: 1,
    activeProjectId: "demo",
    projects: [
      {
        id: "demo",
        label: "Demo",
        projectRoot: "",
        dataDir: "data/projects/demo",
        workspaceDir: "workspace/projects/demo",
      },
    ],
  });
  const project = registry.projects[0];
  const paths = store.projectPaths(project);
  store.writeJson(paths.manifest, {
    schemaVersion: 1,
    profiles: [
      {
        id: "hero",
        label: "Hero",
        bodyScale: 1,
        runtimeScale: 1,
        animations: [
          {
            id: "attack",
            name: "attack",
            type: "actor",
            source: "workspace/projects/demo/assets/hero/attack",
            frames: [
              {
                id: "frame_1",
                path: "workspace/projects/demo/assets/hero/attack/1.png",
                width: 96,
                height: 72,
              },
              {
                id: "frame_2",
                path: "workspace/projects/demo/assets/hero/attack/2.png",
                width: 96,
                height: 72,
              },
            ],
          },
        ],
      },
    ],
  });
  const assetsDir = path.join(root, "external-slashes");
  writePng(path.join(assetsDir, "slash_10.png"), 96, 72, 10);
  writePng(path.join(assetsDir, "slash_2.png"), 96, 72, 2);
  return {
    root,
    assetsDir,
    store,
    project,
    paths,
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("frame ranges are one-based, unique, sorted, and bounded", () => {
  assert.deepEqual(parseFrameSelection("2-3,1,2", 3), [0, 1, 2]);
  assert.deepEqual(parseFrameSelection("all", 2), [0, 1]);
  assert.throws(() => parseFrameSelection("0-2", 3), /between 1 and 3/);
  assert.throws(() => parseFrameSelection("2-4", 3), /between 1 and 3/);
});

test("planning is non-mutating and creates a natural one-to-one shared-canvas mapping", () => {
  const fixture = createFixture();
  try {
    const before = fs.readFileSync(fixture.paths.frameImageAttachments, "utf8");
    const plan = createAlignmentPlan({
      root: fixture.root,
      projectId: "demo",
      profileId: "hero",
      animationId: "attack",
      assets: fixture.assetsDir,
      frames: "1-2",
    });

    assert.equal(plan.canvas.mode, "shared");
    assert.equal(plan.requiresVisualReview, false);
    assert.deepEqual(
      plan.entries.map((entry) => [entry.displayFrame, entry.asset.name]),
      [
        [1, "slash_2.png"],
        [2, "slash_10.png"],
      ],
    );
    assert.match(plan.entries[0].key, /^demo:player:hero:actor:attack:/);
    assert.equal(plan.entries[0].metadata.animation, "hero/attack");
    assert.equal(fs.readFileSync(fixture.paths.frameImageAttachments, "utf8"), before);
    assert.deepEqual(fixture.store.readJson(fixture.paths.attachmentAssets, []), []);
  } finally {
    fixture.dispose();
  }
});

test("explicit resampling maps a longer sequence while preserving the strict default", () => {
  const fixture = createFixture();
  try {
    writePng(path.join(fixture.assetsDir, "slash_20.png"), 96, 72, 20);
    const plan = createAlignmentPlan({
      root: fixture.root,
      projectId: "demo",
      profileId: "hero",
      animationId: "attack",
      assets: fixture.assetsDir,
      frames: "all",
      strategy: "resample",
    });

    assert.equal(plan.mappingStrategy, "resample");
    assert.equal(plan.requiresVisualReview, true);
    assert.deepEqual(plan.sequenceAnalysis, {
      strategy: "resample",
      sourceCount: 3,
      targetCount: 2,
      confidence: 0.9,
    });
    assert.deepEqual(
      plan.entries.map((entry) => [entry.displayFrame, entry.asset.name, entry.alignment.sourceAssetFrame]),
      [
        [1, "slash_2.png", 1],
        [2, "slash_20.png", 3],
      ],
    );
  } finally {
    fixture.dispose();
  }
});

test("apply requires confirmation, backs up data, validates, and is idempotent", () => {
  const fixture = createFixture();
  try {
    const plan = createAlignmentPlan({
      root: fixture.root,
      projectId: "demo",
      profileId: "hero",
      animationId: "attack",
      assets: fixture.assetsDir,
      frames: "all",
    });
    assert.throws(
      () => applyAlignmentPlan({ root: fixture.root, plan, syncGodot: false }),
      /explicit confirmation/,
    );

    const result = applyAlignmentPlan({ root: fixture.root, plan, confirmed: true, syncGodot: false });
    assert.equal(result.status, "applied");
    assert.equal(result.applied, 2);
    assert.equal(result.validation.ok, true);
    assert.equal(result.backups.length, 2);
    assert.ok(result.backups.every((filePath) => fs.existsSync(filePath)));
    const attachments = fixture.store.readJson(fixture.paths.frameImageAttachments, []);
    assert.equal(attachments.length, 2);
    assert.equal(attachments[0].assetId, attachments[0].automation.assetId);
    assert.equal(attachments[0].automation.planId, plan.planId);
    assert.ok(fs.existsSync(path.join(fixture.root, attachments[0].path)));

    const repeated = applyAlignmentPlan({ root: fixture.root, plan, confirmed: true, syncGodot: false });
    assert.equal(repeated.status, "already_applied");
    assert.equal(repeated.applied, 0);
    assert.equal(fixture.store.readJson(fixture.paths.frameImageAttachments, []).length, 2);

    const collided = fixture.store.readJson(fixture.paths.frameImageAttachments, []);
    collided[0].transform.offset.x += 1;
    fixture.store.writeJson(fixture.paths.frameImageAttachments, collided);
    assert.throws(
      () => applyAlignmentPlan({ root: fixture.root, plan, confirmed: true, syncGodot: false }),
      /collision|partial|different plan/iu,
    );
    collided[0].transform.offset.x -= 1;
    delete collided[0].automation.planId;
    delete collided[1].automation.planId;
    fixture.store.writeJson(fixture.paths.frameImageAttachments, collided);
    assert.throws(
      () => applyAlignmentPlan({ root: fixture.root, plan, confirmed: true, syncGodot: false }),
      /collision|different plan|instance/iu,
    );
  } finally {
    fixture.dispose();
  }
});

test("apply synchronizes stable attachment keys and res paths to a bound Godot project", () => {
  const fixture = createFixture();
  try {
    const godotRoot = path.join(fixture.root, "godot-game");
    fs.mkdirSync(godotRoot, { recursive: true });
    fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Demo"\n');
    const registry = fixture.store.readRegistry();
    registry.projects[0].projectRoot = godotRoot;
    fixture.store.writeRegistry(registry);
    const plan = createAlignmentPlan({
      root: fixture.root,
      projectId: "demo",
      profileId: "hero",
      animationId: "attack",
      assets: fixture.assetsDir,
      frames: "all",
    });

    const result = applyAlignmentPlan({ root: fixture.root, plan, confirmed: true });
    assert.equal(result.godotSync.ok, true);
    assert.equal(result.godotSync.imageAttachmentCount, 2);
    const syncedPath = path.join(
      godotRoot,
      "xsxb_frame_tuner",
      "data",
      "projects",
      "demo",
      "frame_image_attachments.json",
    );
    const synced = JSON.parse(fs.readFileSync(syncedPath, "utf8"));
    assert.deepEqual(
      synced.map((attachment) => attachment.key),
      ["hero/attack:0", "hero/attack:1"],
    );
    assert.ok(synced.every((attachment) => attachment.path.startsWith("res://xsxb_frame_tuner/")));
  } finally {
    fixture.dispose();
  }
});

test("apply rejects revision conflicts and unsafe asset/frame counts", () => {
  const fixture = createFixture();
  try {
    const plan = createAlignmentPlan({
      root: fixture.root,
      projectId: "demo",
      profileId: "hero",
      animationId: "attack",
      assets: fixture.assetsDir,
      frames: "all",
    });
    fixture.store.writeJson(fixture.paths.tuning, { schemaVersion: 1, values: { changed: true } });
    assert.throws(
      () => applyAlignmentPlan({ root: fixture.root, plan, confirmed: true, syncGodot: false }),
      /changed after planning/,
    );

    assert.throws(
      () =>
        createAlignmentPlan({
          root: fixture.root,
          projectId: "demo",
          profileId: "hero",
          animationId: "attack",
          assets: fixture.assetsDir,
          frames: "1",
        }),
      /Unsafe one-to-one mapping/,
    );
  } finally {
    fixture.dispose();
  }
});

test("validation reports invalid geometry and asset identity", () => {
  const fixture = createFixture();
  try {
    const plan = createAlignmentPlan({
      root: fixture.root,
      projectId: "demo",
      profileId: "hero",
      animationId: "attack",
      assets: fixture.assetsDir,
      frames: "all",
    });
    applyAlignmentPlan({ root: fixture.root, plan, confirmed: true, syncGodot: false });
    const attachments = fixture.store.readJson(fixture.paths.frameImageAttachments, []);
    attachments[0].transform.scale = 0;
    attachments[0].assetId = "missing";
    attachments[0].key = "another/animation:0";
    attachments[0].frameKey = "another/animation:0";
    fixture.store.writeJson(fixture.paths.frameImageAttachments, attachments);

    const report = validateAlignment({
      root: fixture.root,
      projectId: "demo",
      profileId: "hero",
      animationId: "attack",
    });
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((message) => message.includes("scale must be greater")));
    assert.ok(report.errors.some((message) => message.includes("assetId does not exist")));
    assert.ok(report.errors.some((message) => message.includes("frame key does not belong")));
  } finally {
    fixture.dispose();
  }
});
