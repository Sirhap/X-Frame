"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { INSTRUCTIONS } = require("../xsxb_mcp_server");
const { MCP_TOOL_NAMES, createXsxbMcpService, toolDefinitions } = require("../xsxb_mcp_service");
const { decodePngRgba, encodePngRgba } = require("../xsxb_mcp_cutout");
const {
  LABEL_INK,
  alphaAnchor,
  cellBox,
  integerCrop,
  overlayGridImage,
  parseCellId,
  placeImageOnTarget,
  placementOrigin,
} = require("../xsxb_mcp_place");

const FIGURE = Object.freeze([210, 36, 42, 255]);
const REGION = Object.freeze([40, 80, 200, 255]);
const STAMP = Object.freeze([20, 180, 60, 255]);
const FIELD = Object.freeze([236, 232, 220, 255]);
const FINGER = Object.freeze([200, 90, 70, 255]);

/**
 * Builds an isolated MCP root for overlay and place tools.
 * @returns {{root:string,service:object,cleanup:Function}} Fixture.
 */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-place-"));
  return {
    root,
    service: createXsxbMcpService({ root }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Writes one packed pixel.
 * @param {Uint8ClampedArray} rgba Buffer.
 * @param {number} width Width.
 * @param {number} x Column.
 * @param {number} y Row.
 * @param {readonly number[]} color RGBA.
 * @returns {void}
 */
function setPixel(rgba, width, x, y, color) {
  rgba.set(color, (y * width + x) * 4);
}

/**
 * Fills a half-open rectangle.
 * @param {Uint8ClampedArray} rgba Buffer.
 * @param {number} width Width.
 * @param {number} x1 Left.
 * @param {number} y1 Top.
 * @param {number} x2 Exclusive right.
 * @param {number} y2 Exclusive bottom.
 * @param {readonly number[]} color RGBA.
 * @returns {void}
 */
function fillRect(rgba, width, x1, y1, x2, y2, color) {
  for (let y = y1; y < y2; y += 1) {
    for (let x = x1; x < x2; x += 1) setPixel(rgba, width, x, y, color);
  }
}

/**
 * Encodes an RGBA buffer as a PNG on disk.
 * @param {string} filePath Destination.
 * @param {Uint8ClampedArray} rgba Pixels.
 * @param {number} width Width.
 * @param {number} height Height.
 * @returns {string} Absolute path.
 */
function writePng(filePath, rgba, width, height) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encodePngRgba(rgba, width, height));
  return filePath;
}

/**
 * Opaque bounding box of pixels matching a color.
 * @param {Uint8ClampedArray} rgba Pixels.
 * @param {number} width Width.
 * @param {number} height Height.
 * @param {readonly number[]} color RGBA.
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}} Box.
 */
function colorBox(rgba, width, height, color) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (rgba[offset + 3] < 16) continue;
      if (rgba[offset] !== color[0] || rgba[offset + 1] !== color[1] || rgba[offset + 2] !== color[2]) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * True when a pixel is solid speakable-id ink, not a translucent grid line.
 * @param {Uint8ClampedArray} rgba Pixels.
 * @param {number} width Width.
 * @param {number} x Column.
 * @param {number} y Row.
 * @returns {boolean} Whether the pixel is label ink.
 */
function isLabelInk(rgba, width, x, y) {
  const offset = (y * width + x) * 4;
  return (
    rgba[offset] === LABEL_INK[0] &&
    rgba[offset + 1] === LABEL_INK[1] &&
    rgba[offset + 2] === LABEL_INK[2] &&
    rgba[offset + 3] === LABEL_INK[3]
  );
}

/**
 * Whether A1's cell contains at least one solid label-ink pixel.
 * @param {{data:Uint8ClampedArray,width:number,height:number}} overlay Overlay PNG.
 * @param {{width:number,height:number,rows:number,cols:number}} view Grid view.
 * @returns {boolean} Whether A1 is labeled.
 */
function a1HasLabelInk(overlay, view) {
  const cellW = Math.max(1, Math.ceil(view.width / view.cols));
  const cellH = Math.max(1, Math.ceil(view.height / view.rows));
  for (let y = 0; y < Math.min(cellH, overlay.height); y += 1) {
    for (let x = 0; x < Math.min(cellW, overlay.width); x += 1) {
      if (isLabelInk(overlay.data, overlay.width, x, y)) return true;
    }
  }
  return false;
}

/**
 * Whether any solid label-ink pixel exists (in-cell or gutter).
 * @param {{data:Uint8ClampedArray,width:number,height:number}} overlay Overlay PNG.
 * @returns {boolean} Whether ids were painted.
 */
