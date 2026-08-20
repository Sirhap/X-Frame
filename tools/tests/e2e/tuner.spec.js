"use strict";

const { expect, test } = require("./fixtures");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);
const WIDE_IMAGE_PATH = path.resolve(__dirname, "../../../docs/screenshot.png");
const WIDE_IMAGE_PNG = fs.readFileSync(WIDE_IMAGE_PATH);
const PNG_CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/**
 * Wraps PNG chunk data in its length, type and CRC envelope.
 * @param {string} type Four-letter chunk type.
 * @param {Buffer} data Chunk payload.
 * @returns {Buffer} Encoded chunk.
 */
function pngChunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([Buffer.from(type, "ascii"), data])) {
    crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([header, data, checksum]);
}

/**
 * Encodes an opaque frame whose centered quarter is the subject and whose
 * remaining three quarters are a flat background. A one-pixel image cannot tell
 * a working cutout apart from one that returns its input untouched.
 * @param {number} size Square edge length in pixels.
 * @param {number} shift Horizontal subject offset distinguishing the frames.
 * @param {[number,number,number]} background Background RGB.
 * @returns {Buffer} PNG file bytes.
 */
function subjectOnBackgroundPng(size, shift, background) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside =
        x >= size / 4 + shift && x < (size * 3) / 4 + shift && y >= size / 4 && y < (size * 3) / 4;
      const offset = y * stride + 1 + x * 4;
      raw[offset] = inside ? 220 : background[0];
      raw[offset + 1] = inside ? 60 : background[1];
      raw[offset + 2] = inside ? 60 : background[2];
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Measures the share of fully transparent pixels in every organizer thumbnail.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<number[]>} Transparent pixel ratio per frame.
 */
function organizerThumbnailTransparency(page) {
  return page.evaluate(async () => {
    const images = Array.from(document.querySelectorAll(".organizerFrame img"));
    await Promise.all(
      images.map((image) => {
        if (image.complete && image.naturalWidth > 0) return undefined;
        return new Promise((resolve, reject) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener(
            "error",
            () => reject(new Error(`organizer thumbnail failed to load: ${image.currentSrc}`)),
            { once: true },
          );
        });
      }),
    );
    return images.map((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let transparent = 0;
      for (let offset = 3; offset < data.length; offset += 4) if (data[offset] === 0) transparent += 1;
      return transparent / (data.length / 4);
    });
  });
}

/**
 * Opens the sidebar batch panel after its queue is ready.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function expandStableBatchTray(page) {
  await expect.poll(() => page.locator(".cutoutQueueItem").count()).toBeGreaterThan(0);
  await page.locator("#cutoutSidebarBatchTab").click();
  await expect(page.locator("#cutoutSidebarBatchTab")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#cutoutSidebarBatchPanel")).toBeVisible();
}

/**
 * Opens the single-image repair workbench with one full-size image and two navigation frames.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function openRepairWorkbench(page) {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: WIDE_IMAGE_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await page.locator(".organizerFrameCutout").first().click();
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await expect(page).toHaveURL(/\/tools\/import/);
  await expect(page.locator("#organizerModal")).toBeVisible();
  await expect(page.locator("#organizerModal")).toHaveAttribute("inert", "");
  await expect(page.locator("#organizerModal")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
}

test("organizer smart cutout processes the workset without opening the batch editor", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  const batchCutout = page.locator("#organizerBatchCutout");
  await expect(batchCutout).toBeEnabled();
  await page.locator("#organizerToggleImportSetup").click();
  await expect(page.locator("#organizerAnimationNameField")).toBeHidden();
  await expect(page.locator("#organizerImportFps")).toHaveCount(0);

  await batchCutout.click();

  const cutoutModal = page.locator("#cutoutModal");
  const organizerModal = page.locator("#organizerModal");
  await expect(cutoutModal).toBeHidden();
  await expect(organizerModal).toBeVisible();
  await expect(organizerModal).not.toHaveAttribute("inert", "");
  await expect(page.locator("#organizerViewEdited")).toHaveClass(/active/);
});

for (const [label, background] of [
  ["white", [255, 255, 255]],
  ["green screen", [0, 177, 64]],
  ["near black", [12, 12, 12]],
]) {
  test(`organizer smart cutout erases a ${label} background from every frame`, async ({ page }) => {
    await page.goto("/tools/import");
    await page.locator("#organizerFileInput").setInputFiles(
      [0, 2, 4].map((shift, index) => ({
        name: `frame_${String(index + 1).padStart(4, "0")}.png`,
        mimeType: "image/png",
        buffer: subjectOnBackgroundPng(64, shift, background),
      })),
    );
    await expect(page.locator(".organizerFrame")).toHaveCount(3);
    expect(await organizerThumbnailTransparency(page)).toEqual([0, 0, 0]);

    await page.locator("#organizerBatchCutout").click();

    await expect(page.locator("#organizerStatus")).toContainText("已回写 3 帧", { timeout: 60000 });
    await expect(page.locator("#organizerViewEdited")).toHaveClass(/active/);
    // The subject covers exactly one quarter of each frame, so a working cutout
    // clears the remaining three quarters. Reporting success while the frames
    // stay opaque is the failure this guards.
    for (const ratio of await organizerThumbnailTransparency(page)) {
      expect(ratio).toBeGreaterThan(0.7);
    }
  });
}

test("organizer smart cutout reports progress and encodes every frame once", async ({ page }) => {
  const errors = [];
  const frameCount = 20;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__frameEncodes = 0;
    const encode = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function countedToDataURL(...args) {
      window.__frameEncodes += 1;
      return encode.apply(this, args);
    };
  });
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles(
    Array.from({ length: frameCount }, (_, index) => ({
      name: `frame_${String(index + 1).padStart(4, "0")}.png`,
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    })),
  );
  await expect(page.locator(".organizerFrame")).toHaveCount(frameCount);

  // The toast used to sit under the organizer modal (z-index 1000 vs 1001), so
  // tests that only watched the hidden attribute could pass while the user saw
  // no load progress at all.
  const stacking = await page.evaluate(() => {
    const overlay = document.querySelector("#organizerSmartCutoutProgress");
    const organizer = document.querySelector("#organizerModal");
    const wasHidden = overlay.hidden;
    overlay.hidden = false;
    const result = {
      overlay: Number(getComputedStyle(overlay).zIndex) || 0,
      organizer: Number(getComputedStyle(organizer).zIndex) || 0,
    };
    overlay.hidden = wasHidden;
    return result;
  });
  expect(stacking.overlay).toBeGreaterThan(stacking.organizer);

  await page.locator("#organizerSmartCutoutProgress").evaluate((overlay) => {
    window.__overlayShown = false;
    window.__overlayVisible = false;
    new MutationObserver(() => {
      if (overlay.hidden) return;
      window.__overlayShown = true;
      const bounds = overlay.getBoundingClientRect();
      window.__overlayVisible =
        bounds.width > 0 &&
        bounds.height > 0 &&
        getComputedStyle(overlay).visibility !== "hidden" &&
        getComputedStyle(overlay).opacity !== "0";
    }).observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
  });
  const baselineEncodes = await page.evaluate(() => window.__frameEncodes);

  await page.locator("#organizerBatchCutout").click();

  await expect(page.locator("#organizerStatus")).toContainText(`已回写 ${frameCount} 帧`, {
    timeout: 120000,
  });
  expect(await page.evaluate(() => window.__overlayShown)).toBe(true);
  expect(await page.evaluate(() => window.__overlayVisible)).toBe(true);
  await expect(page.locator("#organizerSmartCutoutProgress")).toBeHidden();
  await expect(page.locator("#organizerBatchCutout")).toBeEnabled();
  await expect(page.locator("#organizerViewEdited")).toHaveClass(/active/);
  await expect(page.locator("#cutoutModal")).toBeHidden();

  const encodes = (await page.evaluate(() => window.__frameEncodes)) - baselineEncodes;
  expect(encodes).toBeLessThanOrEqual(frameCount * 7);

  const previewLabel = await page.locator("#organizerPreviewFrame").textContent();
  await expect.poll(() => page.locator("#organizerPreviewFrame").textContent()).not.toBe(previewLabel);
  expect(errors).toEqual([]);
});

const DOWNSTREAM_ACTIONS = Object.freeze([
  "#organizerReset",
  "#organizerExport",
  "#organizerAddProject",
  "#organizerApply",
]);

/**
 * Asserts every downstream organizer action is on screen and receives its own
 * clicks, naming the covering element when one steals the center point.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {{scroll?:boolean}} [options] Whether each action may be scrolled into view first.
 * @returns {Promise<void>}
 */
