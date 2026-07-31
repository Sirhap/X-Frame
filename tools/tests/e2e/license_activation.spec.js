"use strict";

const { expect, test } = require("@playwright/test");

const E2E_ACTIVATION_CODE = "XSXB-E2E-ONLY";

test("local factory opens the dedicated license administration page", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await page.getByRole("link", { name: "许可证管理" }).first().click();

  await expect(page).toHaveURL(/\/admin\/licenses$/u);
  await expect(page).toHaveTitle("激活码管理 — XSXB Frame Tuner");
  await expect(page.getByRole("heading", { name: "验证管理员身份" })).toBeVisible();
  await expect(page.locator("#adminLoginView")).toBeVisible();
  await expect(page.locator("#adminDashboardView")).toBeHidden();

  await page.getByRole("link", { name: /返回首页/u }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.locator("#factoryTitle")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("license manager reports invalid codes and persists a valid activation", async ({ page }) => {
  await page.goto("/workspace");
  const manageButton = page.locator("#activationManage");
  await expect(manageButton).toHaveAttribute("data-active", "false");
  await manageButton.click();

  const panel = page.locator("#activationPanel");
  const codeInput = page.locator("#activationCode");
  const status = page.locator("#activationStatus");
  await expect(panel).toBeVisible();
  await expect(codeInput).toBeFocused();

  await codeInput.fill("XSXB-NOT-VALID");
  await page.locator("#activationSubmit").click();
  await expect(status).toContainText("Invalid activation code.");
  await expect(status).toHaveAttribute("data-tone", "error");
  await expect(codeInput).toBeEnabled();

  await codeInput.fill(E2E_ACTIVATION_CODE);
  await page.locator("#activationSubmit").click();
  await expect(page.locator("#activationPlanBadge")).toHaveText("已激活");
  await expect(status).toHaveAttribute("data-tone", "success");
  await expect(manageButton).toHaveAttribute("data-active", "true");

  await page.locator("#activationCancel").click();
  await expect(panel).toBeHidden();
  await page.reload();
  await expect(manageButton).toHaveAttribute("data-active", "true");

  const activationResponse = await page.request.get("/api/activation");
  expect(activationResponse.ok()).toBe(true);
  await expect(activationResponse.json()).resolves.toMatchObject({
    activated: true,
    configured: true,
  });
});
