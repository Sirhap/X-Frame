"use strict";

const { expect, test } = require("./fixtures");

test("BOX-006 selected box arrows nudge instead of stepping the filmstrip", async ({ page }) => {
  await page.goto("/workspace/animation/boxes");
  await expect(page.locator("body")).toHaveAttribute("data-workspace-tool", "boxes");
  await expect(page.locator("#filmstrip .thumb[data-frame-index='0']")).toBeVisible();
  await page.locator("#showBoxes").check();
  await page.locator('[data-box-choice="hurtbox"]').check();
  await expect(page.locator("#filmstrip .thumb[data-frame-index='0']")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.locator("#workspaceFlowProject").click();
  await page.keyboard.press("ArrowRight");

  await expect(page.locator("#filmstrip .thumb[data-frame-index='0']")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#filmstrip .thumb[data-frame-index='1']")).not.toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#status")).toContainText("nudge box");
});