async function expectDownstreamActionsHittable(page, options = {}) {
  for (const selector of DOWNSTREAM_ACTIONS) {
    const action = page.locator(selector);
    await expect
      .poll(
        async () => {
          // Re-scroll on every attempt: opening the downstream menu reflows the
          // footer, which can push a previously revealed action back off screen.
          if (options.scroll) await action.scrollIntoViewIfNeeded();
          return action.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const x = bounds.left + bounds.width / 2;
            const y = bounds.top + bounds.height / 2;
            if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
              return "outside the viewport";
            }
            const target = document.elementFromPoint(x, y);
            if (target === element || element.contains(target)) return "reachable";
            if (!target) return "covered by nothing";
            return `covered by ${target.tagName}${target.id ? `#${target.id}` : ""}.${String(target.className || "")}`;
          });
        },
        { message: `${selector} should receive its own clicks` },
      )
      .toBe("reachable");
  }
}

/**
 * Scrolls a control into the cutout parameter pane without moving the page.
 * @param {import("@playwright/test").Locator} locator Target inside #cutoutSidebarParametersPanel.
 * @returns {Promise<void>}
 */
async function revealInCutoutParams(locator) {
  await locator.evaluate((element) => {
    const pane = element.closest("#cutoutSidebarParametersPanel");
    if (!pane) return;
    const paneRect = pane.getBoundingClientRect();
    const elRect = element.getBoundingClientRect();
    pane.scrollTop += elRect.top - paneRect.top - 24;
  });
}

/**
 * Measures the unused strip between the organizer body and its workbench bottom.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<{gap:number,bodyHeight:number}>}
 */
async function measureOrganizerFill(page) {
  return page.evaluate(() => {
    const workbench = document.querySelector(".organizerWorkbench");
    const body = document.querySelector(".organizerBody");
    const workbenchBounds = workbench.getBoundingClientRect();
    const bodyBounds = body.getBoundingClientRect();
    return {
      gap: Math.round(workbenchBounds.bottom - bodyBounds.bottom),
      bodyHeight: Math.round(bodyBounds.height),
    };
  });
}

test("organizer workbench fills its surface in every toolbar state", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/tools/import");
  await expect(page.locator(".organizerWorkbench")).toBeVisible();
  await expect(page.locator(".organizerBody")).toBeVisible();

  const empty = await measureOrganizerFill(page);
  expect(empty.bodyHeight).toBeGreaterThan(400);
  expect(empty.gap).toBeLessThanOrEqual(2);

  await page.locator("#organizerFileInput").setInputFiles(
    [1, 2, 3].map((index) => ({
      name: `frame_000${index}.png`,
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    })),
  );
  await expect(page.locator(".organizerFrame")).toHaveCount(3);
  const populated = await measureOrganizerFill(page);
  expect(populated.gap).toBeLessThanOrEqual(2);

  await page.locator("#organizerToggleImportSetup").click();
  await expect(page.locator("#organizerImportSetup")).toBeVisible();
  const expanded = await measureOrganizerFill(page);
  expect(expanded.gap).toBeLessThanOrEqual(2);
  expect(expanded.bodyHeight).toBeLessThan(populated.bodyHeight);
});

/**
 * Selects a repair tool and waits until its result canvas is ready for a gesture.
 * @param {import("@playwright/test").Page} page Browser page.
 * @param {string} selector Repair-tool selector.
 * @returns {Promise<void>}
 */
async function selectRepairTool(page, selector) {
  const button = page.locator(selector);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveClass(/active/);
  await expect(button).toBeEnabled();
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
}

