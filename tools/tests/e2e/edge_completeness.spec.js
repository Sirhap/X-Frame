"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { expect, test } = require("@playwright/test");
const { readZipEntries } = require("./zip_test_utils");

const E2E_ACTIVATION_CODE = "XSXB-E2E-ONLY";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);
const PNG_DATA_URL = `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`;

/**
 * Imports an isolated project so navigation decisions cannot mutate another E2E scenario.
 * @param {import("@playwright/test").APIRequestContext} request Page-bound request context.
 * @param {string} suffix Unique project suffix.
 * @returns {Promise<object>} Import response payload.
 */
async function importProject(request, suffix) {
  const response = await request.post("/api/import-animation", {
    data: {
      projectLabel: `Edge Completeness ${suffix}`,
      profileLabel: "Hero",
      animationName: `edge-${suffix}`,
      fps: 12,
      items: [1, 2].map((index) => ({
        name: `frame_${String(index).padStart(4, "0")}.png`,
        data: PNG_DATA_URL,
      })),
    },
  });
  const responseText = await response.text();
  expect(response.ok(), responseText).toBe(true);
  return JSON.parse(responseText);
}

/**
 * Activates test-only exports through the same signed-cookie endpoint used by the application.
 * @param {import("@playwright/test").Page} page Edge page whose context receives the cookie.
 * @returns {Promise<void>}
 */
async function activateExports(page) {
  const response = await page.request.post("/api/activation", {
    data: { code: E2E_ACTIVATION_CODE },
  });
  const responseText = await response.text();
  expect(response.ok(), responseText).toBe(true);
}

test("Edge persists theme, panel, sidebar, filmstrip, and easter-egg preferences", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.locator("body")).toHaveClass(/theme-dark/);
  await expect(page.locator(".toolbar .kunkunThemeButton")).toBeHidden();

  for (let click = 0; click < 5; click += 1) await page.locator("#brandMark").click();
  await expect(page.locator("body")).toHaveClass(/kunkunUnlocked/);
  await expect(page.locator(".toolbar .kunkunThemeButton")).toBeVisible();
  await page.locator(".toolbar .kunkunThemeButton").click();
  await page.locator('[data-sidebar-tab="boxes"]').click();
  await page.locator('[data-filmstrip-layout="grid"]').click();
  await page.locator("#sidebarCollapse").click();

  await expect(page.locator("body")).toHaveClass(/theme-kunkun/);
  await expect(page.locator("body")).toHaveClass(/sidebarCollapsed/);
  await expect(page.locator("body")).toHaveAttribute("data-sidebar-tab", "boxes");
  await expect(page.locator(".filmstripPanel")).toHaveAttribute("data-layout", "grid");

  await page.reload();
  await expect(page.locator("body")).toHaveClass(/theme-kunkun/);
  await expect(page.locator("body")).toHaveClass(/kunkunUnlocked/);
  await expect(page.locator("body")).toHaveClass(/sidebarCollapsed/);
  await expect(page.locator("body")).toHaveAttribute("data-sidebar-tab", "boxes");
  await expect(page.locator(".filmstripPanel")).toHaveAttribute("data-layout", "grid");
  await expect(page.locator("#workbenchSidebar")).toHaveAttribute("aria-hidden", "true");

  const preferences = await page.evaluate(() => ({
    theme: localStorage.getItem("xsxbFrameTuner.theme"),
    sidebar: localStorage.getItem("xsxbFrameTuner.sidebarCollapsed"),
    tab: localStorage.getItem("xsxbFrameTuner.activePanelTab"),
    filmstrip: localStorage.getItem("xsxbFrameTuner.filmstripLayout"),
    kunkun: localStorage.getItem("xsxbFrameTuner.kunkunUnlocked"),
  }));
  expect(preferences).toEqual({
    theme: "kunkun",
    sidebar: "true",
    tab: "boxes",
    filmstrip: "grid",
    kunkun: "true",
  });
});

test("Edge route guard supports cancel, save, and discard decisions", async ({ page }) => {
  await importProject(page.request, `guard-${Date.now()}`);
  await page.goto("/workspace");
  const baseX = page.locator("#baseX");
  const initialValue = await baseX.inputValue();

  await page.locator('[data-step-target="baseX"][data-step-dir="1"]').click();
  const savedValue = await baseX.inputValue();
  expect(savedValue).not.toBe(initialValue);
  const quickToolsLink = page.getByRole("link", { name: "快速工具" });
  await quickToolsLink.click();
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await expect(page.locator("#appConfirmAlternate")).toBeVisible();
  await page.locator("#appConfirmCancel").click();
  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.locator("#stage")).toBeVisible();

  await quickToolsLink.click();
  await page.locator("#appConfirmAlternate").click();
  await expect(page).toHaveURL(/\/tools$/);
  await page.getByRole("link", { name: /批量抠图/ }).click();
  await expect(page).toHaveURL(/\/tools\/cutout/);
  await expect(page.locator("#cutoutModal")).toBeVisible();

  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/workspace/);
  await expect(baseX).toHaveValue(savedValue);
  await page.locator('[data-step-target="baseX"][data-step-dir="1"]').click();
  await quickToolsLink.click();
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await page.locator("#appConfirmAccept").click();
  await expect(page).toHaveURL(/\/tools$/);

  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/workspace/);
  await expect(baseX).toHaveValue(savedValue);
});

test("Edge organizer exports PNG frames and a sprite sheet in one readable ZIP", async ({ page }) => {
  await activateExports(page);
  await page.goto("/tools/import");
  await page.locator("#organizerAnimationName").fill("edge-output");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator(".organizerFrame")).toHaveCount(2);

  await page.locator("#organizerExport").click();
  await expect(page.locator("#mediaExportDialog")).toBeVisible();
  await expect(page.locator("#mediaExportFrameCount")).toHaveText("2");
  await expect(page.locator("#mediaExportFrames")).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.locator("#mediaExportDialog")).toBeHidden();
  await expect(page.locator("#organizerModal")).toBeVisible();
  await expect(page.locator("#organizerExport")).toBeFocused();

  await page.locator("#organizerExport").click();
  await page.locator("#mediaExportSheet").check();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#mediaExportSubmit").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("edge-output-xsxb.zip");
  const downloadPath = path.join(os.tmpdir(), `xsxb-edge-output-${process.pid}-${Date.now()}.zip`);
  try {
    await download.saveAs(downloadPath);
    const entries = readZipEntries(fs.readFileSync(downloadPath));
    expect(entries.has("frames/frame_0001.png")).toBe(true);
    expect(entries.has("frames/frame_0002.png")).toBe(true);
    expect(entries.has("frames.json")).toBe(true);
    expect(entries.has("spritesheets/atlas.json")).toBe(true);

    const sheetEntry = [...entries.entries()].find(([name]) => /^spritesheets\/.+\.png$/.test(name));
    expect(sheetEntry).toBeDefined();
    expect(sheetEntry[1].subarray(1, 4).toString("ascii")).toBe("PNG");

    const manifest = JSON.parse(entries.get("xsxb-animation.json").toString("utf8"));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      animation: { name: "edge-output", fps: 12 },
      outputs: { pngSequence: true, spriteSheet: true },
    });
    await expect(page.locator("#mediaExportStatus")).toHaveAttribute("data-tone", "success");
  } finally {
    fs.rmSync(downloadPath, { force: true });
  }
});