function overlayHasLabelInk(overlay) {
  for (let y = 0; y < overlay.height; y += 1) {
    for (let x = 0; x < overlay.width; x += 1) {
      if (isLabelInk(overlay.data, overlay.width, x, y)) return true;
    }
  }
  return false;
}

/**
 * Solid field PNG of a given size.
 * @param {number} width Width.
 * @param {number} height Height.
 * @param {readonly number[]} [color] Fill.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}} Image.
 */
function fieldImage(width, height, color = FIELD) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(color, offset);
  return { data, width, height };
}

test("overlay_grid and place_image sit after measure_image in the catalog", () => {
  const measure = MCP_TOOL_NAMES.indexOf("xsxb_measure_image");
  assert.equal(MCP_TOOL_NAMES[measure + 1], "xsxb_overlay_grid");
  assert.equal(MCP_TOOL_NAMES[measure + 2], "xsxb_place_image");
  assert.equal(MCP_TOOL_NAMES[measure + 3], "xsxb_open_tuner");
  const names = toolDefinitions().map((tool) => tool.name);
  assert.deepEqual(names, [...MCP_TOOL_NAMES]);
});

test("core place schema fields stay generic", () => {
  const banned = /门|人|刀|西门|door|person|blade/i;
  const src = fs.readFileSync(path.join(__dirname, "../xsxb_mcp_place.js"), "utf8");
  assert.doesNotMatch(src, banned);
  for (const name of ["xsxb_overlay_grid", "xsxb_place_image"]) {
    const tool = toolDefinitions().find((entry) => entry.name === name);
    assert.ok(tool, name);
    assert.doesNotMatch(JSON.stringify(Object.keys(tool.inputSchema.properties)), banned);
    for (const key of Object.keys(tool.inputSchema.properties)) {
      assert.doesNotMatch(key, banned, key);
    }
  }
});

test("A1 on a 64×64 8×8 view is the known top-left 8px square", () => {
  const view = { x: 0, y: 0, width: 64, height: 64, rows: 8, cols: 8 };
  const box = cellBox(view, "A1");
  assert.equal(box.x1, 0);
  assert.equal(box.y1, 0);
  assert.equal(box.x2, 8);
  assert.equal(box.y2, 8);
  assert.equal(parseCellId("A1").column, 0);
  assert.equal(parseCellId("A1").row, 1);
});

test("Z99 and empty cell ids throw without computing a box", () => {
  const view = { x: 0, y: 0, width: 64, height: 64, rows: 8, cols: 8 };
  assert.throws(
    () => cellBox(view, "Z99"),
    (error) => {
      assert.equal(error.code, "GRID_CELL_OUT_OF_RANGE");
      return true;
    },
  );
  assert.throws(
    () => cellBox(view, ""),
    (error) => {
      assert.equal(error.code, "GRID_INVALID_CELL");
      return true;
    },
  );
  assert.throws(
    () => parseCellId("Z99", view),
    (error) => {
      assert.equal(error.code, "GRID_CELL_OUT_OF_RANGE");
      return true;
    },
  );
});

test("overlay_grid receipt uses original-image cells and leaves the source PNG unchanged", async () => {
  const current = fixture();
  try {
    const image = fieldImage(64, 64);
    fillRect(image.data, 64, 16, 16, 24, 24, REGION);
    const filePath = writePng(path.join(current.root, "scene.png"), image.data, 64, 64);
    const before = fs.readFileSync(filePath);
    const receipt = await current.service.call("xsxb_overlay_grid", { file_path: filePath });
    assert.deepEqual(receipt.view, { x: 0, y: 0, width: 64, height: 64, rows: 8, cols: 8 });
    assert.equal(receipt.cell_width_px, 8);
    assert.equal(receipt.cell_height_px, 8);
    assert.equal(receipt.cells.A1.x1, 0);
    assert.equal(receipt.cells.A1.y1, 0);
    assert.equal(receipt.cells.A1.x2, 8);
    assert.equal(receipt.cells.A1.y2, 8);
    assert.equal(receipt.cells.C3.x1, 16);
    assert.equal(receipt.cells.C3.y1, 16);
    assert.equal(receipt.cells.C3.x2, 24);
    assert.equal(receipt.cells.C3.y2, 24);
    assert.equal(path.basename(receipt.overlay_path), "scene_grid.png");
    assert.ok(fs.existsSync(receipt.overlay_path));
    assert.deepEqual(fs.readFileSync(filePath), before);
    const overlay = decodePngRgba(receipt.overlay_path);
    assert.equal(overlay.width, 64);
    assert.equal(overlay.height, 64);
    assert.notDeepEqual(Buffer.from(overlay.data), Buffer.from(image.data));
  } finally {
    current.cleanup();
  }
});