/**
 * Opens the consolidated protection controls and activates subject selection.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function selectProtectionTool(page) {
  await selectRepairTool(page, "#cutoutRepairAutomaticQuick");
  const advancedTab = page.locator("#cutoutTabAdvanced");
  await advancedTab.scrollIntoViewIfNeeded();
  await advancedTab.click();
  const disclosure = page.locator(".cutoutProtectionDisclosure");
  if (!(await disclosure.evaluate((element) => element.open))) await disclosure.locator("summary").click();
  await selectRepairTool(page, "#cutoutRepairProtect");
}

/**
 * Drags horizontally across the center of the editable preview.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function dragAcrossPreview(page) {
  const canvasBox = await page.locator("#cutoutResult").boundingBox();
  const y = canvasBox.y + canvasBox.height / 2;
  const startX = canvasBox.x + canvasBox.width * 0.45;
  const endX = canvasBox.x + canvasBox.width * 0.65;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 8 });
  await page.mouse.up();
}

test("desktop selection is linkable and browser history restores it", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workspace");
  await expect(page).toHaveTitle(/XSXB Frame Tuner$/);
  const options = await page
    .locator("#groupSelect option")
    .evaluateAll((nodes) => nodes.map((node) => node.value));
  if (options.length >= 2) {
    const firstUrl = page.url();
    await page.selectOption("#groupSelect", options[1]);
    await expect(page).toHaveURL(/group=/);
    expect(page.url()).not.toBe(firstUrl);
    await page.goBack();
    await expect(page.locator("#groupSelect")).toHaveValue(options[0]);
  }
  expect(errors).toEqual([]);
});

test("the website home, import flow, and tuning workbench use separate URLs", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#factoryTitle")).toBeVisible();
  await expect(page.locator("#stage")).toHaveCount(0);
  await page.getByRole("link", { name: "打开快速工具" }).click();
  await expect(page).toHaveURL(/\/tools$/);
  await page.getByRole("link", { name: /序列处理/ }).click();
  await expect(page).toHaveURL(/\/tools\/organizer/);
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#filmstrip")).toBeVisible();
  await page.getByRole("link", { name: "网站首页" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#factoryTitle")).toBeVisible();
  await page.goto("/tools/import");
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.locator("#workspaceFlowBack").click();
  await expect(page).toHaveURL(/\/tools$/);
  await expect(page.locator("#quickToolsHub")).toBeVisible();
  await page.getByRole("link", { name: "转到动画项目" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator("#projectHubContinue")).toHaveAttribute("data-document-navigation", "");
  await expect(page.locator(".projectHubCard").first()).toHaveAttribute("data-document-navigation", "");
  await page.locator("#projectHubContinue").click();
  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.locator("#stage")).toBeVisible();
  await page.reload();
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#filmstrip")).toBeVisible();
});

test("factory workstation count follows visible tool cards instead of advertising SIX", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("a.tool-card")).toHaveCount(6);
  await expect(page.locator("[data-workstation-count]")).toHaveText(/^(SIX|六)$/);

  await page.evaluate(() => {
    document.querySelector("a.tool-card[href='/tools/watermark']")?.remove();
  });
  await page.locator('[data-factory-language="en"]').click();
  await expect(page.locator("a.tool-card")).toHaveCount(5);
  await expect(page.locator("a.tool-card[href='/tools/watermark']")).toHaveCount(0);
  await expect(page.locator("[data-workstation-count]")).toHaveText("FIVE");
});

test("homepage language selector persists the workbench language", async ({ page }) => {
  await page.goto("/");
  const english = page.locator('[data-factory-language="en"]');
  await expect(english).toBeVisible();
  await english.click();
  await expect(english).toHaveAttribute("aria-pressed", "true");

  await page.goto("/workspace");
  await expect(page.locator('a[data-app-mode="projects"]')).toContainText("Projects");
  await expect(page.locator('a[data-workbench-route="overview"]')).toHaveText("Animation");
});

test("project and tool routes default to the dark UI theme", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("xsxbFrameTuner.theme"));
  for (const route of ["/projects", "/tools", "/tools/organizer", "/tools/cutout"]) {
    await page.goto(route);
    await expect(page.locator("body")).toHaveClass(/theme-dark/);
  }
});

test("transform sidebar lets the main animation frame move directly on the canvas", async ({ page }) => {
  await page.goto("/workspace/animation/transform");
  await page.locator("#adjustGroup").check();
  const offsetBefore = Number(await page.locator("#baseX").inputValue());
  const stageBox = await page.locator("#stage").boundingBox();
  const startX = stageBox.x + stageBox.width * 0.5;
  const startY = stageBox.y + stageBox.height * 0.5;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 36, startY + 18, { steps: 4 });
  await page.mouse.up();

  await expect.poll(async () => Number(await page.locator("#baseX").inputValue())).not.toBe(offsetBefore);
});

test("every stage keeps naming the project and animation being worked on", async ({ page }) => {
  const routes = [
    "/workspace/animation/transform",
    "/workspace/animation/boxes",
    "/workspace/animation/trails",
    "/workspace/resources/import",
    "/workspace/resources/cutout",
    "/workspace/resources/scatter",
    "/workspace/delivery/export",
  ];

  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("#workspaceFlowProject"), `${route} should name the project`).toHaveText(
      /E2E Seed Project/,
    );
    await expect(page.locator("#workspaceFlowProject"), `${route} should name the animation`).toHaveText(
      /Idle/,
    );
    await expect(
      page.locator("#workspaceSaveIndicator"),
      `${route} should keep the save indicator`,
    ).toBeVisible();
  }

  // The tool the user is inside is still identified, just demoted out of the title slot.
  await page.goto("/workspace/resources/cutout");
  await expect(page.locator("#workspaceFlowEyebrow")).toContainText("资源处理");
  await expect(page.locator("#workspaceFlowEyebrow")).toContainText("抠图");
});

test("the trails tool keeps attack trail mode reachable under web-mode chrome", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/workspace/animation/trails");
  await page.evaluate(() => {
    document.body.classList.add("browserOnlyMode");
    const banner = document.querySelector("#browserModeBanner");
    if (banner) banner.hidden = false;
  });
  const trailPanel = page.locator("#attackTrailPanel");
  await trailPanel.evaluate((panel) => {
    panel.hidden = false;
    panel.open = true;
  });

  await expect(page.locator("#browserModeBanner")).toBeHidden();
  await expect(page.locator(".sidebar > .brand")).toBeHidden();

  const modeToggle = page.locator("label").filter({ has: page.locator("#attackTrailMode") });
  await expect(modeToggle).toBeVisible();
  await expect
    .poll(
      async () =>
        modeToggle.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const x = bounds.left + bounds.width / 2;
          const y = bounds.top + bounds.height / 2;
          if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
            return "outside the viewport";
          }
          const target = document.elementFromPoint(x, y);
          if (!target) return "covered by nothing";
          if (target === element || element.contains(target) || target.closest("label") === element) {
            return "reachable";
          }
          return `covered by ${target.tagName}${target.id ? `#${target.id}` : ""}`;
        }),
      { message: "attack trail mode should receive clicks without scrolling the sidebar" },
    )
    .toBe("reachable");
});

test("workbench controls expose specific accessible names without nested actions", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByRole("spinbutton", { name: "缩放", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "减少缩放", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "增加缩放", exact: true })).toBeVisible();
  await page.locator('a[data-workbench-route="attachments"]').click();
  await expect(page.getByRole("button", { name: "添加图片", exact: true })).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem("xsxbFrameTuner.language", "en");
    localStorage.setItem("xsxbFrameTuner.languageExplicit", "true");
  });
  await page.goto("/workspace/animation/transform");
  await expect(page.getByRole("spinbutton", { name: "Scale", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Decrease Scale", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Increase Scale", exact: true })).toBeVisible();
  await expect(page.locator("#save")).toHaveCSS("color", "rgb(6, 18, 15)");

  await page.locator('#workspaceFlowHeader .themeButton[data-theme="light"]').click();
  await page.locator('a[data-workbench-route="overview"]').click();
  await expect(page.locator("#projectContext")).toBeHidden();
  await expect(page.locator("#groupSelect")).toBeVisible();

  await page.goto("/tools/organizer");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  const firstFrame = page.locator(".organizerFrame").first();
  await expect(firstFrame.getByRole("button", { name: /Select frame/ })).toBeVisible();
  await expect(firstFrame.getByRole("checkbox", { name: /Include .* in the workset/ })).toBeChecked();
  await expect(firstFrame.locator("button button, button input")).toHaveCount(0);
  await expect(firstFrame.locator("img")).toHaveAttribute("width", "156");
  await expect(firstFrame.locator("img")).toHaveAttribute("height", "156");
  await firstFrame.getByRole("button", { name: /Select frame/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".organizerFrameSelect").nth(1)).toBeFocused();
});

test("tool paths refresh, update titles, and return to the quick tools hub", async ({ page }) => {
  await page.goto("/tools/import");
  await expect(page).toHaveURL(/\/tools\/import/);
  await expect(page).toHaveTitle(/导入与整理/);
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.reload();
  await expect(page.locator("#organizerModal")).toBeVisible();
  await page.locator("#workspaceFlowBack").click();
  await expect(page).toHaveURL(/\/tools$/);
  await expect(page.locator("#homeHub")).toHaveCount(0);
  await expect(page.locator("#quickToolsHub")).toBeVisible();
});

test("tool rail keeps the active animation when opening contextual processing tools", async ({ page }) => {
  await page.goto("/workspace");
  await page.locator("#toolRailTools").hover();
  await expect(page.locator("#toolRailContextMenu")).toBeVisible();
  await expect(page.locator("#toolRailContextTitle")).toContainText("2 帧");

  await page.locator('[data-context-tool="organizer"]').click();
  await expect(page).toHaveURL(/\/workspace\/resources\/import/);
  await expect(page.locator("#organizerModal")).toBeVisible();
  await expect(page.locator(".organizerFrame")).toHaveCount(2);
});

test("same-stage workbench tabs do not ask about unsaved edits", async ({ page }) => {
  await page.goto("/workspace/animation/transform");
  await page.locator('[data-step-target="baseX"][data-step-dir="1"]').click();
  await expect(page.locator("#saveState")).toContainText("未保存");

  await page.locator('a[data-workbench-route="boxes"]').click();
  await expect(page).toHaveURL(/\/workspace\/animation\/boxes/);
  await expect(page.locator("#appConfirmPanel")).toBeHidden();
  await expect(page.locator("#saveState")).toContainText("未保存");
});

test("contextual tools preserve auto-saved tuning when switching", async ({ page }) => {
  await page.goto("/workspace/animation/transform");
  await page.locator('[data-step-target="baseX"][data-step-dir="1"]').click();
  await expect(page.locator("#saveState")).toContainText("未保存改动");

  await page.locator("#toolRailTools").hover();
  await page.locator('[data-context-tool="batch-cutout"]').click();
  await expect(page).toHaveURL(/\/workspace\/resources\/cutout/);
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await expect(page.locator("#appConfirmPanel")).toBeHidden();
});

test("native image import accepts valid files and reports unsupported input", async ({ page }) => {
  await page.goto("/tools/import");
  const imageInput = page.locator("#organizerFileInput");
  await imageInput.setInputFiles({ name: "frame.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
  await expect(page.locator("#organizerStatus")).toContainText("已导入 1 张图片");
  await expect(page.locator(".organizerFrame")).toHaveCount(1);
  await imageInput.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator("#organizerStatus")).toContainText("PNG、JPG 或 WebP");
  await expect(page.locator("#organizerStatusDismiss")).toBeVisible();
  await page.locator("#organizerStatusDismiss").click();
  await expect(page.locator("#organizerStatusDismiss")).toBeHidden();
});

test("loaded organizer keeps tools visible and can restore import settings", async ({ page }) => {
  await page.goto("/tools/import");
  await expect(page.locator(".organizerEditTools")).toBeVisible();
  await expect(page.locator(".organizerToolbarSecondary")).toBeVisible();
  await expect(page.locator("#organizerFindLoop")).toBeVisible();
  await expect(page.locator("#organizerFindLoop")).toBeDisabled();

  await page.locator("#organizerFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });

  await expect(page.locator("#organizerImportSetup")).toBeHidden();
  await expect(page.locator(".organizerToolbarSecondary")).toBeVisible();
  await expect(page.locator("#organizerToggleImportSetup")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#organizerViewEdited")).toBeDisabled();

  await page.locator(".organizerDownstreamMenu").evaluate((element) => {
    element.open = true;
  });
  await page.locator("#organizerReset").click();
  await expect(page.locator("#organizerConfirmPanel")).toBeVisible();
  await page.locator("#organizerConfirmAccept").click();
  await expect(page.locator(".organizerFrame")).toHaveCount(0);
  await expect(page.locator("#organizerImportSetup")).toBeVisible();

  await page.locator("#organizerFileInput").setInputFiles({
    name: "frame-reimported.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.locator(".organizerFrame")).toHaveCount(1);
  await expect(page.locator("#organizerImportSetup")).toBeHidden();
});

test("organizer preview reports the currently playing frame", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator("#organizerPreviewFrame")).toContainText("/ 3 帧");
  await expect(page.locator(".organizerSpeed")).toBeVisible();
  const [previewBox, speedControlBox] = await Promise.all([
    page.locator("#organizerPreview").boundingBox(),
    page.locator(".organizerSpeed").boundingBox(),
  ]);
  expect(previewBox).not.toBeNull();
  expect(speedControlBox).not.toBeNull();
  expect(speedControlBox.y + speedControlBox.height).toBeLessThanOrEqual(previewBox.y);
  const firstLabel = await page.locator("#organizerPreviewFrame").textContent();
  await expect.poll(() => page.locator("#organizerPreviewFrame").textContent()).not.toBe(firstLabel);
});

test("organizer layout stays usable across neighboring desktop breakpoints", async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 720 });
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles(
    Array.from({ length: 53 }, (_, index) => ({
      name: `frame_${String(index + 1).padStart(4, "0")}.png`,
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    })),
  );
  await expect(page.locator(".organizerFrame")).toHaveCount(53);

  const metrics = [];
  for (const viewport of [
    { width: 1120, height: 720 },
    { width: 1120, height: 721 },
    { width: 1121, height: 720 },
    { width: 1121, height: 721 },
  ]) {
    await page.setViewportSize(viewport);
    const current = await page.evaluate(() => {
      const bounds = (selector) => document.querySelector(selector)?.getBoundingClientRect();
      const status = bounds(".organizerStatusRow");
      const preview = bounds("#organizerPreview");
      const speed = bounds(".organizerSpeed");
      const footer = bounds(".organizerFooterActions");
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        footerBottom: footer?.bottom || 0,
        speedBottom: speed?.bottom || 0,
        statusBottom: status?.bottom || 0,
        previewTop: preview?.top || 0,
        previewHeight: preview?.height || 0,
        previewBottom: preview?.bottom || 0,
      };
    });
    metrics.push(current);
    expect(current.scrollWidth).toBeLessThanOrEqual(current.viewportWidth + 1);
    expect(current.previewHeight).toBeGreaterThanOrEqual(150);
    expect(current.footerBottom).toBeLessThanOrEqual(current.speedBottom + 1);
    expect(current.speedBottom).toBeLessThanOrEqual(current.statusBottom + 1);
    expect(current.statusBottom).toBeLessThanOrEqual(current.previewTop + 1);
    expect(current.previewBottom).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.scrollHeight + 1),
    );
  }

  expect(Math.abs(metrics[0].previewHeight - metrics[1].previewHeight)).toBeLessThanOrEqual(4);
  expect(Math.abs(metrics[2].previewHeight - metrics[3].previewHeight)).toBeLessThanOrEqual(16);
});

test("single-image cutout keeps parameters local until apply-all", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await page.locator(".organizerFrameCutout").first().click();
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await expect(page.locator("#cutoutCopyLink")).toHaveCount(0);
  await expect(page.locator(".cutoutHeader #cutoutApplyGroup")).toBeVisible();
  await expect(page.locator(".cutoutHeader #cutoutAddProject")).toBeVisible();
  await expect(page.locator(".cutoutBatchWorkspaceActions #cutoutApplyGroup")).toHaveCount(0);
  await expect(page.locator(".cutoutBatchWorkspaceActions #cutoutAddProject")).toHaveCount(0);
  await expect(page.locator("#cutoutPrevious")).toHaveText("《");
  await expect(page.locator("#cutoutNext")).toHaveText("》");
  const [previousBox, nextBox, canvasBox] = await Promise.all([
    page.locator("#cutoutPrevious").boundingBox(),
    page.locator("#cutoutNext").boundingBox(),
    page.locator("#cutoutResult").boundingBox(),
  ]);
  expect(previousBox.width).toBeGreaterThanOrEqual(72);
  expect(previousBox.height).toBeGreaterThanOrEqual(96);
  expect(previousBox.x + previousBox.width / 2).toBeLessThan(canvasBox.x + 120);
  expect(nextBox.x + nextBox.width / 2).toBeGreaterThan(canvasBox.x + canvasBox.width - 120);
  expect(previousBox.y + previousBox.height / 2).toBeGreaterThan(canvasBox.y);
  expect(previousBox.y + previousBox.height / 2).toBeLessThan(canvasBox.y + canvasBox.height);

  await page.locator("#cutoutColor").evaluate((input) => {
    input.value = "#00ff00";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#cutoutTolerance").evaluate((input) => {
    input.value = "37";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#cutoutRepairBatch")).toBeEnabled();
  await expect(page.locator("#cutoutViewResult")).toHaveClass(/active/);

  await page.locator("#cutoutNext").click();
  await expect(page.locator("#cutoutTolerance")).toHaveValue("1");
  await page.locator("#cutoutPrevious").click();
  await expect(page.locator("#cutoutTolerance")).toHaveValue("37");

  await page.locator("#cutoutRepairBatch").evaluate((button) => {
    window.__cutoutApplyProgress = [];
    new MutationObserver(() => window.__cutoutApplyProgress.push(button.textContent)).observe(button, {
      childList: true,
      subtree: true,
    });
  });
  await page.locator("#cutoutRepairBatch").click();
  await expect(page.locator("#cutoutStatus")).toContainText("当前参数应用到 3 张图片");
  await expect.poll(() => page.evaluate(() => window.__cutoutApplyProgress)).toContain("正在应用 3 / 3…");
  await page.locator("#cutoutNext").click();
  await expect(page.locator("#cutoutTolerance")).toHaveValue("37");
  await page.locator("#cutoutNext").click();
  await expect(page.locator("#cutoutTolerance")).toHaveValue("37");
  await page.locator("#cutoutPrevious").click();
  await page.locator("#cutoutPrevious").click();
  await page.locator("#cutoutRepairUndo").click();
  await page.locator("#cutoutNext").click();
  await expect(page.locator("#cutoutTolerance")).toHaveValue("1");
  await page.locator("#cutoutPrevious").click();
  await page.locator("#cutoutRepairRedo").click();
  await page.locator("#cutoutNext").click();
  await expect(page.locator("#cutoutTolerance")).toHaveValue("37");
  await expect(page.locator("#cutoutViewResult")).toHaveClass(/active/);
});

test("single-image navigation remains clickable while a repair tool is active", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: WIDE_IMAGE_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await page.locator(".organizerFrameCutout").first().click();
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await page.locator("#cutoutRepairBrush").click();
  await expect(page.locator("#cutoutViewResult")).toHaveClass(/active/);
  await expect(page.locator("#cutoutRepairBrush")).toBeEnabled();
  await expect(page.locator("#cutoutNext")).toBeEnabled();

  const nextBox = await page.locator("#cutoutNext").boundingBox();
  const edgePoint = {
    x: nextBox.x + nextBox.width / 2,
    y: nextBox.y + nextBox.height / 2,
  };
  await expect
    .poll(() => page.evaluate((point) => document.elementFromPoint(point.x, point.y)?.id, edgePoint))
    .toBe("cutoutNext");

  await page.mouse.click(edgePoint.x, edgePoint.y);

  await expect(page.locator("#cutoutFrameNumber")).toHaveValue("2");
  await expect(page.locator("#cutoutStatus")).toContainText("图片 2/3");
});

test("single-image clear region applies to every other image", async ({ page }) => {
  await openRepairWorkbench(page);
  await selectRepairTool(page, "#cutoutRepairClear");
  await dragAcrossPreview(page);
  await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正");

  await page.locator("#cutoutRepairBatch").click();

  await expect(page.locator("#cutoutStatus")).toContainText("已按画布位置应用到 2 张图片");
  await expect(page.locator("#cutoutStatus")).toContainText("未能处理 0 张");
});

test("brush-family and region repair tools keep edits after a horizontal release", async ({ page }) => {
  await openRepairWorkbench(page);
  await expect(page.locator("#cutoutBatchTray")).toBeHidden();
  for (const selector of [
    "#cutoutRepairSource",
    "#cutoutRepairEraser",
    "#cutoutRepairClear",
    "#cutoutRepairRestore",
  ]) {
    await selectRepairTool(page, selector);
    if (selector === "#cutoutRepairRestore") {
      await expect(page.locator("#cutoutSelectionHint")).toContainText("所有像素");
    }
    await dragAcrossPreview(page);
    await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正");
    await expect(page.locator("#cutoutRepairUndo")).toBeEnabled();
  }

  await selectProtectionTool(page);
  await dragAcrossPreview(page);
  await expect(page.locator("#cutoutStatus")).toContainText(/已提取|已智能识别保护范围|未提取到保护色/);
  await expect(page.locator("#cutoutProtectionPreview")).toBeVisible();
  await expect(page.locator(".cutoutProtectionPreviewLegend")).toContainText("保护主体");
  await expect(page.locator("#cutoutProtectionPreviewStatus")).toContainText(/保护|识别/);
  await expect(page.locator("#cutoutRepairUndo")).toBeEnabled();

  await selectRepairTool(page, "#cutoutRepairBrush");
  await expect(page.locator("#cutoutProtectionPreview")).toBeHidden();

  await selectProtectionTool(page);
  await expect(page.locator("#cutoutProtectionPreviewStatus")).toContainText(/保护|识别/);
  await page.locator("#cutoutRepairReset").click();
  await expect(page.locator("#cutoutProtectionPreviewStatus")).toContainText("拖动框选保护区域");
});

test("background sampling follows the visible result after a local fill", async ({ page }) => {
  await openRepairWorkbench(page);
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  const canvasBox = await page.locator("#cutoutResult").boundingBox();
  const samplePoint = {
    x: canvasBox.x + canvasBox.width / 2,
    y: canvasBox.y + canvasBox.height / 2,
  };

  await page.locator("#cutoutRepairAutomaticQuick").click();
  await expect(page.locator("#cutoutRepairAutomatic")).toHaveClass(/active/);
  await expect(page.locator("#cutoutBackgroundHint")).toContainText("取样中");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  await page.mouse.click(samplePoint.x, samplePoint.y);
  await expect(page.locator("#cutoutStatus")).toContainText(/已添加背景样本|结果已更新/);
  await expect(page.locator("#cutoutRepairAutomaticQuick")).toHaveClass(/active/);
  await expect(page.locator("#cutoutBackgroundHint")).toContainText("取样中");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });

  await page.locator("#cutoutAreaColor").evaluate((input) => {
    input.value = "#00ff00";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await selectRepairTool(page, "#cutoutRepairRecolor");
  await page.locator("#cutoutAreaScope").selectOption("connected");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  await page.mouse.click(samplePoint.x, samplePoint.y);
  await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正", { timeout: 15000 });

  await page.locator("#cutoutRepairAutomaticQuick").click();
  await expect(page.locator("#cutoutBackgroundHint")).toContainText("取样中");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  await page.mouse.click(samplePoint.x, samplePoint.y);

  await expect(page.locator("#cutoutColor")).toHaveValue("#00ff00");
  await expect(page.locator("#cutoutBackgroundColors button").first()).toHaveAttribute(
    "aria-label",
    /#00ff00/,
  );
});

test("switching from background sampling to a repair tool cancels sampling mode", async ({ page }) => {
  await openRepairWorkbench(page);
  await page.locator("#cutoutRepairAutomaticQuick").click();
  await expect(page.locator("#cutoutRepairAutomaticQuick")).toHaveClass(/active/);
  await selectRepairTool(page, "#cutoutRepairBrush");
  await expect(page.locator("#cutoutRepairAutomaticQuick")).not.toHaveClass(/active/);
  await expect(page.locator("#cutoutBackgroundHint")).toContainText("先点");
});

test("a fast brush stroke keeps its endpoint and commits on release", async ({ page }) => {
  await openRepairWorkbench(page);
  await selectRepairTool(page, "#cutoutRepairBrush");
  const canvasBox = await page.locator("#cutoutResult").boundingBox();
  const y = canvasBox.y + canvasBox.height * 0.5;
  const startX = canvasBox.x + canvasBox.width * 0.2;
  const endX = canvasBox.x + canvasBox.width * 0.8;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 1 });
  await page.mouse.up();

  await expect(page.locator("#cutoutFrameNumber")).toHaveValue("1");
  await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正");
  await expect(page.locator("#cutoutRepairUndo")).toBeEnabled();
});

test("cutout modal supports Ctrl or Cmd Z for the latest local repair", async ({ page }) => {
  await openRepairWorkbench(page);
  await selectRepairTool(page, "#cutoutRepairBrush");
  await dragAcrossPreview(page);
  await expect(page.locator("#cutoutRepairUndo")).toBeEnabled();

  await page.keyboard.press("Control+z");

  await expect(page.locator("#cutoutRepairUndo")).toBeDisabled();
});

test("a cancelled brush pointer commits the collected stroke", async ({ page }) => {
  await openRepairWorkbench(page);
  await selectRepairTool(page, "#cutoutRepairBrush");
  await page.evaluate(() => {
    document.querySelector("#cutoutResult").addEventListener(
      "pointerdown",
      (event) => {
        window.__repairPointerId = event.pointerId;
      },
      { once: true },
    );
  });
  const canvasBox = await page.locator("#cutoutResult").boundingBox();
  const y = canvasBox.y + canvasBox.height * 0.5;
  const startX = canvasBox.x + canvasBox.width * 0.3;
  const endX = canvasBox.x + canvasBox.width * 0.7;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 2 });
  const pointerId = await page.evaluate(() => window.__repairPointerId);
  await page.evaluate(
    ({ pointerId: activePointerId, clientX, clientY }) => {
      document.querySelector("#cutoutResult").dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          pointerId: activePointerId,
          pointerType: "mouse",
          isPrimary: true,
          clientX,
          clientY,
        }),
      );
    },
    { pointerId, clientX: endX, clientY: y },
  );

  await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正");
  await expect(page.locator("#cutoutRepairUndo")).toBeEnabled();
});

test("organizer confirms before discarding an imported workset", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });

  await page.locator("#workspaceFlowBack").click();
  await expect(page.locator("#organizerConfirmPanel")).toBeVisible();
  await expect(page.locator("#organizerConfirmTitle")).toHaveText("尚未加入项目");
  await expect(page.locator(".organizerConfirmCard")).toHaveAttribute("data-tone", "danger");
  await expect(page.locator("#organizerConfirmCancel")).toBeFocused();
  await page.locator("#organizerConfirmPanel").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#organizerModal")).toBeVisible();
  await expect(page).toHaveURL(/\/tools\/import/);
  await expect(page.locator("#workspaceFlowBack")).toBeFocused();

  await page.locator("#workspaceFlowBack").click();
  await page.locator("#organizerConfirmAccept").click();
  await expect(page.locator("#organizerModal")).toBeHidden();
  await expect(page).toHaveURL(/\/tools$/);
});

test("imported organizer checks agree with 选中 count and 删除选中", async ({ page }) => {
  await page.goto("/tools/organizer");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);

  await expect(page.locator(".organizerFrame")).toHaveCount(2);
  await expect(page.locator(".organizerFrameInclude input:checked")).toHaveCount(2);
  await expect(page.locator("#organizerCount")).toContainText("2 / 2");
  await expect(page.locator("#organizerSelection")).toContainText(/选中 [1-9]/);
  await expect(page.locator("#organizerSelection")).not.toContainText("选中 0");
  await expect(page.locator("#organizerDeleteSelected")).toBeEnabled();
});

test("inverting the organizer workset flips include checks without touching the other pair", async ({
  page,
}) => {
  await page.goto("/tools/organizer");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0004.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator(".organizerFrame")).toHaveCount(4);
  await page.locator(".organizerFrameInclude input").nth(1).click();
  await page.locator(".organizerFrameInclude input").nth(3).click();
  await expect(page.locator(".organizerFrameInclude input").nth(0)).toBeChecked();
  await expect(page.locator(".organizerFrameInclude input").nth(1)).not.toBeChecked();
  await expect(page.locator(".organizerFrameInclude input").nth(2)).toBeChecked();
  await expect(page.locator(".organizerFrameInclude input").nth(3)).not.toBeChecked();
  await expect(page.locator("#organizerCount")).toContainText("2 / 4");

  await page.locator("#organizerInvert").click();

  await expect(page.locator(".organizerFrameInclude input").nth(0)).not.toBeChecked();
  await expect(page.locator(".organizerFrameInclude input").nth(1)).toBeChecked();
  await expect(page.locator(".organizerFrameInclude input").nth(2)).not.toBeChecked();
  await expect(page.locator(".organizerFrameInclude input").nth(3)).toBeChecked();
  await expect(page.locator("#organizerCount")).toContainText("2 / 4");
  await expect(page.locator(".organizerFrame").nth(0)).toHaveClass(/excluded/);
  await expect(page.locator(".organizerFrame").nth(1)).toHaveClass(/included/);
  await expect(page.locator(".organizerFrame").nth(2)).toHaveClass(/excluded/);
  await expect(page.locator(".organizerFrame").nth(3)).toHaveClass(/included/);
});

test("compact organizer keeps undo clear of preview controls", async ({ page }) => {
  await page.setViewportSize({ width: 1114, height: 674 });
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await page.locator(".organizerFrameSelect").nth(1).click();
  await page.locator("#organizerDeleteSelected").click();
  await expect(page.locator("#organizerUndoDelete")).toBeVisible();

  const [speedBounds, undoBounds, previewBounds, frameLabelBounds] = await Promise.all([
    page.locator(".organizerSpeed").boundingBox(),
    page.locator("#organizerUndoDelete").boundingBox(),
    page.locator("#organizerPreview").boundingBox(),
    page.locator("#organizerPreviewFrame").boundingBox(),
  ]);
  expect(speedBounds).not.toBeNull();
  expect(undoBounds).not.toBeNull();
  expect(previewBounds).not.toBeNull();
  expect(frameLabelBounds).not.toBeNull();
  expect(undoBounds.y + undoBounds.height).toBeLessThanOrEqual(previewBounds.y);
  expect(speedBounds.y + speedBounds.height).toBeLessThanOrEqual(undoBounds.y);
  expect(frameLabelBounds.y + frameLabelBounds.height).toBeLessThanOrEqual(
    previewBounds.y + previewBounds.height,
  );

  await expect(page.locator(".organizerDownstreamMenu > summary")).toBeInViewport();
  await page.locator(".organizerDownstreamMenu").evaluate((element) => {
    element.open = true;
  });
  await expectDownstreamActionsHittable(page);

  await page.locator("#organizerUndoDelete").click();
  await expect(page.locator(".organizerFrame")).toHaveCount(3);
});

test("200% organizer keeps footer actions reachable after scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 450 });
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);

  await page.locator(".organizerDownstreamMenu").evaluate((element) => {
    element.open = true;
  });
  await expectDownstreamActionsHittable(page, { scroll: true });

  await page.locator("#organizerViewOriginal").click();
  await expect(page.locator("#organizerViewOriginal")).toHaveClass(/active/);
  await expect(page.locator("#organizerViewEdited")).toBeDisabled();
  await page.locator(".organizerDownstreamMenu").evaluate((element) => {
    element.open = false;
  });
  await page.locator("#organizerFlip").click();
  await expect(page.locator("#organizerViewEdited")).toBeEnabled();
  await page.locator("#organizerViewEdited").click();
  await expect(page.locator("#organizerViewEdited")).toHaveClass(/active/);
});

test("cutout reports mixed-file skips and confirms destructive clearing", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles([
    { name: "frame.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") },
  ]);

  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);
  await expect(page.locator("#cutoutStatus")).toContainText("跳过 1");
  await expect(page.locator("#cutoutBatchTray")).toBeHidden();
  await expect(page.locator("#cutoutSidebarBatchTab")).toHaveAttribute("aria-selected", "false");
  await expandStableBatchTray(page);

  await page.locator("#cutoutClear").click();
  await expect(page.locator("#cutoutConfirmTitle")).toHaveText("清空当前批次？");
  await expect(page.locator(".cutoutConfirmCard")).toHaveAttribute("data-tone", "danger");
  await expect(page.locator("#cutoutConfirmCancel")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);
  await expect(page.locator("#cutoutClear")).toBeFocused();

  await page.locator("#cutoutDeleteSelected").click();
  await expect(page.locator("#cutoutConfirmTitle")).toHaveText("删除选中的图片？");
  await page.locator("#cutoutConfirmCancel").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);
  await expect(page.locator("#cutoutDeleteSelected")).toBeFocused();
  await page.locator("#cutoutDeleteSelected").click();
  await page.locator("#cutoutConfirmApply").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(0);

  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await page.locator("#cutoutClear").click();
  await page.locator("#cutoutConfirmApply").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(0);
});

test("cutout restores a batch after leaving its URL and starts a new batch explicitly", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);

  await page.locator("#workspaceFlowBack").click();
  await expect(page.locator("#cutoutModal")).toBeHidden();
  await expect(page).toHaveURL(/\/tools$/);
  await page.getByRole("link", { name: /批量抠图/ }).click();
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await expect(page.locator("#cutoutStatus")).toHaveText("已恢复上次批次：1 张图片");
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);

  await page.locator("#cutoutNewBatch").click();
  await expect(page.locator("#cutoutConfirmTitle")).toHaveText("新建批次？");
  await page.locator("#cutoutConfirmCancel").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);

  await page.locator("#cutoutNewBatch").click();
  await page.locator("#cutoutConfirmApply").click();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(0);
  await expect(page.locator("#cutoutStatus")).toHaveText("等待图片");
  await expect(page.locator("#cutoutNewBatch")).toBeDisabled();
});

test("cutout warns before refresh discards a local batch", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);

  const dialogPromise = page.waitForEvent("dialog");
  const reloadPromise = page.reload();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
  await reloadPromise;
  await expect(page).toHaveURL(/\/tools\/cutout/);
  await expect(page.locator("#cutoutModal")).toBeVisible();
});

test("@cross-browser protected runtime stays local and resolves its Worker", async ({ page }) => {
  const processingRequests = [];
  let captureProcessingTraffic = false;
  page.on("request", (request) => {
    if (!captureProcessingTraffic) return;
    processingRequests.push({
      method: request.method(),
      pathname: new URL(request.url()).pathname,
      postData: request.postData(),
    });
  });
  await page.goto("/tools/cutout");
  await page.waitForLoadState("networkidle");
  captureProcessingTraffic = true;
  const resultBytes = await page.evaluate(async () => {
    const adapter = window.ProtectedAlgorithmRuntime.createProductionWorkerAdapter({
      WorkerConstructor: window.Worker,
      cutoutClient: window.BatchCutoutWorkerClient,
      frameClient: window.FrameOrganizerWorkerClient,
    });
    const runtime = window.ProtectedAlgorithmRuntime.createRuntime({ adapter });
    try {
      const result = await runtime.applyProductCutout(
        { data: new Uint8ClampedArray([20, 40, 60, 255]), width: 1, height: 1 },
        {
          processingOptions: {
            backgroundColor: { r: 255, g: 255, b: 255 },
            tolerance: 0,
          },
          repairs: [],
        },
        "cross-browser-local-processing",
      );
      return Array.from(result.data);
    } finally {
      runtime.dispose();
    }
  });
  expect(resultBytes).toEqual([20, 40, 60, 255]);
  expect(processingRequests.length).toBeGreaterThan(0);
  const workerResourcePaths = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => new URL(entry.name).pathname),
  );
  expect(
    processingRequests.some(({ pathname }) => pathname === "/batch_cutout_worker.js") ||
      workerResourcePaths.includes("/batch_cutout_worker.js"),
  ).toBe(true);
  expect(processingRequests.every(({ method, postData }) => method === "GET" && postData === null)).toBe(
    true,
  );
  expect(processingRequests.some(({ pathname }) => pathname.startsWith("/api/"))).toBe(false);
});

test("area tools expose and synchronize the transparent color shortcut", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", {
    timeout: 20000,
  });
  const quickTransparent = page.locator("#cutoutAreaTransparentQuick");
  const detailedTransparent = page.locator("#cutoutAreaTransparent");
  await expect(quickTransparent).toBeVisible();
  await quickTransparent.click();
  await expect(quickTransparent).toHaveAttribute("aria-pressed", "true");
  await expect(detailedTransparent).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#cutoutActiveToolTitle")).toHaveText("补色 / 替换");
  await detailedTransparent.click();
  await expect(quickTransparent).toHaveAttribute("aria-pressed", "false");
  await expect(detailedTransparent).toHaveAttribute("aria-pressed", "false");
});

test("cutout parameters follow the regular post-processing advanced layout", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", {
    timeout: 20000,
  });
  const processingDefaults = await page
    .locator(
      [
        "#cutoutTolerance",
        "#cutoutEdgeBoost",
        "#cutoutBlendStrength",
        "#cutoutDespillStrength",
        "#cutoutEdgeDespillRadius",
        "#cutoutEdgeRecoveryStrength",
        "#cutoutBackgroundRadius",
        "#cutoutBlurRadius",
        "#cutoutFeather",
        "#cutoutChromaFeather",
        "#cutoutAlphaLow",
        "#cutoutAlphaHigh",
        "#cutoutAlphaThreshold",
        "#cutoutProtectionTolerance",
      ].join(","),
    )
    .evaluateAll((inputs) => Object.fromEntries(inputs.map((input) => [input.id, input.value])));
  expect(processingDefaults).toEqual({
    cutoutTolerance: "1",
    cutoutEdgeBoost: "10",
    cutoutBlendStrength: "0",
    cutoutDespillStrength: "0",
    cutoutEdgeDespillRadius: "0",
    cutoutEdgeRecoveryStrength: "0",
    cutoutBackgroundRadius: "0",
    cutoutBlurRadius: "0",
    cutoutFeather: "0",
    cutoutChromaFeather: "0",
    cutoutAlphaLow: "0",
    cutoutAlphaHigh: "0",
    cutoutAlphaThreshold: "0",
    cutoutProtectionTolerance: "0",
  });
  await expect(page.locator("#cutoutConnected")).not.toBeChecked();
  await expect(page.locator("#cutoutPerceptual")).not.toBeChecked();
  await expect(page.locator("#cutoutBlendMode")).toHaveValue("blend");
  await expect(page.locator("#cutoutDespillMode")).toHaveValue("general");
  await expect(page.locator("[data-cutout-preset].active")).toHaveCount(0);
  await expect(page.locator("#cutoutTabRegular")).toHaveText("常规");
  await expect(page.locator("#cutoutEdgeBoost")).toBeVisible();
  await expect(page.locator("#cutoutBlendStrength")).toBeVisible();
  await expect(page.locator("#cutoutBlendMode")).toBeVisible();
  await expect(page.locator("#cutoutFeather")).toBeHidden();

  await page.locator("#cutoutTabPost").click();
  await expect(page.locator("#cutoutDespillStrength")).toBeVisible();
  await page.locator("#cutoutTabAdvanced").click();
  await expect(page.locator("#cutoutFeather")).toBeHidden();
  await expect(page.locator("#cutoutAlphaLow")).toBeHidden();
  await expect(page.locator("#cutoutProtectSample")).toBeHidden();
  await expect(page.locator("#cutoutAdvancedSummary")).toHaveText("未设置");
  await expect(page.locator("#cutoutAdvancedSummary")).not.toHaveText(/0 — 0 \/ T 0/);
  const firstDisclosure = page.locator(".cutoutAdvancedDisclosure").first().locator("summary");
  await revealInCutoutParams(firstDisclosure);
  await firstDisclosure.click();
  await expect(page.locator("#cutoutFeather")).toBeVisible();
  await expect(page.locator("#cutoutAlphaLow")).toBeVisible();
  const protectionDisclosure = page.locator(".cutoutProtectionDisclosure summary");
  await revealInCutoutParams(protectionDisclosure);
  await protectionDisclosure.click();
  await expect(page.locator("#cutoutProtectSample")).toBeVisible();
});

test("mobile cutout keeps preview first and supports keyboard repair", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "mobile-frame.png",
    mimeType: "image/png",
    buffer: WIDE_IMAGE_PNG,
  });
  const sourceRestore = page.getByRole("button", { name: "原图恢复笔" });
  await expect(sourceRestore).toBeVisible();
  await sourceRestore.click();
  await expect(page.locator("#cutoutActiveToolTitle")).toHaveText("原图恢复笔");
  await page.getByRole("button", { name: "背景清除" }).click();
  await expect(page.locator("#cutoutStatus")).toContainText("请在画布上点击");
  await sourceRestore.click();
  await expect(page.locator("#cutoutActiveToolTitle")).toHaveText("原图恢复笔");
  const preview = page.locator(".cutoutPreview");
  const controls = page.locator(".cutoutControls");
  await expect(preview).toBeVisible();
  const [previewBox, controlsBox] = await Promise.all([preview.boundingBox(), controls.boundingBox()]);
  expect(previewBox.y).toBeLessThan(controlsBox.y);
  expect(previewBox.y).toBeLessThan(844);

  await page.locator("#cutoutResult").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.locator("#cutoutStatus")).toContainText("已添加局部修正");

  await expandStableBatchTray(page);
  const [compareBox, batchTrayBox, batchTrayMetrics] = await Promise.all([
    page.locator(".cutoutCompare").boundingBox(),
    page.locator(".cutoutBatchTray").boundingBox(),
    page.locator(".cutoutBatchTray").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    })),
  ]);
  expect(compareBox).not.toBeNull();
  expect(batchTrayBox).not.toBeNull();
  expect(compareBox.y + compareBox.height).toBeLessThanOrEqual(batchTrayBox.y);
  expect(batchTrayMetrics.scrollHeight).toBeLessThanOrEqual(batchTrayMetrics.clientHeight + 1);
  await page.locator("#cutoutClear").click();
  const confirmationMetrics = await page.locator(".cutoutConfirmCard").evaluate((card) => {
    const bounds = card.getBoundingClientRect();
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      viewportHeight: window.innerHeight,
      buttonHeights: Array.from(
        card.querySelectorAll("button"),
        (button) => button.getBoundingClientRect().height,
      ),
    };
  });
  expect(confirmationMetrics.top).toBeGreaterThanOrEqual(0);
  expect(confirmationMetrics.bottom).toBeLessThanOrEqual(confirmationMetrics.viewportHeight);
  expect(confirmationMetrics.buttonHeights.every((height) => height >= 48)).toBe(true);
  await expect(page.locator("#cutoutConfirmCancel")).toBeFocused();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("mobile editor presents the operation workspace before the parameter sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace");

  const [stageBox, workspaceBox, sidebarBox] = await Promise.all([
    page.locator("#stage").boundingBox(),
    page.locator(".workspace").boundingBox(),
    page.locator(".sidebar").boundingBox(),
  ]);
  expect(stageBox).not.toBeNull();
  expect(workspaceBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(stageBox.y).toBeLessThan(844);
  expect(workspaceBox.y).toBeLessThan(sidebarBox.y);
});

test("desktop cutout keeps batch images in the collapsible sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: WIDE_IMAGE_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  const parameterCompareBox = await page.locator(".cutoutCompare").boundingBox();
  await expandStableBatchTray(page);

  const preview = page.locator(".cutoutPreview");
  const [compareBox, zoomBox, batchTrayBox, sidebarBox, scrollMetrics, batchTrayMetrics] = await Promise.all([
    page.locator(".cutoutCompare").boundingBox(),
    page.locator(".cutoutZoomControls").boundingBox(),
    page.locator(".cutoutBatchTray").boundingBox(),
    page.locator("#cutoutSidebar").boundingBox(),
    preview.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    })),
    page.locator(".cutoutBatchTray").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    })),
  ]);
  expect(compareBox).not.toBeNull();
  expect(zoomBox).not.toBeNull();
  expect(batchTrayBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(parameterCompareBox).not.toBeNull();
  expect(Math.abs(compareBox.width - parameterCompareBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(compareBox.height - parameterCompareBox.height)).toBeLessThanOrEqual(1);
  expect(batchTrayBox.x + batchTrayBox.width).toBeLessThanOrEqual(compareBox.x);
  expect(batchTrayBox.x).toBeGreaterThanOrEqual(sidebarBox.x);
  expect(batchTrayBox.x + batchTrayBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
  expect(zoomBox.x + zoomBox.width).toBeLessThanOrEqual(compareBox.x + compareBox.width);
  expect(zoomBox.y + zoomBox.height).toBeLessThanOrEqual(compareBox.y + compareBox.height);
  expect(zoomBox.y).toBeLessThan(compareBox.y + compareBox.height / 2);
  expect(batchTrayMetrics.scrollHeight).toBeLessThanOrEqual(batchTrayMetrics.clientHeight);
  expect(scrollMetrics.scrollHeight).toBeLessThanOrEqual(scrollMetrics.clientHeight + 1);
  expect(scrollMetrics.overflowY).toBe("hidden");

  await page.locator("#cutoutSidebarCollapse").click();
  await expect(page.locator("#cutoutSidebarCollapse")).toHaveAttribute("aria-expanded", "false");
  const expandedCompareBox = await page.locator(".cutoutCompare").boundingBox();
  expect(expandedCompareBox.width).toBeGreaterThan(compareBox.width + 200);

  await page.locator("#cutoutResult").hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBe(0);
});

test("desktop cutout removes smart comparison and keeps every parameter scrollable", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 656 });
  await page.addInitScript(() => {
    localStorage.setItem("xsxbFrameTuner.language", "en");
    localStorage.setItem("xsxbFrameTuner.languageExplicit", "true");
  });
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: WIDE_IMAGE_PNG,
  });
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", {
    timeout: 20000,
  });

  await expect(page.locator("#cutoutCandidatePanel")).toHaveCount(0);
  const [panelBox, settingsBox] = await Promise.all([
    page.locator("#cutoutSidebarParametersPanel").boundingBox(),
    page.locator("#cutoutSettings").boundingBox(),
  ]);
  expect(panelBox).not.toBeNull();
  expect(settingsBox).not.toBeNull();
  expect(settingsBox.y).toBeGreaterThanOrEqual(panelBox.y);

  const automaticSettings = page.locator("#cutoutAutomaticSettings");
  await expect(automaticSettings).toBeVisible();
  await page.locator("#cutoutTabAdvanced").click();
  const firstDisclosure = page.locator(".cutoutAdvancedDisclosure").first().locator("summary");
  await revealInCutoutParams(firstDisclosure);
  await firstDisclosure.click();
  const protectionDisclosure = page.locator(".cutoutProtectionDisclosure summary");
  await revealInCutoutParams(protectionDisclosure);
  await protectionDisclosure.click();

  const pane = page.locator("#cutoutSidebarParametersPanel");
  const paneMetrics = await pane.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(paneMetrics.scrollHeight, "advanced params must overflow the left pane").toBeGreaterThan(
    paneMetrics.clientHeight,
  );
  expect(["auto", "scroll"]).toContain(paneMetrics.overflowY);

  const windowBefore = await page.evaluate(() => window.scrollY);
  const paneBefore = await pane.evaluate((element) => element.scrollTop);
  const paneBox = await pane.boundingBox();
  expect(paneBox).not.toBeNull();
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + Math.min(80, paneBox.height / 4));
  await page.mouse.wheel(0, 480);
  await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(paneBefore);
  expect(await page.evaluate(() => window.scrollY)).toBe(windowBefore);

  for (const tabSelector of ["#cutoutTabRegular", "#cutoutTabPost", "#cutoutTabAdvanced"]) {
    await page.locator(tabSelector).click();
    const horizontalOverflow = await page.locator("#cutoutSettings").evaluate((settings) => {
      const settingsBounds = settings.getBoundingClientRect();
      const selectors = [
        "input",
        "select",
        "button",
        ".cutoutRange",
        ".cutoutSelectField",
        ".cutoutPanelHint",
        ".cutoutParameterCard > header",
      ].join(",");
      return [...settings.querySelectorAll(selectors)]
        .filter((element) => {
          const style = getComputedStyle(element);
          return !element.hidden && style.display !== "none" && style.visibility !== "hidden";
        })
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            id: element.id || element.className || element.tagName,
            height: bounds.height,
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
          };
        })
        .filter(({ height, width }) => height > 0 && width > 0)
        .filter(({ left, right }) => left < settingsBounds.left - 1 || right > settingsBounds.right + 1);
    });
    expect(horizontalOverflow, `${tabSelector} contains horizontally clipped controls`).toEqual([]);
  }
});

test("organizer migrates unconfirmed legacy English state back to Chinese", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("xsxbFrameTuner.language", "en");
    localStorage.removeItem("xsxbFrameTuner.languageExplicit");
  });
  await page.goto("/tools/organizer");
  await expect(page.locator("#workspaceFlowEyebrow")).toContainText("导入与处理动画");
});

test("compact desktop cutout keeps batch actions and readable previews in the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1299, height: 802 });
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: WIDE_IMAGE_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(3);
  await expandStableBatchTray(page);

  const sidebarPanel = page.locator("#cutoutSidebar");
  const batchActions = page.locator(".cutoutBatchWorkspaceActions");
  const utilityActions = batchActions.locator(":scope > div");
  const previewCards = page.locator(".cutoutQueueItem");
  const [panelBox, batchActionsBox, downloadBox, actionLayout, buttonMetrics, previewMetrics] =
    await Promise.all([
      sidebarPanel.boundingBox(),
      batchActions.boundingBox(),
      page.locator("#cutoutDownload").boundingBox(),
      utilityActions.evaluate((element) => ({
        display: getComputedStyle(element).display,
        columns: getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
      })),
      batchActions.locator("button:visible").evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return { height: box.height, left: box.left, right: box.right, width: box.width };
        }),
      ),
      previewCards.evaluateAll((cards) =>
        cards.map((card) => {
          const box = card.getBoundingClientRect();
          const imageBox = card.querySelector("img").getBoundingClientRect();
          return {
            cardHeight: box.height,
            imageHeight: imageBox.height,
            imageWidth: imageBox.width,
          };
        }),
      ),
    ]);

  expect(panelBox).not.toBeNull();
  expect(batchActionsBox).not.toBeNull();
  expect(downloadBox).not.toBeNull();
  expect(actionLayout).toEqual({ display: "grid", columns: 2 });
  expect(batchActionsBox.x).toBeGreaterThanOrEqual(panelBox.x);
  expect(batchActionsBox.x + batchActionsBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
  expect(downloadBox.x).toBeCloseTo(batchActionsBox.x, 1);
  expect(downloadBox.x + downloadBox.width).toBeCloseTo(batchActionsBox.x + batchActionsBox.width, 1);
  expect(buttonMetrics.length).toBeGreaterThanOrEqual(3);
  for (const button of buttonMetrics) {
    expect(button.width).toBeGreaterThanOrEqual(80);
    expect(button.height).toBeGreaterThanOrEqual(34);
    expect(button.left).toBeGreaterThanOrEqual(batchActionsBox.x);
    expect(button.right).toBeLessThanOrEqual(batchActionsBox.x + batchActionsBox.width + 1);
  }
  expect(previewMetrics).toHaveLength(3);
  for (const preview of previewMetrics) {
    expect(preview.cardHeight).toBeGreaterThanOrEqual(160);
    expect(preview.imageHeight).toBeGreaterThanOrEqual(110);
    expect(preview.imageWidth).toBeGreaterThan(preview.imageHeight * 1.8);
  }
});

test("loop finder cancel closes the dialog", async ({ page }) => {
  await page.goto("/tools/import");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0003.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0004.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator("#organizerFindLoop")).toBeEnabled();
  await page.locator("#organizerFindLoop").click();
  await expect(page.locator("#organizerLoopPanel")).toBeVisible();
  await page.locator("#organizerLoopCancel").click();
  await expect(page.locator("#organizerLoopPanel")).toBeHidden();
});

test("New Project asks for a name and stays on the hub when cancelled", async ({ page }) => {
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goto("/projects");
  await page.locator("#projectHubNew").click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("the trails page shows the attack trail panel instead of attached assets", async ({ page }) => {
  await page.goto("/workspace/animation/trails");
  await expect(page.locator("body")).toHaveAttribute("data-workspace-tool", "trails");
  await expect(page.locator("#attackTrailPanel")).toBeVisible();
  await expect(page.locator('[data-panel="attachment-assets"]')).toBeHidden();
});

/**
 * Reads the share of mostly-opaque pixels on the cutout result canvas.
 * @param {import("@playwright/test").Page} page Browser page.
 * @returns {Promise<number>} Opaque pixel ratio.
 */
