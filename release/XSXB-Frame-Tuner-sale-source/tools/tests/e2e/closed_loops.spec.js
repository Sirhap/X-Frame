"use strict";

const { expect, test } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const zlib = require("node:zlib");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);
const WIDE_IMAGE_PATH = path.resolve(__dirname, "../../../docs/screenshot.png");
const PNG_DATA_URL = `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`;

/**
 * Imports an isolated project through the real server API for test setup.
 * @param {import("@playwright/test").APIRequestContext} request Playwright request context.
 * @param {string} suffix Unique project suffix.
 * @param {number} frameCount Number of animation frames.
 * @returns {Promise<object>} Import response.
 */
async function importProject(request, suffix, frameCount = 2) {
  const response = await request.post("/api/import-animation", {
    data: {
      projectLabel: `E2E ${suffix}`,
      profileLabel: "Hero",
      animationName: `animation-${suffix}`,
      fps: 12,
      items: Array.from({ length: frameCount }, (_, index) => ({
        name: `frame_${String(index + 1).padStart(4, "0")}.png`,
        data: PNG_DATA_URL,
      })),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

/**
 * Dispatches a browser-native file drop onto one animation frame.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {{name:string,type:string,bytes:number[]}} file File descriptor.
 * @returns {Promise<void>}
 */
async function dropFileOnCurrentFrame(page, file) {
  await page.locator(".thumb.primary").evaluate((element, descriptor) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(descriptor.bytes)], descriptor.name, { type: descriptor.type }),
    );
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, file);
}

/**
 * Reads local ZIP entries produced by the browser without adding a test-only dependency.
 * @param {Buffer} archive ZIP bytes.
 * @returns {Map<string, Buffer>} Uncompressed entry contents by name.
 */
function readZipEntries(archive) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    expect(flags & 0x08).toBe(0);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed));
    offset = dataStart + compressedSize;
  }
  return entries;
}

test("image import creates a persisted animation through the organizer", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerAnimationName").fill("loop-idle");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator(".organizerFrame")).toHaveCount(2);
  await page.locator("#organizerApply").click();
  await expect(page.locator("#organizerConfirmPanel")).toBeVisible();
  await expect(page.locator("#organizerConfirmMessage")).toContainText("创建为动画");
  await page.locator("#organizerConfirmAccept").click();
  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.locator("#organizerModal")).toBeHidden();
  await expect(page.locator("#projectSelect option:checked")).toContainText("E2E Seed Project");
  await expect(page.locator("#groupSelect option:checked")).toContainText("loop-idle");
  await expect(page.locator(".thumb")).toHaveCount(2);
});

test("editor tuning, frame attachment, and audio survive save and reload", async ({ page, request }) => {
  await importProject(request, "editor-media");
  await page.goto("/workspace");
  await expect(page.locator(".thumb")).toHaveCount(2);
  await page.locator("label:has(#adjustFrame)").click();
  await expect(page.locator("#adjustFrame")).toBeChecked();
  await page.locator('[data-step-target="baseX"][data-step-dir="1"]').click();
  await page.locator("#frameReference").check({ force: true });
  await expect(page.locator("#frameReference")).toBeChecked();
  await page.locator(".thumb.primary .durationStep").last().click();

  await dropFileOnCurrentFrame(page, {
    name: "attachment.png",
    type: "image/png",
    bytes: Array.from(ONE_PIXEL_PNG),
  });
  await expect(page.locator(".attachmentThumb")).toHaveCount(1);
  await dropFileOnCurrentFrame(page, {
    name: "effect.wav",
    type: "audio/wav",
    bytes: [82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69],
  });
  await expect(page.locator(".thumb.primary")).toHaveClass(/hasSfx/);

  await page.locator("#save").click();
  await expect(page.locator("#saveState")).toContainText("已保存");
  await page.reload();
  await expect(page.locator("#baseX")).toHaveValue("1");
  await expect(page.locator(".attachmentThumb")).toHaveCount(1);
  await expect(page.locator(".thumb.primary")).toHaveClass(/hasSfx/);

  await page.locator(".thumb.primary .frameSfxBadge").click();
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await expect(page.locator("#appConfirmCard")).toHaveAttribute("data-tone", "danger");
  await page.keyboard.press("Escape");
  await expect(page.locator("#appConfirmPanel")).toBeHidden();
  await expect(page.locator(".thumb.primary")).toHaveClass(/hasSfx/);

  await page.locator(".thumb.primary .frameSfxBadge").click();
  await page.locator("#appConfirmAccept").click();
  await expect(page.locator("#appConfirmPanel")).toBeHidden();
  await expect(page.locator(".thumb.primary")).not.toHaveClass(/hasSfx/);
});