test("invalid overlay cell ids throw GRID codes through MCP", async () => {
  const current = fixture();
  try {
    const image = fieldImage(64, 64);
    const filePath = writePng(path.join(current.root, "scene.png"), image.data, 64, 64);
    const parentView = { x: 0, y: 0, width: 64, height: 64, rows: 8, cols: 8 };
    await assert.rejects(
      () =>
        current.service.call("xsxb_overlay_grid", {
          file_path: filePath,
          crop_from: { parent_view: parentView, cells: ["Z99"] },
        }),
      (error) => {
        assert.equal(error.code, "GRID_CELL_OUT_OF_RANGE");
        return true;
      },
    );
    await assert.rejects(
      () =>
        current.service.call("xsxb_overlay_grid", {
          file_path: filePath,
          crop_from: { parent_view: parentView, cells: [""] },
        }),
      (error) => {
        assert.equal(error.code, "GRID_INVALID_CELL");
        return true;
      },
    );
  } finally {
    current.cleanup();
  }
});

test("integer crop origin matches the remapped A1 origin", async () => {
  const current = fixture();
  try {
    const image = fieldImage(100, 80);
    fillRect(image.data, 100, 12, 10, 25, 20, REGION);
    const filePath = writePng(path.join(current.root, "wide.png"), image.data, 100, 80);
    const parent = await current.service.call("xsxb_overlay_grid", {
      file_path: filePath,
      grid_divs: "8x8",
    });
    assert.equal(parent.cells.B2.x1, 12.5);
    assert.equal(parent.cells.B2.y1, 10);
    assert.equal(parent.cells.B2.x2, 25);
    assert.equal(parent.cells.B2.y2, 20);
    const cropped = await current.service.call("xsxb_overlay_grid", {
      file_path: filePath,
      rows: 8,
      cols: 8,
      crop_from: { parent_view: parent.view, cells: ["B2"], padding_cells: 0 },
    });
    assert.equal(cropped.crop.x, 12);
    assert.equal(cropped.crop.y, 10);
    assert.equal(cropped.crop.width, 13);
    assert.equal(cropped.crop.height, 10);
    assert.equal(cropped.crop.x, Math.floor(parent.cells.B2.x1));
    assert.equal(cropped.view.x, 12);
    assert.equal(cropped.view.y, 10);
    assert.equal(cropped.cells.A1.x1, 12);
    assert.equal(cropped.cells.A1.y1, 10);
    const extract = integerCrop({ x1: 12.5, y1: 10, x2: 25, y2: 20 });
    assert.equal(extract.x, 12);
    assert.equal(extract.y, 10);
    const overlay = decodePngRgba(cropped.overlay_path);
    assert.ok(overlay.width > 13, "guttered crop overlay must grow past the 13px extract");
    assert.ok(overlay.height > 10, "guttered crop overlay must grow past the 10px extract");
    const letterX = Math.round(5 + ((7 + 0.5) * 13) / 8 - 1.5);
    const digitY = Math.round(6 + ((8 - 0.5) * 10) / 8 - 2.5);
    assert.ok(
      isLabelInk(overlay.data, overlay.width, letterX + 2, 0),
      `last-column H right stem at (${letterX + 2},0) must not clip`,
    );
    assert.ok(
      isLabelInk(overlay.data, overlay.width, 1, digitY + 4),
      `last-row 8 bottom bar at (1,${digitY + 4}) must not clip`,
    );
  } finally {
    current.cleanup();
  }
});

test("padding_cells expands the integer crop by parent cell units", async () => {
  const current = fixture();
  try {
    const image = fieldImage(100, 80);
    const filePath = writePng(path.join(current.root, "pad.png"), image.data, 100, 80);
    const parent = await current.service.call("xsxb_overlay_grid", {
      file_path: filePath,
      grid_divs: "8x8",
    });
    const cropped = await current.service.call("xsxb_overlay_grid", {
      file_path: filePath,
      crop_from: { parent_view: parent.view, cells: ["B2"], padding_cells: 1 },
    });
    assert.equal(cropped.crop.x, 0);
    assert.equal(cropped.crop.y, 0);
    assert.equal(cropped.crop.width, 38);
    assert.equal(cropped.crop.height, 30);
    assert.equal(cropped.view.x, 0);
    assert.equal(cropped.view.width, 38);
  } finally {
    current.cleanup();
  }
});

test("unknown crop_from keys are rejected instead of becoming padding 0", async () => {
  const current = fixture();
  try {
    const image = fieldImage(32, 32);
    const filePath = writePng(path.join(current.root, "typo.png"), image.data, 32, 32);
    const parentView = { x: 0, y: 0, width: 32, height: 32, rows: 8, cols: 8 };
    await assert.rejects(
      () =>
        current.service.call("xsxb_overlay_grid", {
          file_path: filePath,
          crop_from: { parent_view: parentView, cells: ["A1"], padding: 1 },
        }),
      /padding_cells/,
    );
  } finally {
    current.cleanup();
  }
});