function cutoutOpaqueShare(page) {
  return page.locator("#cutoutResult").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let opaque = 0;
    for (let offset = 3; offset < data.length; offset += 4) if (data[offset] > 128) opaque += 1;
    return opaque / (data.length / 4);
  });
}

test("switching to Post-processing keeps the cutout subject", async ({ page }) => {
  const frame = subjectOnBackgroundPng(32, 0, [255, 255, 255]);
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "subject.png",
    mimeType: "image/png",
    buffer: frame,
  });
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  const before = await cutoutOpaqueShare(page);
  expect(before).toBeGreaterThan(0.02);
  await page.locator("#cutoutTabPost").click();
  await expect(page.locator("#cutoutDespillStrength")).toBeVisible();
  const afterPost = await cutoutOpaqueShare(page);
  expect(afterPost).toBeGreaterThan(before * 0.8);
  await page.locator("#cutoutTabRegular").click();
  const afterRegular = await cutoutOpaqueShare(page);
  expect(afterRegular).toBeGreaterThan(before * 0.8);
});

test("Escape on standalone cutout keeps the batch on the page", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/tools\/cutout/);
  await expect(page.locator("#cutoutModal")).toBeVisible();
  await expect(page.locator(".cutoutQueueItem")).toHaveCount(1);
});

