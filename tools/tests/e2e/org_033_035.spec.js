"use strict";

const { expect, test, openOrganizerAnalysisMenu } = require("./fixtures");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);

/**
 * Imports an included workset on the organizer import surface.
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

test("ORG-033 loop dialog title matches 寻找循环段", async ({ page }) => {
  await importWorkset(page, 4);
  await openOrganizerAnalysisMenu(page);
  await expect(page.locator("#organizerFindLoop")).toHaveText("寻找循环段");
  await page.locator("#organizerFindLoop").click();
  await expect(page.locator("#organizerLoopPanel")).toBeVisible();
  await expect(page.locator("#organizerLoopTitle")).toHaveText("寻找循环段");
});

test("ORG-034 empty loop search shows 没有循环段 and the preference hint", async ({ page }) => {
  await importWorkset(page, 10);
  await openOrganizerAnalysisMenu(page);
  await page.locator("#organizerFindLoop").click();
  await expect(page.locator("#organizerLoopPanel")).toBeVisible();
  await page.locator("#organizerLoopStartCustom").check();
  await page.locator("#organizerLoopStartInput").fill("10");
  await page.locator("#organizerLoopStartSearch").click();
  await expect(page.locator("#organizerLoopEmpty")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#organizerLoopEmpty")).toContainText("没有循环段");
  await expect(page.locator("#organizerLoopEmpty")).toContainText("循环偏好");
  await expect(page.locator("#organizerLoopEmpty")).toContainText("起始帧");
  const emptyBox = await page.locator("#organizerLoopEmpty").boundingBox();
  expect(emptyBox, "empty state must not collapse into a blank strip").not.toBeNull();
  expect(emptyBox.height).toBeGreaterThan(40);
});

test("ORG-035 reduce asks for confirm and cancel leaves the workset unchanged", async ({ page }) => {
  await importWorkset(page, 4);
  await page.locator("#organizerReduceStep").fill("2");
  await page.locator("#organizerReduce").click();
  await expect(page.locator("#organizerConfirmPanel")).toBeVisible();
  await expect(page.locator("#organizerConfirmMessage")).toContainText("每 2 帧保留 1 帧");
  await page.locator("#organizerConfirmCancel").click();
  await expect(page.locator("#organizerConfirmPanel")).toBeHidden();
  await expect(page.locator(".organizerFrameInclude input:checked")).toHaveCount(4);
  await expect(page.locator("#organizerCount")).toContainText("4 / 4");

  await page.locator("#organizerReduce").click();
  await page.locator("#organizerConfirmAccept").click();
  await expect(page.locator(".organizerFrameInclude input:checked")).toHaveCount(2);
  await expect(page.locator("#organizerCount")).toContainText("2 / 4");
});
