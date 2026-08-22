"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectStore } = require("../project_store");
const { decodePngRgba, encodePngRgba } = require("../xsxb_mcp_cutout");
const { createXsxbMcpService } = require("../xsxb_mcp_service");
const {
  DIGIT_GLYPHS,
  GROUP_GRID,
  INDEX_BADGE,
  MARK_BORDER,
  canvasToGroup,
  estimateVisualScales,
  findMotionWindow,
  groupToCanvas,
  measureFrame,
  measureLongAxis,
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
 * Reads one RGBA pixel from a sheet.
 * @param {{data:Uint8ClampedArray,width:number}} sheet Sheet buffer.
 * @param {number} x Column.
 * @param {number} y Row.
 * @returns {number[]} RGBA.
 */
function pixelAt(sheet, x, y) {
  const offset = (y * sheet.width + x) * 4;
  return [sheet.data[offset], sheet.data[offset + 1], sheet.data[offset + 2], sheet.data[offset + 3]];
}

test("renderContactSheet paints absolute frame indexes from the shared glyph table", () => {
  const sheet = renderContactSheet([bodyFrame(16, 4, 8), bodyFrame(16, 4, 8)], {
    cell: 32,
    pad: 4,
    columns: 2,
    startIndex: 7,
  });
  const originX = 4 + INDEX_BADGE.inset + INDEX_BADGE.pad;
  const originY = 4 + INDEX_BADGE.inset + INDEX_BADGE.pad;
  const glyph = DIGIT_GLYPHS[7];
  assert.equal(glyph.length, 5);
  for (let row = 0; row < glyph.length; row += 1) {
    for (let column = 0; column < glyph[row].length; column += 1) {
      const expected = glyph[row][column] === "1" ? INDEX_BADGE.ink : INDEX_BADGE.plate;
      assert.deepEqual(pixelAt(sheet, originX + column, originY + row), expected);
    }
  }
});

test("canvas_bottom_center maps the canvas foot to group origin", () => {
  assert.deepEqual(canvasToGroup(8, 16, 16, 16, "canvas_bottom_center"), { x: 0, y: 0 });
  assert.deepEqual(canvasToGroup(10, 10, 16, 16, "canvas_bottom_center"), { x: 2, y: -6 });
  assert.deepEqual(groupToCanvas(0, -8, 16, 16, "canvas_bottom_center"), { x: 8, y: 8 });
});

test("renderContactSheet paints the group origin on the shared axis color", () => {
  const sheet = renderContactSheet([bodyFrame(16, 4, 8)], {
    cell: 32,
    pad: 4,
    columns: 1,
    grid: true,
    labels: false,
    markFrame: -1,
  });
  const originX = 4 + 16;
  const originY = 4 + 31;
  assert.deepEqual(pixelAt(sheet, originX, originY), GROUP_GRID.originInk);
  assert.deepEqual(pixelAt(sheet, originX, 4 + 16), GROUP_GRID.axis, "vertical axis through the body");
});

test("measureLongAxis reports pommel, tip, and handle fractions on a tapered blade", () => {
  const width = 16;
  const height = 32;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 2; y <= 28; y += 1) {
    const taper = y < 10 ? 0 : y < 20 ? 1 : 2;
    for (let x = 7 - taper; x <= 8 + taper; x += 1) {
      setPixel(rgba, width, x, y, [180, 180, 190, 255]);
    }
  }
  const measured = measureLongAxis(rgba, width, height, { t: 2 / 3 });
  assert.ok(measured.tip.y < measured.pommel.y, "thinner end is the tip");
  assert.equal(measured.fractions["0"].y, measured.pommel.y);
  assert.equal(measured.fractions["1"].y, measured.tip.y);
  const midY = (measured.pommel.y + measured.tip.y) / 2;
  assert.ok(Math.abs(measured.fractions["0.5"].y - midY) < 1.5);
  const twoThirdsY = measured.pommel.y + (measured.tip.y - measured.pommel.y) * (2 / 3);
  assert.ok(Math.abs(measured.at.y - twoThirdsY) < 1.5);
  assert.ok(Math.abs(measured.at.x - 7.5) < 1.5, "grip stays on the shaft centerline");
  assert.deepEqual(measured.localFromCenter, {
    x: measured.at.x - width / 2,
    y: measured.at.y - height / 2,
  });
});

