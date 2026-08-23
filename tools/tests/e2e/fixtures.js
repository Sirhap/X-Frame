"use strict";

const { expect, test: base } = require("@playwright/test");
const { resetE2EWorkspace, resolveE2ERoot } = require("./e2e_fixture");

const test = base.extend({
  _resetE2EFixture: [
    async ({}, use) => {
      resetE2EWorkspace(resolveE2ERoot());
      await use();
    },
    { auto: true },
  ],
});

/**
 * Opens a collapsed organizer tool menu when the target control is hidden.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {string} summarySelector Details summary.
 * @param {string} targetSelector Control that must be visible afterwards.
 * @returns {Promise<void>}
 */
async function openOrganizerToolMenu(page, summarySelector, targetSelector) {
  const target = page.locator(targetSelector);
  if (await target.isVisible()) return;
  await page.locator(summarySelector).click();
  await expect(target).toBeVisible();
}

/**
 * Waits until organizer sequence tools are visible next to 智能抠图.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function openOrganizerAnalysisMenu(page) {
  await expect(page.locator("#organizerFindLoop")).toBeVisible();
}

/**
 * Waits until organizer delete actions are visible on the invert/edit strip.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function openOrganizerDangerMenu(page) {
  await expect(page.locator("#organizerDeleteSelected")).toBeVisible();
}

module.exports = { expect, test, openOrganizerAnalysisMenu, openOrganizerDangerMenu };
