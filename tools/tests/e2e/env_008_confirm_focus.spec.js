"use strict";

const { expect, test } = require("./fixtures");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);

/**
 * Imports frames onto the organizer import surface.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {number} count Frame count.
 * @returns {Promise<void>}
 */
async function importWorkset(page, count) {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles(
    Array.from({ length: count }, (_, index) => ({
      name: `frame_${String(index + 1).padStart(4, "0")}.png`,
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    })),
  );
  await expect(page.locator(".organizerFrame")).toHaveCount(count);
}

/**
 * Returns whether keyboard focus is inside the visible confirmation dialog.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {string} panelSelector Dialog root selector.
 * @returns {Promise<{open:boolean,inside:boolean,activeId:string}>}
 */
async function confirmFocusState(page, panelSelector) {
  return page.evaluate((selector) => {
    const panel = document.querySelector(selector);
    const active = document.activeElement;
    return {
      open: Boolean(panel && !panel.hidden),
      inside: Boolean(panel && !panel.hidden && panel.contains(active)),
      activeId: active?.id || active?.tagName || "",
    };
  }, panelSelector);
}

test("ENV-008 Tab inside 清空工作集 stays in the dialog and does not dismiss it", async ({ page }) => {
  await importWorkset(page, 3);
  await page.locator(".organizerDownstreamMenu > summary").click();
  await expect(page.locator("#organizerReset")).toHaveText("清空工作集");
  await page.locator("#organizerReset").click();

  const panel = page.locator("#organizerConfirmPanel");
  await expect(panel).toBeVisible();
  await expect(page.locator("#organizerConfirmTitle")).toHaveText("清空当前工作集？");
  await expect(page.locator("#organizerConfirmMessage")).toContainText("将从工作集中移出全部 3 帧");
  await expect(page.locator("#organizerConfirmCancel")).toBeFocused();
  await expect(page.locator(".organizerFrame")).toHaveCount(3);

  await page.keyboard.press("Tab");
  await expect(panel).toBeVisible();
  await expect(page.locator("#organizerConfirmTitle")).toHaveText("清空当前工作集？");
  let focus = await confirmFocusState(page, "#organizerConfirmPanel");
  expect(focus, "the first Tab must not dismiss the dialog").toMatchObject({ open: true, inside: true });
  await expect(page.locator("#organizerConfirmAccept")).toBeFocused();
  await expect(page.locator("#organizerAddAssets")).not.toBeFocused();
  await expect(page.locator(".organizerFrame")).toHaveCount(3);

  await page.keyboard.press("Tab");
  await expect(panel).toBeVisible();
  focus = await confirmFocusState(page, "#organizerConfirmPanel");
  expect(focus, "Tab from the last button must wrap inside the dialog").toMatchObject({
    open: true,
    inside: true,
  });
  await expect(page.locator("#organizerConfirmCancel")).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(panel).toBeVisible();
  focus = await confirmFocusState(page, "#organizerConfirmPanel");
  expect(focus, "Shift+Tab must stay inside the dialog").toMatchObject({ open: true, inside: true });
  await expect(page.locator("#organizerConfirmAccept")).toBeFocused();
  await expect(page.locator("#organizerAddAssets")).not.toBeFocused();

  await expect(page.locator(".organizerFrame")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.locator(".organizerFrame")).toHaveCount(3);
});

test("ENV-008 Tab inside leave-protect stays in the dialog and does not dismiss it", async ({ page }) => {
  await page.goto("/workspace");
  await page.locator('[data-step-target="baseX"][data-step-dir="1"]').click();
  await expect(page.locator("#saveState")).toContainText("未保存");

  await page.locator(".toolRailBrand").click();
  const panel = page.locator("#appConfirmPanel");
  await expect(panel).toBeVisible();
  await expect(page.locator("#appConfirmTitle")).toHaveText("离开编辑器？");
  await expect(page.locator("#appConfirmCancel")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(panel).toBeVisible();
  let focus = await confirmFocusState(page, "#appConfirmPanel");
  expect(focus, "Tab must keep leave-protect open").toMatchObject({ open: true, inside: true });

  await page.keyboard.press("Tab");
  await expect(panel).toBeVisible();
  focus = await confirmFocusState(page, "#appConfirmPanel");
  expect(focus, "Tab must cycle inside leave-protect").toMatchObject({ open: true, inside: true });

  await page.keyboard.press("Shift+Tab");
  await expect(panel).toBeVisible();
  focus = await confirmFocusState(page, "#appConfirmPanel");
  expect(focus, "Shift+Tab must stay inside leave-protect").toMatchObject({ open: true, inside: true });

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/workspace/);
});
