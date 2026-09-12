"use strict";

const { expect, test } = require("./fixtures");

/**
 * Creates predictable code records for list ordering and paging coverage.
 * @param {number} count Number of records to create.
 * @returns {object[]} Administrator license API records.
 */
function createLicenseFixtures(count) {
  return Array.from({ length: count }, (_value, index) => {
    const ordinal = String(index + 1).padStart(3, "0");
    return {
      id: `e2e-license-${ordinal}`,
      source: "code",
      code: `XSXB-E2E-${ordinal}`,
      codeHashPrefix: `hash-${ordinal}`,
      status: "unused",
      permanent: false,
      durationDays: 3,
      redeemBy: "2027-12-31T23:59:59.000Z",
      expiresAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      activatedAt: null,
      accountEmail: null,
    };
  });
}

/**
 * Authenticates the static E2E server as an administrator and serves a deterministic list.
 * The production admin API itself is covered by unit/integration tests; this fixture exercises
 * the browser list state, sort controls, and pagination without a real TOTP secret.
 * @param {import("@playwright/test").Page} page Playwright page.
 * @param {object[]} licenses Administrator license records.
 * @returns {Promise<void>}
 */
async function openAdminDashboard(page, licenses) {
  await page.route("**/api/admin/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        configured: true,
        username: "e2e-admin",
        sessionExpiresAt: "2026-12-31T23:59:59.000Z",
        periodSeconds: 30,
      }),
    }),
  );
  await page.route("**/api/admin/licenses", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ licenses }) }),
  );
  await page.route("**/api/admin/accounts**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ accounts: [], defaultProEnabled: false }),
    }),
  );

  await page.goto("/admin/licenses");
  await expect(page.locator("#adminDashboardView")).toBeVisible();
  await expect(page.locator("#adminLicenseItems article")).toHaveCount(Math.min(licenses.length, 20));
}

test("VIS-032 admin login password placeholder is fully visible and continue stays below the field", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/admin/licenses");
  await expect(page.locator("#adminLoginView")).toBeVisible();
  const password = page.locator("#adminPassword");
  const submit = page.locator("#adminLoginButton");
  await expect(password).toHaveAttribute("placeholder", "请输入管理员密码");
  const metrics = await page.evaluate(() => {
    const field = document.querySelector("#adminPassword");
    const button = document.querySelector("#adminLoginButton");
    const fieldBox = field.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const style = getComputedStyle(field);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      letterSpacing: Number.parseFloat(style.letterSpacing) || 0,
      fieldBottom: fieldBox.bottom,
      buttonTop: buttonBox.top,
      overlap:
        fieldBox.left < buttonBox.right &&
        fieldBox.right > buttonBox.left &&
        fieldBox.top < buttonBox.bottom &&
        fieldBox.bottom > buttonBox.top,
    };
  });
  expect(metrics.fontSize, "password field must not use the 36px TOTP display font").toBeLessThanOrEqual(20);
  expect(metrics.letterSpacing, "wide letter-spacing clips 请输入管理员密码").toBeLessThanOrEqual(2);
  expect(metrics.overlap, "continue must not cover the password field").toBe(false);
  expect(metrics.buttonTop, "continue must sit below the password field").toBeGreaterThan(
    metrics.fieldBottom,
  );
  await expect(submit).toBeVisible();
});

test("dedicated email authorization administration page renders from its direct route", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/admin/licenses");

  await expect(page).toHaveURL(/\/admin\/licenses$/u);
  await expect(page).toHaveTitle("账户与授权管理 — X-Frame");
  await expect(page.getByRole("heading", { name: "验证管理员身份" })).toBeVisible();
  await expect(page.locator("#adminLoginView")).toBeVisible();
  await expect(page.locator("#adminDashboardView")).toBeHidden();

  await page.getByRole("link", { name: /返回首页/u }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("heading", { name: "从原始素材， 到可用动画。" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("email authorization manager opens the sign-in flow without device state", async ({ page }) => {
  await page.goto("/workspace");
  const accountButton = page.locator("#workspaceAccount");
  await expect(accountButton).toBeVisible();
  await expect(page.locator("#activationManage")).toBeHidden();
  await accountButton.click();

  const panel = page.locator("#activationPanel");
  await expect(panel).toBeVisible();
  await expect(page.locator("#accountEmail")).toBeFocused();
  await expect(page.locator("#accountLoginForm")).toBeVisible();
  await expect(page.locator("#activationForm")).toBeHidden();
  await expect(page.locator("#activationPanel")).not.toContainText(/设备|浏览器指纹/u);
});

test("administrator license list sorts, paginates, and resets after a search", async ({ page }) => {
  await openAdminDashboard(page, createLicenseFixtures(45));

  const items = page.locator("#adminLicenseItems article");
  await expect(page.locator("#adminLicensePageStatus")).toHaveText("第 1 / 3 页 · 共 45 条");
  await expect(page.locator("#adminLicensePreviousPage")).toBeDisabled();
  await expect(page.locator("#adminLicenseNextPage")).toBeEnabled();
  await expect(items.first().locator("strong")).toHaveText("XSXB-E2E-045");

  await page.locator("#adminLicenseNextPage").click();
  await expect(page.locator("#adminLicensePageStatus")).toHaveText("第 2 / 3 页 · 共 45 条");
  await expect(items.first().locator("strong")).toHaveText("XSXB-E2E-025");

  await page.locator("#adminLicenseSort").selectOption("expires-asc");
  await expect(page.locator("#adminLicensePageStatus")).toHaveText("第 1 / 3 页 · 共 45 条");
  await expect(items.first().locator("strong")).toHaveText("XSXB-E2E-001");

  await page.locator("#adminLicenseSearch").fill("E2E-007");
  await expect(page.locator("#adminLicensePageStatus")).toHaveText("第 1 / 1 页 · 共 1 条");
  await expect(items).toHaveCount(1);
  await expect(items.first().locator("strong")).toHaveText("XSXB-E2E-007");
});
