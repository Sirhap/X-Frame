#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProjectStore } = require("./project_store");
const {
  MCP_TOOL_NAMES,
  createTestWav,
  createXsxbMcpService,
  toolDefinitions,
} = require("./xsxb_mcp_service");
const { decodePngRgba, encodePngRgba, subjectAnchor } = require("./xsxb_mcp_cutout");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XkM0WQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Creates an isolated tuner root and MCP service for one tool probe.
 * @returns {{root:string,godotRoot:string,service:object,cleanup:Function}} Fixture.
 */
function createFixture(serviceOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-usable-"));
  const godotRoot = path.join(root, "godot");
  fs.mkdirSync(godotRoot, { recursive: true });
  fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Usable"\n');
  const presetPath = path.join(
    root,
    "tools/animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
  );
  const realPreset = path.join(
    __dirname,
    "animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
  );
  fs.mkdirSync(path.dirname(presetPath), { recursive: true });
  if (fs.existsSync(realPreset)) fs.copyFileSync(realPreset, presetPath);
  else fs.writeFileSync(presetPath, ONE_PIXEL_PNG);
  createProjectStore(root).addProject({ id: "usable", label: "Usable", projectRoot: godotRoot });
  return {
    root,
    godotRoot,
    service: createXsxbMcpService({ root, ...serviceOptions }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Writes a two-frame PNG sequence and imports it.
 * @param {object} fixture Isolated fixture.
 * @param {string} animationId Animation id.
 * @returns {Promise<object>} Import receipt.
 */
async function importSequence(fixture, animationId) {
  const directory = path.join(fixture.root, `${animationId}-seq`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "01.png"), ONE_PIXEL_PNG);
  fs.writeFileSync(path.join(directory, "02.png"), ONE_PIXEL_PNG);
  return fixture.service.call("xsxb_import_animation", {
    source: "png_sequence",
    directory,
    animation_id: animationId,
    fps: 12,
  });
}

/**
 * Writes a green-screen PNG sequence for cutout probes.
 * @param {string} directory Output directory.
 * @returns {void}
 */
function writeGreenSequence(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const width = 16;
  const height = 16;
  const idle = new Uint8ClampedArray(width * height * 4);
  const hit = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < idle.length; offset += 4) {
    idle.set([0, 255, 0, 255], offset);
    hit.set([0, 255, 0, 255], offset);
  }
  for (let y = 6; y <= 11; y += 1) {
    idle.set([210, 36, 42, 255], (y * width + 7) * 4);
    idle.set([210, 36, 42, 255], (y * width + 8) * 4);
    hit.set([210, 36, 42, 255], (y * width + 7) * 4);
    hit.set([210, 36, 42, 255], (y * width + 8) * 4);
  }
  for (let x = 6; x <= 14; x += 1) hit.set([240, 250, 255, 255], (14 * width + x) * 4);
  fs.writeFileSync(path.join(directory, "idle.png"), encodePngRgba(idle, width, height));
  fs.writeFileSync(path.join(directory, "hit.png"), encodePngRgba(hit, width, height));
}

/**
 * Builds one lavfi MP4 when ffmpeg is on PATH.
 * @param {string} filePath Destination path.
 * @returns {{ok:boolean,error?:string}} Probe result.
 */
function writeTestVideo(filePath) {
  try {
    execFileSync(
      process.env.XSXB_FFMPEG || "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=green:s=32x32:r=3:d=1",
        "-pix_fmt",
        "yuv420p",
        filePath,
      ],
      { timeout: 20_000 },
    );
    return { ok: fs.existsSync(filePath) };
  } catch (error) {
    return { ok: false, error: error.stderr || error.message };
  }
}

/**
 * Records one tool verdict.
 * @param {string} tool Tool name.
 * @param {"ready"|"limited"|"stub"|"fail"} status Usability class.
 * @param {string} evidence What was observed.
 * @param {string} [gap] Remaining product gap.
 * @returns {object} Verdict.
 */
function verdict(tool, status, evidence, gap) {
  return { tool, status, evidence, gap: gap || "" };
}

/**
 * Runs one probe and converts thrown errors into a fail verdict.
 * @param {string} tool Tool name.
 * @param {Function} probe Async probe.
 * @returns {Promise<object>} Verdict.
 */
async function isolate(tool, probe, serviceOptions) {
  const fixture = createFixture(serviceOptions);
  try {
    return await probe(fixture);
  } catch (error) {
    return verdict(tool, "fail", error.message);
  } finally {
    fixture.cleanup();
  }
}

