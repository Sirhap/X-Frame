"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore } = require("../project_store");
const { createXsxbMcpService } = require("../xsxb_mcp_service");
const { decodePngRgba, encodePngRgba } = require("../xsxb_mcp_cutout");
const { encodeGifWithFfmpeg } = require("../xsxb_mcp_processes");

const TRAIL_PRESET = path.join(
  __dirname,
  "../animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
);

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

/**
 * Builds a 64×64 cut frame: transparent field plus a red torso.
 * @returns {Buffer} Encoded PNG.
 */
function slashBodyPng() {
  const width = 64;
  const height = 64;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 20; y < 56; y += 1) {
    for (let x = 28; x < 36; x += 1) {
      rgba.set([200, 40, 40, 255], (y * width + x) * 4);
    }
  }
  return encodePngRgba(rgba, width, height);
}

/**
 * Counts gold-tint pixels that a solid #ffe082 trail mesh must produce.
 * @param {Uint8ClampedArray|Buffer} rgba Pixel buffer.
 * @returns {number} Matching pixels.
 */
function isGoldPixel(rgba, offset) {
  return (
    rgba[offset + 3] >= 32 &&
    rgba[offset] > 180 &&
    rgba[offset + 1] > 140 &&
    rgba[offset + 2] < 190 &&
    rgba[offset + 1] > rgba[offset + 2]
  );
}

function countGoldPixels(rgba) {
  let count = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (isGoldPixel(rgba, offset)) count += 1;
  }
  return count;
}

/**
 * Counts gold pixels inside a box. Used to prove a rotating slash leaves a
 * smear behind the blade instead of filling the whole pie.
 * @param {Uint8ClampedArray|Buffer} rgba Pixel buffer.
 * @param {number} width Image width.
 * @param {number} x0 Inclusive left.
 * @param {number} y0 Inclusive top.
 * @param {number} x1 Exclusive right.
 * @param {number} y1 Exclusive bottom.
 * @returns {number} Matching pixels.
 */
function countGoldInBox(rgba, width, x0, y0, x1, y1) {
  let count = 0;
  const height = rgba.length / 4 / width;
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 1) {
      if (isGoldPixel(rgba, (y * width + x) * 4)) count += 1;
    }
  }
  return count;
}

