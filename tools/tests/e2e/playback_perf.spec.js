"use strict";

const { expect, test } = require("./fixtures");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);
const PNG_DATA_URL = `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`;

/**
 * Imports an isolated animation through the real server API.
 * @param {import("@playwright/test").APIRequestContext} request Playwright request context.
 * @param {number} frameCount Number of animation frames.
 * @returns {Promise<void>}
 */
async function importPlaybackProject(request, frameCount) {
  const response = await request.post("/api/import-animation", {
    data: {
      projectLabel: "E2E playback-perf",
      profileLabel: "Hero",
      animationName: "animation-playback-perf",
      fps: 24,
      items: Array.from({ length: frameCount }, (_, index) => ({
        name: `frame_${String(index + 1).padStart(4, "0")}.png`,
        data: PNG_DATA_URL,
      })),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

test("playback does not rebuild the filmstrip or ghost-draw every frame", async ({ page, request }) => {
  const frameCount = 8;
  await importPlaybackProject(request, frameCount);
  await page.goto("/workspace/animation/transform");
  await expect(page.locator("#filmstrip .thumb[data-frame-index]")).toHaveCount(frameCount);
  await expect(page.locator("#ghostToggle")).toHaveClass(/active/);
  await expect(page.locator("#playPause")).toBeEnabled();

  await page.evaluate(() => {
    window.__filmstripChildMutations = 0;
    window.__stageDrawImages = 0;
    window.__playheadMoves = 0;
    const filmstrip = document.querySelector("#filmstrip");
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList" && (record.addedNodes.length || record.removedNodes.length)) {
          window.__filmstripChildMutations += 1;
        }
      }
    }).observe(filmstrip, { childList: true });
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function countedStageDrawImage(...args) {
      if (this.canvas?.id === "stage") window.__stageDrawImages += 1;
      return drawImage.apply(this, args);
    };
    let lastPlayhead = document.querySelector("#filmstrip .thumb.playhead, #filmstrip .thumb.primary")
      ?.dataset?.frameIndex;
    new MutationObserver(() => {
      const next = document.querySelector("#filmstrip .thumb.playhead")?.dataset?.frameIndex;
      if (next != null && next !== lastPlayhead) {
        lastPlayhead = next;
        window.__playheadMoves += 1;
      }
    }).observe(filmstrip, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });

  await page.locator("#playPause").click();
  await expect(page.locator("#playPause")).toHaveText("暂停");
  await page.evaluate(() => {
    window.__filmstripChildMutations = 0;
    window.__stageDrawImages = 0;
    window.__playheadMoves = 0;
  });
  await expect
    .poll(async () => page.evaluate(() => window.__playheadMoves), { timeout: 8000 })
    .toBeGreaterThanOrEqual(frameCount);

  const [mutations, drawImages, playheadMoves] = await page.evaluate(() => [
    window.__filmstripChildMutations,
    window.__stageDrawImages,
    window.__playheadMoves,
  ]);
  expect(playheadMoves, "playback must actually advance the playhead").toBeGreaterThanOrEqual(frameCount);
  expect(mutations, "playback must not destroy and rebuild filmstrip thumbs").toBe(0);
  expect(drawImages, "ghost copies must not make sprite draws grow with frameCount²").toBeLessThan(
    playheadMoves * 3,
  );
});
