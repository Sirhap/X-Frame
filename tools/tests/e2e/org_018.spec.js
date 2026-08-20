"use strict";

const { expect, test } = require("./fixtures");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);

const WORKSET_SIZE = 10;

/**
 * Imports an N-frame included workset and opens the loop-finder params.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function openLoopStartParams(page) {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles(
    Array.from({ length: WORKSET_SIZE }, (_, index) => ({
      name: `frame_${String(index + 1).padStart(4, "0")}.png`,
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    })),
  );
  await expect(page.locator(".organizerFrame")).toHaveCount(WORKSET_SIZE);
  await expect(page.locator("#organizerFindLoop")).toBeEnabled();
  await page.locator("#organizerFindLoop").click();
  await expect(page.locator("#organizerLoopPanel")).toBeVisible();
  await page.locator("#organizerLoopStartCustom").check();
  await expect(page.locator("#organizerLoopStartRow")).toBeVisible();
}

/**
 * Runs a custom-start search and waits for the results stage.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {string} startFrame 1-based included start.
 * @returns {Promise<void>}
 */
async function searchFromStart(page, startFrame) {
  const input = page.locator("#organizerLoopStartInput");
  await input.fill(startFrame);
  await expect(input).toHaveValue(startFrame);
  await page.locator("#organizerLoopStartSearch").click();
  await expect(page.locator("#organizerLoopResults")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#organizerLoopError")).toBeHidden();
}

test("ORG-018 start=1 and start=N are accepted on an included workset", async ({ page }) => {
  await openLoopStartParams(page);
  const input = page.locator("#organizerLoopStartInput");
  await expect(input).toHaveAttribute("max", String(WORKSET_SIZE));
  await expect(page.locator("#organizerLoopStartMax")).toHaveText(`/ ${WORKSET_SIZE}`);

  await searchFromStart(page, "1");
  await page.locator("#organizerLoopRetry").click();
  await expect(page.locator("#organizerLoopParams")).toBeVisible();
  await page.locator("#organizerLoopStartCustom").check();
  await searchFromStart(page, String(WORKSET_SIZE));
  await expect(page.locator("#organizerLoopEmpty")).toBeVisible();
});

test("ORG-018 start=N+1 is clamped or rejected before search", async ({ page }) => {
  await openLoopStartParams(page);
  const input = page.locator("#organizerLoopStartInput");

  await input.fill(String(WORKSET_SIZE + 1));
  await expect(input).toHaveValue(String(WORKSET_SIZE));
  await expect(page.locator("#organizerLoopSearch")).toBeHidden();
  await expect(page.locator("#organizerLoopParams")).toBeVisible();

  const rejected = await page.evaluate(
    async (outOfRange) => {
      const inputEl = document.querySelector("#organizerLoopStartInput");
      const searchEl = document.querySelector("#organizerLoopStartSearch");
      if (document.activeElement === inputEl) inputEl.blur();
      inputEl.value = outOfRange;
      searchEl.click();
      return {
        value: inputEl.value,
        paramsHidden: document.querySelector("#organizerLoopParams").hidden,
        searchVisible: !document.querySelector("#organizerLoopSearch").hidden,
        resultsVisible: !document.querySelector("#organizerLoopResults").hidden,
        error: document.querySelector("#organizerLoopError").textContent,
        errorHidden: document.querySelector("#organizerLoopError").hidden,
      };
    },
    String(WORKSET_SIZE + 1),
  );
  expect(rejected.value, "N+1 must not remain in the field").toBe(String(WORKSET_SIZE));
  expect(rejected.searchVisible, "search must not run with an out-of-range start").toBe(false);
  expect(rejected.paramsHidden, "out-of-range start must stay on the params stage").toBe(false);
  expect(rejected.resultsVisible).toBe(false);
  expect(rejected.errorHidden).toBe(false);
  expect(rejected.error).toContain(String(WORKSET_SIZE));
});

test("ORG-018 empty start stays safe and focus replaces the current digits", async ({ page }) => {
  await openLoopStartParams(page);
  const input = page.locator("#organizerLoopStartInput");
  await input.fill("");
  await input.blur();
  await expect(input).toHaveValue("1");
  await page.locator("#organizerLoopStartSearch").click();
  await expect(page.locator("#organizerLoopResults")).toBeVisible({ timeout: 20000 });

  await page.locator("#organizerLoopRetry").click();
  await page.locator("#organizerLoopStartCustom").check();
  await input.fill(String(WORKSET_SIZE));
  await expect(input).toHaveValue(String(WORKSET_SIZE));
  await input.click();
  await page.keyboard.type("2");
  await expect(input, "typing must replace 10 instead of prepending to 210/102").toHaveValue("2");
});
