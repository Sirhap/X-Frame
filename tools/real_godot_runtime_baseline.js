#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { spawnSync } = require("node:child_process");
const { createProjectStore } = require("./project_store");
const { syncGodotProject } = require("./godot_sync");
const { estimateInitialCharacterScale } = require("./import_scale");

const ROOT = path.resolve(process.env.XSXB_PERF_WORKSPACE_ROOT || path.resolve(__dirname, ".."));
const PROJECT_ID = String(process.env.XSXB_PERF_PROJECT_ID || "Goblin_Run_Test");
const GODOT_EXECUTABLE = process.env.GODOT_EXECUTABLE || "/opt/homebrew/bin/godot";
const PROBE_FRAME_COUNT = 360;

/**
 * Writes the minimal Godot project files needed to run the generated actor with real synced frames.
 * @param {string} projectRoot Temporary Godot project root.
 * @returns {void}
 */
function writeProbeProject(projectRoot) {
  fs.writeFileSync(
    path.join(projectRoot, "project.godot"),
    [
      "; Engine configuration file.",
      "; Generated only for real-asset runtime benchmarking.",
      "config_version=5",
      "",
      "[application]",
      'config/name="XSXB Runtime Real Asset Baseline"',
      'run/main_scene="res://runtime_probe.tscn"',
      "",
      "[display]",
      "window/size/viewport_height=720",
      "",
      "[rendering]",
      'renderer/rendering_method="gl_compatibility"',
      'renderer/rendering_method.mobile="gl_compatibility"',
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(projectRoot, "actor_scale_reference.gd"),
    [
      "extends Node2D",
      "var collider: RectangleShape2D = RectangleShape2D.new()",
      "",
      "func _ready() -> void:",
      "\tcollider.size = Vector2(48, 128)",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(projectRoot, "runtime_probe.gd"),
    [
      "extends Node2D",
      `const PROBE_FRAME_COUNT: int = ${PROBE_FRAME_COUNT}`,
      "var _started_at_usec: int = 0",
      "var _frame_count: int = 0",
      "",
      "func _ready() -> void:",
      "\t_started_at_usec = Time.get_ticks_usec()",
      "",
      "func _process(_delta: float) -> void:",
      "\t_frame_count += 1",
      "\tif _frame_count < PROBE_FRAME_COUNT:",
      "\t\treturn",
      "\tvar elapsed_usec: int = Time.get_ticks_usec() - _started_at_usec",
      '\tprint("XSXB_RUNTIME_PROBE frames=%d elapsed_usec=%d" % [_frame_count, elapsed_usec])',
      "\tget_tree().quit()",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(projectRoot, "runtime_probe.tscn"),
    [
      "[gd_scene load_steps=3 format=3]",
      "",
      '[ext_resource type="Script" path="res://runtime_probe.gd" id="1_probe"]',
      '[ext_resource type="PackedScene" path="res://xsxb_frame_tuner/runtime/xsxb_frame_actor.tscn" id="2_actor"]',
      "",
      '[node name="RuntimeProbe" type="Node2D"]',
      'script = ExtResource("1_probe")',
      "",
      '[node name="XSXBFrameActor" parent="." instance=ExtResource("2_actor")]',
      "",
    ].join("\n"),
  );
}

/**
 * Builds import-scale samples directly from the real project manifest.
 * @param {object} manifest Persisted project animation manifest.
 * @returns {Array<{filePath:string,animationId:string,animationName:string}>}
 */
function realFrameSamples(manifest) {
  const samples = [];
  for (const profile of manifest?.profiles || []) {
    for (const animation of profile?.animations || []) {
      for (const frame of animation?.frames || []) {
        const relativePath = String(frame?.path || "");
        if (!relativePath) continue;
        samples.push({
          filePath: path.resolve(ROOT, relativePath),
          animationId: String(animation.id || ""),
          animationName: String(animation.name || ""),
        });
      }
    }
  }
  return samples;
}

/**
 * Parses the benchmark marker emitted by the temporary Godot scene.
 * @param {string} output Godot stdout and stderr.
 * @returns {{frames:number,elapsedMs:number}}
 */
function parseProbeOutput(output) {
  const match = /XSXB_RUNTIME_PROBE frames=(\d+) elapsed_usec=(\d+)/.exec(output);
  if (!match) throw new Error(`Godot runtime probe did not finish:\n${output}`);
  return {
    frames: Number(match[1]),
    elapsedMs: Number((Number(match[2]) / 1000).toFixed(2)),
  };
}

/**
 * Runs the generated Godot runtime against the real Goblin manifest and image corpus.
 * This is a real-material smoke benchmark, not a replacement for a user gameplay scene.
 * @returns {{kind:string,sourceFrames:number,processMs:number,probeFrames:number,probeElapsedMs:number,importScale:object}}
 */
function runRealGodotRuntimeBaseline() {
  if (!fs.existsSync(GODOT_EXECUTABLE))
    throw new Error(`Godot executable is unavailable: ${GODOT_EXECUTABLE}`);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-real-godot-runtime-"));
  try {
    writeProbeProject(temporaryRoot);
    const store = createProjectStore(ROOT);
    const project = store.resolveProject(store.readRegistry(), PROJECT_ID);
    if (!project) {
      throw new Error(
        `Missing real material project: ${PROJECT_ID}. Set XSXB_PERF_WORKSPACE_ROOT and XSXB_PERF_PROJECT_ID to a populated tuner workspace.`,
      );
    }
    const manifest = store.readJson(store.projectPaths(project).manifest, { profiles: [] });
    const scaleStartedAt = performance.now();
    const importScale = estimateInitialCharacterScale(temporaryRoot, realFrameSamples(manifest));
    importScale.elapsedMs = Number((performance.now() - scaleStartedAt).toFixed(2));
    const syncResult = syncGodotProject(ROOT, store, { ...project, projectRoot: temporaryRoot });
    if (!syncResult.ok || syncResult.frameCount < 1)
      throw new Error("Could not sync real frames into temporary Godot runtime.");
    const startedAt = performance.now();
    const result = spawnSync(
      GODOT_EXECUTABLE,
      ["--headless", "--path", temporaryRoot, "--editor", "--quit"],
      {
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Godot import failed.");
    const playback = spawnSync(GODOT_EXECUTABLE, ["--headless", "--path", temporaryRoot], {
      encoding: "utf8",
      timeout: 60_000,
    });
    if (playback.status !== 0) throw new Error(playback.stderr || playback.stdout || "Godot runtime failed.");
    const probe = parseProbeOutput(`${playback.stdout}\n${playback.stderr}`);
    return {
      kind: "synthetic-scene-real-assets",
      sourceFrames: syncResult.frameCount,
      processMs: Number((performance.now() - startedAt).toFixed(2)),
      probeFrames: probe.frames,
      probeElapsedMs: probe.elapsedMs,
      importScale,
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

/**
 * Executes the CLI and prints a portable JSON report.
 * @returns {void}
 */
function main() {
  const unsupported = process.argv.slice(2).find((argument) => argument !== "--json");
  if (unsupported) throw new Error(`Unknown argument: ${unsupported}`);
  process.stdout.write(`${JSON.stringify(runRealGodotRuntimeBaseline(), null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Real Godot runtime benchmark failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseProbeOutput, realFrameSamples, runRealGodotRuntimeBaseline };
