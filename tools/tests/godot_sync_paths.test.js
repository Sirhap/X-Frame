"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  GODOT_SYNC_ROOT,
  invalidateGodotImport,
  localFrameRelPath,
  syncFrameAudio,
  syncManifest,
} = require("../godot_sync");
const { createProjectStore } = require("../project_store");

test("localFrameRelPath keeps Godot copies inside x_frame/", () => {
  assert.equal(GODOT_SYNC_ROOT, "x_frame");
  assert.equal(localFrameRelPath("x_frame/../art/hero.png"), `${GODOT_SYNC_ROOT}/hero.png`);
  assert.equal(
    localFrameRelPath("workspace/projects/demo/a.png"),
    `${GODOT_SYNC_ROOT}/workspace/projects/demo/a.png`,
  );
  assert.ok(localFrameRelPath("x_frame/assets/a.png").startsWith(`${GODOT_SYNC_ROOT}/`));
  assert.ok(!localFrameRelPath("x_frame/../art/hero.png").includes(".."));
});

test("syncManifest does not write escaped frame paths outside the sandbox", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-sync-sandbox-"));
  const godotRoot = path.join(root, "godot");
  const artDir = path.join(godotRoot, "art");
  fs.mkdirSync(artDir, { recursive: true });
  fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Sync"\n');
  const victim = path.join(artDir, "hero.png");
  fs.writeFileSync(victim, "original");
  const store = createProjectStore(root);
  store.addProject({ id: "sync", label: "Sync", projectRoot: godotRoot });
  const project = store.resolveProject(store.readRegistry(), "sync");
  const source = path.join(root, "workspace/projects/sync/assets/frame.png");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, "frame-bytes");
  store.writeJson(store.projectPaths(project).manifest, {
    schemaVersion: 1,
    profiles: [
      {
        id: "hero",
        animations: [
          {
            id: "idle",
            frames: [{ path: "x_frame/../art/hero.png", name: "hero.png" }],
          },
        ],
      },
    ],
  });
  try {
    syncManifest(root, store, project);
    assert.equal(fs.readFileSync(victim, "utf8"), "original");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("frame audio sync keeps two same-frame bindings as distinct files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-sync-audio-"));
  try {
    const godotRoot = path.join(root, "godot");
    fs.mkdirSync(godotRoot, { recursive: true });
    fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Audio"\n');
    const store = createProjectStore(root);
    store.addProject({ id: "audio", label: "Audio", projectRoot: godotRoot });
    const project = store.resolveProject(store.readRegistry(), "audio");
    const wavA = Buffer.from("RIFF____WAVEfmt a");
    const wavB = Buffer.from("RIFF____WAVEfmt b");
    const result = syncFrameAudio(store, project, [
      {
        id: "hit-a",
        key: "hero/attack:0",
        type: "audio/wav",
        data: `data:audio/wav;base64,${wavA.toString("base64")}`,
      },
      {
        id: "hit-b",
        key: "hero/attack:0",
        type: "audio/wav",
        data: `data:audio/webm;codecs=opus;base64,${wavB.toString("base64")}`,
      },
    ]);
    assert.equal(result.copiedAudio, 2);
    const audioDir = path.join(godotRoot, "x_frame", "audio", "projects", "audio");
    const files = fs.readdirSync(audioDir);
    assert.equal(files.length, 2);
    assert.notEqual(files[0], files[1]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("frame audio sync removes Godot copies that are no longer referenced", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-sync-audio-prune-"));
  try {
    const godotRoot = path.join(root, "godot");
    fs.mkdirSync(godotRoot, { recursive: true });
    fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Audio"\n');
    const store = createProjectStore(root);
    store.addProject({ id: "audio", label: "Audio", projectRoot: godotRoot });
    const project = store.resolveProject(store.readRegistry(), "audio");
    const first = Buffer.from("RIFF____WAVEfmt old");
    const second = Buffer.from("RIFF____WAVEfmt new");
    syncFrameAudio(store, project, [
      {
        id: "hit",
        key: "hero/attack:0",
        type: "audio/wav",
        data: `data:audio/wav;base64,${first.toString("base64")}`,
      },
    ]);
    const audioDir = path.join(godotRoot, "x_frame", "audio", "projects", "audio");
    const firstFiles = fs.readdirSync(audioDir);
    assert.equal(firstFiles.length, 1);
    syncFrameAudio(store, project, [
      {
        id: "hit",
        key: "hero/attack:0",
        type: "audio/wav",
        data: `data:audio/wav;base64,${second.toString("base64")}`,
      },
    ]);
    const secondFiles = fs.readdirSync(audioDir);
    assert.equal(secondFiles.length, 1);
    assert.notEqual(secondFiles[0], firstFiles[0]);
    assert.equal(fs.existsSync(path.join(audioDir, firstFiles[0])), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalidateGodotImport drops a stale imported ctex after the PNG changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-sync-import-"));
  try {
    const crypto = require("node:crypto");
    const pngPath = path.join(root, "x_frame/assets/frame.png");
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    fs.writeFileSync(pngPath, "new-png-bytes");
    const destRel = ".godot/imported/frame.png-abc.ctex";
    const dest = path.join(root, destRel);
    const md5Path = dest.replace(/\.ctex$/, ".md5");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "old-ctex");
    fs.writeFileSync(md5Path, 'source_md5="deadbeef"\ndest_md5="00"\n');
    fs.writeFileSync(
      `${pngPath}.import`,
      `[remap]\npath="res://${destRel}"\n\n[deps]\ndest_files=["res://${destRel}"]\n`,
    );
    assert.equal(invalidateGodotImport(root, pngPath), 2);
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(md5Path), false);

    fs.writeFileSync(dest, "fresh-ctex");
    const current = crypto.createHash("md5").update("new-png-bytes").digest("hex");
    fs.writeFileSync(md5Path, `source_md5="${current}"\ndest_md5="11"\n`);
    assert.equal(invalidateGodotImport(root, pngPath), 0);
    assert.equal(fs.existsSync(dest), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