function fixture(serviceOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-media-"));
  const godotRoot = path.join(root, "godot");
  fs.mkdirSync(godotRoot, { recursive: true });
  fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Media"\n');
  const presetPath = path.join(
    root,
    "tools/animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
  );
  fs.mkdirSync(path.dirname(presetPath), { recursive: true });
  fs.copyFileSync(TRAIL_PRESET, presetPath);
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

/**
 * Imports a three-frame slash with a gold blade that translates across the canvas.
 * @param {object} [serviceOptions] Service overrides.
 * @returns {Promise<object>} Fixture plus animation id.
 */
async function importedSlash(serviceOptions = {}) {
  const current = fixture(serviceOptions);
  fs.writeFileSync(path.join(current.sequenceDir, "a.png"), slashBodyPng());
  fs.writeFileSync(path.join(current.sequenceDir, "b.png"), slashBodyPng());
  fs.writeFileSync(path.join(current.sequenceDir, "c.png"), slashBodyPng());
  await current.service.call("xsxb_import_animation", {
    source: "png_sequence",
    directory: current.sequenceDir,
    project_id: "media",
    animation_id: "slash",
  });
  await current.service.call("xsxb_add_attack_trail", {
    animation_id: "slash",
    id: "gold_cleave",
    color: "#ffe082",
    sticks: [
      { frame: 0, top: { x: -22, y: -40 }, bottom: { x: -22, y: -16 }, layer: "front" },
      { frame: 1, top: { x: 0, y: -48 }, bottom: { x: 0, y: -18 }, layer: "front" },
      { frame: 2, top: { x: 22, y: -40 }, bottom: { x: 22, y: -16 }, layer: "front" },
    ],
    sync: false,
  });
  return current;
}

async function importWalk(current) {
  await current.service.call("xsxb_import_animation", {
    source: "png_sequence",
    directory: current.sequenceDir,
    project_id: "media",
    animation_id: "walk",
  });
}

/**
 * Builds an easily compressible RGBA PNG so compress_frames has bytes to save.
 * @param {number} width Pixel width.
 * @param {number} height Pixel height.
 * @returns {Buffer} PNG bytes encoded at zlib level 0.
 */
function bulkyRgbaPng(width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba.set([offset % 250, 40, 200, offset % 5 === 0 ? 0 : 255], offset);
  }
  return encodePngRgba(rgba, width, height, { level: 0 });
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

test("compress_frames reencodes stored PNGs losslessly and dry_run does not write", async () => {
  const current = fixture();
  try {
    const bulky = bulkyRgbaPng(24, 16);
    fs.writeFileSync(path.join(current.sequenceDir, "a.png"), bulky);
    fs.writeFileSync(path.join(current.sequenceDir, "b.png"), bulky);
    await importWalk(current);
    const animation = await current.service.call("xsxb_get_animation", { animation_id: "walk" });
    const firstPath = animation.animation.frames[0].absolutePath;
    const sizeBefore = fs.statSync(firstPath).size;
    const preview = await current.service.call("xsxb_compress_frames", {
      animation_id: "walk",
      dry_run: true,
    });
    assert.equal(preview.dryRun, true);
    assert.ok(preview.savedBytes > 0);
    assert.equal(fs.statSync(firstPath).size, sizeBefore);
    const originalPixels = decodePngRgba(firstPath).data;
    const written = await current.service.call("xsxb_compress_frames", { animation_id: "walk" });
    assert.ok(written.rewritten >= 1);
    assert.ok(written.bytesAfter < written.bytesBefore);
    assert.deepEqual(
      Buffer.from(decodePngRgba(firstPath).data),
      Buffer.from(originalPixels),
      "pixels stay identical",
    );
    assert.ok(fs.statSync(firstPath).size < sizeBefore);
    const again = await current.service.call("xsxb_compress_frames", { animation_id: "walk" });
    assert.equal(again.rewritten, 0);
  } finally {
    current.cleanup();
  }
});

test("compress_frames start_frame/end_frame only rewrites the selected slice", async () => {
  const current = fixture();
  try {
    const bulky = bulkyRgbaPng(24, 16);
    fs.writeFileSync(path.join(current.sequenceDir, "a.png"), bulky);
    fs.writeFileSync(path.join(current.sequenceDir, "b.png"), bulky);
    await importWalk(current);
    const animation = await current.service.call("xsxb_get_animation", { animation_id: "walk" });
    const firstPath = animation.animation.frames[0].absolutePath;
    const secondPath = animation.animation.frames[1].absolutePath;
    const firstBefore = fs.statSync(firstPath).size;
    const secondBefore = fs.statSync(secondPath).size;
    const written = await current.service.call("xsxb_compress_frames", {
      animation_id: "walk",
      start_frame: 1,
      end_frame: 1,
    });
    assert.equal(written.frameCount, 1);
    assert.equal(written.frames[0].index, 1);
    assert.equal(fs.statSync(firstPath).size, firstBefore);
    assert.ok(fs.statSync(secondPath).size < secondBefore);
  } finally {
    current.cleanup();
  }
});

test("compress_frames names the first missing on-disk frame instead of succeeding", async () => {
  const current = fixture();
  try {
    const bulky = bulkyRgbaPng(24, 16);
    fs.writeFileSync(path.join(current.sequenceDir, "a.png"), bulky);
    fs.writeFileSync(path.join(current.sequenceDir, "b.png"), bulky);
    await importWalk(current);
    const animation = await current.service.call("xsxb_get_animation", { animation_id: "walk" });
    const secondPath = animation.animation.frames[1].absolutePath;
    fs.rmSync(secondPath);
    await assert.rejects(
      () => current.service.call("xsxb_compress_frames", { animation_id: "walk" }),
      /missing on-disk frame 1/,
    );
    assert.equal(fs.existsSync(animation.animation.frames[0].absolutePath), true);
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

test("export_gif bakes the attack-trail mesh into the encoded frames", async () => {
  let encodedGold = 0;
  const current = await importedSlash({
    encodeGifImpl: async (job) => {
      const last = decodePngRgba(job.framePaths[job.framePaths.length - 1]);
      encodedGold = countGoldPixels(last.data);
      fs.writeFileSync(job.outputPath, Buffer.from("GIF89a-fake"));
    },
  });
  try {
    const source = await current.service.call("xsxb_get_animation", {
      animation_id: "slash",
      frames: "full",
    });
    assert.equal(
      countGoldPixels(decodePngRgba(source.animation.frames[2].absolutePath).data),
      0,
      "source frames stay unbaked",
    );
    const exported = await current.service.call("xsxb_export_gif", { animation_id: "slash" });
    assert.equal(exported.bakedTrails, true);
    assert.deepEqual(exported.trailIds, ["gold_cleave"]);
    assert.ok(encodedGold > 40, `encoded last frame must show the gold mesh, got ${encodedGold} pixels`);
  } finally {
    current.cleanup();
  }
});

test("export_sheet bakes the attack-trail mesh into the contact sheet", async () => {
  const current = await importedSlash();
  try {
    const source = await current.service.call("xsxb_get_animation", {
      animation_id: "slash",
      frames: "full",
    });
    const lastSource = decodePngRgba(source.animation.frames[2].absolutePath);
    assert.equal(countGoldPixels(lastSource.data), 0, "source frames stay unbaked");

    const exported = await current.service.call("xsxb_export_sheet", {
      animation_id: "slash",
      cell: 64,
      pad: 4,
      columns: 3,
      grid: false,
    });
    assert.equal(exported.bakedTrails, true);
    assert.deepEqual(exported.trailIds, ["gold_cleave"]);
    const sheet = decodePngRgba(exported.outputPath);
    const gold = countGoldPixels(sheet.data);
    assert.ok(gold > 40, `sheet must show the gold mesh, got ${gold} pixels`);
  } finally {
    current.cleanup();
  }
});

test("export_gif paints a trailing smear behind a rotating blade", async () => {
  const goldByFrame = [];
  let startArcOnLast = 0;
  let midArcOnLast = 0;
  const current = fixture({
    encodeGifImpl: async (job) => {
      for (const filePath of job.framePaths) {
        const frame = decodePngRgba(filePath);
        goldByFrame.push(countGoldPixels(frame.data));
      }
      const last = decodePngRgba(job.framePaths[job.framePaths.length - 1]);
      // Start blade is vertical at (32, 6)–(32, 50). End blade is horizontal
      // through y=28. A 拖影 sits on the mid-arc behind the blade; a filled
      // pie still paints the start tip; a 4px edge paints only the new blade.
      // The mid-arc sample is the upper-right quadrant of that sweep, not a
      // 16×16 sliver that one rasterizer can miss by a pixel.
      startArcOnLast = countGoldInBox(last.data, last.width, 30, 4, 35, 10);
      midArcOnLast = countGoldInBox(last.data, last.width, 36, 8, 60, 32);
      fs.writeFileSync(job.outputPath, Buffer.from("GIF89a-fake"));
    },
  });
  try {
    fs.writeFileSync(path.join(current.sequenceDir, "a.png"), slashBodyPng());
    fs.writeFileSync(path.join(current.sequenceDir, "b.png"), slashBodyPng());
    fs.writeFileSync(path.join(current.sequenceDir, "c.png"), slashBodyPng());
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: current.sequenceDir,
      project_id: "media",
      animation_id: "spin",
    });
    const added = await current.service.call("xsxb_add_attack_trail", {
      animation_id: "spin",
      id: "spin_cleave",
      color: "#ffe082",
      sticks: [
        { frame: 0, top: { x: 0, y: -58 }, bottom: { x: 0, y: -14 }, layer: "front" },
        { frame: 2, top: { x: 22, y: -36 }, bottom: { x: -22, y: -36 }, layer: "front" },
      ],
      sync: false,
    });
    assert.equal(added.segment.sticks[0].framePhase, 0);
    assert.equal(added.segment.sticks[1].framePhase, 1);
    assert.ok(added.edgeTravel > 28, "receipt must report the tip sweep");
    await current.service.call("xsxb_export_gif", { animation_id: "spin" });
    const startGold = goldByFrame[0];
    const endGold = goldByFrame[2];
    assert.ok(startGold > 8, `start frame must already show the smear, got ${startGold}`);
    assert.ok(endGold > 20, `end frame must show the smear, got ${endGold}`);
    assert.ok(endGold > startGold, "the smear must grow toward the tip");
    assert.ok(midArcOnLast > 6, `last frame must paint the smear behind the blade, got ${midArcOnLast}`);
    // The collapsed tail is allowed to touch the origin as a point. Anything
    // wider means the ribbon never let go of where the swing started.
    assert.ok(startArcOnLast <= 4, `last frame must not hold on to the swing origin, got ${startArcOnLast}`);
  } finally {
    current.cleanup();
  }
});

test("encodeGifWithFfmpeg rejects missing durations instead of writing NaN", async () => {
  await assert.rejects(
    () =>
      encodeGifWithFfmpeg({
        framePaths: ["/tmp/a.png", "/tmp/b.png"],
        durations: [0.08],
        outputPath: "/tmp/out.gif",
        ffmpegBinary: "true",
      }),
    /GIF duration is missing for frame 2/,
  );
});
