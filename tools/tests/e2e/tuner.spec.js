"use strict";

const { expect, test } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);
const WIDE_IMAGE_PATH = path.resolve(__dirname, "../../../docs/screenshot.png");
const WIDE_IMAGE_PNG = fs.readFileSync(WIDE_IMAGE_PATH);

/**
 * Waits for the batch queue and the tray expansion transition to finish.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function expandStableBatchTray(page) {
  await expect.poll(() => page.locator(".cutoutQueueItem").count()).toBeGreaterThan(0);
  const batchTray = page.locator(".cutoutBatchTray");
  await page.locator("#cutoutBatchTrayToggle").click();
  await expect
    .poll(() => batchTray.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeLessThanOrEqual(1);
}

/**
 * Opens the single-image repair workbench with one full-size image and two navigation frames.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function openRepairWorkbench(page) {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: WIDE_IMAGE_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await page.locator(".organizerFrameCutout").first().click();
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await expect(page).toHaveURL(/\/tools\/import/);
  await expect(page.locator("#organizerModal")).toBeVisible();
  await expect(page.locator("#organizerModal")).toHaveAttribute("inert", "");
  await expect(page.locator("#organizerModal")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
}

/**
 * Selects a repair tool and waits until its result canvas is ready for a gesture.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {string} selector Repair-tool selector.
 * @returns {Promise<void>}
 */
async function selectRepairTool(page, selector) {
  const button = page.locator(selector);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveClass(/active/);
  await expect(button).toBeEnabled();
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
}