test("picking #000000 raises the idle black-plate tolerance", async ({ page }) => {
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: subjectOnBackgroundPng(32, 0, [0, 0, 0]),
  });
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });
  await page.locator("#cutoutColor").fill("#000000");
  await expect(page.locator("#cutoutTolerance")).toHaveValue("12");
});

test("scatter detection modes expose their own parameters", async ({ page }) => {
  await page.goto("/tools/scatter-slice");
  await expect(page.locator("#scatterMode")).toBeVisible();
  await page.locator("#scatterMode").selectOption("alpha");
  await expect(page.locator("#scatterAlphaHint")).toBeVisible();
  await expect(page.locator("#scatterThreshold")).toBeHidden();
  await page.locator("#scatterMode").selectOption("colorkey");
  await expect(page.locator("#scatterThreshold")).toBeVisible();
  await expect(page.locator("#scatterAlphaHint")).toBeHidden();
});

test("English workbench copy drops the leftover Chinese resource labels", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-factory-language="en"]').click();
  await page.goto("/tools/organizer");
  await expect(page.locator("#organizerModal")).toBeVisible();
  await expect(page.locator(".organizerDownstreamMenu summary")).toHaveText("More Tools");
  await expect(page.locator("#workspaceSaveIndicator")).toHaveText("Saved");
  await expect(page.locator("#organizerFileInput")).toHaveAttribute("aria-label", "Import images");
  await expect(page.locator("#organizerVideoInput")).toHaveAttribute("aria-label", "Import video");
  await expect(page.locator("#organizerReduceStep")).toHaveAttribute("aria-label", "Frame skip interval");
  await expect(page.locator("#organizerBatchCutoutScope")).toHaveText(/Applies to the workset/);
  await page.goto("/workspace/resources/scatter");
  await expect(page.locator("#scatterResultsTitle")).toHaveText("Animation groups and slices");
});