test("focused controls keep native Space behavior without starting playback", async ({ page }) => {
  await page.goto("/workspace");
  const secondFrame = page.locator('.thumb[data-frame-index="1"]');
  await secondFrame.focus();
  await page.keyboard.press("Space");
  await expect(secondFrame).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/frame=1/);
  await expect(page.locator("#playPause")).toHaveText("播放");

  await page.getByRole("button", { name: "批量抠图" }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await expect(page.locator("#playPause")).toHaveText("播放");
});

test("workspace starts when browser storage access is denied", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access denied", "SecurityError");
      },
    });
  });

  await page.goto("/workspace");
  await expect(page.locator(".app")).toBeVisible();
  await expect(page.locator(".thumb")).toHaveCount(2);
});

test("mobile frame deletion and animation clearing remain explicit and bounded", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await importProject(request, "frame-delete", 3);
  await page.goto("/workspace");
  await expect(page.locator(".thumb")).toHaveCount(3);

  await page.locator(".frameActionsMenu > summary").click();
  await page.locator("#deleteSelectedFrames").click();
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await expect(page.locator("#appConfirmCancel")).toBeFocused();
  await expect(page.locator("#appConfirmAccept")).toHaveText("删除所选");
  const dialogMetrics = await page.locator("#appConfirmCard").evaluate((card) => {
    const bounds = card.getBoundingClientRect();
    const buttonHeights = Array.from(
      card.querySelectorAll("button"),
      (button) => button.getBoundingClientRect().height,
    );
    return { top: bounds.top, bottom: bounds.bottom, viewportHeight: window.innerHeight, buttonHeights };
  });
  expect(dialogMetrics.top).toBeGreaterThanOrEqual(0);
  expect(dialogMetrics.bottom).toBeLessThanOrEqual(dialogMetrics.viewportHeight);
  expect(dialogMetrics.buttonHeights.every((height) => height >= 48)).toBe(true);
  await page.keyboard.press("Space");
  await expect(page.locator("#appConfirmPanel")).toBeHidden();
  await expect(page.locator("#playPause")).toHaveText("播放");
  await expect(page.locator(".thumb")).toHaveCount(3);

  await page.locator("#deleteSelectedFrames").click();
  await page.locator("#appConfirmAccept").click();
  await expect(page.locator(".thumb")).toHaveCount(2);

  await page.locator("#clearAnimation").click();
  await expect(page.locator("#appConfirmCancel")).toBeFocused();
  await expect(page.locator("#appConfirmAccept")).toHaveText("清空动画");
  await page.keyboard.press("Escape");
  await expect(page.locator(".thumb")).toHaveCount(2);

  await page.locator("#clearAnimation").click();
  await page.locator("#appConfirmAccept").click();
  await expect(page.locator(".thumb")).toHaveCount(0);
  await expect(page.locator("#groupSelect")).toBeDisabled();
});

test("organizer reorders data through the server and reloads the reduced animation", async ({
  page,
  request,
}) => {
  await importProject(request, "reorganize", 4);
  await page.goto("/tools/organizer");
  await expect(page.locator(".organizerFrame")).toHaveCount(4);
  await page.locator("#organizerReduceStep").fill("2");
  await page.locator("#organizerReduce").click();
  await page.locator("#organizerApply").click();
  await page.locator("#organizerConfirmAccept").click();
  await expect(page.locator(".organizerFrame")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".organizerFrame")).toHaveCount(2);
});

test("batch cutout downloads a readable ZIP with PNG outputs and a manifest", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "two.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#cutoutDownload").click();
  const download = await downloadPromise;
  const downloadPath = path.join(os.tmpdir(), `xsxb-${process.pid}-${Date.now()}.zip`);
  try {
    await download.saveAs(downloadPath);
    const entries = readZipEntries(fs.readFileSync(downloadPath));
    expect([...entries.keys()].filter((name) => name.endsWith(".png"))).toHaveLength(2);
    const manifest = JSON.parse(entries.get("cutout-manifest.json").toString("utf8"));
    expect(manifest.totals).toMatchObject({ images: 2, exported: 2, failed: 0 });
    for (const [name, contents] of entries) {
      if (name.endsWith(".png")) expect(contents.subarray(1, 4).toString("ascii")).toBe("PNG");
    }
  } finally {
    fs.rmSync(downloadPath, { force: true });
  }
});