const PROBES = {
  async xsxb_list_projects(fixture) {
    const listed = await fixture.service.call("xsxb_list_projects");
    if (listed.count < 1 || listed.activeProjectId !== "usable") {
      return verdict("xsxb_list_projects", "fail", JSON.stringify(listed));
    }
    return verdict("xsxb_list_projects", "ready", `count=${listed.count} active=${listed.activeProjectId}`);
  },

  async xsxb_get_project(fixture) {
    const project = await fixture.service.call("xsxb_get_project", { project_id: "usable" });
    if (project.projectId !== "usable" || project.godotProjectValid !== true) {
      return verdict("xsxb_get_project", "fail", JSON.stringify(project));
    }
    return verdict("xsxb_get_project", "ready", `godotValid=${project.godotProjectValid}`);
  },

  async xsxb_set_active_project(fixture) {
    const store = createProjectStore(fixture.root);
    store.addProject({ id: "other", label: "Other", projectRoot: "" });
    const activated = await fixture.service.call("xsxb_set_active_project", { project_id: "other" });
    const listed = await fixture.service.call("xsxb_list_projects");
    if (activated.activeProjectId !== "other" || listed.activeProjectId !== "other") {
      return verdict("xsxb_set_active_project", "fail", JSON.stringify({ activated, listed }));
    }
    return verdict("xsxb_set_active_project", "ready", "active project switches and persists");
  },

  async xsxb_bind_godot(fixture) {
    const store = createProjectStore(fixture.root);
    store.addProject({ id: "orphan", label: "Orphan", projectRoot: "" });
    const bound = await fixture.service.call("xsxb_bind_godot", {
      project_id: "orphan",
      project_root: fixture.godotRoot,
    });
    if (!bound.godotProjectValid || bound.projectId !== "orphan") {
      return verdict("xsxb_bind_godot", "fail", JSON.stringify(bound));
    }
    return verdict("xsxb_bind_godot", "ready", `bound ${bound.projectRoot}`);
  },

  async xsxb_import_animation(fixture) {
    const png = await importSequence(fixture, "walk");
    const spriteDir = path.join(fixture.godotRoot, "sprites");
    fs.mkdirSync(spriteDir, { recursive: true });
    fs.writeFileSync(path.join(spriteDir, "idle.png"), ONE_PIXEL_PNG);
    const tresPath = path.join(spriteDir, "hero.spriteframes.tres");
    fs.writeFileSync(
      tresPath,
      `[ext_resource type="Texture2D" path="res://sprites/idle.png" id="1_tex"]

[resource]
animations = [{
"frames": [{"duration": 1.0, "texture": ExtResource("1_tex")}],
"loop": true,
"name": &"idle",
"speed": 8.0
}]
`,
    );
    const sprite = await fixture.service.call("xsxb_import_animation", {
      source: "spriteframes",
      file_path: tresPath,
    });
    if (png.importedFrameCount !== 2 || sprite.importedFrameCount < 1) {
      return verdict("xsxb_import_animation", "fail", JSON.stringify({ png, sprite }));
    }
    return verdict(
      "xsxb_import_animation",
      "ready",
      `png=${png.importedFrameCount} spriteframes=${sprite.importedFrameCount}`,
    );
  },

  async xsxb_import_video(fixture) {
    const videoPath = path.join(fixture.root, "clip.mp4");
    const made = writeTestVideo(videoPath);
    if (!made.ok) {
      return verdict(
        "xsxb_import_video",
        "limited",
        "ffmpeg unavailable in this environment",
        made.error || "Cannot extract real video without ffmpeg",
      );
    }
    const imported = await fixture.service.call("xsxb_import_video", {
      file_path: videoPath,
      animation_id: "clip",
      fps: 12,
      start_frame: 0,
      end_frame: 1,
    });
    if (imported.importedFrameCount < 1) {
      return verdict("xsxb_import_video", "fail", JSON.stringify(imported));
    }
    return verdict(
      "xsxb_import_video",
      "ready",
      `imported=${imported.importedFrameCount} extracted=${imported.extractedFrameCount}`,
    );
  },

  async xsxb_get_animation(fixture) {
    await importSequence(fixture, "walk");
    const full = await fixture.service.call("xsxb_get_animation", { animation_id: "walk" });
    const summary = await fixture.service.call("xsxb_get_animation", {
      animation_id: "walk",
      frames: "summary",
    });
    if (full.animation.frames.length !== 2 || summary.summary !== true || summary.animation.frames) {
      return verdict("xsxb_get_animation", "fail", JSON.stringify({ summary, full }));
    }
    return verdict("xsxb_get_animation", "ready", "default full frames; summary on request");
  },

  async xsxb_update_frame_boxes(fixture) {
    await importSequence(fixture, "walk");
    const boxes = await fixture.service.call("xsxb_update_frame_boxes", {
      animation_id: "walk",
      frame: 0,
      hurtbox: { enabled: true, offset: { x: 1, y: -8 }, size: { x: 16, y: 16 } },
      collisionbox: { enabled: true, size: { x: 12, y: 20 } },
    });
    if (boxes.boxes.hurtbox.size.x !== 16 || boxes.sync.requested !== false) {
      return verdict("xsxb_update_frame_boxes", "fail", JSON.stringify(boxes));
    }
    return verdict("xsxb_update_frame_boxes", "ready", "writes boxes without implicit sync");
  },

  async xsxb_update_timing(fixture) {
    await importSequence(fixture, "walk");
    const timing = await fixture.service.call("xsxb_update_timing", {
      animation_id: "walk",
      fps: 8,
      frame: 1,
      duration_ms: 250,
    });
    if (timing.fps !== 8 || timing.playback.durationMs !== 250) {
      return verdict("xsxb_update_timing", "fail", JSON.stringify(timing));
    }
    return verdict("xsxb_update_timing", "ready", "fps and per-frame duration persist");
  },

  async xsxb_reorganize_frames(fixture) {
    await importSequence(fixture, "walk");
    const reversed = await fixture.service.call("xsxb_reorganize_frames", {
      animation_id: "walk",
      order: [1, 0],
      sync: false,
    });
    if (reversed.outputFrameCount !== 2 || reversed.identityOrder !== false) {
      return verdict("xsxb_reorganize_frames", "fail", JSON.stringify(reversed));
    }
    return verdict("xsxb_reorganize_frames", "ready", "reorder remaps frame-owned state");
  },

  async xsxb_delete_animation(fixture) {
    await importSequence(fixture, "walk");
    const preview = await fixture.service.call("xsxb_delete_animation", {
      animation_id: "walk",
      dry_run: true,
    });
    const still = await fixture.service.call("xsxb_get_animation", { animation_id: "walk" });
    const removed = await fixture.service.call("xsxb_delete_animation", { animation_id: "walk" });
    if (preview.deleted !== false || still.frameCount !== 2 || removed.deleted !== true) {
      return verdict("xsxb_delete_animation", "fail", JSON.stringify({ preview, still, removed }));
    }
    return verdict("xsxb_delete_animation", "ready", "dry_run then delete");
  },

  async xsxb_sync_godot(fixture) {
    await importSequence(fixture, "walk");
    const synced = await fixture.service.call("xsxb_sync_godot", { project_id: "usable" });
    if (synced.ok !== true || synced.requested !== true) {
      return verdict("xsxb_sync_godot", "fail", JSON.stringify(synced));
    }
    return verdict("xsxb_sync_godot", "ready", "syncs a bound Godot root");
  },

  async xsxb_validate_project(fixture) {
    await importSequence(fixture, "walk");
    const standalone = await fixture.service.call("xsxb_validate_project", { layer: "standalone" });
    if (!standalone.layers || !standalone.layers.standalone) {
      return verdict("xsxb_validate_project", "fail", JSON.stringify(standalone));
    }
    return verdict("xsxb_validate_project", "ready", `layer=${standalone.layer} ok=${standalone.ok}`);
  },

  async xsxb_cutout(fixture) {
    const directory = path.join(fixture.root, "green-seq");
    writeGreenSequence(directory);
    await fixture.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory,
      animation_id: "slash",
    });
    const cut = await fixture.service.call("xsxb_cutout", { animation_id: "slash" });
    const full = await fixture.service.call("xsxb_get_animation", {
      animation_id: "slash",
      frames: "full",
    });
    const idle = decodePngRgba(full.animation.frames[0].absolutePath);
    const hit = decodePngRgba(full.animation.frames[1].absolutePath);
    const idleFeet = subjectAnchor(idle.data, idle.width, idle.height);
    const hitFeet = subjectAnchor(hit.data, hit.width, hit.height);
    const again = await fixture.service.call("xsxb_cutout", {
      animation_id: "slash",
      protected_colors: ["#d2242a"],
    });
    if (
      cut.pipeline !== "smart_product" ||
      idle.data[3] > 16 ||
      idleFeet.feetY !== hitFeet.feetY ||
      again.skippedFrameCount !== 2
    ) {
      return verdict("xsxb_cutout", "fail", JSON.stringify({ cut, again, idleFeet, hitFeet }));
    }
    return verdict(
      "xsxb_cutout",
      "ready",
      `pipeline=${cut.pipeline} skipped=${again.skippedFrameCount} feet=${idleFeet.feetY}`,
    );
  },

  async xsxb_add_attack_trail(fixture) {
    await importSequence(fixture, "walk");
    const trail = await fixture.service.call("xsxb_add_attack_trail", {
      animation_id: "walk",
      id: "slash_arc",
      name: "Slash Arc",
      color: "#88ccff",
      start_frame: 0,
      end_frame: 1,
      sticks: [
        { frame: 0, top: { x: -10, y: -20 }, bottom: { x: 10, y: 4 } },
        { frame: 1, top: { x: 12, y: -18 }, bottom: { x: -8, y: 6 } },
      ],
      sync: false,
    });
    if (
      trail.segment?.id !== "slash_arc" ||
      trail.segment.color !== "#88ccff" ||
      trail.segment.sticks.length !== 2
    ) {
      return verdict("xsxb_add_attack_trail", "fail", JSON.stringify(trail));
    }
    return verdict(
      "xsxb_add_attack_trail",
      "ready",
      `id=${trail.segment.id} sticks=${trail.segment.sticks.length}`,
    );
  },

  async xsxb_add_attachment(fixture) {
    await importSequence(fixture, "walk");
    const filePath = path.join(fixture.root, "spark.png");
    fs.writeFileSync(filePath, ONE_PIXEL_PNG);
    const attachment = await fixture.service.call("xsxb_add_attachment", {
      animation_id: "walk",
      file_path: filePath,
      frame: 0,
      layer: "above",
      scale: 0.5,
      sync: false,
    });
    if (
      !String(attachment.binding?.path || "").includes("attachments") ||
      attachment.binding.name !== "spark.png"
    ) {
      return verdict("xsxb_add_attachment", "fail", JSON.stringify(attachment));
    }
    return verdict("xsxb_add_attachment", "ready", `path=${attachment.binding.path}`);
  },

  async xsxb_add_sfx(fixture) {
    await importSequence(fixture, "walk");
    const filePath = path.join(fixture.root, "hit.wav");
    fs.writeFileSync(filePath, createTestWav());
    const sfx = await fixture.service.call("xsxb_add_sfx", {
      animation_id: "walk",
      file_path: filePath,
      frame: 0,
      sync: false,
    });
    if (sfx.binding?.name !== "hit.wav" || sfx.binding.type !== "audio/wav" || !sfx.binding.path) {
      return verdict("xsxb_add_sfx", "fail", JSON.stringify(sfx));
    }
    return verdict("xsxb_add_sfx", "ready", `path=${sfx.binding.path}`);
  },
};