test("measureLongAxis keeps grips on the centerline of a wide pommel", () => {
  const width = 32;
  const height = 48;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 2; y <= 44; y += 1) {
    const half = y < 12 ? 1 : y < 32 ? 2 : 10;
    for (let x = 16 - half; x <= 15 + half; x += 1) {
      setPixel(rgba, width, x, y, [180, 180, 190, 255]);
    }
  }
  const measured = measureLongAxis(rgba, width, height, { t: 0.5 });
  assert.ok(measured.tip.y < measured.pommel.y, "thinner end is the tip");
  assert.ok(Math.abs(measured.at.x - 15.5) < 2, "wide pommel must not pull the mid grip to a corner");
});

test("measureFrame ignores chroma leftover fog at alpha 13", () => {
  const width = 16;
  const height = 16;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = 1;
    rgba[offset + 1] = 243;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 13;
  }
  for (let y = 6; y < 10; y += 1) {
    for (let x = 6; x < 10; x += 1) {
      setPixel(rgba, width, x, y, [210, 36, 42, 255]);
    }
  }
  const measured = measureFrame(rgba, width, height);
  assert.equal(measured.opaque, 16, "alpha-13 fog is not a subject pixel");
});

test("measureLongAxis names the handle end of a wide-blade sword as the pommel", () => {
  const width = 64;
  const height = 24;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let x = 2; x <= 61; x += 1) {
    const half = x < 14 ? 1 : x < 20 ? 8 : 5;
    for (let y = 12 - half; y <= 11 + half; y += 1) {
      setPixel(rgba, width, x, y, [180, 180, 190, 255]);
    }
  }
  const measured = measureLongAxis(rgba, width, height, { t: 0.5 });
  assert.ok(measured.pommel.x < measured.tip.x, "thin grip is the pommel, wide blade is the tip");
});

test("renderContactSheet keeps the foot origin on the marked cell", () => {
  const sheet = renderContactSheet([bodyFrame(16, 4, 8)], {
    cell: 32,
    pad: 4,
    columns: 1,
    grid: true,
    labels: false,
    markFrame: 0,
  });
  const originX = 4 + 16;
  const originY = 4 + 31;
  assert.deepEqual(pixelAt(sheet, originX, originY), GROUP_GRID.originInk);
});

