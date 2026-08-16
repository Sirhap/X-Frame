"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServerIoOperations } = require("../animation_tuner/server_io_operations");

/**
 * Creates an isolated project fixture for server I/O tests.
 * @returns {{root:string,projectRoot:string,project:object,paths:object,projectStore:object,dispose:()=>void}}
 */
function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-server-io-test-"));
  const dataRoot = path.join(root, "data", "projects", "demo");
  const projectRoot = path.join(root, "godot");
  const paths = {
    manifest: path.join(dataRoot, "manifest.json"),
    tuning: path.join(dataRoot, "tuning.json"),
    frameAudio: path.join(dataRoot, "frame_audio_bindings.json"),
    frameImageAttachments: path.join(dataRoot, "frame_image_attachments.json"),
    attachmentAssets: path.join(dataRoot, "attachment_assets.json"),
  };
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  for (const filePath of Object.values(paths)) {
    fs.writeFileSync(filePath, filePath.endsWith(".json") ? "{}\n" : `${filePath}\n`);
  }
  const project = { id: "demo", projectRoot };
  const projectStore = {
    ensureProjectFiles() {},
    projectPaths() {
      return paths;
    },
  };
  return {
    root,
    projectRoot,
    project,
    paths,
    projectStore,
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("server I/O operations serialize project writes and keep revision tokens stable", async () => {
  const fixture = createFixture();
  try {
    const operations = createServerIoOperations({ root: fixture.root, projectStore: fixture.projectStore });
    const order = [];
    const first = operations.withProjectWrite("demo", async () => {
      order.push("first:start");
      await Promise.resolve();
      order.push("first:end");
      return "first";
    });
    const second = operations.withProjectWrite("demo", async () => {
      order.push("second:start");
      order.push("second:end");
      return "second";
    });
    assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
    assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);

    const revision = operations.projectDataRevision(fixture.project);
    assert.equal(revision, operations.projectDataRevision(fixture.project));
    fs.appendFileSync(fixture.paths.tuning, "changed\n");
    assert.notEqual(operations.projectDataRevision(fixture.project), revision);

    const workspaceDir = path.join(fixture.root, "workspace", "projects", "demo");
    const framePath = path.join(workspaceDir, "frames", "idle.png");
    fs.mkdirSync(path.dirname(framePath), { recursive: true });
    fs.writeFileSync(framePath, "png-a");
    fixture.paths.workspaceDir = workspaceDir;
    fs.writeFileSync(
      fixture.paths.manifest,
      JSON.stringify({
        schemaVersion: 1,
        profiles: [{ animations: [{ frames: [{ path: "workspace/projects/demo/frames/idle.png" }] }] }],
      }),
    );
    const withFrame = operations.projectDataRevision(fixture.project);
    fs.writeFileSync(framePath, "png-b");
    assert.notEqual(operations.projectDataRevision(fixture.project), withFrame);
  } finally {
    fixture.dispose();
  }
});

test("server I/O snapshots restore files and collect runtime project-id paths", async () => {
  const fixture = createFixture();
  try {
    const runtimeFile = path.join(fixture.projectRoot, "player.gd");
    const ignoredDir = path.join(fixture.projectRoot, ".godot");
    const ignoredFile = path.join(ignoredDir, "generated.gd");
    fs.mkdirSync(ignoredDir, { recursive: true });
    fs.writeFileSync(runtimeFile, 'const XSXB_PROJECT_ID: String = "old"\n');
    fs.writeFileSync(ignoredFile, 'const XSXB_PROJECT_ID: String = "ignored"\n');

    const operations = createServerIoOperations({ root: fixture.root, projectStore: fixture.projectStore });
    const transactionPaths = operations.saveTransactionPaths(fixture.project);
    assert.ok(transactionPaths.includes(runtimeFile));
    assert.ok(!transactionPaths.includes(ignoredFile));

    const target = path.join(fixture.root, "save-target.txt");
    fs.writeFileSync(target, "before\n");
    const snapshot = await operations.createFilesystemSnapshot([target]);
    fs.writeFileSync(target, "after\n");
    await snapshot.restore();
    assert.equal(fs.readFileSync(target, "utf8"), "before\n");
    await snapshot.dispose();
    await snapshot.dispose();
  } finally {
    fixture.dispose();
  }
});
