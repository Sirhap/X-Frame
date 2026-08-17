"use strict";

const { expect, test } = require("@playwright/test");

const BASE_PHYSICAL_VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);
const ZOOM_CASES = Object.freeze([
  { label: "100", scale: 1 },
  { label: "125", scale: 1.25 },
  { label: "150", scale: 1.5 },
  { label: "200", scale: 2 },
]);
/* /tools/organizer intentionally shares the import workbench ("整理 = 导入台"),
   so import-populated is its single visual baseline. */
const VISUAL_PAGES = Object.freeze([
  { name: "landing", path: "/", shell: "body" },
  { name: "workspace", path: "/workspace", shell: ".app" },
  { name: "import-empty", path: "/tools/import", shell: "#organizerModal" },
  { name: "import-populated", path: "/tools/import", shell: "#organizerModal" },
  { name: "cutout", path: "/tools/cutout", shell: "#cutoutModal" },
  { name: "scatter-slice", path: "/tools/scatter-slice", shell: "#scatterSliceSurface" },
  { name: "watermark", path: "/tools/watermark", shell: "#watermarkWorkspace" },
]);
const ENGLISH_LAYOUT_PAGES = Object.freeze(
  VISUAL_PAGES.filter(({ name }) =>
    ["workspace", "import-empty", "import-populated", "cutout"].includes(name),
  ),
);

/**
 * Activates fresh deterministic content so prior end-to-end mutations cannot affect snapshots.
 * @param {import("@playwright/test").APIRequestContext} request Playwright request context.
 * @returns {Promise<void>}
 */
