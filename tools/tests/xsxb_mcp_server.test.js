"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PassThrough } = require("node:stream");
const { createProjectStore } = require("../project_store");
const { handleMessage, startServer } = require("../xsxb_mcp_server");
const {
  MCP_TOOL_NAMES,
  createTestWav,
  createXsxbMcpService,
  toolDefinitions,
} = require("../xsxb_mcp_service");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XkM0WQAAAABJRU5ErkJggg==",
  "base64",
);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-test-"));
  const godotRoot = path.join(root, "godot");
  fs.mkdirSync(godotRoot, { recursive: true });
  fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="MCP Test"\n');
  const presetPath = path.join(
    root,
    "tools/animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
  );
  fs.mkdirSync(path.dirname(presetPath), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, "../animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png"),
    presetPath,
  );
  const store = createProjectStore(root);
  store.addProject({ id: "mcp-test", label: "MCP Test", projectRoot: godotRoot });
  const video = path.join(root, "source.mp4");
  fs.writeFileSync(video, "test-video-placeholder");
  const extractVideoFramesImpl = async (_videoPath, outputDirectory) => {
    return Array.from({ length: 3 }, (_, index) => {
      const framePath = path.join(outputDirectory, `frame_${String(index + 1).padStart(6, "0")}.png`);
      fs.writeFileSync(framePath, ONE_PIXEL_PNG);
      return framePath;
    });
  };
  return {
    root,
    godotRoot,
    video,
    service: createXsxbMcpService({ root, extractVideoFramesImpl }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("MCP tool catalog exposes the required XSXB tools in the requested order", () => {
  assert.deepEqual(
    toolDefinitions().map((tool) => tool.name),
    MCP_TOOL_NAMES,
  );
  for (const tool of toolDefinitions()) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(typeof tool.description, "string");
  }
});

test("MCP transport initializes, lists tools, and returns structured tool results", async () => {
  const service = { tools: toolDefinitions(), call: async () => ({ ok: true, value: 42 }) };
  const initialized = await handleMessage(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    service,
  );
  assert.equal(initialized.result.serverInfo.name, "xsxb-frame-tuner");
  const listed = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, service);
  assert.equal(listed.result.tools.length, MCP_TOOL_NAMES.length);
  const called = await handleMessage(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "xsxb_list_projects" } },
    service,
  );
  assert.deepEqual(called.result.structuredContent, { ok: true, value: 42 });
  assert.equal(called.result.isError, false);
});

test("STDIO server accepts newline-delimited JSON-RPC", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += chunk.toString();
  });
  const lines = startServer({
    input,
    output,
    service: { tools: toolDefinitions(), call: async () => ({ projects: [] }) },
  });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  lines.close();
  const response = JSON.parse(text.trim());
  assert.equal(response.id, 1);
  assert.equal(response.result.tools.length, MCP_TOOL_NAMES.length);
});

test("XSXB MCP service executes the complete mutation workflow", async () => {
  const current = fixture();
  try {
    const projects = await current.service.call("xsxb_list_projects");
    assert.equal(projects.count, 1);
    assert.equal(projects.projects[0].godotProjectValid, true);

    const imported = await current.service.call("xsxb_import_video", {
      file_path: current.video,
      fps: 12,
      sync: true,
      validate: true,
    });
    assert.equal(imported.importedFrameCount, 3);
    assert.equal(imported.sync.ok, true);
    assert.equal(imported.validation.ok, true, imported.validation.errors.join("\n"));

    const animation = await current.service.call("xsxb_get_animation");
    assert.equal(animation.frameCount, 3);
    assert.equal(animation.generatedFrameCount, 3);
    assert.equal(animation.allFramesGenerated, true);

    const trail = await current.service.call("xsxb_add_attack_trail");
    assert.equal(trail.segment.sticks.length, 2);
    assert.equal(trail.sync.ok, true);

    const attachment = await current.service.call("xsxb_add_attachment");
    assert.equal(attachment.binding.key, "mcp_imports/source:0");
    assert.equal(attachment.sync.imageAttachmentCount, 1);

    const sfx = await current.service.call("xsxb_add_sfx");
    assert.equal(sfx.binding.type, "audio/wav");
    assert.equal(sfx.sync.audioCount, 1);

    const reorganized = await current.service.call("xsxb_reorganize_frames");
    assert.equal(reorganized.outputFrameCount, 3);
    assert.equal(reorganized.identityOrder, true);

    const validation = await current.service.call("xsxb_validate_project");
    assert.equal(validation.ok, true, validation.errors.join("\n"));
    assert.equal(validation.summary.frames, 3);
    assert.equal(validation.summary.frameAudioBindings, 1);
    assert.equal(validation.summary.frameImageAttachments, 1);
    assert.equal(validation.summary.attackTrailSegments, 1);
  } finally {
    current.cleanup();
  }
});

