"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { expect, test } = require("@playwright/test");
const { readZipEntries } = require("./zip_test_utils");

const REAL_TRAIL_ASSET = path.join(
  __dirname,
  "../../animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
);

/**
 * Reads the minimum and maximum Alpha values from a rendered preview canvas.
 * @param {import("@playwright/test").Locator} canvas Result canvas locator.
 * @returns {Promise<{min:number,max:number}>} Observed Alpha range.
 */
async function readCanvasAlphaRange(canvas) {
  return canvas.evaluate((element) => {
    const context = element.getContext("2d", { willReadFrequently: true });
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let min = 255;
    let max = 0;
    for (let offset = 3; offset < pixels.length; offset += 4) {
      min = Math.min(min, pixels[offset]);
      max = Math.max(max, pixels[offset]);
    }
    return { min, max };
  });
}

test("real trail asset completes batch cutout and exports a readable ZIP", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles(REAL_TRAIL_ASSET);
  await expect(page.locator("#cutoutStatus")).toHaveText("已载入 1 张图片");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", {
    timeout: 20000,
  });

  const alphaRange = await readCanvasAlphaRange(page.locator("#cutoutResult"));
  expect(alphaRange.min).toBe(0);
  expect(alphaRange.max).toBe(255);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#cutoutDownload").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);

  const downloadPath = path.join(os.tmpdir(), `xsxb-real-cutout-${process.pid}-${Date.now()}.zip`);
  try {
    await download.saveAs(downloadPath);
    const archive = fs.readFileSync(downloadPath);
    expect(archive.length).toBeGreaterThan(0);

    const entries = readZipEntries(archive);
    const output = entries.get("dynamic_trail_luma.png");
    expect(output).toBeDefined();
    expect(output.subarray(1, 4).toString("ascii")).toBe("PNG");

    const manifest = JSON.parse(entries.get("cutout-manifest.json").toString("utf8"));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      sourceKind: "files",
      totals: { images: 1, exported: 1, excluded: 0, failed: 0 },
      frames: [{ name: "dynamic_trail_luma.png", excluded: false, status: "processed" }],
    });
    await expect(page.locator("#cutoutStatus")).toHaveText("ZIP 已生成：1 张图片，失败 0 张");
  } finally {
    fs.rmSync(downloadPath, { force: true });
  }
});
