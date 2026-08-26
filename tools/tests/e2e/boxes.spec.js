"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { expect, test } = require("./fixtures");
const { resolveE2ERoot } = require("./e2e_fixture");

const PNG_CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/**
 * Wraps PNG chunk data in its length, type and CRC envelope.
 * @param {string} type Four-letter chunk type.
 * @param {Buffer} data Chunk payload.
 * @returns {Buffer} Encoded chunk.
 */
function pngChunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([Buffer.from(type, "ascii"), data])) {
    crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([header, data, checksum]);
}

/**
 * Encodes an opaque sprite on a light background so restore-auto has a body.
 * Seed metadata stays 1×1; only the decoded image is large.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @returns {Buffer} PNG file bytes.
 */
function bodyFramePng(width, height) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= width * 0.2 && x < width * 0.8 && y >= height * 0.15 && y < height * 0.9;
      const offset = y * stride + 1 + x * 4;
      raw[offset] = inside ? 40 : 240;
      raw[offset + 1] = inside ? 80 : 240;
      raw[offset + 2] = inside ? 50 : 240;
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Replaces the 1×1 seed frames with a body large enough to show jump-collapse.
 * Manifest width/height stay 1 so a missing-image frameBox still becomes a stub.
 * @returns {void}
 */
function plantLargeSeedFrames() {
  const directory = path.join(
    resolveE2ERoot(),
    "workspace",
    "projects",
    "seed-project",
    "assets",
    "hero",
    "idle",
  );
  const png = bodyFramePng(64, 80);
  fs.writeFileSync(path.join(directory, "frame_0001.png"), png);
  fs.writeFileSync(path.join(directory, "frame_0002.png"), png);
}

/**
 * Opens the boxes page with the hurtbox visible on the restored auto box.
 * @param {import("@playwright/test").Page} page Playwright page.
 * @returns {Promise<void>}
 */
async function openRestoredHurtbox(page) {
  plantLargeSeedFrames();
  await page.goto("/workspace/animation/boxes");
  await expect(page.locator("body")).toHaveAttribute("data-workspace-tool", "boxes");
  await expect(page.locator("#filmstrip .thumb[data-frame-index='0']")).toBeVisible();
  await page.locator("#showBoxes").check({ force: true });
  await page.locator('[data-box-choice="hurtbox"]').check({ force: true });
  await page.locator("#clearBox").click();
  await expect(page.locator("#stage")).toBeVisible();
}

/**
 * Reads the cyan hurtbox stroke bounds from the stage backing store.
 * @param {import("@playwright/test").Page} page Playwright page.
 * @returns {Promise<{left:number,top:number,right:number,bottom:number,width:number,height:number}|null>}
 */
async function measureHurtbox(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#stage");
    if (!canvas) return null;
    const context = canvas.getContext("2d");
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        if (alpha < 80 || red > 150 || green < 150 || blue < 200) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left) return null;
    return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
  });
}

/**
 * Stroke/AA jitter grows with canvas zoom; collapse is still caught at 0.6×.
 * @param {number} size Measured edge in canvas pixels.
 * @returns {number} Allowed absolute delta.
 */
function nudgeSlack(size) {
  return Math.max(16, Math.round(Number(size) * 0.05));
}

/**
 * Converts a stage backing-store point into page CSS coordinates.
 * @param {import("@playwright/test").Page} page Playwright page.
 * @param {number} canvasX Backing-store X.
 * @param {number} canvasY Backing-store Y.
 * @returns {Promise<{x:number,y:number}>} Client coordinates.
 */
async function canvasToClient(page, canvasX, canvasY) {
  const stage = page.locator("#stage");
  const box = await stage.boundingBox();
  const size = await page.evaluate(() => {
    const canvas = document.querySelector("#stage");
    return { width: canvas.width, height: canvas.height };
  });
  return {
    x: box.x + (canvasX / size.width) * box.width,
    y: box.y + (canvasY / size.height) * box.height,
  };
}

