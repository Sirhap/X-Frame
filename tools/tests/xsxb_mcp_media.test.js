"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore } = require("../project_store");
const { createXsxbMcpService } = require("../xsxb_mcp_service");
const { encodePngRgba } = require("../xsxb_mcp_cutout");

/**
 * Builds a square opaque PNG of one color.
 * @param {number} size Edge length in pixels.
 * @param {number[]} [color] RGBA color.
 * @returns {Buffer} Encoded PNG.
 */
function solidPng(size, color = [200, 40, 40, 255]) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(color, offset);
  return encodePngRgba(rgba, size, size);
}

/**
 * Builds an already-cut frame: transparent border, opaque interior.
 * @param {number} size Edge length in pixels.
 * @returns {Buffer} Encoded PNG.
 */
function cutBodyPng(size) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      rgba.set([210, 36, 42, 255], (y * size + x) * 4);
    }
  }
  return encodePngRgba(rgba, size, size);
}

function fixture(serviceOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-media-"));
  const godotRoot = path.join(root, "godot");
  fs.mkdirSync(godotRoot, { recursive: true });
  fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Media"\n');
  const store = createProjectStore(root);
  store.addProject({ id: "media", label: "Media", projectRoot: godotRoot });
  const sequenceDir = path.join(root, "seq");
  fs.mkdirSync(sequenceDir);
  fs.writeFileSync(path.join(sequenceDir, "a.png"), solidPng(16));
  fs.writeFileSync(path.join(sequenceDir, "b.png"), solidPng(16, [40, 200, 40, 255]));
  return {
    root,
    store,
    sequenceDir,
    workspaceDir: store.projectWorkspaceDir(store.readRegistry().projects[0]),
    service: createXsxbMcpService({ root, ...serviceOptions }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

async function importWalk(current) {
  await current.service.call("xsxb_import_animation", {
    source: "png_sequence",
    directory: current.sequenceDir,
    project_id: "media",
    animation_id: "walk",
  });
}

test("set_visual_transform writes character, group, and frame levels with clear support", async () => {
  const current = fixture();
  try {
    await importWalk(current);
    const character = await current.service.call("xsxb_set_visual_transform", {
      level: "character",
      visual_size: 0.25,
    });
    assert.equal(character.values["profiles.mcp_imports.character.visual_size"], 0.25);

    await current.service.call("xsxb_set_visual_transform", {
      level: "group",
      visual_size: 2,
      offset_x: 10,
      rotation: 0.5,
    });
    const partialOffset = await current.service.call("xsxb_set_visual_transform", {
      level: "group",
      offset_y: -3,
    });
    assert.equal(
      partialOffset.values["profiles.mcp_imports.groups.walk.offset"].x,
      10,
      "offset merge keeps the earlier x",
    );

    await current.service.call("xsxb_set_visual_transform", {
      level: "frame",
      frame: 1,
      visual_size: 1.5,
      offset_x: 2,
    });

    const readBack = await current.service.call("xsxb_get_animation", { include: ["visual"] });
    assert.equal(readBack.visual.character.visual_size, 0.25);
    assert.equal(readBack.visual.group.visual_size, 2);
    assert.deepEqual(readBack.visual.group.offset, { x: 10, y: -3 });
    assert.equal(readBack.visual.group.rotation, 0.5);
    assert.equal(readBack.visual.frameOverrides["1"].visual_size, 1.5);

    const cleared = await current.service.call("xsxb_set_visual_transform", {
      level: "group",
      clear: true,
    });
    assert.equal(cleared.cleared, true);
    const afterClear = await current.service.call("xsxb_get_animation", { include: ["visual"] });
    assert.equal(afterClear.visual.group.visual_size, undefined);
    assert.equal(afterClear.visual.character.visual_size, 0.25, "character level survives group clear");
    assert.equal(afterClear.visual.frameOverrides["1"].visual_size, 1.5, "frame level survives");

    await assert.rejects(
      current.service.call("xsxb_set_visual_transform", { level: "group" }),
      /at least one of visual_size/,
    );
    await assert.rejects(
      current.service.call("xsxb_set_visual_transform", { level: "frame", visual_size: 1 }),
      /frame is required/,
    );
    await assert.rejects(
      current.service.call("xsxb_set_visual_transform", { level: "group", visual_size: 0 }),
      /greater than 0/,
    );
  } finally {
    current.cleanup();
  }
});

test("replace_frame swaps the PNG, keeps tuning, and refreshes the stored size", async () => {
  const current = fixture();
  try {
    await importWalk(current);
    await current.service.call("xsxb_update_frame_boxes", {
      frame: 0,
      hurtbox: { size: { x: 7, y: 7 } },
    });
    const replacementPath = path.join(current.root, "new.png");
    fs.writeFileSync(replacementPath, solidPng(32, [0, 0, 255, 255]));

    const replaced = await current.service.call("xsxb_replace_frame", {
      frame: 0,
      file_path: replacementPath,
    });
    assert.equal(replaced.sizeChanged, true);
    assert.deepEqual(replaced.newSize, { width: 32, height: 32 });
    assert.ok(replaced.warnings.length, "size change carries a warning");

    const readBack = await current.service.call("xsxb_get_animation", { include: ["boxes"] });
    assert.equal(readBack.animation.frames[0].width, 32, "manifest size is refreshed");
    assert.equal(readBack.boxes["0"].hurtbox.size.x, 7, "box overrides survive replacement");
    const frameOnDisk = fs.readFileSync(readBack.animation.frames[0].absolutePath);
    assert.deepEqual(frameOnDisk, fs.readFileSync(replacementPath), "pixels are swapped");

    const samePath = path.join(current.root, "same.png");
    fs.writeFileSync(samePath, solidPng(32));
    const again = await current.service.call("xsxb_replace_frame", { frame: 0, file_path: samePath });
    assert.equal(again.sizeChanged, false);
    assert.equal(again.warnings.length, 0);

    fs.writeFileSync(path.join(current.root, "not-png.png"), "plain text");
    await assert.rejects(
      current.service.call("xsxb_replace_frame", {
        frame: 0,
        file_path: path.join(current.root, "not-png.png"),
      }),
      /valid PNG/,
    );
    await assert.rejects(
      current.service.call("xsxb_replace_frame", { frame: 99, file_path: replacementPath }),
      /Frame must be an integer/,
    );
  } finally {
    current.cleanup();
  }
});

test("export_gif honors timing, skips disabled frames, and validates the output path", async () => {
  const jobs = [];
  const current = fixture({
    encodeGifImpl: async (job) => {
      jobs.push(job);
      fs.writeFileSync(job.outputPath, Buffer.from("GIF89a-fake"));
    },
  });
  try {
    await importWalk(current);
    await current.service.call("xsxb_update_timing", {
      frames: [
        { frame: 0, duration_ms: 250 },
        { frame: 1, disabled: true },
      ],
    });

    const exported = await current.service.call("xsxb_export_gif", {});
    assert.equal(exported.frameCount, 1, "disabled frame is skipped");
    assert.equal(exported.skippedDisabledFrames, 1);
    assert.equal(exported.totalDurationMs, 250);
    assert.ok(exported.outputPath.includes(path.join("exports", "mcp_imports_walk.gif")));
    assert.ok(fs.existsSync(exported.outputPath));
    assert.equal(jobs[0].durations.length, 1);
    assert.equal(jobs[0].durations[0].toFixed(2), "0.25");

    const withDisabled = await current.service.call("xsxb_export_gif", { include_disabled: true });
    assert.equal(withDisabled.frameCount, 2);

    const customPath = path.join(current.root, "out", "preview.gif");
    const custom = await current.service.call("xsxb_export_gif", { output_path: customPath });
    assert.equal(custom.outputPath, customPath);
    assert.ok(fs.existsSync(customPath), "parent directory is created");

    // A relative output_path is anchored to the project workspace rather than
    // to whatever directory the server happens to be running in.
    const relative = await current.service.call("xsxb_export_gif", { output_path: "previews/walk.gif" });
    assert.equal(relative.outputPath, path.join(current.workspaceDir, "previews", "walk.gif"));

    await assert.rejects(
      current.service.call("xsxb_export_gif", { output_path: "/tmp/not-a-gif.png" }),
      /must end with \.gif/,
    );
    await assert.rejects(
      current.service.call("xsxb_export_gif", { start_frame: 1, end_frame: 0 }),
      /greater than or equal/,
    );
  } finally {
    current.cleanup();
  }
});

test("cutout apply_visual rematches from group and frame visual_size, not a shared scale", async () => {
  const current = fixture();
  try {
    fs.writeFileSync(path.join(current.sequenceDir, "a.png"), cutBodyPng(16));
    fs.writeFileSync(path.join(current.sequenceDir, "b.png"), cutBodyPng(16));
    await importWalk(current);
    await current.service.call("xsxb_set_visual_transform", { level: "group", visual_size: 0.5 });
    await current.service.call("xsxb_set_visual_transform", {
      level: "frame",
      frame: 1,
      visual_size: 1,
    });

    const cut = await current.service.call("xsxb_cutout", {
      output_width: 16,
      output_height: 16,
      apply_visual: true,
    });
    assert.equal(cut.rematchMode, "visual");
    assert.deepEqual(cut.frameScales, [0.5, 1]);

    const { decodePngRgba, subjectAnchor } = require("../xsxb_mcp_cutout");
    const readBack = await current.service.call("xsxb_get_animation", { frames: "full" });
    const first = decodePngRgba(readBack.animation.frames[0].absolutePath);
    const second = decodePngRgba(readBack.animation.frames[1].absolutePath);
    assert.equal(subjectAnchor(first.data, 16, 16).height, 7);
    assert.equal(subjectAnchor(second.data, 16, 16).height, 14);
    assert.equal(subjectAnchor(first.data, 16, 16).feetY, 15);
    assert.equal(subjectAnchor(second.data, 16, 16).feetY, 15);

    const visual = await current.service.call("xsxb_get_animation", { include: ["visual"] });
    assert.equal(visual.visual.group.visual_size, 1, "baked group scale is consumed");
    assert.equal(visual.visual.frameOverrides["1"], undefined, "baked frame scale is consumed");
  } finally {
    current.cleanup();
  }
});

test("export_gif rematches group and frame visual_size before encode", async () => {
  const jobs = [];
  const { decodePngRgba, subjectAnchor } = require("../xsxb_mcp_cutout");
  const current = fixture({
    encodeGifImpl: async (job) => {
      const first = decodePngRgba(job.framePaths[0]);
      jobs.push({
        ...job,
        firstHeight: subjectAnchor(first.data, first.width, first.height).height,
      });
      fs.writeFileSync(job.outputPath, Buffer.from("GIF89a-fake"));
    },
  });
  try {
    fs.writeFileSync(path.join(current.sequenceDir, "a.png"), cutBodyPng(16));
    fs.writeFileSync(path.join(current.sequenceDir, "b.png"), cutBodyPng(16));
    await importWalk(current);
    await current.service.call("xsxb_set_visual_transform", { level: "group", visual_size: 0.5 });
    const exported = await current.service.call("xsxb_export_gif", {});
    assert.equal(exported.appliedVisual, true);
    assert.deepEqual(exported.frameScales, [0.5, 0.5]);
    assert.equal(jobs[0].firstHeight, 7);
    const source = (await current.service.call("xsxb_get_animation")).animation.frames[0].absolutePath;
    assert.notEqual(jobs[0].framePaths[0], source);
  } finally {
    current.cleanup();
  }
});
