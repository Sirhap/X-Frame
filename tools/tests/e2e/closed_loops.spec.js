"use strict";

const { expect, test } = require("./fixtures");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readZipEntries } = require("./zip_test_utils");

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

test("image import writes frames into the current animation through the organizer", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "loop-idle.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator("#organizerApply")).toHaveText("替换当前动画");
  await expect(page.locator("#organizerImportSetup")).toBeHidden();
  await expect(page.locator(".organizerFrame")).toHaveCount(2);
  await page.locator("#organizerApply").click();
  await expect(page.locator("#organizerConfirmPanel")).toBeVisible();
  await expect(page.locator("#organizerConfirmMessage")).toContainText("覆盖动画帧");
  await expect(page.locator("#organizerConfirmMessage")).not.toContainText("动画组");
  await page.locator("#organizerConfirmAccept").click();
  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.locator("#organizerModal")).toBeHidden();
  await expect(page.locator("#projectSelect option:checked")).toContainText("E2E Seed Project");
  await expect(page.locator("#groupSelect option:checked")).toContainText("Idle");
  await expect(page.locator("#groupSelect option:checked")).not.toContainText("loop-idle");
  await expect(page.locator(".thumb")).toHaveCount(2);
});

test("workspace import writes extracted frames into the current animation", async ({ page }) => {
  await page.goto("/workspace/resources/import");
  await expect(page.locator("#organizerApply")).toHaveText("替换当前动画");
  await expect(page.locator("#organizerImportSetup")).toBeHidden();
  await expect(page.locator(".organizerFrame")).toHaveCount(2);
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "swing_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "swing_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "swing_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator(".organizerFrame")).toHaveCount(5);
  await page.locator("#organizerApply").click();
  await expect(page.locator("#organizerConfirmPanel")).toBeVisible();
  await expect(page.locator("#organizerConfirmMessage")).toContainText("覆盖动画帧");
  await expect(page.locator("#organizerConfirmMessage")).not.toContainText("动画组");
  await page.locator("#organizerConfirmAccept").click();
  await expect(page.locator("#organizerConfirmPanel")).toBeHidden();
  await expect(page.locator(".organizerFrame")).toHaveCount(5);
  await page.goto("/workspace/animation/transform");
  await expect(page.locator("#groupSelect option:checked")).toContainText("Idle");
  await expect(page.locator("#groupSelect option:checked")).not.toContainText("swing");
  await expect(page.locator(".thumb")).toHaveCount(5);
});

test("single-frame animation disables playback and explains why", async ({ page, request }) => {
  await importProject(request, "single-frame", 1);
  await page.goto("/workspace/animation/transform");

  await expect(page.locator(".thumb")).toHaveCount(1);
  await expect(page.locator("#playPause")).toBeDisabled();
  await expect(page.locator("#playbackAvailability")).toHaveText("单帧动画，无需播放");
  await expect(page.locator("#playbackAvailability")).toHaveAttribute("data-state", "single");
});

test("desktop workspace uses one page scroll instead of locked nested vertical panes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/workspace/animation/transform");
  await page.locator(".sidebar details").evaluateAll((panels) =>
    panels.forEach((panel) => {
      panel.open = true;
    }),
  );

  const before = await page.evaluate(() => ({
    bodyOverflow: getComputedStyle(document.body).overflowY,
    appHeight: getComputedStyle(document.querySelector(".app")).height,
    innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    scrollY,
  }));
  expect(before.bodyOverflow).not.toBe("hidden");
  expect(before.scrollHeight).toBeGreaterThan(before.innerHeight);
  await page.mouse.wheel(0, 560);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator(".workspaceFlowHeader")).toBeInViewport();

  const verticalScrollOwners = await page.evaluate(() =>
    [".sidebar", ".workspace", ".settingsScroll"]
      .map((selector) => {
        const element = document.querySelector(selector);
        return element
          ? [selector, element.scrollHeight, element.clientHeight, getComputedStyle(element).overflowY]
          : null;
      })
      .filter(Boolean),
  );
  expect(
    verticalScrollOwners.every(([, scrollHeight, clientHeight]) => scrollHeight <= clientHeight + 1),
  ).toBe(true);
});