test("BOX-006 selected box arrows nudge instead of stepping the filmstrip", async ({ page }) => {
  await page.goto("/workspace/animation/boxes");
  await expect(page.locator("body")).toHaveAttribute("data-workspace-tool", "boxes");
  await expect(page.locator("#filmstrip .thumb[data-frame-index='0']")).toBeVisible();
  await page.locator("#showBoxes").check({ force: true });
  await page.locator('[data-box-choice="hurtbox"]').check({ force: true });
  await expect(page.locator("#filmstrip .thumb[data-frame-index='0']")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.locator("#workspaceFlowProject").click();
  await page.keyboard.press("ArrowRight");

  await expect(page.locator("#filmstrip .thumb[data-frame-index='0']")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#filmstrip .thumb[data-frame-index='1']")).not.toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#status")).toContainText("nudge box");
});

test("BOX-006 restore-auto ArrowLeft cannot jump-collapse the hurtbox", async ({ page }) => {
  await openRestoredHurtbox(page);
  const before = await measureHurtbox(page);
  expect(before, "restored auto hurtbox should be visible").toBeTruthy();
  expect(before.width).toBeGreaterThan(20);
  expect(before.height).toBeGreaterThan(20);

  const center = await canvasToClient(
    page,
    (before.left + before.right) / 2,
    (before.top + before.bottom) / 2,
  );
  await page.mouse.click(center.x, center.y);
  await page.keyboard.press("ArrowLeft");
  const afterOne = await measureHurtbox(page);
  expect(afterOne, "hurtbox should still be visible after one ArrowLeft").toBeTruthy();
  expect(afterOne.width, "one ArrowLeft must not collapse to a foot speck").toBeGreaterThan(
    before.width * 0.6,
  );
  expect(afterOne.height).toBeGreaterThan(before.height * 0.6);
  expect(Math.abs(afterOne.height - before.height)).toBeLessThanOrEqual(nudgeSlack(before.height));

  for (let step = 0; step < 11; step += 1) await page.keyboard.press("ArrowLeft");

  await expect(page.locator("#status")).toContainText("nudge box");
  await expect(page.locator("#filmstrip .thumb[data-frame-index='0']")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const after = await measureHurtbox(page);
  expect(after, "hurtbox should still be visible after ArrowLeft").toBeTruthy();
  expect(after.width).toBeGreaterThan(before.width * 0.6);
  expect(after.height).toBeGreaterThan(before.height * 0.6);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(nudgeSlack(before.height));
  expect(after.left, "undo-label-only is not a successful nudge").toBeLessThan(before.left);
  expect(after.right).toBeLessThan(before.right);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(nudgeSlack(before.width));
});

test("BOX-006 restore-auto ArrowUp cannot jump-collapse the hurtbox", async ({ page }) => {
  await openRestoredHurtbox(page);
  const before = await measureHurtbox(page);
  expect(before, "restored auto hurtbox should be visible").toBeTruthy();
  expect(before.height).toBeGreaterThan(20);

  const center = await canvasToClient(
    page,
    (before.left + before.right) / 2,
    (before.top + before.bottom) / 2,
  );
  await page.mouse.click(center.x, center.y);
  for (let step = 0; step < 12; step += 1) await page.keyboard.press("ArrowUp");

  await expect(page.locator("#status")).toContainText("nudge box");
  const after = await measureHurtbox(page);
  expect(after, "hurtbox should still be visible after ArrowUp").toBeTruthy();
  expect(after.width).toBeGreaterThan(before.width * 0.6);
  expect(after.height).toBeGreaterThan(before.height * 0.6);
  expect(after.top).toBeLessThan(before.top);
  expect(after.bottom).toBeLessThan(before.bottom);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(nudgeSlack(before.width));
});

test("BOX-006 west-handle drag after restore-auto moves only the left edge", async ({ page }) => {
  await openRestoredHurtbox(page);
  const before = await measureHurtbox(page);
  expect(before, "restored auto hurtbox should be visible").toBeTruthy();
  expect(before.width).toBeGreaterThan(20);

  const handle = await canvasToClient(page, before.left, (before.top + before.bottom) / 2);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 36, handle.y);
  await page.mouse.up();

  await expect(page.locator("#status")).toContainText("resize box");
  const after = await measureHurtbox(page);
  expect(after, "hurtbox should still be visible after handle drag").toBeTruthy();
  expect(after.width).toBeGreaterThan(20);
  expect(after.width).toBeLessThan(before.width);
  expect(Math.abs(after.right - before.right)).toBeLessThan(10);
  expect(Math.abs(after.height - before.height)).toBeLessThan(10);
});