test("placement origin maps the object anchor onto the target", () => {
  const origin = placementOrigin({ x: 120, y: 90 }, { x: 30, y: 45 }, 2);
  assert.equal(origin.left, 60);
  assert.equal(origin.top, 0);
  assert.equal(origin.left + 30 * 2, 120);
  assert.equal(origin.top + 45 * 2, 90);
});

test("place_image mapped foot equals the given target within 1px", async () => {
  const current = fixture();
  try {
    const scene = fieldImage(160, 160);
    const targetPath = writePng(path.join(current.root, "stage.png"), scene.data, 160, 160);
    const object = new Uint8ClampedArray(60 * 50 * 4);
    fillRect(object, 60, 20, 15, 40, 45, FIGURE);
    const objectPath = writePng(path.join(current.root, "stamp.png"), object, 60, 50);
    const view = { x: 0, y: 0, width: 160, height: 160, rows: 8, cols: 8 };
    const placed = await current.service.call("xsxb_place_image", {
      target_path: targetPath,
      object_path: objectPath,
      target_anchor: { view, cells: ["D5", "E5"], derive: "bottom_center" },
      object_anchor: { mode: "alpha_bottom_center" },
      scale: { mode: "none" },
    });
    assert.equal(placed.rotation, 0);
    assert.equal(placed.scale, 1);
    assert.ok(Math.abs(placed.mapped.x - 80) <= 1);
    assert.ok(Math.abs(placed.mapped.y - 100) <= 1);
    const out = decodePngRgba(placed.output_path);
    const box = colorBox(out.data, out.width, out.height, FIGURE);
    assert.equal(box.maxY + 1, 100);
    assert.equal((box.minX + box.maxX + 1) / 2, 80);
  } finally {
    current.cleanup();
  }
});

test("transparent padding makes alpha_bottom different from the image bottom", () => {
  const data = new Uint8ClampedArray(48 * 64 * 4);
  fillRect(data, 48, 12, 8, 36, 50, FIGURE);
  const foot = alphaAnchor(data, 48, 64, "alpha_bottom_center");
  assert.equal(foot.x, 24);
  assert.equal(foot.y, 50);
  assert.notEqual(foot.y, 64);
  const support = alphaAnchor(data, 48, 64, "alpha_support");
  assert.equal(support.y, 50);
  assert.notEqual(support.y, 64);
});

test("measure_image alpha_bottom uses the opaque foot, not the canvas edge", async () => {
  const current = fixture();
  try {
    const data = new Uint8ClampedArray(48 * 64 * 4);
    fillRect(data, 48, 12, 8, 36, 50, FIGURE);
    const filePath = writePng(path.join(current.root, "padded.png"), data, 48, 64);
    const measured = await current.service.call("xsxb_measure_image", {
      file_path: filePath,
      anchor: "alpha_bottom",
    });
    assert.equal(measured.anchor, "alpha_bottom");
    assert.equal(measured.at.x, 24);
    assert.equal(measured.at.y, 50);
    assert.notEqual(measured.at.y, 64);
  } finally {
    current.cleanup();
  }
});

test("physical height scale uses the selected span and warns instead of stretching", async () => {
  const current = fixture();
  try {
    const scene = fieldImage(160, 160);
    const targetPath = writePng(path.join(current.root, "span.png"), scene.data, 160, 160);
    const object = new Uint8ClampedArray(80 * 100 * 4);
    fillRect(object, 80, 10, 5, 70, 95, FIGURE);
    const objectPath = writePng(path.join(current.root, "body.png"), object, 80, 100);
    const view = { x: 0, y: 0, width: 160, height: 160, rows: 8, cols: 8 };
    const placed = await current.service.call("xsxb_place_image", {
      target_path: targetPath,
      object_path: objectPath,
      target_anchor: { view, cells: ["A1", "E8"], derive: "center" },
      object_anchor: { mode: "alpha_center" },
      scale: {
        mode: "physical",
        target: { view, cells: ["A1", "E1"] },
        span: "width",
        target_m: 2,
        object_m: 0.9,
        object_span: "bbox_height",
      },
    });
    assert.equal(placed.scale, 0.5);
    assert.match(String(placed.warning), /stretch|aspect|mismatch/i);
    const out = decodePngRgba(placed.output_path);
    const box = colorBox(out.data, out.width, out.height, FIGURE);
    assert.ok(Math.abs(box.maxX - box.minX + 1 - 30) <= 1);
    assert.ok(Math.abs(box.maxY - box.minY + 1 - 45) <= 1);
    assert.notEqual(box.maxX - box.minX + 1, 60);
    assert.notEqual(placed.scale, 1);
  } finally {
    current.cleanup();
  }
});