test("generated MCP test WAV has a valid PCM RIFF header", () => {
  const wav = createTestWav();
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.length, wav.readUInt32LE(4) + 8);
});

test("MCP catalog includes the production editing tools", () => {
  for (const name of [
    "xsxb_import_animation",
    "xsxb_update_frame_boxes",
    "xsxb_update_timing",
    "xsxb_sync_godot",
    "xsxb_get_project",
    "xsxb_delete_animation",
  ]) {
    assert.ok(MCP_TOOL_NAMES.includes(name), name);
  }
  assert.ok(MCP_TOOL_NAMES.includes("xsxb_import_video"));
});

test("XSXB MCP service completes the production editing loop", async () => {
  const current = fixture();
  try {
    const sequenceDir = path.join(current.root, "png-sequence");
    fs.mkdirSync(sequenceDir, { recursive: true });
    fs.writeFileSync(path.join(sequenceDir, "walk_02.png"), ONE_PIXEL_PNG);
    fs.writeFileSync(path.join(sequenceDir, "walk_01.png"), ONE_PIXEL_PNG);

    const imported = await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "walk",
      fps: 10,
    });
    assert.equal(imported.source, "png_sequence");
    assert.equal(imported.importedFrameCount, 2);
    assert.equal(imported.animationId, "walk");
    assert.equal(imported.sync.requested, false);

    const videoAlias = await current.service.call("xsxb_import_animation", {
      source: "video",
      file_path: current.video,
      animation_id: "clip",
      fps: 12,
    });
    assert.equal(videoAlias.source, "video");
    assert.equal(videoAlias.importedFrameCount, 3);

    const spriteDir = path.join(current.godotRoot, "sprites");
    fs.mkdirSync(spriteDir, { recursive: true });
    fs.writeFileSync(path.join(spriteDir, "idle.png"), ONE_PIXEL_PNG);
    const tresPath = path.join(spriteDir, "hero.spriteframes.tres");
    fs.writeFileSync(
      tresPath,
      `[ext_resource type="Texture2D" path="res://sprites/idle.png" id="1_tex"]

[resource]
animations = [{
"frames": [{
"duration": 1.0,
"texture": ExtResource("1_tex")
}],
"loop": true,
"name": &"idle",
"speed": 8.0
}]
`,
    );
    const spriteImported = await current.service.call("xsxb_import_animation", {
      source: "spriteframes",
      file_path: tresPath,
    });
    assert.equal(spriteImported.source, "spriteframes");
    assert.ok(spriteImported.importedFrameCount >= 1);

    const boxes = await current.service.call("xsxb_update_frame_boxes", {
      animation_id: "walk",
      frame: 0,
      hurtbox: { enabled: true, offset: { x: 1, y: -8 }, size: { x: 16, y: 16 } },
      collisionbox: { enabled: true, size: { x: 12, y: 20 } },
      hitbox: { enabled: false, offset: { x: 4, y: -4 }, size: { x: 8, y: 8 } },
    });
    assert.equal(boxes.frame, 0);
    assert.equal(boxes.boxes.hurtbox.size.x, 16);
    assert.equal(boxes.boxes.collisionbox.offset.y, -10);
    assert.equal(boxes.sync.requested, false);

    const timing = await current.service.call("xsxb_update_timing", {
      animation_id: "walk",
      fps: 8,
      frame: 1,
      duration_ms: 250,
      disabled: false,
    });
    assert.equal(timing.fps, 8);
    assert.equal(timing.playback.durationMs, 250);
    assert.equal(timing.sync.requested, false);

    const project = await current.service.call("xsxb_get_project");
    assert.equal(project.projectId, "mcp-test");
    assert.equal(project.godotProjectValid, true);
    assert.ok(project.animations.some((entry) => entry.id === "walk" && entry.frameCount === 2));
    assert.ok(project.animations.some((entry) => entry.id === "clip"));

    const preview = await current.service.call("xsxb_delete_animation", {
      animation_id: "clip",
      dry_run: true,
    });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.deleted, false);
    assert.equal(preview.removedFrames, 3);
    const stillThere = await current.service.call("xsxb_get_animation", { animation_id: "clip" });
    assert.equal(stillThere.frameCount, 3);

    const removed = await current.service.call("xsxb_delete_animation", { animation_id: "clip" });
    assert.equal(removed.deleted, true);
    assert.equal(removed.removedFrames, 3);
    await assert.rejects(
      () => current.service.call("xsxb_get_animation", { animation_id: "clip" }),
      /not found/i,
    );

    const synced = await current.service.call("xsxb_sync_godot");
    assert.equal(synced.ok, true);
    assert.equal(synced.requested, true);
    const afterSync = await current.service.call("xsxb_get_project");
    assert.equal(afterSync.animationCount, project.animationCount - 1);
  } finally {
    current.cleanup();
  }
});
