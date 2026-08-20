"use strict";

const { expect, test } = require("./fixtures");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);

/**
 * Reports whether the element's center is the real hit target.
 * @param {import("@playwright/test").Locator} locator Target locator.
 * @returns {Promise<string>} Reachability label.
 */
async function hitTarget(locator) {
  return locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return "outside the viewport";
    const target = document.elementFromPoint(x, y);
    if (!target) return "covered by nothing";
    if (target === element || element.contains(target)) return "reachable";
    return `covered by ${target.tagName}${target.id ? `#${target.id}` : ""}`;
  });
}

test("VIS-025 last batch item sits fully above the fixed batch bar and stays clickable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles(
    Array.from({ length: 8 }, (_, index) => ({
      name: `batch_0${index}.png`,
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    })),
  );
  await expect(page.locator("#cutoutStatus")).toContainText("已载入 8 张图片");
  await page.locator("#cutoutSidebarBatchTab").click();
  await expect(page.locator("#cutoutSidebarBatchTab")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#cutoutSidebarBatchPanel")).toBeVisible();
  await expect(page.locator("#cutoutBatchSummary")).toContainText("8/8");
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(8);
  await expect(page.locator(".cutoutQueueItem .cutoutQueueName").first()).toHaveText("batch_00.png");

  const queue = page.locator("#cutoutQueue");
  const lastItem = page.locator(".cutoutQueueItem").last();
  const batchBar = page.locator(".cutoutBatchWorkspaceActions");
  const queueMetrics = await queue.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    overflowY: getComputedStyle(element).overflowY,
    display: getComputedStyle(element).display,
  }));
  expect(queueMetrics.display, "batch list must be painted").not.toBe("none");
  expect(queueMetrics.height, "batch list must have a real scrollport").toBeGreaterThan(80);
  expect(["auto", "scroll"]).toContain(queueMetrics.overflowY);

  await lastItem.evaluate((element) => {
    element.scrollIntoView({ block: "end", inline: "nearest" });
  });
  const [lastBox, barBox] = await Promise.all([lastItem.boundingBox(), batchBar.boundingBox()]);
  expect(lastBox, "last batch item should have a box").not.toBeNull();
  expect(barBox, "fixed batch bar should have a box").not.toBeNull();
  expect(lastBox.height).toBeGreaterThan(40);
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(barBox.y + 1);

  await expect.poll(() => hitTarget(lastItem)).toBe("reachable");
  await lastItem.click();
  await expect(lastItem).toHaveClass(/active/);
  await expect(page.locator("#cutoutFrameNumber")).toHaveValue("8");
});
