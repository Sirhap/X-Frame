"use strict";

const { expect, test } = require("@playwright/test");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);

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
  await expect(page.locator("#filmstrip .thumb")).not.toHaveCount(0);
  await expect(page.locator("#homeHubOpen")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#homeHubOpen").click();
  await expect(page.locator("#homeHub")).toBeVisible();
  await expect(page.locator("#homeAnimationCount")).not.toHaveText("0");
  await expect(page.locator("#homeFrameCount")).not.toHaveText("0");
  const [homeHubBox, filmstripBox] = await Promise.all([
    page.locator("#homeHub").boundingBox(),
    page.locator("#filmstrip").boundingBox(),
  ]);
  expect(homeHubBox).not.toBeNull();
  expect(filmstripBox).not.toBeNull();
  expect(homeHubBox.y + homeHubBox.height).toBeLessThanOrEqual(filmstripBox.y);
  await page.locator("#homeHubContinue").click();
  await expect(page.locator("#homeHub")).toBeHidden();
  await page.reload();
  await expect(page.locator("#homeHub")).toBeHidden();
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#filmstrip .thumb")).not.toHaveCount(0);
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

  const organizerThumbnail = page.locator(".organizerFrame img").first();
  const originalThumbnail = await organizerThumbnail.getAttribute("src");
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
  await expect.poll(() => organizerThumbnail.getAttribute("src")).not.toBe(originalThumbnail);
  await page.locator("#cutoutRepairUndo").click();
  await expect.poll(() => organizerThumbnail.getAttribute("src")).toBe(originalThumbnail);
  await page.locator("#cutoutRepairRedo").click();
  await expect.poll(() => organizerThumbnail.getAttribute("src")).not.toBe(originalThumbnail);
  await page.locator("#cutoutNext").click();
  await expect(page.locator("#cutoutTolerance")).toHaveValue("37");
  await expect(page.locator("#cutoutViewResult")).toHaveClass(/active/);
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
  await page.goto("/");
  await page.locator("#cutoutOpen").click();
  const sourceRestore = page.getByRole("button", { name: "原图恢复笔" });
  await expect(sourceRestore).toBeVisible();
  await sourceRestore.click();
  await expect(page.locator("#cutoutActiveToolTitle")).toHaveText("原图恢复笔");
  await page.getByRole("button", { name: "自动抠图" }).click();
  const preview = page.locator(".cutoutPreview");
  const controls = page.locator(".cutoutControls");
  await expect(preview).toBeVisible();
  const [previewBox, controlsBox] = await Promise.all([preview.boundingBox(), controls.boundingBox()]);
  expect(previewBox.y).toBeLessThan(controlsBox.y);
  expect(previewBox.y).toBeLessThan(844);

  const loadGroup = page.getByRole("button", { name: "载入当前组" });
  if (await loadGroup.isEnabled()) {
    await loadGroup.click();
    await page.locator("#cutoutResult").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.locator("#cutoutStatus")).toContainText("自动抠图");

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
  }
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
  await page.goto("/");
  await page.locator("#cutoutOpen").click();

  const loadGroup = page.getByRole("button", { name: "载入当前组" });
  test.skip(!(await loadGroup.isEnabled()), "No animation group is available for cutout layout verification");
  await loadGroup.click();
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