/**
 * Drags horizontally across the center of the editable preview.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function dragAcrossPreview(page) {
  const canvasBox = await page.locator("#cutoutResult").boundingBox();
  const y = canvasBox.y + canvasBox.height / 2;
  const startX = canvasBox.x + canvasBox.width * 0.45;
  const endX = canvasBox.x + canvasBox.width * 0.65;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 8 });
  await page.mouse.up();
}

test("desktop selection is linkable and browser history restores it", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle(/XSXB Frame Tuner$/);
  const options = await page
    .locator("#groupSelect option")
    .evaluateAll((nodes) => nodes.map((node) => node.value));
  if (options.length >= 2) {
    const firstUrl = page.url();
    await page.selectOption("#groupSelect", options[1]);
    await expect(page).toHaveURL(/group=/);
    expect(page.url()).not.toBe(firstUrl);
    await page.goBack();
    await expect(page.locator("#groupSelect")).toHaveValue(options[0]);
  }
  expect(errors).toEqual([]);
});

test("the original editor is the default and the home hub opens on demand", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#homeHub")).toBeHidden();
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#filmstrip")).toBeVisible();
  await expect(page.locator("#homeHubOpen")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#homeHubOpen").click();
  await expect(page.locator("#homeHub")).toBeVisible();
  await expect(page.locator("#homeAnimationCount")).toBeVisible();
  await expect(page.locator("#homeFrameCount")).toBeVisible();
  const [homeHubBox, filmstripBox] = await Promise.all([
    page.locator("#homeHub").boundingBox(),
    page.locator("#filmstrip").boundingBox(),
  ]);
  expect(homeHubBox).not.toBeNull();
  expect(filmstripBox).not.toBeNull();
  expect(homeHubBox.y + homeHubBox.height).toBeLessThanOrEqual(filmstripBox.y);
  await page.locator("#homeHubContinue").click();
  await expect(page.locator("#homeHub")).toBeHidden();
  await page.locator("#homeHubOpen").click();
  await page.locator('[data-home-tool="import"]').click();
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.locator("#organizerHome").click();
  await expect(page.locator("#homeHub")).toBeHidden();
  await expect(page.locator("#stage")).toBeVisible();
  await page.reload();
  await expect(page.locator("#homeHub")).toBeHidden();
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#filmstrip")).toBeVisible();
});

test("tool paths refresh, update titles, and return home", async ({ page }) => {
  await page.goto("/tools/import");
  await expect(page).toHaveURL(/\/tools\/import/);
  await expect(page).toHaveTitle(/导入动画/);
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.reload();
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.locator("#organizerHome").click();
  await expect(page).toHaveURL(/\/(?:\?|$)/);
  await expect(page.locator("#homeHub")).toBeHidden();
  await expect(page.locator("#stage")).toBeVisible();
});

test("native image import accepts valid files and reports unsupported input", async ({ page }) => {
  await page.goto("/tools/import");
  const imageInput = page.locator("#organizerFileInput");
  await imageInput.setInputFiles({ name: "frame.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
  await expect(page.locator("#organizerStatus")).toContainText("已导入 1 张图片");
  await expect(page.locator(".organizerFrame")).toHaveCount(1);
  await imageInput.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator("#organizerStatus")).toContainText("PNG、JPG 或 WebP");
});

test("organizer preview reports the currently playing frame", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator("#organizerPreviewFrame")).toContainText("/ 3 帧");
  await expect(page.locator(".organizerSpeed")).toBeVisible();
  const [previewStageBox, speedControlBox] = await Promise.all([
    page.locator(".organizerPreviewStage").boundingBox(),
    page.locator(".organizerSpeed").boundingBox(),
  ]);
  expect(speedControlBox.y).toBeGreaterThan(previewStageBox.y);
  expect(speedControlBox.y + speedControlBox.height).toBeLessThan(previewStageBox.y + previewStageBox.height);
  const firstLabel = await page.locator("#organizerPreviewFrame").textContent();
  await expect.poll(() => page.locator("#organizerPreviewFrame").textContent()).not.toBe(firstLabel);
});

test("single-image cutout keeps parameters local until apply-all", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await page.locator(".organizerFrameCutout").first().click();
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await expect(page.locator("#cutoutPrevious")).toHaveText("《");
  await expect(page.locator("#cutoutNext")).toHaveText("》");
  const [previousBox, nextBox, canvasBox] = await Promise.all([
    page.locator("#cutoutPrevious").boundingBox(),
    page.locator("#cutoutNext").boundingBox(),
    page.locator("#cutoutResult").boundingBox(),
  ]);
  expect(previousBox.width).toBeGreaterThanOrEqual(72);
  expect(previousBox.height).toBeGreaterThanOrEqual(96);
  expect(previousBox.x + previousBox.width / 2).toBeLessThan(canvasBox.x + 120);
  expect(nextBox.x + nextBox.width / 2).toBeGreaterThan(canvasBox.x + canvasBox.width - 120);
  expect(previousBox.y + previousBox.height / 2).toBeGreaterThan(canvasBox.y);
  expect(previousBox.y + previousBox.height / 2).toBeLessThan(canvasBox.y + canvasBox.height);

  await page.locator("#cutoutColor").evaluate((input) => {
    input.value = "#00ff00";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#cutoutTolerance").evaluate((input) => {
    input.value = "37";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#cutoutRepairBatch")).toBeEnabled();
  await expect(page.locator("#cutoutViewOriginal")).toHaveClass(/active/);

  await page.locator("#cutoutNext").click();
  await expect(page.locator("#cutoutTolerance")).toHaveValue("1");
  await page.locator("#cutoutPrevious").click();
  await expect(page.locator("#cutoutTolerance")).toHaveValue("37");

  const organizerThumbnails = page.locator(".organizerFrame img");
  const originalThumbnails = await organizerThumbnails.evaluateAll((images) =>
    images.map((image) => image.getAttribute("src")),
  );
  await page.locator("#cutoutRepairBatch").evaluate((button) => {
    window.__cutoutApplyProgress = [];
    new MutationObserver(() => window.__cutoutApplyProgress.push(button.textContent)).observe(button, {
      childList: true,
      subtree: true,
    });
  });
  await page.locator("#cutoutRepairBatch").click();
  await expect(page.locator("#cutoutStatus")).toContainText("当前参数应用到 3 张图片");
  await expect.poll(() => page.evaluate(() => window.__cutoutApplyProgress)).toContain("正在应用 3 / 3…");
  await expect
    .poll(async () => {
      const current = await organizerThumbnails.evaluateAll((images) =>
        images.map((image) => image.getAttribute("src")),
      );
      return current.every((source, index) => source !== originalThumbnails[index]);
    })
    .toBe(true);
  await page.locator("#cutoutRepairUndo").click();
  await expect
    .poll(() => organizerThumbnails.evaluateAll((images) => images.map((image) => image.getAttribute("src"))))
    .toEqual(originalThumbnails);
  await page.locator("#cutoutRepairRedo").click();
  await expect
    .poll(async () => {
      const current = await organizerThumbnails.evaluateAll((images) =>
        images.map((image) => image.getAttribute("src")),
      );
      return current.every((source, index) => source !== originalThumbnails[index]);
    })
    .toBe(true);
  await page.locator("#cutoutNext").click();
  await expect(page.locator("#cutoutTolerance")).toHaveValue("37");
  await expect(page.locator("#cutoutViewResult")).toHaveClass(/active/);
});

test("single-image navigation remains clickable while a repair tool is active", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: WIDE_IMAGE_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await page.locator(".organizerFrameCutout").first().click();
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await page.locator("#cutoutRepairBrush").click();
  await expect(page.locator("#cutoutViewResult")).toHaveClass(/active/);
  await expect(page.locator("#cutoutRepairBrush")).toBeEnabled();
  await expect(page.locator("#cutoutNext")).toBeEnabled();

  const nextBox = await page.locator("#cutoutNext").boundingBox();
  const edgePoint = {
    x: nextBox.x + nextBox.width / 2,
    y: nextBox.y + nextBox.height / 2,
  };
  await expect
    .poll(() => page.evaluate((point) => document.elementFromPoint(point.x, point.y)?.id, edgePoint))
    .toBe("cutoutNext");

  await page.mouse.click(edgePoint.x, edgePoint.y);

  await expect(page.locator("#cutoutFrameNumber")).toHaveValue("2");
  await expect(page.locator("#cutoutStatus")).toContainText("图片 2/3");
});

test("single-image clear region applies to every other image", async ({ page }) => {
  await openRepairWorkbench(page);
  await selectRepairTool(page, "#cutoutRepairClear");
  await dragAcrossPreview(page);
  await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正");

  await page.locator("#cutoutRepairBatch").click();

  await expect(page.locator("#cutoutStatus")).toContainText("已按画布位置应用到 2 张图片");
  await expect(page.locator("#cutoutStatus")).toContainText("未能处理 0 张");
});

test("brush-family and region repair tools keep edits after a horizontal release", async ({ page }) => {
  await openRepairWorkbench(page);
  await expect(page.locator("#cutoutBatchTray")).toBeHidden();
  for (const selector of [
    "#cutoutRepairSource",
    "#cutoutRepairEraser",
    "#cutoutRepairClear",
    "#cutoutRepairRestore",
  ]) {
    await selectRepairTool(page, selector);
    if (selector === "#cutoutRepairRestore") {
      await expect(page.locator("#cutoutSelectionHint")).toContainText("所有像素");
    }
    await dragAcrossPreview(page);
    await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正");
    await expect(page.locator("#cutoutRepairUndo")).toBeEnabled();
  }

  await selectRepairTool(page, "#cutoutRepairProtect");
  await dragAcrossPreview(page);
  await expect(page.locator("#cutoutStatus")).toContainText(/已提取|已智能识别保护范围|未提取到保护色/);
  await expect(page.locator("#cutoutProtectionPreview")).toBeVisible();
  await expect(page.locator(".cutoutProtectionPreviewLegend")).toContainText("黄色");
  await expect(page.locator("#cutoutProtectionPreviewStatus")).toContainText(/保护|识别/);
  await expect(page.locator("#cutoutRepairUndo")).toBeEnabled();

  await selectRepairTool(page, "#cutoutRepairBrush");
  await expect(page.locator("#cutoutProtectionPreview")).toBeHidden();

  await selectRepairTool(page, "#cutoutRepairProtect");
  await expect(page.locator("#cutoutProtectionPreviewStatus")).toContainText(/保护|识别/);
  await page.locator("#cutoutRepairReset").click();
  await expect(page.locator("#cutoutProtectionPreviewStatus")).toContainText("拖动框选保护区域");
});

test("background sampling follows the visible result after a local fill", async ({ page }) => {
  await openRepairWorkbench(page);
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  const canvasBox = await page.locator("#cutoutResult").boundingBox();
  const samplePoint = {
    x: canvasBox.x + canvasBox.width / 2,
    y: canvasBox.y + canvasBox.height / 2,
  };

  await page.locator("#cutoutRepairAutomaticQuick").click();
  await expect(page.locator("#cutoutRepairAutomatic")).toHaveClass(/active/);
  await expect(page.locator("#cutoutBackgroundHint")).toContainText("取样中");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  await page.mouse.click(samplePoint.x, samplePoint.y);
  await expect(page.locator("#cutoutStatus")).toContainText("已添加背景样本");
  await expect(page.locator("#cutoutRepairAutomaticQuick")).toHaveClass(/active/);
  await expect(page.locator("#cutoutBackgroundHint")).toContainText("取样中");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });

  await page.locator("#cutoutAreaColor").evaluate((input) => {
    input.value = "#00ff00";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await selectRepairTool(page, "#cutoutRepairFill");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  await page.mouse.click(samplePoint.x, samplePoint.y);
  await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正", { timeout: 15000 });

  await page.locator("#cutoutRepairAutomaticQuick").click();
  await expect(page.locator("#cutoutBackgroundHint")).toContainText("取样中");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  await page.mouse.click(samplePoint.x, samplePoint.y);

  await expect(page.locator("#cutoutStatus")).toContainText("当前结果色 #00ff00");
  await expect(page.locator("#cutoutColor")).toHaveValue("#00ff00");
  await expect(page.locator("#cutoutBackgroundColors button").first()).toHaveAttribute(
    "aria-label",
    /#00ff00/,
  );
});

test("switching from background sampling to a repair tool cancels sampling mode", async ({ page }) => {
  await openRepairWorkbench(page);
  await page.locator("#cutoutRepairAutomaticQuick").click();
  await expect(page.locator("#cutoutRepairAutomaticQuick")).toHaveClass(/active/);
  await selectRepairTool(page, "#cutoutRepairBrush");
  await expect(page.locator("#cutoutRepairAutomaticQuick")).not.toHaveClass(/active/);
  await expect(page.locator("#cutoutBackgroundHint")).toContainText("先点");
});

test("a fast brush stroke keeps its endpoint and commits on release", async ({ page }) => {
  await openRepairWorkbench(page);
  await selectRepairTool(page, "#cutoutRepairBrush");
  const canvasBox = await page.locator("#cutoutResult").boundingBox();
  const y = canvasBox.y + canvasBox.height * 0.5;
  const startX = canvasBox.x + canvasBox.width * 0.2;
  const endX = canvasBox.x + canvasBox.width * 0.8;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 1 });
  await page.mouse.up();

  await expect(page.locator("#cutoutFrameNumber")).toHaveValue("1");
  await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正");
  await expect(page.locator("#cutoutRepairUndo")).toBeEnabled();
});

test("a cancelled brush pointer commits the collected stroke", async ({ page }) => {
  await openRepairWorkbench(page);
  await selectRepairTool(page, "#cutoutRepairBrush");
  await page.evaluate(() => {
    document.querySelector("#cutoutResult").addEventListener(
      "pointerdown",
      (event) => {
        window.__repairPointerId = event.pointerId;
      },
      { once: true },
    );
  });
  const canvasBox = await page.locator("#cutoutResult").boundingBox();
  const y = canvasBox.y + canvasBox.height * 0.5;
  const startX = canvasBox.x + canvasBox.width * 0.3;
  const endX = canvasBox.x + canvasBox.width * 0.7;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 2 });
  const pointerId = await page.evaluate(() => window.__repairPointerId);
  await page.evaluate(
    ({ pointerId: activePointerId, clientX, clientY }) => {
      document.querySelector("#cutoutResult").dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          pointerId: activePointerId,
          pointerType: "mouse",
          isPrimary: true,
          clientX,
          clientY,
        }),
      );
    },
    { pointerId, clientX: endX, clientY: y },
  );

  await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正");
  await expect(page.locator("#cutoutRepairUndo")).toBeEnabled();
});

test("organizer confirms before discarding an imported workset", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });

  await page.locator("#organizerHome").click();
  await expect(page.locator("#organizerConfirmPanel")).toBeVisible();
  await expect(page.locator("#organizerConfirmTitle")).toHaveText("放弃工作集修改？");
  await page.locator("#organizerConfirmCancel").click();
  await expect(page.locator("#organizerModal")).toBeVisible();
  await expect(page).toHaveURL(/\/tools\/import/);

  await page.locator("#organizerHome").click();
  await page.locator("#organizerConfirmAccept").click();
  await expect(page.locator("#organizerModal")).toBeHidden();
  await expect(page).toHaveURL(/\/(?:\?|$)/);
});

test("cutout reports mixed-file skips and confirms destructive clearing", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles([
    { name: "frame.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") },
  ]);

  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);
  await expect(page.locator("#cutoutStatus")).toContainText("跳过 1");
  await expect(page.locator("#cutoutBatchTray")).toBeVisible();
  await expect(page.locator("#cutoutBatchTrayToggle")).toHaveAttribute("aria-label", "展开批次图片栏");

  await page.locator("#cutoutClear").click();
  await expect(page.locator("#cutoutConfirmTitle")).toHaveText("清空当前批次？");
  await page.locator("#cutoutConfirmCancel").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);

  await expandStableBatchTray(page);
  await page.locator("#cutoutDeleteSelected").click();
  await expect(page.locator("#cutoutConfirmTitle")).toHaveText("删除选中的图片？");
  await page.locator("#cutoutConfirmCancel").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);
  await page.locator("#cutoutDeleteSelected").click();
  await page.locator("#cutoutConfirmApply").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(0);

  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await page.locator("#cutoutClear").click();
  await page.locator("#cutoutConfirmApply").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(0);
});

test("cutout warns before refresh discards a local batch", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);

  const dialogPromise = page.waitForEvent("dialog");
  const reloadPromise = page.reload();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
  await reloadPromise;
  await expect(page).toHaveURL(/\/tools\/cutout/);
  await expect(page.locator("#cutoutModal")).toBeVisible();
});

test("cutout worker resolves beside its client on tool routes", async ({ page }) => {
  await page.goto("/tools/cutout");
  const alpha = await page.evaluate(async () => {
    const executor = window.BatchCutoutWorkerClient.createExecutor();
    try {
      const result = await executor.process(
        new Uint8ClampedArray([20, 40, 60, 255]),
        1,
        1,
        { backgroundColor: { r: 255, g: 255, b: 255 }, tolerance: 0 },
        [],
      );
      return result.data[3];
    } finally {
      executor.dispose();
    }
  });
  expect(alpha).toBe(255);
});

test("area tools expose and synchronize the transparent color shortcut", async ({ page }) => {
  await page.goto("/tools/cutout");
  const quickTransparent = page.locator("#cutoutAreaTransparentQuick");
  const detailedTransparent = page.locator("#cutoutAreaTransparent");
  await expect(quickTransparent).toBeVisible();
  await quickTransparent.click();
  await expect(quickTransparent).toHaveAttribute("aria-pressed", "true");
  await expect(detailedTransparent).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#cutoutActiveToolTitle")).toHaveText("区域补色");
  await detailedTransparent.click();
  await expect(quickTransparent).toHaveAttribute("aria-pressed", "false");
  await expect(detailedTransparent).toHaveAttribute("aria-pressed", "false");
});

test("cutout parameters follow the regular post-processing advanced layout", async ({ page }) => {
  await page.goto("/tools/cutout");
  const processingDefaults = await page
    .locator(
      [
        "#cutoutTolerance",
        "#cutoutEdgeBoost",
        "#cutoutBlendStrength",
        "#cutoutDespillStrength",
        "#cutoutEdgeDespillRadius",
        "#cutoutEdgeRecoveryStrength",
        "#cutoutBackgroundRadius",
        "#cutoutBlurRadius",
        "#cutoutFeather",
        "#cutoutChromaFeather",
        "#cutoutAlphaLow",
        "#cutoutAlphaHigh",
        "#cutoutAlphaThreshold",
        "#cutoutProtectionTolerance",
      ].join(","),
    )
    .evaluateAll((inputs) => Object.fromEntries(inputs.map((input) => [input.id, input.value])));
  expect(processingDefaults).toEqual({
    cutoutTolerance: "1",
    cutoutEdgeBoost: "10",
    cutoutBlendStrength: "0",
    cutoutDespillStrength: "0",
    cutoutEdgeDespillRadius: "0",
    cutoutEdgeRecoveryStrength: "0",
    cutoutBackgroundRadius: "0",
    cutoutBlurRadius: "0",
    cutoutFeather: "0",
    cutoutChromaFeather: "0",
    cutoutAlphaLow: "0",
    cutoutAlphaHigh: "0",
    cutoutAlphaThreshold: "0",
    cutoutProtectionTolerance: "0",
  });
  await expect(page.locator("#cutoutConnected")).not.toBeChecked();
  await expect(page.locator("#cutoutPerceptual")).not.toBeChecked();
  await expect(page.locator("[data-cutout-preset].active")).toHaveCount(0);
  await expect(page.locator("#cutoutTabRegular")).toHaveText("常规");
  await expect(page.locator("#cutoutEdgeBoost")).toBeVisible();
  await expect(page.locator("#cutoutBlendStrength")).toBeVisible();
  await expect(page.locator("#cutoutFeather")).toBeHidden();

  await page.locator("#cutoutTabPost").click();
  await expect(page.locator("#cutoutDespillStrength")).toBeVisible();
  await page.locator("#cutoutTabAdvanced").click();
  await expect(page.locator("#cutoutFeather")).toBeVisible();
  await expect(page.locator("#cutoutAlphaLow")).toBeVisible();
  await expect(page.locator("#cutoutProtectSample")).toBeVisible();
});

test("mobile cutout keeps preview first and supports keyboard repair", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "mobile-frame.png",
    mimeType: "image/png",
    buffer: WIDE_IMAGE_PNG,
  });
  const sourceRestore = page.getByRole("button", { name: "原图恢复笔" });
  await expect(sourceRestore).toBeVisible();
  await sourceRestore.click();
  await expect(page.locator("#cutoutActiveToolTitle")).toHaveText("原图恢复笔");
  await page.getByRole("button", { name: "背景清除" }).click();
  await expect(page.locator("#cutoutStatus")).toContainText("请在画布上点击");
  await sourceRestore.click();
  await expect(page.locator("#cutoutActiveToolTitle")).toHaveText("原图恢复笔");
  const preview = page.locator(".cutoutPreview");
  const controls = page.locator(".cutoutControls");
  await expect(preview).toBeVisible();
  const [previewBox, controlsBox] = await Promise.all([preview.boundingBox(), controls.boundingBox()]);
  expect(previewBox.y).toBeLessThan(controlsBox.y);
  expect(previewBox.y).toBeLessThan(844);

  await page.locator("#cutoutResult").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正");

  await expandStableBatchTray(page);
  const [compareBox, batchTrayBox, batchTrayMetrics] = await Promise.all([
    page.locator(".cutoutCompare").boundingBox(),
    page.locator(".cutoutBatchTray").boundingBox(),
    page.locator(".cutoutBatchTray").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    })),
  ]);
  expect(compareBox).not.toBeNull();
  expect(batchTrayBox).not.toBeNull();
  expect(compareBox.y + compareBox.height).toBeLessThanOrEqual(batchTrayBox.y);
  expect(batchTrayMetrics.scrollHeight).toBeLessThanOrEqual(batchTrayMetrics.clientHeight + 1);
  expect(errors).toEqual([]);
});

test("mobile editor presents the operation workspace before the parameter sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const [stageBox, workspaceBox, sidebarBox] = await Promise.all([
    page.locator("#stage").boundingBox(),
    page.locator(".workspace").boundingBox(),
    page.locator(".sidebar").boundingBox(),
  ]);
  expect(stageBox).not.toBeNull();
  expect(workspaceBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(stageBox.y).toBeLessThan(844);
  expect(workspaceBox.y).toBeLessThan(sidebarBox.y);
});

test("desktop cutout fixes the main workspace and anchors zoom to the canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: WIDE_IMAGE_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expandStableBatchTray(page);

  const preview = page.locator(".cutoutPreview");
  const [compareBox, zoomBox, batchTrayBox, footerBox, scrollMetrics, batchTrayMetrics] = await Promise.all([
    page.locator(".cutoutCompare").boundingBox(),
    page.locator(".cutoutZoomControls").boundingBox(),
    page.locator(".cutoutBatchTray").boundingBox(),
    page.locator(".cutoutFooter").boundingBox(),
    preview.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    })),
    page.locator(".cutoutBatchTray").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    })),
  ]);
  expect(compareBox).not.toBeNull();
  expect(zoomBox).not.toBeNull();
  expect(batchTrayBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(compareBox.y + compareBox.height).toBeLessThanOrEqual(batchTrayBox.y);
  expect(zoomBox.x + zoomBox.width).toBeLessThanOrEqual(compareBox.x + compareBox.width);
  expect(zoomBox.y + zoomBox.height).toBeLessThanOrEqual(compareBox.y + compareBox.height);
  expect(zoomBox.y).toBeGreaterThan(compareBox.y + compareBox.height / 2);
  expect(batchTrayBox.y + batchTrayBox.height).toBeLessThanOrEqual(footerBox.y);
  expect(batchTrayMetrics.scrollHeight).toBeLessThanOrEqual(batchTrayMetrics.clientHeight);
  expect(scrollMetrics.scrollHeight).toBeLessThanOrEqual(scrollMetrics.clientHeight + 1);
  expect(scrollMetrics.overflowY).toBe("hidden");

  await page.locator("#cutoutResult").hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBe(0);
});