test("Case A: cell bottom_center plus physical width plants the foot on the region", async () => {
  const current = fixture();
  try {
    const scene = fieldImage(160, 160);
    fillRect(scene.data, 160, 60, 40, 100, 140, REGION);
    const targetPath = writePng(path.join(current.root, "case-a-scene.png"), scene.data, 160, 160);
    const object = new Uint8ClampedArray(80 * 100 * 4);
    fillRect(object, 80, 20, 10, 50, 80, FIGURE);
    fillRect(object, 80, 28, 80, 36, 90, FIGURE);
    const objectPath = writePng(path.join(current.root, "case-a-figure.png"), object, 80, 100);
    const view = { x: 0, y: 0, width: 160, height: 160, rows: 8, cols: 8 };
    const placed = await current.service.call("xsxb_place_image", {
      target_path: targetPath,
      object_path: objectPath,
      target_anchor: { view, cells: ["D3", "E7"], derive: "bottom_center" },
      object_anchor: { mode: "alpha_support" },
      scale: {
        mode: "physical",
        target: { view, cells: ["D3", "E7"] },
        span: "width",
        target_m: 0.8,
        object_m: 0.3,
        object_span: "bbox_width",
      },
    });
    assert.equal(placed.scale, 0.5);
    assert.ok(Math.abs(placed.mapped.x - 80) <= 1);
    assert.ok(Math.abs(placed.mapped.y - 140) <= 1);
    const out = decodePngRgba(placed.output_path);
    const box = colorBox(out.data, out.width, out.height, FIGURE);
    assert.equal(box.maxY + 1, 140);
    const support = alphaAnchor(
      (() => {
        const copy = new Uint8ClampedArray(out.data);
        for (let offset = 0; offset < copy.length; offset += 4) {
          if (
            copy[offset] !== FIGURE[0] ||
            copy[offset + 1] !== FIGURE[1] ||
            copy[offset + 2] !== FIGURE[2]
          ) {
            copy[offset + 3] = 0;
          }
        }
        return copy;
      })(),
      out.width,
      out.height,
      "alpha_support",
    );
    assert.ok(Math.abs(support.x - 80) <= 1);
    assert.ok(Math.abs(support.y - 140) <= 1);
  } finally {
    current.cleanup();
  }
});

test("Case B: relative width 0.7 centers a stamp on a known box", async () => {
  const current = fixture();
  try {
    const scene = fieldImage(160, 160);
    fillRect(scene.data, 160, 40, 40, 120, 120, REGION);
    const targetPath = writePng(path.join(current.root, "case-b-scene.png"), scene.data, 160, 160);
    const object = new Uint8ClampedArray(64 * 64 * 4);
    fillRect(object, 64, 12, 12, 52, 52, STAMP);
    const objectPath = writePng(path.join(current.root, "case-b-stamp.png"), object, 64, 64);
    const view = { x: 0, y: 0, width: 160, height: 160, rows: 8, cols: 8 };
    const placed = await current.service.call("xsxb_place_image", {
      target_path: targetPath,
      object_path: objectPath,
      target_anchor: { view, cells: ["C3", "F6"], derive: "center" },
      object_anchor: { mode: "alpha_center" },
      scale: {
        mode: "relative",
        target: { view, cells: ["C3", "F6"] },
        span: "width",
        ratio: 0.7,
      },
    });
    assert.equal(placed.scale, 1.4);
    assert.ok(Math.abs(placed.mapped.x - 80) <= 1);
    assert.ok(Math.abs(placed.mapped.y - 80) <= 1);
    const out = decodePngRgba(placed.output_path);
    const box = colorBox(out.data, out.width, out.height, STAMP);
    assert.ok(Math.abs((box.minX + box.maxX + 1) / 2 - 80) <= 1);
    assert.ok(Math.abs((box.minY + box.maxY + 1) / 2 - 80) <= 1);
    assert.equal(box.maxX - box.minX + 1, 56);
  } finally {
    current.cleanup();
  }
});

test("output_path must stay inside the service root", async () => {
  const current = fixture();
  try {
    const image = fieldImage(32, 32);
    fillRect(image.data, 32, 8, 8, 24, 24, REGION);
    const filePath = writePng(path.join(current.root, "in.png"), image.data, 32, 32);
    await assert.rejects(
      () =>
        current.service.call("xsxb_overlay_grid", {
          file_path: filePath,
          output_path: path.join(os.tmpdir(), "xsxb-place-escape.png"),
        }),
      /inside/i,
    );
  } finally {
    current.cleanup();
  }
});