test("organizer route renders as a page section and scrolls with the document", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/workspace/resources/import");
  await expect(page.locator("#organizerModal")).toBeVisible();
  const layout = await page.locator("#organizerModal").evaluate((element) => ({
    position: getComputedStyle(element).position,
    bodyOverflow: getComputedStyle(document.body).overflowY,
  }));
  expect(layout.position).not.toBe("fixed");
  expect(layout.bodyOverflow).not.toBe("hidden");
});

test("organizer video overlay covers preview actions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/workspace/resources/import");
  await expect(page.locator(".organizerFooterActions")).toBeVisible();
  await page.locator(".organizerDownstreamMenu").evaluate((element) => {
    element.open = true;
  });
  await page.locator("#organizerVideoPanel").evaluate((element) => {
    element.hidden = false;
  });
  await expect(page.locator("#organizerVideoPanel")).toBeVisible();

  const coverage = await page.evaluate(() => {
    const overlay = document.querySelector("#organizerVideoPanel");
    const hit = (selector) => {
      const bounds = document.querySelector(selector).getBoundingClientRect();
      const target = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return overlay.contains(target);
    };
    return {
      applyCovered: hit("#organizerApply"),
      moreCovered: hit(".organizerDownstreamMenu > summary"),
    };
  });
  expect(coverage.applyCovered).toBe(true);
  expect(coverage.moreCovered).toBe(true);
});

test("organizer primary action sits above the preview canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/workspace/resources/import");
  await expect(page.locator("#organizerPreview")).toBeVisible();
  await expect(page.locator(".organizerFooterActions")).toBeVisible();

  const geometry = await page.evaluate(() => {
    const preview = document.querySelector("#organizerPreview").getBoundingClientRect();
    const actions = document.querySelector(".organizerFooterActions").getBoundingClientRect();
    return { previewTop: preview.top, actionsBottom: actions.bottom };
  });
  expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.previewTop);
});

/**
 * Asserts the FFmpeg/local-only reason is painted next to the format pills.
 * @param {import("@playwright/test").Locator} hint Local-export hint paragraph.
 * @returns {Promise<void>}
 */
async function expectVisibleExportHint(hint) {
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(/GIF|MP4|FFmpeg|本地/);
  const metrics = await hint.evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const section = element.closest(".mediaExportFormatSection");
    return {
      display: style.display,
      visibility: style.visibility,
      width: box.width,
      height: box.height,
      inFormatSection: Boolean(section),
      inNoticesOnly: Boolean(element.closest(".mediaExportNotices")) && !section,
    };
  });
  expect(metrics.display, "ORG-023 forbids hiding the disable reason with display:none").not.toBe("none");
  expect(metrics.visibility).not.toBe("hidden");
  expect(metrics.width, "ORG-023 needs a painted FFmpeg reason, not width 0").toBeGreaterThan(0);
  expect(metrics.height, "ORG-023 needs a painted FFmpeg reason, not height 0").toBeGreaterThan(0);
  expect(metrics.inFormatSection, "ORG-023 needs the reason under the format row, not a clipped footer").toBe(
    true,
  );
  expect(metrics.inNoticesOnly).toBe(false);
}

test("online-disabled GIF and MP4 keep a visible FFmpeg reason", async ({ page }) => {
  await page.route("**/api/media-export/capabilities", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mode: "cloudflare-static", ffmpeg: { available: false, version: "" } }),
    });
  });
  await page.goto("/workspace/delivery/export");

  const hint = page.locator(".mediaExportFormatSection #mediaExportLocalHint");
  await expect(page.locator("#mediaExportDialog")).toBeVisible();
  await expect(page.locator("#mediaExportGif")).toBeDisabled();
  await expect(page.locator("#mediaExportMp4")).toBeDisabled();
  await expectVisibleExportHint(hint);
});

test("organizer export dialog shows a painted FFmpeg reason beside disabled GIF and MP4", async ({
  page,
}) => {
  await page.route("**/api/media-export/capabilities", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mode: "cloudflare-static", ffmpeg: { available: false, version: "" } }),
    });
  });
  await page.goto("/tools/organizer");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator(".organizerFrame")).toHaveCount(2);
  await page.locator(".organizerDownstreamMenu").evaluate((element) => {
    element.open = true;
  });
  await page.locator("#organizerExport").click();

  const hint = page.locator(".mediaExportFormatSection #mediaExportLocalHint");
  await expect(page.locator("#mediaExportDialog")).toBeVisible();
  await expect(page.locator("#mediaExportGif")).toBeDisabled();
  await expect(page.locator("#mediaExportMp4")).toBeDisabled();
  await expectVisibleExportHint(hint);
  await expect(page.locator(".mediaExportFooter > span")).toBeVisible();
});

