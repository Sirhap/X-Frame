"use strict";

const { expect, test } = require("./fixtures");

const SEED_GROUP = encodeURIComponent("player:actor:Idle:0");
const SEED_QUERY = `project=seed-project&group=${SEED_GROUP}&frame=0`;

test("NAV-012 deep-link opens the same animation frames", async ({ page }) => {
  await page.goto(`/workspace/animation/transform?${SEED_QUERY}`);
  await expect(page.locator("#workspaceFlowProject")).toContainText("E2E Seed Project");
  await expect(page.locator("#workspaceFlowProject")).toContainText("Idle");
  await expect(page.locator(".thumb")).toHaveCount(2);
  await expect(page).toHaveURL(/project=seed-project/);
  await expect(page).toHaveURL(/group=/);
});

test("NAV-013 workbench cutout deep-link loads the current animation batch", async ({ page }) => {
  await page.goto(`/workspace/resources/cutout?${SEED_QUERY}`);
  await expect(page.locator("#workspaceFlowProject")).toContainText("E2E Seed Project");
  await expect(page.locator("#workspaceFlowProject")).toContainText("Idle");
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await expect(page.locator("#cutoutStatus")).not.toHaveText("等待图片");
  await expect(page.locator("#cutoutStatus")).toContainText("2");
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(2);
  await expect(page.locator("#cutoutModal")).toHaveClass(/hasItems/);
});

test("NAV-014 delivery export deep-link estimates the current animation frames", async ({ page }) => {
  await page.goto(`/workspace/delivery/export?${SEED_QUERY}`);
  await expect(page.locator("#workspaceFlowProject")).toContainText("E2E Seed Project");
  await expect(page.locator("#workspaceFlowProject")).toContainText("Idle");
  await expect(page.locator("#mediaExportDialog")).toBeVisible();
  await expect(page.locator("#mediaExportEstimate")).toContainText("2 帧");
  await expect(page.locator("#mediaExportPreviewMeta")).not.toHaveText("导入帧后可预览导出结果。");
});

test("EXP-005 output-size pill updates preview canvas and estimate", async ({ page }) => {
  await page.goto(`/workspace/delivery/export?${SEED_QUERY}`);
  await expect(page.locator("#mediaExportDialog")).toBeVisible();
  await expect(page.locator("#mediaExportPreviewMeta")).not.toHaveText("导入帧后可预览导出结果。");
  await expect(page.locator('input[name="mediaExportResolution"][value="512"]')).toBeChecked();

  const previewSize = () =>
    page.locator("#mediaExportPreviewCanvas").evaluate((canvas) => `${canvas.width}x${canvas.height}`);

  await page.locator('.mediaExportResolutionSection label:has(input[value="128"])').click();
  await expect(page.locator('input[name="mediaExportResolution"][value="128"]')).toBeChecked();
  await expect.poll(previewSize).toBe("128x128");
  await expect(page.locator("#mediaExportEstimate")).toContainText("128 × 128");
  await expect(page.locator("#mediaExportEstimate")).not.toContainText("2048");

  await page.locator('.mediaExportResolutionSection label:has(input[value="512"])').click();
  await expect(page.locator('input[name="mediaExportResolution"][value="512"]')).toBeChecked();
  await expect.poll(previewSize).toBe("512x512");
  await expect(page.locator("#mediaExportEstimate")).toContainText("512 × 512");
});
