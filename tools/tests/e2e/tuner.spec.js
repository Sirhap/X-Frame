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
 * Opens the sidebar batch panel after its queue is ready.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function expandStableBatchTray(page) {
  await expect.poll(() => page.locator(".cutoutQueueItem").count()).toBeGreaterThan(0);
  await page.locator("#cutoutSidebarBatchTab").click();
  await expect(page.locator("#cutoutSidebarBatchTab")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#cutoutSidebarBatchPanel")).toBeVisible();
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
  await page.goto("/workspace");
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

test("the website home, import flow, and tuning workbench use separate URLs", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#hero-title")).toBeVisible();
  await expect(page.locator("#stage")).toHaveCount(0);
  await page.getByRole("link", { name: "开始制作" }).click();
  await expect(page).toHaveURL(/\/tools\/import/);
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#filmstrip")).toBeVisible();
  await page.locator("#homeHubOpen").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#hero-title")).toBeVisible();
  await page.goto("/tools/import");
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.locator("#organizerHome").click();
  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.locator("#stage")).toBeVisible();
  await page.reload();
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#filmstrip")).toBeVisible();
});

test("workbench controls expose specific accessible names without nested actions", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByRole("spinbutton", { name: "缩放", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "减少缩放", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "增加缩放", exact: true })).toBeVisible();
  await page.locator('[data-panel="attachment-assets"] > summary').click();
  await expect(page.getByRole("button", { name: "添加图片", exact: true })).toBeVisible();

  await page.locator('.languageButton[data-language="en"]').click();
  await expect(page.getByRole("spinbutton", { name: "Scale", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Decrease Scale", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Increase Scale", exact: true })).toBeVisible();
  await expect(page.locator("#save")).toHaveCSS("color", "rgb(5, 7, 10)");

  await page.locator('.themeButton[data-theme="light"]').click();
  await page.locator(".projectContext > summary").click();
  await page.locator("#deleteProject").click();
  await expect(page.locator("#appConfirmAccept")).toHaveCSS("background-color", "rgb(180, 35, 24)");
  await expect(page.locator("#appConfirmAccept")).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.locator("#appConfirmCancel").click();

  await page.goto("/tools/organizer");
  const firstFrame = page.locator(".organizerFrame").first();
  await expect(firstFrame.getByRole("button", { name: /Select frame/ })).toBeVisible();
  await expect(firstFrame.getByRole("checkbox", { name: /Include .* in the workset/ })).toBeChecked();
  await expect(firstFrame.locator("button button, button input")).toHaveCount(0);
  await expect(firstFrame.locator("img")).toHaveAttribute("width", "156");
  await expect(firstFrame.locator("img")).toHaveAttribute("height", "156");
  await firstFrame.getByRole("button", { name: /Select frame/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".organizerFrameSelect").nth(1)).toBeFocused();
});

test("tool paths refresh, update titles, and return to the tuning workbench", async ({ page }) => {
  await page.goto("/tools/import");
  await expect(page).toHaveURL(/\/tools\/import/);
  await expect(page).toHaveTitle(/导入与处理动画/);
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.reload();
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.locator("#organizerHome").click();
  await expect(page).toHaveURL(/\/workspace(?:\?|$)/);
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
  await expect(page.locator(".cutoutProtectionPreviewLegend")).toContainText("保护主体");
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
  await expect(page.locator(".organizerConfirmCard")).toHaveAttribute("data-tone", "danger");
  await expect(page.locator("#organizerConfirmCancel")).toBeFocused();
  await page.locator("#organizerConfirmPanel").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#organizerModal")).toBeVisible();
  await expect(page).toHaveURL(/\/tools\/import/);
  await expect(page.locator("#organizerHome")).toBeFocused();

  await page.locator("#organizerHome").click();
  await page.locator("#organizerConfirmAccept").click();
  await expect(page.locator("#organizerModal")).toBeHidden();
  await expect(page).toHaveURL(/\/workspace(?:\?|$)/);
});

test("cutout reports mixed-file skips and confirms destructive clearing", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles([
    { name: "frame.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") },
  ]);

  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);
  await expect(page.locator("#cutoutStatus")).toContainText("跳过 1");
  await expect(page.locator("#cutoutBatchTray")).toBeHidden();
  await expect(page.locator("#cutoutSidebarBatchTab")).toHaveAttribute("aria-selected", "false");
  await expandStableBatchTray(page);

  await page.locator("#cutoutClear").click();
  await expect(page.locator("#cutoutConfirmTitle")).toHaveText("清空当前批次？");
  await expect(page.locator(".cutoutConfirmCard")).toHaveAttribute("data-tone", "danger");
  await expect(page.locator("#cutoutConfirmCancel")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);
  await expect(page.locator("#cutoutClear")).toBeFocused();

  await page.locator("#cutoutDeleteSelected").click();
  await expect(page.locator("#cutoutConfirmTitle")).toHaveText("删除选中的图片？");
  await page.locator("#cutoutConfirmCancel").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);
  await expect(page.locator("#cutoutDeleteSelected")).toBeFocused();
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

