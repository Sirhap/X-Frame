"use strict";

const { expect, test } = require("./fixtures");
const { encodePngRgba } = require("../../xsxb_mcp_cutout");

const SIZE = 32;
const BACKGROUND = [255, 255, 255];
const SUBJECT = [210, 36, 42];

/**
 * Builds a white plate with a centered red subject. A solid or 1×1 image cannot
 * tell "matching is off" from "the processor returned the source unchanged".
 * @returns {Buffer} PNG bytes.
 */
function subjectOnWhitePlate() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const inside = x >= SIZE / 4 && x < (SIZE * 3) / 4 && y >= SIZE / 4 && y < (SIZE * 3) / 4;
      const color = inside ? SUBJECT : BACKGROUND;
      rgba.set([color[0], color[1], color[2], 255], (y * SIZE + x) * 4);
    }
  }
  return encodePngRgba(rgba, SIZE, SIZE);
}

test("CUT-035 tolerance -1 shows closed matching copy and leaves pixels unmoved", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/tools/cutout");
  await page.locator("#cutoutFileInput").setInputFiles({
    name: "cut-035-plate.png",
    mimeType: "image/png",
    buffer: subjectOnWhitePlate(),
  });
  await expect(page.locator("#cutoutStatus")).toContainText("已载入 1 张图片");

  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });

  await page.locator("#cutoutTolerance").evaluate((input) => {
    input.value = "-1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#cutoutTolerance")).toHaveValue("-1");
  await expect(page.locator("#cutoutToleranceClosedHint")).toBeVisible();
  await expect(page.locator("#cutoutToleranceClosedHint")).toContainText(/关闭|已关/);
  await expect(page.locator("#cutoutToleranceClosedHint")).not.toContainText(/将自动估算|会自动估算/);
  await expect(page.locator("#cutoutStatus")).toContainText("结果已更新");
  await expect(page.locator("#cutoutResult")).toHaveAttribute("aria-busy", "false", { timeout: 20000 });

  const pixels = await page.locator("#cutoutResult").evaluate((canvas, size) => {
    const view = canvas._cutoutView;
    if (!view) return { error: "missing preview view" };
    const { data, width } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const sample = (imageX, imageY) => {
      const x = Math.min(width - 1, Math.max(0, Math.round(view.offsetX + imageX * view.renderScale)));
      const y = Math.min(
        canvas.height - 1,
        Math.max(0, Math.round(view.offsetY + imageY * view.renderScale)),
      );
      const offset = (y * width + x) * 4;
      return [...data.subarray(offset, offset + 4)];
    };
    return {
      corner: sample(1, 1),
      subject: sample(size / 2, size / 2),
    };
  }, SIZE);
  expect(pixels.error, "result preview must finish drawing").toBeUndefined();
  expect(pixels.corner, "white plate must stay opaque; -1 must not key or auto-estimate").toEqual([
    255, 255, 255, 255,
  ]);
  expect(pixels.subject, "subject must stay put").toEqual([210, 36, 42, 255]);
});