test("INSTRUCTIONS tell the agent to report cell ids and crop_from to refine", () => {
  assert.match(INSTRUCTIONS, /xsxb_overlay_grid/);
  assert.match(INSTRUCTIONS, /xsxb_place_image/);
  assert.match(INSTRUCTIONS, /cell ids|A1/i);
  assert.match(INSTRUCTIONS, /crop_from/);
  assert.match(INSTRUCTIONS, /eye/i);
  assert.match(INSTRUCTIONS, /layer/);
  assert.match(INSTRUCTIONS, /under_target/);
});

test("INSTRUCTIONS and place_image require physical held-object pose", () => {
  const place = toolDefinitions().find((entry) => entry.name === "xsxb_place_image");
  assert.ok(place, "xsxb_place_image is a catalog tool");
  for (const [label, text] of [
    ["INSTRUCTIONS", INSTRUCTIONS],
    ["xsxb_place_image", place.description],
  ]) {
    assert.match(text, /source-upright|generated upright/i, `${label} must reject leaving rotation 0`);
    assert.match(text, /forearm/, `${label} must align the shaft with the forearm`);
    assert.match(text, /does not redraw/i, `${label} must say place_image does not redraw a hand`);
    assert.match(text, /body span/, `${label} must scale from the body span`);
    assert.match(text, /clips/, `${label} must say what to do when the head clips`);
  }
});