test("cutout restores a batch after leaving its URL and starts a new batch explicitly", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);

  await page.locator("#cutoutHome").click();
  await expect(page.locator("#cutoutModal")).toBeHidden();
  await expect(page).toHaveURL(/\/workspace(?:\?|$)/);
  await page.locator("#cutoutOpen").click();
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await expect(page.locator("#cutoutStatus")).toHaveText("已恢复上次批次：1 张图片");
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);

  await page.locator("#cutoutNewBatch").click();
  await expect(page.locator("#cutoutConfirmTitle")).toHaveText("新建批次？");
  await page.locator("#cutoutConfirmCancel").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);

  await page.locator("#cutoutNewBatch").click();
  await page.locator("#cutoutConfirmApply").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(0);
  await expect(page.locator("#cutoutStatus")).toHaveText("等待图片");
  await expect(page.locator("#cutoutNewBatch")).toBeDisabled();
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

test("@cross-browser protected runtime stays local and resolves its Worker", async ({ page }) => {
  const processingRequests = [];
  let captureProcessingTraffic = false;
  page.on("request", (request) => {
    if (!captureProcessingTraffic) return;
    processingRequests.push({
      method: request.method(),
      pathname: new URL(request.url()).pathname,
      postData: request.postData(),
    });
  });
  await page.goto("/tools/cutout");
  await page.waitForLoadState("networkidle");
  captureProcessingTraffic = true;
  const resultBytes = await page.evaluate(async () => {
    const adapter = window.ProtectedAlgorithmRuntime.createProductionWorkerAdapter({
      WorkerConstructor: window.Worker,
      cutoutClient: window.BatchCutoutWorkerClient,
      frameClient: window.FrameOrganizerWorkerClient,
    });
    const runtime = window.ProtectedAlgorithmRuntime.createRuntime({ adapter });
    try {
      const result = await runtime.applyProductCutout(
        { data: new Uint8ClampedArray([20, 40, 60, 255]), width: 1, height: 1 },
        {
          processingOptions: {
            backgroundColor: { r: 255, g: 255, b: 255 },
            tolerance: 0,
          },
          repairs: [],
        },
        "cross-browser-local-processing",
      );
      return Array.from(result.data);
    } finally {
      runtime.dispose();
    }
  });
  expect(resultBytes).toEqual([20, 40, 60, 255]);
  expect(processingRequests.length).toBeGreaterThan(0);
  expect(processingRequests.some(({ pathname }) => pathname === "/batch_cutout_worker.js")).toBe(true);
  expect(processingRequests.every(({ method, postData }) => method === "GET" && postData === null)).toBe(
    true,
  );
  expect(processingRequests.some(({ pathname }) => pathname.startsWith("/api/"))).toBe(false);
});

test("area tools expose and synchronize the transparent color shortcut", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", {
    timeout: 20000,
  });
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
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", {
    timeout: 20000,
  });
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
  await page.locator("#cutoutClear").click();
  const confirmationMetrics = await page.locator(".cutoutConfirmCard").evaluate((card) => {
    const bounds = card.getBoundingClientRect();
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      viewportHeight: window.innerHeight,
      buttonHeights: Array.from(
        card.querySelectorAll("button"),
        (button) => button.getBoundingClientRect().height,
      ),
    };
  });
  expect(confirmationMetrics.top).toBeGreaterThanOrEqual(0);
  expect(confirmationMetrics.bottom).toBeLessThanOrEqual(confirmationMetrics.viewportHeight);
  expect(confirmationMetrics.buttonHeights.every((height) => height >= 48)).toBe(true);
  await expect(page.locator("#cutoutConfirmCancel")).toBeFocused();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("mobile editor presents the operation workspace before the parameter sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace");

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

