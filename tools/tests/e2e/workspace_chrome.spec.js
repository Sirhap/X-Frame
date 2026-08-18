"use strict";

const { expect, test } = require("./fixtures");

test("workspace chrome drops unused status text and keeps account plus shortcuts in the header", async ({
  page,
}) => {
  await page.goto("/workspace", { waitUntil: "networkidle" });

  const toolbar = page.locator(".workspace > .toolbar");
  const header = page.locator("#workspaceFlowHeader");
  const account = header.locator("#workspaceAccount");
  const shortcut = header.locator(".shortcutGuide");

  await expect(toolbar).toBeVisible();
  await expect(account).toBeVisible();
  await expect(shortcut).toBeVisible();
  await expect(page.locator(".workspace > .toolbar .shortcutGuide")).toHaveCount(0);
  await expect(page.locator("#activationManage")).toBeHidden();
  await expect(page.locator("#canvasTitle")).toBeHidden();
  await expect(page.locator("#selectionHud")).toBeHidden();
  await expect(page.locator("#hint")).toBeHidden();

  const [toolbarBox, shortcutBox, accountBox] = await Promise.all([
    toolbar.boundingBox(),
    shortcut.boundingBox(),
    account.boundingBox(),
  ]);
  expect(toolbarBox, "toolbar should render").not.toBeNull();
  expect(shortcutBox, "header shortcut should render").not.toBeNull();
  expect(accountBox, "account should render").not.toBeNull();
  expect(toolbarBox.height, "toolbar should be a single compact control row").toBeLessThanOrEqual(56);
  expect(Math.abs(shortcutBox.y - accountBox.y), "shortcut should sit on the account row").toBeLessThan(8);
  expect(
    shortcutBox.x + shortcutBox.width,
    "shortcut should sit immediately left of account",
  ).toBeLessThanOrEqual(accountBox.x + 1);

  for (const selector of [
    "#workspaceAccount",
    ".workspaceFlowChrome .shortcutGuide > summary",
    "#playPause",
    "#ghostToggle",
    "#stageZoom",
    "#stageZoomFit",
  ]) {
    const hit = page.locator(selector);
    await expect(hit).toBeVisible();
    await expect
      .poll(
        async () => {
          return hit.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const x = bounds.left + bounds.width / 2;
            const y = bounds.top + bounds.height / 2;
            if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
              return "outside the viewport";
            }
            const target = document.elementFromPoint(x, y);
            if (target === element || element.contains(target)) return "reachable";
            if (!target) return "covered by nothing";
            return `covered by ${target.tagName}${target.id ? `#${target.id}` : ""}`;
          });
        },
        { message: `${selector} should receive its own clicks` },
      )
      .toBe("reachable");
  }

  await account.click();
  await expect(page.locator("#activationPanel")).toBeVisible();
  await expect(page.locator("#accountEmail")).toBeFocused();
});
