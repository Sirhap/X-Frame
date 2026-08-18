"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore } = require("../project_store");
const { encodePngRgba } = require("../xsxb_mcp_cutout");
const { createXsxbMcpService } = require("../xsxb_mcp_service");
const {
  estimateVisualScales,
  findMotionWindow,
  measureFrame,
  renderContactSheet,
} = require("../xsxb_mcp_visual_qa");

/**
 * Fills one RGBA pixel.
 * @param {Uint8ClampedArray} rgba Pixel buffer.
 * @param {number} width Image width.
 * @param {number} x Column.
 * @param {number} y Row.
 * @param {number[]} color RGBA color.
 * @returns {void}
 */
function setPixel(rgba, width, x, y, color) {
  rgba.set(color, (y * width + x) * 4);
}

/**
 * Builds a transparent canvas with an opaque block.
 * @param {number} canvas Edge length.
 * @param {number} bodyW Body width.
 * @param {number} bodyH Body height.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}} RGBA frame.
 */
function bodyFrame(canvas, bodyW, bodyH) {
  const rgba = new Uint8ClampedArray(canvas * canvas * 4);
  const left = Math.floor((canvas - bodyW) / 2);
  const top = canvas - bodyH - 1;
  for (let y = top; y < top + bodyH; y += 1) {
    for (let x = left; x < left + bodyW; x += 1) {
      setPixel(rgba, canvas, x, y, [210, 36, 42, 255]);
    }
  }
  return { data: rgba, width: canvas, height: canvas };
}

test("estimateVisualScales uses the median as native height and only boosts zoomed-out frames", () => {
  const estimated = estimateVisualScales([12, 20, 20, 20, 28], 20);
  assert.equal(estimated.nativeHeight, 20);
  assert.equal(estimated.targetHeight, 20);
  assert.equal(estimated.groupScale, 1);
  assert.equal(estimated.frames[0].reason, "zoom");
  assert.equal(estimated.frames[0].scale, 1.667);
  assert.equal(estimated.frames[1].reason, "group");
  assert.equal(estimated.frames[4].reason, "group", "taller VFX/pose keeps the group scale");
  assert.equal(estimated.frames[4].scale, 1);
});

test("estimateVisualScales matches a foreign target height", () => {
  const estimated = estimateVisualScales([40, 40, 40], 20);
  assert.equal(estimated.groupScale, 0.5);
  assert.ok(estimated.frames.every((frame) => frame.scale === 0.5));
});

test("findMotionWindow drops leading and trailing holds", () => {
  const series = [
    { opaque: 10, height: 8, cy: 10 },
    { opaque: 10, height: 8, cy: 10 },
    { opaque: 10, height: 8, cy: 10 },
    { opaque: 14, height: 9, cy: 8 },
    { opaque: 18, height: 11, cy: 6 },
    { opaque: 16, height: 10, cy: 7 },
    { opaque: 10, height: 8, cy: 10 },
    { opaque: 10, height: 8, cy: 10 },
  ];
  const found = findMotionWindow(series);
  assert.equal(found.start, 3);
  assert.equal(found.end, 5);
  assert.deepEqual(found.order, [3, 4, 5]);
});

test("measureFrame reports body height and leftover near-white", () => {
  const frame = bodyFrame(16, 4, 8);
  setPixel(frame.data, 16, 2, 2, [250, 250, 250, 255]);
  const metrics = measureFrame(frame.data, 16, 16);
  assert.equal(metrics.bodyHeight, 8);
  assert.equal(metrics.nearWhite, 1);
  assert.ok(metrics.opaque >= 32);
});

test("renderContactSheet places every source frame into a shared cell grid", () => {
  const sheet = renderContactSheet([bodyFrame(16, 4, 8), bodyFrame(16, 4, 8)], {
    cell: 8,
    pad: 2,
    columns: 2,
  });
  assert.equal(sheet.width, 2 * 8 + 3 * 2);
  assert.equal(sheet.height, 8 + 4);
  assert.equal(sheet.data.length, sheet.width * sheet.height * 4);
  assert.ok(sheet.data.some((value, index) => index % 4 === 3 && value > 16));
});

/**
 * Writes a standing body PNG.
 * @param {string} filePath Destination.
 * @param {number} canvas Edge length.
 * @param {number} bodyW Body width.
 * @param {number} bodyH Body height.
 * @returns {void}
 */
function writeBodyPng(filePath, canvas, bodyW, bodyH) {
  fs.writeFileSync(filePath, encodePngRgba(bodyFrame(canvas, bodyW, bodyH).data, canvas, canvas));
}

function serviceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-visual-"));
  const godotRoot = path.join(root, "godot");
  fs.mkdirSync(godotRoot, { recursive: true });
  fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="Visual"\n');
  const store = createProjectStore(root);
  store.addProject({ id: "visual", label: "Visual", projectRoot: godotRoot });
  return {
    root,
    service: createXsxbMcpService({ root }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("estimate_visual matches a reference animation and apply writes zoom-frame scales", async () => {
  const current = serviceFixture();
  try {
    const idleDir = path.join(current.root, "idle");
    const comboDir = path.join(current.root, "combo");
    fs.mkdirSync(idleDir);
    fs.mkdirSync(comboDir);
    writeBodyPng(path.join(idleDir, "01.png"), 16, 4, 12);
    writeBodyPng(path.join(idleDir, "02.png"), 16, 4, 12);
    writeBodyPng(path.join(comboDir, "01.png"), 16, 4, 6);
    writeBodyPng(path.join(comboDir, "02.png"), 16, 4, 12);
    writeBodyPng(path.join(comboDir, "03.png"), 16, 4, 12);
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: idleDir,
      animation_id: "idle",
    });
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: comboDir,
      animation_id: "combo",
    });
    await assert.rejects(
      current.service.call("xsxb_estimate_visual", { animation_id: "combo" }),
      /target_height or reference_animation_id/,
    );
    const estimated = await current.service.call("xsxb_estimate_visual", {
      animation_id: "combo",
      reference_animation_id: "idle",
      apply: true,
    });
    assert.equal(estimated.nativeHeight, 12);
    assert.equal(estimated.targetHeight, 12);
    assert.equal(estimated.groupScale, 1);
    assert.equal(estimated.frames[0].reason, "zoom");
    assert.equal(estimated.frames[0].scale, 2);
    assert.equal(estimated.frames[2].reason, "group");
    const readBack = await current.service.call("xsxb_get_animation", {
      animation_id: "combo",
      include: ["visual"],
    });
    assert.equal(readBack.visual.group.visual_size, 1);
    assert.equal(readBack.visual.frameOverrides["0"].visual_size, 2);
    assert.equal(readBack.visual.frameOverrides["2"], undefined);
  } finally {
    current.cleanup();
  }
});

test("find_motion trims leading and trailing rest holds", async () => {
  const current = serviceFixture();
  try {
    const directory = path.join(current.root, "jump");
    fs.mkdirSync(directory);
    for (let index = 1; index <= 3; index += 1) {
      writeBodyPng(path.join(directory, `${String(index).padStart(2, "0")}.png`), 16, 4, 8);
    }
    for (let index = 4; index <= 6; index += 1) {
      writeBodyPng(path.join(directory, `${String(index).padStart(2, "0")}.png`), 16, 4, 12);
    }
    for (let index = 7; index <= 8; index += 1) {
      writeBodyPng(path.join(directory, `${String(index).padStart(2, "0")}.png`), 16, 4, 8);
    }
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory,
      animation_id: "jump",
    });
    const found = await current.service.call("xsxb_find_motion", { animation_id: "jump" });
    assert.equal(found.start, 3);
    assert.equal(found.end, 5);
    assert.deepEqual(found.order, [3, 4, 5]);
    assert.equal(found.applied, false);
  } finally {
    current.cleanup();
  }
});

test("export_sheet writes a PNG inside the workspace and rejects escapes", async () => {
  const current = serviceFixture();
  try {
    const directory = path.join(current.root, "walk");
    fs.mkdirSync(directory);
    writeBodyPng(path.join(directory, "01.png"), 16, 4, 8);
    writeBodyPng(path.join(directory, "02.png"), 16, 4, 8);
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory,
      animation_id: "walk",
    });
    const exported = await current.service.call("xsxb_export_sheet", {
      animation_id: "walk",
      cell: 16,
      pad: 2,
      columns: 2,
    });
    assert.equal(exported.frameCount, 2);
    assert.equal(exported.width, 2 * 16 + 3 * 2);
    assert.ok(fs.existsSync(exported.outputPath));
    await assert.rejects(
      current.service.call("xsxb_export_sheet", {
        animation_id: "walk",
        output_path: "/tmp/outside.png",
      }),
      /must stay inside the XSXB workspace root/,
    );
    await assert.rejects(
      current.service.call("xsxb_export_sheet", {
        animation_id: "walk",
        output_path: "sheet.gif",
      }),
      /must end with \.png/,
    );
  } finally {
    current.cleanup();
  }
});

test("cutout receipts include body-height and near-white metrics", async () => {
  const current = serviceFixture();
  try {
    const directory = path.join(current.root, "green");
    fs.mkdirSync(directory);
    const width = 16;
    const height = 16;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([0, 255, 0, 255], offset);
    for (let y = 6; y <= 11; y += 1) {
      rgba.set([210, 36, 42, 255], (y * width + 7) * 4);
      rgba.set([210, 36, 42, 255], (y * width + 8) * 4);
    }
    rgba.set([250, 250, 250, 255], (2 * width + 2) * 4);
    fs.writeFileSync(path.join(directory, "01.png"), encodePngRgba(rgba, width, height));
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory,
      animation_id: "slash",
    });
    const cut = await current.service.call("xsxb_cutout", { animation_id: "slash" });
    assert.equal(cut.metrics.bodyHeight.median, 6);
    assert.ok(cut.metrics.frames[0].opaque >= 12);
    const silent = await current.service.call("xsxb_cutout", { animation_id: "slash", metrics: false });
    assert.equal(silent.metrics, undefined);
  } finally {
    current.cleanup();
  }
});