test("desktop cutout keeps batch images in the collapsible sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: WIDE_IMAGE_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  const parameterCompareBox = await page.locator(".cutoutCompare").boundingBox();
  await expandStableBatchTray(page);

  const preview = page.locator(".cutoutPreview");
  const [compareBox, zoomBox, batchTrayBox, sidebarBox, scrollMetrics, batchTrayMetrics] = await Promise.all([
    page.locator(".cutoutCompare").boundingBox(),
    page.locator(".cutoutZoomControls").boundingBox(),
    page.locator(".cutoutBatchTray").boundingBox(),
    page.locator("#cutoutSidebar").boundingBox(),
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
  expect(sidebarBox).not.toBeNull();
  expect(parameterCompareBox).not.toBeNull();
  expect(Math.abs(compareBox.width - parameterCompareBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(compareBox.height - parameterCompareBox.height)).toBeLessThanOrEqual(1);
  expect(batchTrayBox.x + batchTrayBox.width).toBeLessThanOrEqual(compareBox.x);
  expect(batchTrayBox.x).toBeGreaterThanOrEqual(sidebarBox.x);
  expect(batchTrayBox.x + batchTrayBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
  expect(zoomBox.x + zoomBox.width).toBeLessThanOrEqual(compareBox.x + compareBox.width);
  expect(zoomBox.y + zoomBox.height).toBeLessThanOrEqual(compareBox.y + compareBox.height);
  expect(zoomBox.y).toBeLessThan(compareBox.y + compareBox.height / 2);
  expect(batchTrayMetrics.scrollHeight).toBeLessThanOrEqual(batchTrayMetrics.clientHeight);
  expect(scrollMetrics.scrollHeight).toBeLessThanOrEqual(scrollMetrics.clientHeight + 1);
  expect(scrollMetrics.overflowY).toBe("hidden");

  await page.locator("#cutoutSidebarCollapse").click();
  await expect(page.locator("#cutoutSidebarCollapse")).toHaveAttribute("aria-expanded", "false");
  const expandedCompareBox = await page.locator(".cutoutCompare").boundingBox();
  expect(expandedCompareBox.width).toBeGreaterThan(compareBox.width + 200);

  await page.locator("#cutoutResult").hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBe(0);
});

test("compact desktop cutout keeps batch actions and readable previews in the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1299, height: 802 });
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: WIDE_IMAGE_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(3);
  await expandStableBatchTray(page);

  const sidebarPanel = page.locator("#cutoutSidebar");
  const batchActions = page.locator(".cutoutBatchWorkspaceActions");
  const utilityActions = batchActions.locator(":scope > div");
  const previewCards = page.locator(".cutoutQueueItem");
  const [panelBox, batchActionsBox, downloadBox, actionLayout, buttonMetrics, previewMetrics] =
    await Promise.all([
      sidebarPanel.boundingBox(),
      batchActions.boundingBox(),
      page.locator("#cutoutDownload").boundingBox(),
      utilityActions.evaluate((element) => ({
        display: getComputedStyle(element).display,
        columns: getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
      })),
      batchActions.locator("button:visible").evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return { height: box.height, left: box.left, right: box.right, width: box.width };
        }),
      ),
      previewCards.evaluateAll((cards) =>
        cards.map((card) => {
          const box = card.getBoundingClientRect();
          const imageBox = card.querySelector("img").getBoundingClientRect();
          return {
            cardHeight: box.height,
            imageHeight: imageBox.height,
            imageWidth: imageBox.width,
          };
        }),
      ),
    ]);

  expect(panelBox).not.toBeNull();
  expect(batchActionsBox).not.toBeNull();
  expect(downloadBox).not.toBeNull();
  expect(actionLayout).toEqual({ display: "grid", columns: 2 });
  expect(batchActionsBox.x).toBeGreaterThanOrEqual(panelBox.x);
  expect(batchActionsBox.x + batchActionsBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
  expect(downloadBox.x).toBeCloseTo(batchActionsBox.x, 1);
  expect(downloadBox.x + downloadBox.width).toBeCloseTo(batchActionsBox.x + batchActionsBox.width, 1);
  expect(buttonMetrics.length).toBeGreaterThanOrEqual(3);
  for (const button of buttonMetrics) {
    expect(button.width).toBeGreaterThanOrEqual(80);
    expect(button.height).toBeGreaterThanOrEqual(34);
    expect(button.left).toBeGreaterThanOrEqual(batchActionsBox.x);
    expect(button.right).toBeLessThanOrEqual(batchActionsBox.x + batchActionsBox.width + 1);
  }
  expect(previewMetrics).toHaveLength(3);
  for (const preview of previewMetrics) {
    expect(preview.cardHeight).toBeGreaterThanOrEqual(160);
    expect(preview.imageHeight).toBeGreaterThanOrEqual(110);
    expect(preview.imageWidth).toBeGreaterThan(preview.imageHeight * 1.8);
  }
});
