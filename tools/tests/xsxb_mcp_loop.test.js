"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore } = require("../project_store");
const { findLoopInPngFiles } = require("../xsxb_mcp_loop");
const { createXsxbMcpService } = require("../xsxb_mcp_service");
const { encodePngRgba } = require("../xsxb_mcp_cutout");

const PHASES = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
];

/**
 * Encodes an 8×8 opaque PNG of one color.
 * @param {number[]} color RGBA color.
 * @returns {Buffer} Encoded PNG.
 */
function solidPng(color) {
  const size = 8;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(color, offset);
  return encodePngRgba(rgba, size, size);
}

/**
 * Writes a repeating 3-phase PNG cycle.
 * @param {string} directory Output directory.
 * @param {number} [count=7] Frame count.
 * @returns {string[]} Written paths.
 */
function writeCycle(directory, count = 7) {
  fs.mkdirSync(directory, { recursive: true });
  return Array.from({ length: count }, (_, index) => {
    const filePath = path.join(directory, `${String(index + 1).padStart(2, "0")}.png`);
    fs.writeFileSync(filePath, solidPng(PHASES[index % PHASES.length]));
    return filePath;
  });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-loop-"));
  const godotRoot = path.join(root, "godot");
  fs.mkdirSync(godotRoot, { recursive: true });
  fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Loop"\n');
  createProjectStore(root).addProject({ id: "loop", label: "Loop", projectRoot: godotRoot });
  return {
    root,
    service: createXsxbMcpService({ root }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("findLoopInPngFiles ranks the same 3-frame period as the Tuner core", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-loop-core-"));
  try {
    const files = writeCycle(directory);
    const found = findLoopInPngFiles(files, { minPeriod: 2, maxPeriod: 4, sampleSize: 8 });
    assert.equal(found.frameCount, 7);
    assert.equal(found.recommended.period, 3);
    assert.deepEqual(
      found.recommended.order,
      Array.from(
        { length: found.recommended.end - found.recommended.start + 1 },
        (_, index) => found.recommended.start + index,
      ),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("xsxb_find_loop queries a PNG directory without importing", async () => {
  const current = fixture();
  try {
    const directory = path.join(current.root, "run-seq");
    writeCycle(directory);
    const found = await current.service.call("xsxb_find_loop", {
      directory,
      sample_size: 8,
      min_period: 2,
      max_period: 4,
    });
    assert.equal(found.source, "directory");
    assert.equal(found.applied, false);
    assert.equal(found.recommended.period, 3);
    assert.ok(Array.isArray(found.candidates) && found.candidates.length >= 1);
    assert.ok(found.recommended.order.length >= 2);
  } finally {
    current.cleanup();
  }
});

test("xsxb_find_loop queries an imported animation and honors start_frame", async () => {
  const current = fixture();
  try {
    const directory = path.join(current.root, "idle-seq");
    writeCycle(directory);
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory,
      animation_id: "idle",
      fps: 12,
    });
    const found = await current.service.call("xsxb_find_loop", {
      animation_id: "idle",
      sample_size: 8,
      min_period: 2,
      max_period: 4,
      start_frame: 3,
    });
    assert.equal(found.source, "animation");
    assert.equal(found.animationId, "idle");
    assert.ok(found.candidates.every((candidate) => candidate.start >= 3));
  } finally {
    current.cleanup();
  }
});

test("xsxb_find_loop prefers file_paths over an imported animation", async () => {
  const current = fixture();
  try {
    const imported = path.join(current.root, "imported");
    const queried = path.join(current.root, "queried");
    writeCycle(imported, 7);
    const files = writeCycle(queried, 7);
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: imported,
      animation_id: "walk",
    });
    const found = await current.service.call("xsxb_find_loop", {
      animation_id: "walk",
      file_paths: files,
      sample_size: 8,
    });
    assert.equal(found.source, "files");
    assert.equal(found.animationId, undefined);
    assert.equal(found.recommended.period, 3);
  } finally {
    current.cleanup();
  }
});

test("xsxb_find_loop rejects sequences shorter than four frames", async () => {
  const current = fixture();
  try {
    const directory = path.join(current.root, "short");
    writeCycle(directory, 3);
    await assert.rejects(
      () => current.service.call("xsxb_find_loop", { directory, sample_size: 8 }),
      /at least 4 PNG frames/u,
    );
  } finally {
    current.cleanup();
  }
});