async function activateVisualFixture(request) {
  const response = await request.post("/api/import-animation", {
    data: {
      projectLabel: "Visual Baseline",
      profileLabel: "Hero",
      animationName: "visual-idle",
      fps: 12,
      items: [1, 2, 3].map((index) => ({
        name: `visual_${String(index).padStart(4, "0")}.png`,
        data: `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`,
      })),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/**
 * Converts a desktop browser zoom level into the CSS viewport seen by the page.
 * The device scale factor keeps the resulting screenshot close to 1600 × 900 physical pixels.
 * @param {number} scale Browser zoom multiplier.
 * @returns {{width: number, height: number}} CSS viewport dimensions.
 */
function getZoomedViewport(scale) {
  return {
    width: Math.round(BASE_PHYSICAL_VIEWPORT.width / scale),
    height: Math.round(BASE_PHYSICAL_VIEWPORT.height / scale),
  };
}

/**
 * Adds deterministic image content so populated organizer and cutout layouts are covered.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {string} pageName Visual page identifier.
 * @returns {Promise<void>}
 */
async function populateVisualPage(page, pageName) {
  const files = [1, 2, 3].map((index) => ({
    name: `frame_${String(index).padStart(4, "0")}.png`,
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  }));

  if (pageName === "import-populated") {
    await page.locator("#organizerFileInput").setInputFiles(files);
    await expect(page.locator(".organizerFrame")).toHaveCount(files.length);
  }

  if (pageName === "cutout") {
    await page.locator("#cutoutFileInput").setInputFiles(files);
    await expect(page.locator(".cutoutQueueItem")).toHaveCount(files.length);
    await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", {
      timeout: 20000,
    });
    await page.locator("#cutoutSidebarBatchTab").click();
    await expect(page.locator("#cutoutSidebarBatchTab")).toHaveAttribute("aria-selected", "true");
  }
}

/**
 * Freezes visual motion and waits for fonts before comparing a screenshot.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function stabilizeVisualPage(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
  });
}

/**
 * Verifies that a responsive application shell does not create horizontal scrolling.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {string} selector Application shell selector.
 * @returns {Promise<void>}
 */
async function expectNoHorizontalOverflow(page, selector) {
  const widths = await page.locator(selector).evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth + 1);
}

/**
 * Verifies that visible controls and important copy are not silently clipped by an ancestor.
 * Whole-page scrollWidth checks cannot detect this when the ancestor uses overflow-x: hidden.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {string} selector Application shell selector.
 * @returns {Promise<void>}
 */
async function expectNoClippedDescendants(page, selector) {
  const offenders = await page.locator(selector).evaluate((shell) => {
    const candidateSelector = [
      "button",
      "input",
      "select",
      "textarea",
      "label",
      "[role='button']",
      "[role='tab']",
      "[role='slider']",
      "[role='status']",
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
      "small",
      "strong",
    ].join(",");
    const tolerance = 1;

    return [...shell.querySelectorAll(candidateSelector)].flatMap((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      if (
        !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        bounds.width <= 0 ||
        bounds.height <= 0
      ) {
        return [];
      }

      let ancestor = element.parentElement;
      while (ancestor && ancestor !== shell.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (["hidden", "clip"].includes(ancestorStyle.overflowX)) {
          const ancestorBounds = ancestor.getBoundingClientRect();
          if (
            bounds.left < ancestorBounds.left - tolerance ||
            bounds.right > ancestorBounds.right + tolerance
          ) {
            return [
              {
                ancestor: ancestor.id || ancestor.className || ancestor.tagName,
                element:
                  element.id || element.getAttribute("aria-label") || element.className || element.tagName,
                left: Math.round(bounds.left * 10) / 10,
                right: Math.round(bounds.right * 10) / 10,
                visibleLeft: Math.round(ancestorBounds.left * 10) / 10,
                visibleRight: Math.round(ancestorBounds.right * 10) / 10,
              },
            ];
          }
        }
        ancestor = ancestor.parentElement;
      }
      return [];
    });
  });

  expect(offenders).toEqual([]);
}

for (const zoomCase of ZOOM_CASES) {
  test.describe(`browser zoom ${zoomCase.label}%`, () => {
    test.use({
      deviceScaleFactor: zoomCase.scale,
      viewport: getZoomedViewport(zoomCase.scale),
    });

    for (const visualPage of VISUAL_PAGES) {
      test(`${visualPage.name} remains stable`, async ({ page, request }) => {
        await activateVisualFixture(request);
        await page.goto(visualPage.path, { waitUntil: "networkidle" });
        await expect(page.locator(visualPage.shell)).toBeVisible();
        await populateVisualPage(page, visualPage.name);
        await stabilizeVisualPage(page);
        await expectNoHorizontalOverflow(page, visualPage.shell);
        await expectNoClippedDescendants(page, visualPage.shell);
        if (visualPage.name === "scatter-slice") {
          await expectNoHorizontalOverflow(page, "#scatterSliceSurface");
          await expectNoClippedDescendants(page, "#scatterSliceSurface");
        }
        await expect(page).toHaveScreenshot(`${visualPage.name}-zoom-${zoomCase.label}.png`, {
          animations: "disabled",
          caret: "hide",
          maxDiffPixelRatio: 0.002,
          scale: "device",
          threshold: 0.2,
        });
      });
    }
  });
}

test.describe("explicit English layout", () => {
  test.use({ viewport: BASE_PHYSICAL_VIEWPORT });

  for (const visualPage of ENGLISH_LAYOUT_PAGES) {
    test(`${visualPage.name} keeps visible descendants inside clipping boundaries`, async ({
      page,
      request,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem("xsxbFrameTuner.language", "en");
        localStorage.setItem("xsxbFrameTuner.languageExplicit", "true");
      });
      await activateVisualFixture(request);
      await page.goto(visualPage.path, { waitUntil: "networkidle" });
      await expect(page.locator(visualPage.shell)).toBeVisible();
      await populateVisualPage(page, visualPage.name);
      await stabilizeVisualPage(page);
      await expectNoHorizontalOverflow(page, visualPage.shell);
      await expectNoClippedDescendants(page, visualPage.shell);
    });
  }
});
