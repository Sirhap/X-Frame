"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { expect, test } = require("./fixtures");

const VIDEO_WIDTH = 320;
const VIDEO_HEIGHT = 180;
const VIDEO_FPS = 12;
const VIDEO_DURATION = 1;
const PRESET_REGION = Object.freeze({ x: 234, y: 4, width: 80, height: 22 });
const sourcePath = path.join(os.tmpdir(), `xsxb-watermark-e2e-source-${process.pid}.mp4`);

/**
 * Generates a deterministic short video with a bright top-right watermark.
 * @param {string} filePath Destination MP4 path.
 * @returns {void}
 */
function generateSourceVideo(filePath) {
  const generated = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x203040:size=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:rate=${VIDEO_FPS}:duration=${VIDEO_DURATION}`,
      "-vf",
      "drawbox=x=40+80*t:y=70:w=32:h=32:color=0xdd3344:t=fill,drawbox=x=250:y=9:w=54:h=14:color=white:t=fill",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      filePath,
    ],
    { encoding: "utf8" },
  );
  expect(generated.status, generated.stderr || generated.error?.message).toBe(0);
}

/**
 * Probes a downloaded video and returns its primary stream metadata.
 * @param {string} filePath Downloaded MP4 path.
 * @returns {{codec_name:string,width:number,height:number,r_frame_rate:string,duration:string}}
 */
function probeVideo(filePath) {
  const probed = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,r_frame_rate,duration",
      "-of",
      "json",
      filePath,
    ],
    { encoding: "utf8" },
  );
  expect(probed.status, probed.stderr || probed.error?.message).toBe(0);
  return JSON.parse(probed.stdout).streams[0];
}

/**
 * Reads average luma from the same region used by the editor preset.
 * @param {string} filePath Video path.
 * @returns {number} Mean YAVG across decoded frames.
 */
function readRegionLuma(filePath) {
  const analyzed = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      filePath,
      "-vf",
      `crop=${PRESET_REGION.width}:${PRESET_REGION.height}:${PRESET_REGION.x}:${PRESET_REGION.y},signalstats,metadata=print:file=-`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  expect(analyzed.status, analyzed.stderr || analyzed.error?.message).toBe(0);
  const values = Array.from(analyzed.stdout.matchAll(/YAVG=([\d.]+)/g), (match) => Number(match[1]));
  expect(values.length).toBeGreaterThan(0);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Downloads the completed repair and saves it to a unique temporary path.
 * @param {import("@playwright/test").Page} page Watermark Studio page.
 * @param {string} label Output label used in the temporary filename.
 * @returns {Promise<string>} Saved MP4 path.
 */
async function downloadRepair(page, label) {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadButton").click();
  const download = await downloadPromise;
  const outputPath = path.join(os.tmpdir(), `xsxb-watermark-e2e-${label}-${process.pid}-${Date.now()}.mp4`);
  await download.saveAs(outputPath);
  return outputPath;
}

test.beforeAll(() => generateSourceVideo(sourcePath));
test.afterAll(() => fs.rmSync(sourcePath, { force: true }));

test("watermark studio exports real rectangle and smart repairs", async ({ page }) => {
  test.setTimeout(120_000);
  const outputPaths = [];
  try {
    await page.goto("/tools/watermark");
    await expect(page.locator("#processingBadge")).toContainText("READY");
    await page.locator("#fileInput").setInputFiles(sourcePath);
    await expect(page.locator("#sourceMeta")).toContainText("320 × 180 · 12 FPS");
    await page.getByRole("button", { name: "右上" }).click();
    await expect(page.locator(".mask-item")).toContainText("234, 4 / 80 × 22");

    await page.locator("#exportButton").click();
    await expect(page.locator("#progressText")).toHaveText("修复完成", { timeout: 60_000 });
    const rectangleOutput = await downloadRepair(page, "rectangle");
    outputPaths.push(rectangleOutput);
    expect(probeVideo(rectangleOutput)).toMatchObject({
      codec_name: "h264",
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      r_frame_rate: `${VIDEO_FPS}/1`,
    });

    await page.locator("label").filter({ hasText: "智能修复" }).click();
    const referenceTime = page.locator("#referenceTime");
    await expect(referenceTime).toHaveValue("0.91");
    expect(await referenceTime.evaluate((input) => input.checkValidity())).toBe(true);
    await expect(page.locator("#downloadButton")).toBeHidden();
    await expect(page.locator("#downloadButton")).not.toHaveAttribute("href");

    await page.locator("#exportButton").click();
    await expect(page.locator("#progressText")).toHaveText("修复完成", { timeout: 90_000 });
    const smartOutput = await downloadRepair(page, "smart");
    outputPaths.push(smartOutput);
    expect(probeVideo(smartOutput)).toMatchObject({
      codec_name: "h264",
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      r_frame_rate: `${VIDEO_FPS}/1`,
    });
    expect(readRegionLuma(smartOutput)).toBeLessThan(readRegionLuma(sourcePath) - 5);

    await referenceTime.fill("0.5");
    await referenceTime.dispatchEvent("input");
    await expect(page.locator("#downloadButton")).toBeHidden();
    await expect(page.locator("#downloadButton")).not.toHaveAttribute("href");
  } finally {
    for (const outputPath of outputPaths) fs.rmSync(outputPath, { force: true });
  }
});

test("@touch watermark studio keeps all tool entries visible without horizontal overflow", async ({
  page,
}) => {
  test.skip(!test.info().project.use.hasTouch, "Runs only in the touch-enabled project.");
  await page.goto("/tools/watermark");
  const navigationLinks = page.locator('nav a[href^="/tools"]');
  await expect(navigationLinks).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) await expect(navigationLinks.nth(index)).toBeVisible();
  await expect(page.getByRole("link", { name: "视频去水印" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