test("narrow English chrome keeps scatter and cutout tab labels readable", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-factory-language="en"]').click();
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/workspace/resources/scatter");
  const scatterTab = page.locator(".workspaceSecondaryTabs a[data-workbench-route='scatter']");
  await expect(scatterTab).toBeVisible();
  const scatterMetrics = await scatterTab.evaluate((element) => {
    const chrome = document.querySelector(".workspaceFlowChrome");
    return {
      text: element.textContent.trim(),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      right: element.getBoundingClientRect().right,
      chromeLeft: chrome.getBoundingClientRect().left,
    };
  });
  expect(scatterMetrics.text).toMatch(/Scatter/i);
  expect(scatterMetrics.scrollWidth).toBeLessThanOrEqual(scatterMetrics.clientWidth + 1);
  expect(scatterMetrics.right).toBeLessThanOrEqual(scatterMetrics.chromeLeft + 1);

  await page.goto("/tools/cutout");
  await page.setViewportSize({ width: 900, height: 800 });
  const tabMetrics = await page.locator(".cutoutSettingTabs button").evaluateAll((buttons) =>
    buttons.map((button) => ({
      text: button.textContent.replace(/\s+/g, " ").trim(),
      scrollWidth: button.scrollWidth,
      clientWidth: button.clientWidth,
    })),
  );
  expect(tabMetrics.some((tab) => /Post/i.test(tab.text))).toBe(true);
  for (const tab of tabMetrics) {
    expect(tab.scrollWidth, tab.text).toBeLessThanOrEqual(tab.clientWidth + 1);
  }
});