const OPEN_TUNER_OPTIONS = {
  probeTunerImpl: async () => false,
  launchTunerImpl: async () => ({ pid: 4242 }),
};

async function probeOpenTuner() {
  const fixture = createFixture(OPEN_TUNER_OPTIONS);
  try {
    await importSequence(fixture, "walk");
    const opened = await fixture.service.call("xsxb_open_tuner", { animation_id: "walk" });
    if (!opened.launched || opened.pid !== 4242 || !opened.url.includes("walk")) {
      return verdict("xsxb_open_tuner", "fail", JSON.stringify(opened));
    }
    return verdict("xsxb_open_tuner", "ready", `launched pid=${opened.pid} ${opened.url}`);
  } catch (error) {
    return verdict("xsxb_open_tuner", "fail", error.message);
  } finally {
    fixture.cleanup();
  }
}

/**
 * Audits every catalogued MCP tool in isolation.
 * @returns {Promise<{catalog:string[],missing:string[],results:object[],counts:object}>}
 */
async function runUsabilityAudit() {
  const catalog = toolDefinitions().map((tool) => tool.name);
  const missing = MCP_TOOL_NAMES.filter((name) => name !== "xsxb_open_tuner" && !PROBES[name]);
  const extra = catalog.filter((name) => !MCP_TOOL_NAMES.includes(name));
  const results = [];
  for (const name of MCP_TOOL_NAMES) {
    if (name === "xsxb_open_tuner") {
      results.push(await probeOpenTuner());
      continue;
    }
    const probe = PROBES[name];
    if (!probe) {
      results.push(verdict(name, "fail", "no isolated probe registered"));
      continue;
    }
    results.push(await isolate(name, probe));
  }
  const counts = { ready: 0, limited: 0, stub: 0, fail: 0 };
  for (const row of results) counts[row.status] += 1;
  return { catalog, missing, extra, results, counts };
}

/**
 * Formats the audit as a markdown table.
 * @param {object} audit Audit payload.
 * @returns {string} Markdown report.
 */
function formatReport(audit) {
  const lines = [
    "# XSXB MCP tool usability",
    "",
    `ready ${audit.counts.ready} · limited ${audit.counts.limited} · stub ${audit.counts.stub} · fail ${audit.counts.fail}`,
    "",
    "| Tool | Status | Evidence | Gap |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of audit.results) {
    lines.push(
      `| \`${row.tool}\` | ${row.status} | ${row.evidence.replace(/\|/g, "/")} | ${row.gap.replace(/\|/g, "/")} |`,
    );
  }
  if (audit.missing.length) lines.push("", `Unprobed catalog tools: ${audit.missing.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const audit = await runUsabilityAudit();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(audit));
  }
  process.exitCode = audit.counts.fail > 0 ? 1 : 0;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { formatReport, runUsabilityAudit };
