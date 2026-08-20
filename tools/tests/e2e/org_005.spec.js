"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { expect, test } = require("./fixtures");

const INDEX_HTML = fs.readFileSync(path.join(__dirname, "../../animation_tuner/public/index.html"), "utf8");
const NAME_MAX_LENGTH = Number(INDEX_HTML.match(/id="organizerProfileName"[\s\S]*?maxlength="(\d+)"/u)[1]);

/**
 * Lists persisted project labels from the local e2e server.
 * @param {import("@playwright/test").APIRequestContext} request Playwright request.
 * @returns {Promise<string[]>} Project labels.
 */
async function projectLabels(request) {
  const payload = await request.get("/api/projects").then((response) => response.json());
  return (payload.projects || []).map((project) => String(project.label || ""));
}

test("ORG-005 creating a project with 81 characters does not persist a long name", async ({ page }) => {
  const tooLong = "a".repeat(NAME_MAX_LENGTH + 1);
  page.once("dialog", (dialog) => dialog.accept(tooLong));
  await page.goto("/projects");
  const posted = page
    .waitForResponse(
      (response) => response.url().includes("/api/projects") && response.request().method() === "POST",
    )
    .catch(() => null);
  await page.locator("#projectHubNew").click();
  await posted;

  const labels = await projectLabels(page.request);
  expect(
    labels.some((label) => label === tooLong),
    "81-character names must not be stored",
  ).toBe(false);
  expect(
    labels.every((label) => label.length <= NAME_MAX_LENGTH),
    `stored labels ${labels.map((label) => label.length)} exceed the ${NAME_MAX_LENGTH}-char cap`,
  ).toBe(true);
});

test("ORG-005 an 80-character project name is still created", async ({ page }) => {
  const allowed = "b".repeat(NAME_MAX_LENGTH);
  page.once("dialog", (dialog) => dialog.accept(allowed));
  await page.goto("/projects");
  await Promise.all([
    page.waitForURL(/\/workspace\/resources\/import\?.*project=/u),
    page.locator("#projectHubNew").click(),
  ]);
  const labels = await projectLabels(page.request);
  expect(labels).toContain(allowed);
  await expect(page.locator("#organizerProjectSelect")).toContainText(allowed);
});

test("ORG-005 role name and video FPS bounds stay constrained", async ({ page }) => {
  await page.goto("/tools/import");
  const profile = page.locator("#organizerProfileName");
  await expect(profile).toHaveAttribute("maxlength", String(NAME_MAX_LENGTH));
  await profile.fill(`${"c".repeat(NAME_MAX_LENGTH)}X`);
  await expect(profile).toHaveValue("c".repeat(NAME_MAX_LENGTH));

  const fps = await page.evaluate(() => {
    const calculate = globalThis.FrameOrganizerVideo.calculateSelection;
    const sample = { duration: 2, width: 8, height: 8, start: 0, end: 1 };
    const input = document.querySelector("#organizerVideoFpsNumber");
    return {
      zero: calculate({ ...sample, fps: 0 }).fps,
      high: calculate({ ...sample, fps: 121 }).fps,
      invalid: calculate({ ...sample, fps: "abc" }).fps,
      min: input?.getAttribute("min"),
      max: input?.getAttribute("max"),
    };
  });
  expect(fps.zero, "FPS 0 must clamp to 1").toBe(1);
  expect(fps.high, "FPS 121 must clamp to 60").toBe(60);
  expect(fps.invalid, "non-numeric FPS must not pass through").toBe(1);
  expect(fps.min).toBe("1");
  expect(fps.max).toBe("60");
});
