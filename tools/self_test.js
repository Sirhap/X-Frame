const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createOpaqueBoundsCache, opaqueBoundsForPng } = require("./box_estimator");
const { buildZip, crc32, toBytes } = require("./animation_tuner/public/batch_zip");
const {
  createAnimationReplacementPayload,
  createArchiveEntries,
  createOutput,
  uniquePngName,
} = require("./animation_tuner/public/batch_cutout_output_core");
const {
  createExecutor: createCutoutExecutor,
} = require("./animation_tuner/public/batch_cutout_worker_client");
const { runFrameOrganizerCoreTests } = require("./self_test_frame_organizer_core");
const { runCutoutCoreSelfTests } = require("./self_test_cutout_core");
const { createIntegrationTests } = require("./self_test_server_integration");
const { importAnimation, mirrorBoxes, remapBindings, remapIndexedDictionary } = require("./frame_organizer");
const { createProjectStore } = require("./project_store");
const { parseBatchArgs } = require("./import_batch");
const { runtimeScript } = require("./godot_runtime");
const { candidateSkillTargets, resolveSkillTarget, syncSkillDirectory, trustedRemote } = require("./updater");

runCutoutCoreSelfTests();

runFrameOrganizerCoreTests();

const indexedSource = {
  "hero/run:0": { offset: { x: 1 } },
  "hero/run:1": { offset: { x: 2 } },
  "hero/run:__group": { fps: 12 },
  "hero/idle:0": { offset: { x: 3 } },
};
const remappedIndexed = remapIndexedDictionary(indexedSource, "hero/run:", [
  { sourceIndex: 1 },
  { sourceIndex: 0 },
]);
assert.equal(remappedIndexed["hero/run:0"].offset.x, 2);
assert.equal(remappedIndexed["hero/run:1"].offset.x, 1);
assert.equal(remappedIndexed["hero/run:__group"].fps, 12);
assert.equal(remappedIndexed["hero/idle:0"].offset.x, 3);
assert.equal(mirrorBoxes({ hitbox: { offset: { x: 8, y: 2 }, rotation: 15 } }).hitbox.offset.x, -8);
const remappedAudio = remapBindings(
  [
    {
      key: "demo:player:hero:animation:hero/run:source:1",
      metadata: { profileId: "hero", animation: "hero/run", frame: 1, displayFrame: 1 },
      path: "res://hit.wav",
    },
  ],
  "hero/run",
  [{ sourceIndex: 1 }],
);
assert.equal(remappedAudio[0].metadata.frame, 0);
assert.match(remappedAudio[0].key, /:0$/);

const importTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-import-animation-test-"));
try {
  const importStore = createProjectStore(importTestRoot);
  const importRegistry = importStore.addProject({ label: "Browser Import" });
  const importProject = importStore.resolveProject(importRegistry, importRegistry.activeProjectId);
  const pixelPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3j2GJwAAAABJRU5ErkJggg==";
  const imported = importAnimation({
    root: importTestRoot,
    projectStore: importStore,
    project: importProject,
    profileId: "hero",
    profileLabel: "Hero",
    animationId: "idle",
    animationName: "Idle",
    fps: 12,
    items: [{ data: pixelPng, name: "idle.png" }],
  });
  assert.equal(imported.frameCount, 1);
  assert.equal(imported.manifest.profiles[0].animations[0].id, "idle");
  const importedFramePath = path.join(imported.targetDir, "frame_0001.png");
  assert.equal(fs.existsSync(importedFramePath), true);
  const boundsCache = createOpaqueBoundsCache();
  const firstBounds = opaqueBoundsForPng(importedFramePath, boundsCache);
  const secondBounds = opaqueBoundsForPng(importedFramePath, boundsCache);
  assert.equal(firstBounds, secondBounds);
  assert.throws(
    () =>
      importAnimation({
        root: importTestRoot,
        projectStore: importStore,
        project: importProject,
        profileId: "hero",
        animationId: "idle",
        items: [{ data: pixelPng }],
      }),
    /already exists/,
  );
} finally {
  fs.rmSync(importTestRoot, { recursive: true, force: true });
}

const corruptJsonTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-corrupt-json-test-"));
try {
  const corruptStore = createProjectStore(corruptJsonTestRoot);
  const corruptPath = path.join(corruptJsonTestRoot, "broken.json");
  fs.writeFileSync(corruptPath, '{"broken":', "utf8");
  assert.throws(() => corruptStore.readJson(corruptPath, {}), /Invalid JSON/);
  const backups = fs
    .readdirSync(corruptJsonTestRoot)
    .filter((name) => name.startsWith("broken.json.corrupt-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(corruptJsonTestRoot, backups[0]), "utf8"), '{"broken":');
} finally {
  fs.rmSync(corruptJsonTestRoot, { recursive: true, force: true });
}

const parsed = parseBatchArgs([
  "--project-root",
  "C:\\game",
  "--project",
  "demo",
  "--profile",
  "hero",
  "--fps",
  "12",
  "--replace",
  "--animation",
  "idle",
  "--source",
  "C:\\frames\\idle",
  "--animation",
  "站立攻击",
  "--source",
  "C:\\frames\\attack",
  "--fps",
  "18",
]);
assert.equal(parsed.globals.project, "demo");
assert.equal(parsed.globals.profile, "hero");
assert.equal(parsed.globals.replace, true);
assert.equal(parsed.entries.length, 2);
assert.equal(parsed.entries[0].animation, "idle");
assert.equal(parsed.entries[1].fps, "18");

const source = runtimeScript("demo");
assert.match(source, /frame_audio_bindings\.json/);
assert.match(source, /frame_image_attachments\.json/);
assert.match(source, /func animation_duration\(/);
assert.match(source, /func scene_scale\(/);
assert.match(source, /_character_scale\(\) \* scene_scale\(\)/);
assert.match(source, /size\.x\) \* sprite_scale_x/);
assert.match(source, /size\.y\) \* sprite_scale_y/);
assert.match(source, /func restart_frame_animation\(/);
assert.match(source, /var _last_visual_state_key: String = ""/);
assert.match(source, /func _visual_state_key\(/);
assert.match(source, /if visual_state_key == _last_visual_state_key:/);
assert.match(source, /func _sync_frame_image_attachment_layer\(/);
assert.match(source, /sprite\.visible = false/);
const playFrameAnimationSource = source.match(
  /func play_frame_animation\([\s\S]*?\n\nfunc restart_frame_animation\(/,
)?.[0];
assert.ok(playFrameAnimationSource);
assert.match(
  playFrameAnimationSource,
  /_frame_visit_serial \+= 1\n\t_record_entered_hitbox_snapshot\(\)\n\t_play_current_frame_audio\(\)\n\t_apply_frame_visual\(\)/,
);

assert.equal(trustedRemote("https://github.com/sparklecatta-lang/XSXB-Frame-Tuner.git"), true);
assert.equal(trustedRemote("git@github.com:sparklecatta-lang/XSXB-Frame-Tuner.git"), true);
assert.equal(trustedRemote("https://github.com/example/XSXB-Frame-Tuner.git"), false);
assert.equal(trustedRemote("https://evilgithub.com/sparklecatta-lang/XSXB-Frame-Tuner.git"), false);
const candidates = candidateSkillTargets({ USERPROFILE: "C:\\Users\\demo" }, "C:\\Users\\fallback");
assert.equal(candidates[0], path.resolve("C:\\Users\\demo", ".codex", "skills", "xsxb-frame-tuner"));
const customCandidates = candidateSkillTargets(
  { CODEX_HOME: "D:\\Codex", USERPROFILE: "C:\\Users\\demo" },
  "C:\\Users\\fallback",
);
assert.equal(customCandidates[0], path.resolve("D:\\Codex", "skills", "xsxb-frame-tuner"));
assert.equal(
  resolveSkillTarget({ CODEX_HOME: "D:\\Codex", USERPROFILE: "C:\\Users\\demo" }),
  customCandidates[0],
);

const updateTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-updater-test-"));
try {
  const skillSource = path.join(updateTestRoot, "source");
  const skillTarget = path.join(updateTestRoot, "target", "xsxb-frame-tuner");
  fs.mkdirSync(skillSource, { recursive: true });
  fs.mkdirSync(skillTarget, { recursive: true });
  fs.writeFileSync(path.join(skillSource, "SKILL.md"), "new skill\n", "utf8");
  fs.writeFileSync(path.join(skillSource, "reference.md"), "new reference\n", "utf8");
  fs.writeFileSync(path.join(skillTarget, "SKILL.md"), "old skill\n", "utf8");
  fs.writeFileSync(path.join(skillTarget, "stale.md"), "stale\n", "utf8");
  const synced = syncSkillDirectory(skillSource, skillTarget);
  assert.equal(synced.changed, true);
  assert.equal(fs.readFileSync(path.join(skillTarget, "SKILL.md"), "utf8"), "new skill\n");
  assert.equal(fs.existsSync(path.join(skillTarget, "reference.md")), true);
  assert.equal(fs.existsSync(path.join(skillTarget, "stale.md")), false);
} finally {
  fs.rmSync(updateTestRoot, { recursive: true, force: true });
}

assert.equal(crc32(new TextEncoder().encode("abc")), 0x352441c2);
const goldenPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3j2GJwAAAABJRU5ErkJggg==";
const { runAnimationReplacementIntegrationTests, runServerBoundaryTests } = createIntegrationTests({
  assert,
  createProjectStore,
  fetchImpl: fetch,
  fsApi: fs,
  goldenPngDataUrl,
  httpApi: http,
  osApi: os,
  pathApi: path,
  repositoryRoot: path.resolve(__dirname, ".."),
  spawnProcess: spawn,
});
const goldenOutputNames = new Map();
const goldenOutputs = Array.from({ length: 20 }, (_unused, index) =>
  createOutput({
    name: uniquePngName(index < 2 ? "frame.png" : `frame_${index + 1}.png`, goldenOutputNames),
    frame: { path: `frames/frame_${String(index + 1).padStart(4, "0")}.png` },
    data: goldenPngDataUrl,
    canvas: { corpusIndex: index },
  }),
);
assert.equal(goldenOutputs[0].name, "frame.png");
assert.equal(goldenOutputs[1].name, "frame_2.png");
assert.equal(Object.isFrozen(goldenOutputs[0]), true);
const collidingOutputNames = new Map();
assert.equal(uniquePngName("frame.png", collidingOutputNames), "frame.png");
assert.equal(uniquePngName("frame.png", collidingOutputNames), "frame_2.png");
assert.equal(uniquePngName("frame_2.png", collidingOutputNames), "frame_2_2.png");
assert.equal(uniquePngName("frame.png", collidingOutputNames), "frame_3.png");
const goldenManifestJson = JSON.stringify({ schemaVersion: 1, frames: goldenOutputs.length });
const goldenArchiveEntries = createArchiveEntries(goldenOutputs, goldenManifestJson);
const goldenReplacementPayload = createAnimationReplacementPayload(
  "golden-project",
  goldenOutputs.map((output) => output.frame),
  goldenOutputs,
);
assert.equal(goldenArchiveEntries.length, 21);
assert.equal(goldenReplacementPayload.files.length, 20);
for (let index = 0; index < goldenOutputs.length; index += 1) {
  assert.equal(goldenArchiveEntries[index].data, goldenOutputs[index].data);
  assert.equal(goldenReplacementPayload.files[index].data, goldenOutputs[index].data);
  assert.equal(goldenReplacementPayload.frames[index].path, goldenOutputs[index].frame.path);
}
assert.throws(
  () => createAnimationReplacementPayload("golden-project", [{ path: "one.png" }], []),
  /Expected 1 processed frames, received 0/,
);

/** Keeps Node alive and turns unresolved asynchronous self-tests into an explicit failure. */
const asyncSelfTestWatchdog = setTimeout(() => {
  console.error("XSXB asynchronous self-tests timed out.");
  process.exitCode = 1;
}, 30_000);

buildZip(
  [
    { name: "frame_0001.png", data: new Uint8Array([1, 2, 3, 4]) },
    { name: "中文.png", data: new Uint8Array([5, 6, 7]) },
    { name: "cutout-manifest.json", data: '{"frames":2}' },
  ],
  { compress: false },
)
  .then(async (archive) => {
    const fallbackExecutor = createCutoutExecutor({
      WorkerConstructor: null,
      syncProcess(source) {
        return {
          data: new Uint8ClampedArray(source),
          automaticData: new Uint8ClampedArray(source),
          removedPixels: 0,
          partialPixels: 0,
        };
      },
    });
    const fallbackSource = Uint8ClampedArray.from([20, 40, 60, 255]);
    const fallbackResult = await fallbackExecutor.process(fallbackSource, 1, 1, {}, []);
    assert.deepEqual(fallbackResult.data, fallbackSource);
    assert.deepEqual(fallbackSource, Uint8ClampedArray.from([20, 40, 60, 255]));
    /** Worker fixture that keeps a tracked request pending until cancellation. */
    class PendingCutoutWorker {
      postMessage() {}

      terminate() {}
    }
    const cancellableExecutor = createCutoutExecutor({ WorkerConstructor: PendingCutoutWorker });
    const cancelledTask = cancellableExecutor.process(fallbackSource, 1, 1, {}, []);
    cancellableExecutor.cancelAll();
    await assert.rejects(cancelledTask, (error) => error?.name === "AbortError");
    const bytes = new Uint8Array(await archive.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(0, true), 0x04034b50);
    assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
    assert.equal(view.getUint16(bytes.length - 12, true), 3);
    const goldenArchive = await buildZip(goldenArchiveEntries, { compress: false });
    const goldenArchiveBytes = new Uint8Array(await goldenArchive.arrayBuffer());
    const goldenArchiveView = new DataView(
      goldenArchiveBytes.buffer,
      goldenArchiveBytes.byteOffset,
      goldenArchiveBytes.byteLength,
    );
    let localOffset = 0;
    for (let index = 0; index < goldenArchiveEntries.length; index += 1) {
      assert.equal(goldenArchiveView.getUint32(localOffset, true), 0x04034b50);
      const storedSize = goldenArchiveView.getUint32(localOffset + 18, true);
      const nameLength = goldenArchiveView.getUint16(localOffset + 26, true);
      const extraLength = goldenArchiveView.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + nameLength + extraLength;
      const storedBytes = goldenArchiveBytes.slice(dataOffset, dataOffset + storedSize);
      const expectedBytes = await toBytes(goldenArchiveEntries[index].data);
      assert.deepEqual([...storedBytes], [...expectedBytes]);
      localOffset = dataOffset + storedSize;
    }
    await runServerBoundaryTests();
    await runAnimationReplacementIntegrationTests();
    clearTimeout(asyncSelfTestWatchdog);
    console.log("XSXB self-tests passed.");
  })
  .catch((error) => {
    clearTimeout(asyncSelfTestWatchdog);
    console.error(error);
    process.exitCode = 1;
  });