test("file delivery embeds the complete export workbench without a second dialog", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/workspace/delivery/export");

  const exportWorkbench = page.locator("#mediaExportDialog");
  await expect(exportWorkbench).toBeVisible();
  await expect(exportWorkbench).toHaveAttribute("data-presentation", "embedded");
  await expect(exportWorkbench).toHaveAttribute("role", "region");
  await expect(exportWorkbench).not.toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".mediaExportFormats")).toBeVisible();
  await expect(page.locator(".mediaExportWorkspace")).toBeVisible();
  await expect(page.locator("#mediaExportPreviewCanvas")).toBeVisible();
  await expect(page.locator("#mediaExportSubmit")).toBeVisible();
  await expect(page.locator("#mediaExportCancel")).toBeHidden();
  await expect(page.locator("#deliveryOpenExport")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(exportWorkbench).toBeVisible();
});

test("standalone export uses the current animation when no temporary workset exists", async ({ page }) => {
  await page.goto("/tools/export");

  await expect(page.locator("#deliveryExportMount")).not.toContainText("请先导入需要导出的图片序列");
  await expect(
    page.locator("#mediaExportDialog, #deliveryExportMount .mediaExportDialog").first(),
  ).toBeVisible();
});

test("delivery tabs expose only their peer panel", async ({ page }) => {
  await page.goto("/workspace/delivery/godot");
  await expect(page.locator('[data-delivery-panel="godot"]')).toBeVisible();
  await expect(page.locator('[data-delivery-panel="export"]')).toBeHidden();
  await expect(page.locator('[data-delivery-panel="codex-pet"]')).toBeHidden();

  await page.locator('[data-workbench-route="codex-pet"]').first().click();
  await expect(page.locator('[data-delivery-panel="codex-pet"]')).toBeVisible();
  await expect(page.locator('[data-delivery-panel="godot"]')).toBeHidden();
  await expect(page.locator('[data-delivery-panel="export"]')).toBeHidden();
});

