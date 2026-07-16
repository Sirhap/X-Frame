"use strict";

const { expect, test } = require("@playwright/test");

test("desktop selection is linkable and browser history restores it", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("XSXB Frame Tuner");
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

test("mobile cutout keeps preview first and supports keyboard repair", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "批量抠图" }).click();
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
    await expect(page.locator("#cutoutStatus")).toContainText("smart");
  }
  expect(errors).toEqual([]);
});
