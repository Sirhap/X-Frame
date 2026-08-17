"use strict";

const { expect, test } = require("@playwright/test");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);

const CUTOUT_FILES = [1, 2, 3].map((index) => ({
  name: `frame_${String(index).padStart(4, "0")}.png`,
  mimeType: "image/png",
  buffer: ONE_PIXEL_PNG,
}));

/**
 * Asserts that an element's box lies fully inside the viewport vertically,
 * which is the "preserve the canvas, squeeze the chrome" contract for work
 * surfaces under browser zoom.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {string} selector Element selector.
 * @param {{width: number, height: number}} viewport CSS viewport.
 * @returns {Promise<void>}
 */
async function expectVerticallyInViewport(page, selector, viewport) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} should render a box`).not.toBeNull();
  expect(box.y, `${selector} should not start above the viewport`).toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height, `${selector} should not extend past the viewport bottom`).toBeLessThanOrEqual(
    viewport.height + 1,
  );
}

test.describe("work surfaces preserve the canvas under browser zoom", () => {
  test("200% workspace keeps the flow header clear of the tool rail", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 450 });
    await page.goto("/workspace", { waitUntil: "networkidle" });

    const header = page.locator("#workspaceFlowHeader");
    const rail = page.locator(".toolRail");
    await expect(header).toBeVisible();
    await expect(rail).toBeVisible();

    const [headerBox, railBox] = await Promise.all([header.boundingBox(), rail.boundingBox()]);
    expect(headerBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    expect(headerBox.y, "flow header should start below the horizontal tool rail").toBeGreaterThanOrEqual(
      railBox.y + railBox.height - 1,
    );
  });

  test("150% cutout keeps the main preview inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1067, height: 600 });
    await page.goto("/tools/cutout", { waitUntil: "networkidle" });
    await page.locator("#cutoutFileInput").setInputFiles(CUTOUT_FILES);
    await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", {
      timeout: 20000,
    });

    await page.evaluate(() => window.scrollTo(0, 0));
    await expectVerticallyInViewport(page, ".cutoutCompare", { width: 1067, height: 600 });
  });

  test("200% cutout keeps the main preview inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 450 });
    await page.goto("/tools/cutout", { waitUntil: "networkidle" });
    await page.locator("#cutoutFileInput").setInputFiles(CUTOUT_FILES);
    await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", {
      timeout: 20000,
    });

    await page.evaluate(() => window.scrollTo(0, 0));
    await expectVerticallyInViewport(page, ".cutoutCompare", { width: 800, height: 450 });
  });

  test("200% scatter slice keeps the canvas stage inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 450 });
    await page.goto("/tools/scatter-slice", { waitUntil: "networkidle" });
    await expect(page.locator("#scatterSliceSurface")).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await expectVerticallyInViewport(page, ".scatterSliceSurface .canvasStage", {
      width: 800,
      height: 450,
    });
  });

  test("200% watermark keeps the video stage inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 450 });
    await page.goto("/tools/watermark", { waitUntil: "networkidle" });
    await expect(page.locator("#watermarkWorkspace")).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await expectVerticallyInViewport(page, ".video-shell", { width: 800, height: 450 });
  });
});

test.describe("browse surfaces reflow instead of scaling", () => {
  test("import grid ellipsizes long frame names", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 450 });
    await page.goto("/tools/import", { waitUntil: "networkidle" });
    await page.locator("#organizerFileInput").setInputFiles({
      name: "a-very-long-frame-file-name-that-would-overflow-the-card-0001.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });

    const name = page.locator(".organizerFrameName").first();
    await expect(name).toBeVisible();
    await expect(name).toHaveCSS("text-overflow", "ellipsis");
    await expect(name).toHaveCSS("white-space", "nowrap");
    await expect(name).toHaveCSS("overflow", "hidden");
  });
});