test("video extraction produces frames and opens loop analysis", async ({ page }) => {
  const videoPath = path.join(os.tmpdir(), `xsxb-video-${process.pid}-${Date.now()}.webm`);
  const generated = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=64x64:rate=8:duration=1",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "200k",
      "-y",
      videoPath,
    ],
    { encoding: "utf8" },
  );
  expect(generated.status, generated.stderr).toBe(0);
  try {
    await page.goto("/tools/import");
    await page.locator("#organizerVideoInput").setInputFiles(videoPath);
    await expect(page.locator("#organizerVideoPanel")).toBeVisible();
    await expect(page.locator("#organizerVideoExtract")).toBeEnabled();
    await page.locator("#organizerVideoFpsNumber").fill("8");
    await page.locator("#organizerVideoExtract").click();
    await expect
      .poll(() => page.locator(".organizerFrame").count(), { timeout: 20000 })
      .toBeGreaterThanOrEqual(4);
    await page.locator("#organizerFindLoop").click();
    await expect(page.locator("#organizerLoopPanel")).toBeVisible();
    await page.locator("#organizerLoopStartSearch").click();
    await expect(page.locator("#organizerLoopProgressText")).toBeVisible();
    await expect(page.locator("#organizerLoopResults")).toBeVisible({ timeout: 20000 });
  } finally {
    fs.rmSync(videoPath, { force: true });
  }
});

test("save failure remains dirty and a retry closes the persistence loop", async ({ page, request }) => {
  await importProject(request, "save-retry");
  await page.route("**/api/save", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: '{"error":"forced conflict"}',
    });
  });
  await page.goto("/workspace");
  await page.locator('[data-step-target="baseX"][data-step-dir="1"]').click();
  await page.locator("#save").click();
  await expect(page.locator("#status")).toContainText("forced conflict");
  await expect(page.locator("#saveState")).not.toContainText("没有改动");
  await page.unroute("**/api/save");
  await page.locator("#save").click();
  await expect(page.locator("#saveState")).toContainText("已保存", { timeout: 20000 });
});

test("project switching, clearing, and deletion preserve explicit confirmation", async ({
  page,
  request,
}) => {
  const first = await importProject(request, "lifecycle-a");
  const second = await importProject(request, "lifecycle-b");
  await page.goto("/workspace");
  await page.locator('[data-step-target="baseX"][data-step-dir="1"]').click();
  await page.locator("#projectContext > summary").click();
  await page.locator("#projectSelect").focus();
  await page.locator("#projectSelect").selectOption(first.activeProjectId);
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await expect(page.locator("#appConfirmMessage")).toContainText("未保存");
  await expect(page.locator("#mainWorkbench")).toHaveAttribute("inert", "");
  await expect(page.locator("#appConfirmAccept")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#appConfirmPanel")).toBeHidden();
  await expect(page.locator("#mainWorkbench")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#projectSelect")).toBeFocused();
  await expect(page.locator("#projectSelect")).toHaveValue(second.activeProjectId);

  await page.locator("#projectSelect").selectOption(first.activeProjectId);
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await page.locator("#appConfirmAccept").click();
  await expect(page.locator("#projectSelect")).toHaveValue(first.activeProjectId);

  await page.locator("#clearProject").click();
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await expect(page.locator("#appConfirmCard")).toHaveAttribute("data-tone", "danger");
  await expect(page.locator("#appConfirmMessage")).toContainText("清空项目");
  await page.locator("#appConfirmAccept").click();
  await expect(page.locator("#groupSelect")).toBeDisabled();

  await page.locator("#deleteProject").click();
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await expect(page.locator("#appConfirmMessage")).toContainText("删除项目");
  await page.locator("#appConfirmAccept").click();
  await expect(page.locator(`#projectSelect option[value="${first.activeProjectId}"]`)).toHaveCount(0);
});

test("@cross-browser route reload restores the selected animation", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.locator("#stage")).toBeVisible();
  await page.goto("/tools/organizer");
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.reload();
  await expect(page.locator("#organizerModal")).toBeVisible();
});

test("@touch touch input can select and process a cutout frame", async ({ page }) => {
  test.skip(!test.info().project.use.hasTouch, "Runs only in the touch-enabled project.");
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "touch-frame.png",
    mimeType: "image/png",
    buffer: fs.readFileSync(WIDE_IMAGE_PATH),
  });
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  await page.getByRole("button", { name: "原图恢复笔" }).tap();
  await expect(page.locator("#cutoutActiveToolTitle")).toHaveText("原图恢复笔");
  await page.locator("#cutoutResult").tap();
  await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正");
});

test("@touch touch controls can reorder an attached image layer", async ({ page, request }) => {
  test.skip(!test.info().project.use.hasTouch, "Runs only in the touch-enabled project.");
  await importProject(request, "touch-layer", 1);
  await page.goto("/workspace");
  await dropFileOnCurrentFrame(page, {
    name: "touch-layer.png",
    type: "image/png",
    bytes: Array.from(ONE_PIXEL_PNG),
  });
  await expect(page.locator(".attachmentThumb")).toHaveCount(1);
  const moveDownButton = page.locator(".attachmentThumb").getByRole("button", { name: "图层下移" });
  const buttonBounds = await moveDownButton.boundingBox();
  expect(buttonBounds?.width).toBeGreaterThanOrEqual(44);
  expect(buttonBounds?.height).toBeGreaterThanOrEqual(44);
  await moveDownButton.tap();
  await expect(page.locator(".attachmentThumb")).toHaveClass(/layerBelow/);
});