test("renderContactSheet marks one cell with the shared highlight border", () => {
  const sheet = renderContactSheet([bodyFrame(16, 4, 8), bodyFrame(16, 4, 8)], {
    cell: 32,
    pad: 4,
    columns: 2,
    startIndex: 0,
    markFrame: 1,
  });
  const markedX = 4 + 32 + 4;
  const markedY = 4;
  assert.deepEqual(pixelAt(sheet, markedX, markedY), MARK_BORDER.color);
  assert.notDeepEqual(pixelAt(sheet, 4, 4), MARK_BORDER.color);
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

    const attack = await current.service.call("xsxb_find_motion", {
      animation_id: "jump",
      preset: "attack",
    });
    assert.equal(attack.rawStart, 3);
    assert.equal(attack.rawEnd, 5);
    assert.equal(attack.start, 1);
    assert.equal(attack.end, 7);
    assert.deepEqual(attack.order, [1, 2, 3, 4, 5, 6, 7]);
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
    assert.deepEqual(exported.indexes, [0, 1]);
    assert.equal(exported.markFrame, 0);
    assert.equal(exported.grid.enabled, false, "cell 16 is below the paint threshold");
    assert.ok(fs.existsSync(exported.outputPath));
    const marked = await current.service.call("xsxb_export_sheet", {
      animation_id: "walk",
      cell: 32,
      pad: 4,
      columns: 2,
      mark_frame: 1,
    });
    assert.equal(marked.grid.enabled, true);
    assert.equal(marked.grid.anchorMode, "canvas_bottom_center");
    assert.equal(marked.grid.ySign, "down");
    assert.ok(marked.grid.originCell.y < marked.cell);
    assert.ok(marked.grid.originCell.y >= 0);
    assert.equal(marked.markFrame, 1);
    const markedSheet = decodePngRgba(marked.outputPath);
    const markedX = 4 + 32 + 4;
    assert.deepEqual(
      [
        markedSheet.data[(4 * markedSheet.width + markedX) * 4],
        markedSheet.data[(4 * markedSheet.width + markedX) * 4 + 1],
        markedSheet.data[(4 * markedSheet.width + markedX) * 4 + 2],
        markedSheet.data[(4 * markedSheet.width + markedX) * 4 + 3],
      ],
      MARK_BORDER.color,
    );
    const foot = await current.service.call("xsxb_export_sheet", {
      animation_id: "walk",
      cell: 32,
      pad: 4,
      columns: 1,
      mark_frame: 0,
    });
    const footSheet = decodePngRgba(foot.outputPath);
    const originOffset = ((4 + 31) * footSheet.width + (4 + 16)) * 4;
    assert.deepEqual(
      [
        footSheet.data[originOffset],
        footSheet.data[originOffset + 1],
        footSheet.data[originOffset + 2],
        footSheet.data[originOffset + 3],
      ],
      GROUP_GRID.originInk,
    );
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

test("xsxb_measure_image returns pommel-to-tip handle fractions", async () => {
  const current = serviceFixture();
  try {
    const width = 16;
    const height = 32;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 2; y <= 28; y += 1) {
      const taper = y < 10 ? 0 : y < 20 ? 1 : 2;
      for (let x = 7 - taper; x <= 8 + taper; x += 1) {
        setPixel(rgba, width, x, y, [180, 180, 190, 255]);
      }
    }
    const filePath = path.join(current.root, "blade.png");
    fs.writeFileSync(filePath, encodePngRgba(rgba, width, height));
    const measured = await current.service.call("xsxb_measure_image", {
      file_path: filePath,
      t: "2/3",
    });
    assert.ok(measured.tip.y < measured.pommel.y);
    assert.equal(measured.t, 2 / 3);
    assert.ok(measured.fractions["2/3"]);
    assert.ok(Math.abs(measured.at.x - 7.5) < 1.5);
    assert.equal(measured.localFromCenter.x, measured.at.x - width / 2);

    const flipped = await current.service.call("xsxb_measure_image", {
      file_path: filePath,
      t: "2/3",
      flip_axis: true,
    });
    assert.ok(flipped.tip.y > flipped.pommel.y);
    assert.equal(flipped.directionSource, "flip_axis");

    const hinted = await current.service.call("xsxb_measure_image", {
      file_path: filePath,
      pommel_hint: { x: 8, y: 2 },
      tip_hint: { x: 8, y: 28 },
    });
    assert.ok(hinted.pommel.y < hinted.tip.y);
    assert.equal(hinted.directionSource, "hints");
  } finally {
    current.cleanup();
  }
});

test("find_motion warns when opaque backgrounds make motion analysis unreliable", async () => {
  const current = serviceFixture();
  try {
    const directory = path.join(current.root, "opaque");
    fs.mkdirSync(directory);
    for (let index = 0; index < 3; index += 1) {
      const rgba = new Uint8ClampedArray(16 * 16 * 4);
      for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([240, 235, 220, 255], offset);
      fs.writeFileSync(path.join(directory, `${index}.png`), encodePngRgba(rgba, 16, 16));
    }
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory,
      animation_id: "opaque_attack",
    });
    const found = await current.service.call("xsxb_find_motion", { animation_id: "opaque_attack" });
    assert.equal(found.analysisReliable, false);
    assert.ok(found.opaqueRatio >= 0.99);
    assert.match(found.warnings.join("\n"), /xsxb_cutout/u);
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
    assert.equal(cut.metricsSource, "in_memory");
    assert.equal(cut.metrics.bodyHeight.median, 6);
    assert.ok(cut.metrics.frames[0].opaque >= 12);
    const silent = await current.service.call("xsxb_cutout", { animation_id: "slash", metrics: false });
    assert.equal(silent.metrics, undefined);
  } finally {
    current.cleanup();
  }
});
