"use strict";

const { expect, test } = require("./fixtures");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);

test("SAV-005 new browser project persists first import and survives hard reload", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__XSXB_PRODUCTION__ = true;
    document.documentElement.dataset.runtimeMode = "browser";
  });
  page.once("dialog", (dialog) => dialog.accept("P0test1"));

  await page.goto("/projects");
  await expect(page.locator("body")).toHaveClass(/browserOnlyMode/);
  await page.locator("#projectHubNew").click();
  await expect(page).toHaveURL(/\/workspace\/resources\/import\?project=p0test1(?:$|&)/);
  await expect(page.locator("#status")).not.toContainText("Project not found");

  await page.locator("#organizerFileInput").setInputFiles([
    { name: "jump_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "jump_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator(".organizerFrame")).toHaveCount(2);
  await expect(page.locator("#organizerApply")).toHaveText("导入动画组并进入调参");
  await page.locator("#organizerApply").click();
  await expect(page.locator("#organizerConfirmPanel")).toBeVisible();
  await expect(page.locator("#organizerConfirmTitle")).toHaveText("确认应用");
  await page.locator("#organizerConfirmAccept").click();

  await expect(page.locator("#organizerStatus")).not.toContainText("尚未就绪");
  await expect(page.locator("#status")).not.toContainText("尚未就绪");
  await expect(page.locator("#organizerModal")).toBeHidden();
  await expect(page.locator(".thumb")).toHaveCount(2);

  await page.goto("/workspace/animation/transform?project=p0test1");
  await expect(page.locator("#status")).not.toContainText("Project not found");
  await expect(page.locator(".thumb")).toHaveCount(2);
});

test("TUN-021 deleted browser-session frame stays gone after hard reload", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__XSXB_PRODUCTION__ = true;
    document.documentElement.dataset.runtimeMode = "browser";
  });
  page.once("dialog", (dialog) => dialog.accept("P0test2"));

  await page.goto("/projects");
  await expect(page.locator("body")).toHaveClass(/browserOnlyMode/);
  await page.locator("#projectHubNew").click();
  await expect(page).toHaveURL(/\/workspace\/resources\/import\?project=p0test2(?:$|&)/);

  await page.locator("#organizerFileInput").setInputFiles([
    { name: "jump_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "jump_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "jump_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator(".organizerFrame")).toHaveCount(3);
  await page.locator("#organizerApply").click();
  await page.locator("#organizerConfirmAccept").click();
  await expect(page.locator("#organizerModal")).toBeHidden();
  await expect(page.locator(".thumb")).toHaveCount(3);

  await page.locator('.thumb[data-frame-index="2"]').click();
  await page.locator("#frameReference").check({ force: true });
  await expect(page.locator("#frameReference")).toBeChecked();
  await expect(page.locator('.thumb[data-frame-index="2"]')).toHaveClass(/reference/);

  await page.locator(".frameActionsMenu > summary").click();
  await page.locator("#deleteSelectedFrames").click();
  await expect(page.locator("#appConfirmPanel")).toBeVisible();
  await expect(page.locator("#appConfirmMessage")).toContainText("删除当前动画中选中的 1 帧");
  await page.locator("#appConfirmAccept").click();
  await expect(page.locator(".thumb")).toHaveCount(2);
  await expect(page.locator("#frameReference")).not.toBeChecked();
  await expect(page.locator(".thumb.reference")).toHaveCount(0);

  await page.reload();
  await expect(page.locator("body")).toHaveClass(/browserOnlyMode/);
  await expect(page.locator(".thumb")).toHaveCount(2);
  await expect(page.locator("#status")).toContainText("已预载 2 帧");
  await expect(page.locator("#frameReference")).not.toBeChecked();
  await expect(page.locator(".thumb.reference")).toHaveCount(0);

  await page.locator('.thumb[data-frame-index="0"]').click();
  await page.locator("#frameReference").check({ force: true });
  await expect(page.locator("#frameReference")).toBeChecked();
  await expect(page.locator('.thumb[data-frame-index="0"]')).toHaveClass(/reference/);
});