test("quick tools retain one temporary workset across organizer, cutout, and export", async ({ page }) => {
  await page.goto("/tools/organizer");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "idle_01.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "idle_02.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator(".organizerFrame")).toHaveCount(2);
  await expect
    .poll(() => page.evaluate(() => globalThis.XSXBTemporaryWorkset.getSnapshot().frames.length))
    .toBe(2);

  await page.locator('[data-workbench-route="cutout"]').first().click();
  await expect(page).toHaveURL(/\/tools\/cutout/);
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await expect(page.locator("#cutoutBatchSummary")).toContainText("2");

  await page.locator('[data-workbench-route="organizer"]').first().click();
  await expect(page).toHaveURL(/\/tools\/organizer/);
  await expect(page.locator(".organizerFrame")).toHaveCount(2);

  await page.evaluate(() => {
    const updatedCanvas = document.createElement("canvas");
    updatedCanvas.width = 2;
    updatedCanvas.height = 2;
    globalThis.XSXBTemporaryWorkset.setWorkset({
      name: "updated-cutout",
      sourceTool: "cutout",
      frames: [{ id: "updated-frame", name: "updated.png", image: updatedCanvas, enabled: true }],
    });
  });

  await page.locator('[data-workbench-route="export"]').first().click();
  await expect(page).toHaveURL(/\/tools\/export/);
  await expect(page.locator("#mediaExportDialog")).toBeVisible();
  await expect(page.locator("#mediaExportDialog")).toHaveAttribute("data-presentation", "embedded");
  await expect(page.locator("#mediaExportFrameCount")).toHaveText("1");
  await expect(page.locator("#mediaExportDialog")).toContainText("Sprite Sheet 预览");
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
  await expect(page.locator("#frameReference")).toBeChecked();
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

test("TUN-013 Space after clicking a non-play control does not start playback", async ({ page }) => {
  await page.goto("/workspace");
  await expect.poll(() => page.locator(".thumb").count()).toBeGreaterThan(1);
  await expect(page.locator("#playPause")).toHaveText("播放");

  const secondFrame = page.locator('.thumb[data-frame-index="1"]');
  await secondFrame.click();
  await expect(secondFrame).toHaveAttribute("aria-selected", "true");
  const afterThumb = await page.evaluate(() => ({
    tag: document.activeElement?.tagName || "",
    id: document.activeElement?.id || "",
    role: document.activeElement?.getAttribute?.("role") || "",
    frame: document.activeElement?.dataset?.frameIndex || "",
  }));
  expect(
    afterThumb.role === "option" || afterThumb.frame === "1",
    `thumb click left focus on ${afterThumb.tag}#${afterThumb.id}`,
  ).toBe(true);
  await page.keyboard.press("Space");
  await expect(page.locator("#playPause")).toHaveText("播放");

  await page.locator("#stageZoomFit").click();
  await page.keyboard.press("Space");
  await expect(page.locator("#playPause")).toHaveText("播放");

  await page.goto("/workspace/animation/trails");
  const trailPanel = page.locator("#attackTrailPanel");
  if (await trailPanel.count()) {
    await trailPanel.evaluate((panel) => {
      panel.hidden = false;
      panel.open = true;
    });
  }
  const addStick = page.locator("#attackTrailAddStick");
  if (await addStick.isVisible()) {
    await page.locator("#attackTrailMode").check();
    await addStick.click();
    await page.keyboard.press("Space");
    await expect(page.locator("#playPause")).toHaveText("播放");
  }

  await page.locator("#stage").click();
  await page.keyboard.press("Space");
  await expect(page.locator("#playPause")).toHaveText("暂停");
});

test("focused controls keep native Space behavior without starting playback", async ({ page }) => {
  await page.goto("/workspace");
  const secondFrame = page.locator('.thumb[data-frame-index="1"]');
  await secondFrame.focus();
  await page.keyboard.press("Space");
  await expect(secondFrame).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/frame=1/);
  await expect(page.locator("#playPause")).toHaveText("播放");

  const quickToolsLink = page.getByRole("link", { name: "快速工具" });
  await quickToolsLink.focus();
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.locator("#playPause")).toHaveText("播放");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tools$/);
  await expect(page.locator("#quickToolsHub")).toBeVisible();
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
  await expect.poll(() => page.locator(".thumb").count()).toBeGreaterThan(0);
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
      card.querySelectorAll("button:not([hidden])"),
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
  await expect(page.locator("#appConfirmAccept")).toHaveText("删除当前动画");
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
  await page.goto("/workspace/tools/organizer");
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
    await expect(page.locator("#organizerLoopResults")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#organizerLoopProgressText")).toHaveText("100%");
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
  await page.locator('a[data-workbench-route="overview"]').click();
  await page.locator("#projectSelect").selectOption(first.activeProjectId, { force: true });
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await expect(page.locator("#appConfirmMessage")).toContainText("未保存");
  await expect(page.locator("#mainWorkbench")).toHaveAttribute("inert", "");
  await expect(page.locator("#appConfirmAccept")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#appConfirmPanel")).toBeHidden();
  await expect(page.locator("#mainWorkbench")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#projectSelect")).toHaveValue(second.activeProjectId);

  await page.locator("#projectSelect").selectOption(first.activeProjectId, { force: true });
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await page.locator("#appConfirmAccept").click();
  await expect(page.locator("#projectSelect")).toHaveValue(first.activeProjectId);

  await page.locator("#clearProject").evaluate((button) => button.click());
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await expect(page.locator("#appConfirmCard")).toHaveAttribute("data-tone", "danger");
  await expect(page.locator("#appConfirmMessage")).toContainText("清空项目");
  await page.locator("#appConfirmAccept").click();
  await expect(page.locator("#groupSelect")).toBeDisabled();

  await page.locator("#deleteProject").evaluate((button) => button.click());
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
  const restoreSourceButton = page.getByRole("button", { name: "原图恢复笔" });
  await restoreSourceButton.evaluate((button) => button.scrollIntoView({ block: "center" }));
  const restoreSourceBounds = await restoreSourceButton.boundingBox();
  expect(restoreSourceBounds).not.toBeNull();
  await page.touchscreen.tap(
    restoreSourceBounds.x + restoreSourceBounds.width / 2,
    restoreSourceBounds.y + restoreSourceBounds.height / 2,
  );
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

test("standalone export reads frames already added to the current project", async ({ page, request }) => {
  await importProject(request, "export-standalone", 3);
  await page.goto("/tools/export");
  await expect(page.locator("#deliveryExportMount")).not.toContainText("请先导入需要导出的图片序列");
  await expect(
    page.locator("#mediaExportDialog, #deliveryExportMount .mediaExportDialog").first(),
  ).toBeVisible();
});