test("exported overlayGridImage paints speakable ids without a 0–1000 axis", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-place-grid-"));
  try {
    for (const size of [64, 80, 128, 192]) {
      const image = fieldImage(size, size);
      const filePath = writePng(path.join(dir, `plain-${size}.png`), image.data, size, size);
      const receipt = overlayGridImage({ file_path: filePath }, { root: dir });
      assert.ok(receipt.cells.A1);
      assert.equal(receipt.ticks, undefined);
      assert.equal(receipt.originLabel, undefined);
      const overlay = decodePngRgba(receipt.overlay_path);
      assert.ok(a1HasLabelInk(overlay, receipt.view), `${size}×${size} 8×8 must paint A1 ink`);
    }
    const image64 = fieldImage(64, 64);
    const path64 = writePng(path.join(dir, "a1.png"), image64.data, 64, 64);
    const overlay64 = decodePngRgba(overlayGridImage({ file_path: path64 }, { root: dir }).overlay_path);
    assert.ok(isLabelInk(overlay64.data, overlay64.width, 1, 2), "A glyph center bar at A1 (1,2)");
    const tiny = fieldImage(32, 32);
    const tinyPath = writePng(path.join(dir, "tiny.png"), tiny.data, 32, 32);
    const tinyOverlay = decodePngRgba(overlayGridImage({ file_path: tinyPath }, { root: dir }).overlay_path);
    assert.ok(overlayHasLabelInk(tinyOverlay), "32×32 probes must still expose speakable ids");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("object_anchor cells require a view", async () => {
  const current = fixture();
  try {
    const scene = fieldImage(64, 64);
    const targetPath = writePng(path.join(current.root, "t.png"), scene.data, 64, 64);
    const object = new Uint8ClampedArray(32 * 32 * 4);
    fillRect(object, 32, 8, 8, 24, 24, STAMP);
    const objectPath = writePng(path.join(current.root, "o.png"), object, 32, 32);
    await assert.rejects(
      () =>
        current.service.call("xsxb_place_image", {
          target_path: targetPath,
          object_path: objectPath,
          target_anchor: {
            view: { x: 0, y: 0, width: 64, height: 64, rows: 8, cols: 8 },
            cells: ["D4"],
            derive: "center",
          },
          object_anchor: { cells: ["B2"], derive: "center" },
        }),
      /object_anchor[\s\S]*view/i,
    );
  } finally {
    current.cleanup();
  }
});

test("physical scale omitted object_span follows the named span axis", async () => {
  const current = fixture();
  try {
    const scene = fieldImage(160, 160);
    const targetPath = writePng(path.join(current.root, "axis.png"), scene.data, 160, 160);
    const object = new Uint8ClampedArray(80 * 100 * 4);
    fillRect(object, 80, 10, 5, 70, 95, FIGURE);
    const objectPath = writePng(path.join(current.root, "axis-body.png"), object, 80, 100);
    const view = { x: 0, y: 0, width: 160, height: 160, rows: 8, cols: 8 };
    const placed = await current.service.call("xsxb_place_image", {
      target_path: targetPath,
      object_path: objectPath,
      target_anchor: { view, cells: ["A1"], derive: "center" },
      object_anchor: { mode: "alpha_center" },
      scale: {
        mode: "physical",
        target: { view, cells: ["A1", "E1"] },
        span: "width",
        target_m: 2,
        object_m: 1.8,
      },
    });
    assert.ok(Math.abs(placed.scale - 1.5) < 1e-9);
  } finally {
    current.cleanup();
  }
});

/**
 * Packed RGBA at one pixel.
 * @param {Uint8ClampedArray} rgba Buffer.
 * @param {number} width Width.
 * @param {number} x Column.
 * @param {number} y Row.
 * @returns {number[]} RGBA.
 */
function pixelAt(rgba, width, x, y) {
  return [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
}

/**
 * Whether a pixel matches an opaque color.
 * @param {Uint8ClampedArray} rgba Buffer.
 * @param {number} width Width.
 * @param {number} x Column.
 * @param {number} y Row.
 * @param {readonly number[]} color RGBA.
 * @returns {boolean} Match.
 */
function pixelIs(rgba, width, x, y, color) {
  const pixel = pixelAt(rgba, width, x, y);
  return pixel[0] === color[0] && pixel[1] === color[1] && pixel[2] === color[2] && pixel[3] === color[3];
}

/**
 * Hand-over-grip scene: opaque fingers in D4–E5, a hole, and a stamp that spills outside.
 * @param {string} root Fixture root.
 * @returns {{targetPath:string,objectPath:string,view:object}} Paths.
 */
function fingerScene(root) {
  const scene = fieldImage(80, 80);
  fillRect(scene.data, 80, 32, 32, 48, 48, FINGER);
  for (let y = 38; y < 42; y += 1) {
    for (let x = 38; x < 42; x += 1) setPixel(scene.data, 80, x, y, [0, 0, 0, 0]);
  }
  const targetPath = writePng(path.join(root, "hand.png"), scene.data, 80, 80);
  const object = new Uint8ClampedArray(40 * 40 * 4);
  fillRect(object, 40, 0, 0, 40, 40, STAMP);
  const objectPath = writePng(path.join(root, "grip.png"), object, 40, 40);
  const view = { x: 0, y: 0, width: 80, height: 80, rows: 8, cols: 8 };
  return { targetPath, objectPath, view };
}

test("under_target keeps finger color inside the anchor box and object color outside", async () => {
  const current = fixture();
  try {
    const { targetPath, objectPath, view } = fingerScene(current.root);
    const placed = await current.service.call("xsxb_place_image", {
      target_path: targetPath,
      object_path: objectPath,
      target_anchor: { view, cells: ["D4", "E5"], derive: "center" },
      object_anchor: { mode: "alpha_center" },
      scale: { mode: "none" },
      layer: "under_target",
    });
    assert.equal(placed.layer, "under_target");
    const out = decodePngRgba(placed.output_path);
    assert.ok(pixelIs(out.data, out.width, 34, 34, FINGER), "opaque fingers cover the object inside the box");
    assert.ok(pixelIs(out.data, out.width, 40, 40, STAMP), "object shows through the hole inside the box");
    assert.ok(pixelIs(out.data, out.width, 25, 40, STAMP), "object stays in front outside the anchor box");
  } finally {
    current.cleanup();
  }
});

test("front layer lets the object cover fingers", async () => {
  const current = fixture();
  try {
    const { targetPath, objectPath, view } = fingerScene(current.root);
    const placed = await current.service.call("xsxb_place_image", {
      target_path: targetPath,
      object_path: objectPath,
      target_anchor: { view, cells: ["D4", "E5"], derive: "center" },
      object_anchor: { mode: "alpha_center" },
      scale: { mode: "none" },
    });
    assert.equal(placed.layer, "front");
    const out = decodePngRgba(placed.output_path);
    assert.ok(pixelIs(out.data, out.width, 34, 34, STAMP), "default front paints the object over fingers");
    assert.ok(pixelIs(out.data, out.width, 40, 40, STAMP));
  } finally {
    current.cleanup();
  }
});

test("behind layer shows the object only in target holes", async () => {
  const current = fixture();
  try {
    const { targetPath, objectPath, view } = fingerScene(current.root);
    const placed = await current.service.call("xsxb_place_image", {
      target_path: targetPath,
      object_path: objectPath,
      target_anchor: { view, cells: ["D4", "E5"], derive: "center" },
      object_anchor: { mode: "alpha_center" },
      scale: { mode: "none" },
      layer: "behind",
    });
    assert.equal(placed.layer, "behind");
    const out = decodePngRgba(placed.output_path);
    assert.ok(pixelIs(out.data, out.width, 34, 34, FINGER), "opaque target covers the object");
    assert.ok(pixelIs(out.data, out.width, 25, 40, FIELD), "opaque field outside the hole stays on top");
    assert.ok(pixelIs(out.data, out.width, 40, 40, STAMP), "object shows only through the hole");
  } finally {
    current.cleanup();
  }
});

test("90 degree clockwise rotation around the object anchor moves an L-stamp", async () => {
  const current = fixture();
  try {
    const scene = fieldImage(80, 80);
    const targetPath = writePng(path.join(current.root, "stage.png"), scene.data, 80, 80);
    const object = new Uint8ClampedArray(16 * 16 * 4);
    fillRect(object, 16, 4, 2, 6, 10, STAMP);
    fillRect(object, 16, 4, 8, 10, 10, STAMP);
    const objectPath = writePng(path.join(current.root, "ell.png"), object, 16, 16);
    const view = { x: 0, y: 0, width: 80, height: 80, rows: 8, cols: 8 };
    const placed = await current.service.call("xsxb_place_image", {
      target_path: targetPath,
      object_path: objectPath,
      target_anchor: { view, cells: ["D4", "E5"], derive: "center" },
      object_anchor: { mode: "alpha_center" },
      scale: { mode: "none" },
      rotation: 90,
    });
    assert.equal(placed.rotation, 90);
    assert.ok(Math.hypot(placed.mapped.x - placed.target.x, placed.mapped.y - placed.target.y) <= 1);
    const out = decodePngRgba(placed.output_path);
    const box = colorBox(out.data, out.width, out.height, STAMP);
    assert.ok(
      box.maxX - box.minX + 1 > box.maxY - box.minY + 1,
      "clockwise 90 turns the tall L into a wide L",
    );
    const ox = placed.mapped.x;
    const oy = placed.mapped.y;
    assert.ok(
      pixelIs(out.data, out.width, Math.round(ox + 3), Math.round(oy - 3), STAMP),
      "stem that pointed up becomes a bar to the right of and above the anchor after clockwise 90",
    );
    assert.equal(
      pixelIs(out.data, out.width, Math.round(ox + 3), Math.round(oy + 3), STAMP),
      false,
      "counter-clockwise 90 would have sent that bar below the anchor",
    );
    assert.ok(
      pixelIs(out.data, out.width, Math.round(ox - 4), Math.round(oy + 2), STAMP),
      "foot that pointed right hangs down on the left after clockwise 90",
    );
  } finally {
    current.cleanup();
  }
});

test("320×320 8×8 overlay keeps subject color at a labeled cell center", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-place-overlay-320-"));
  try {
    const image = fieldImage(320, 320, REGION);
    const filePath = writePng(path.join(dir, "wide.png"), image.data, 320, 320);
    const receipt = overlayGridImage({ file_path: filePath }, { root: dir });
    const overlay = decodePngRgba(receipt.overlay_path);
    assert.equal(overlay.width, 320);
    assert.equal(overlay.height, 320);
    assert.ok(a1HasLabelInk(overlay, receipt.view), "320×320 8×8 must still paint A1 ink");
    const path64 = writePng(path.join(dir, "a1-64.png"), fieldImage(64, 64).data, 64, 64);
    const overlay64 = decodePngRgba(overlayGridImage({ file_path: path64 }, { root: dir }).overlay_path);
    assert.ok(isLabelInk(overlay64.data, overlay64.width, 1, 2), "A glyph center bar at A1 (1,2)");
    const cx = Math.floor((receipt.cells.D4.x1 + receipt.cells.D4.x2) / 2);
    const cy = Math.floor((receipt.cells.D4.y1 + receipt.cells.D4.y2) / 2);
    const pixel = pixelAt(overlay.data, overlay.width, cx, cy);
    assert.ok(
      Math.abs(pixel[0] - REGION[0]) < 40 &&
        Math.abs(pixel[1] - REGION[1]) < 40 &&
        Math.abs(pixel[2] - REGION[2]) < 40,
      `cell-center (${cx},${cy}) must still show the subject, not a solid label plate; got ${pixel.join(",")}`,
    );
    assert.equal(isLabelInk(overlay.data, overlay.width, cx, cy), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("placeImageOnTarget keeps the target file bytes unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-place-blit-"));
  try {
    const scene = fieldImage(80, 80);
    const targetPath = writePng(path.join(dir, "t.png"), scene.data, 80, 80);
    const object = new Uint8ClampedArray(32 * 32 * 4);
    fillRect(object, 32, 8, 8, 24, 24, STAMP);
    const objectPath = writePng(path.join(dir, "o.png"), object, 32, 32);
    const before = fs.readFileSync(targetPath);
    const view = { x: 0, y: 0, width: 80, height: 80, rows: 8, cols: 8 };
    placeImageOnTarget(
      {
        target_path: targetPath,
        object_path: objectPath,
        target_anchor: { view, cells: ["D4"], derive: "center" },
        object_anchor: { mode: "alpha_center" },
        scale: { mode: "none" },
      },
      { root: dir },
    );
    assert.deepEqual(fs.readFileSync(targetPath), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
