"use strict";

const { expect, test } = require("@playwright/test");

/**
 * Converts source-image coordinates to browser client coordinates.
 * @param {{x:number,y:number}} point Source-image point.
 * @param {{x:number,y:number,width:number,height:number}} canvasBox Rendered canvas box.
 * @param {{width:number,height:number}} source Source-image dimensions.
 * @returns {{x:number,y:number}} Browser client point.
 */
function toClientPoint(point, canvasBox, source) {
  return {
    x: canvasBox.x + (point.x / source.width) * canvasBox.width,
    y: canvasBox.y + (point.y / source.height) * canvasBox.height,
  };
}

test("detected slices can be moved, resized, edited, and deleted before export", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/tools/scatter-slice");
  const tool = page.frameLocator('iframe[title="零散切片"]');
  await tool.locator("#scatterSample").click();
  await expect.poll(() => tool.locator(".sliceCard").count()).toBeGreaterThan(0);
  await expect(tool.locator("#scatterDetect")).toHaveText("智能识别主体");
  await expect(tool.locator("#scatterEditMode")).toHaveAttribute("aria-pressed", "true");

  const playbackButton = tool.locator(".sliceGroupPlay").first();
  const playbackCanvas = tool.locator(".sliceGroupPlayback").first();
  await playbackButton.click();
  await expect(playbackCanvas).toBeVisible();
  await expect
    .poll(async () => Number(await playbackCanvas.getAttribute("data-frame-index")))
    .toBeGreaterThan(0);
  await playbackButton.click();
  await expect(playbackCanvas).toBeHidden();

  const playAllButton = tool.locator("#scatterPlayAll");
  const playAllCanvas = tool.locator("#scatterPlaybackAll");
  await expect(playAllButton).toBeVisible();
  await playAllButton.click();
  await expect(playAllCanvas).toBeVisible();
  await expect
    .poll(async () => Number(await playAllCanvas.getAttribute("data-frame-index")))
    .toBeGreaterThan(0);
  await playAllButton.click();
  await expect(playAllCanvas).toBeHidden();

  const xInput = tool.locator("#scatterBoxX");
  const yInput = tool.locator("#scatterBoxY");
  const widthInput = tool.locator("#scatterBoxW");
  const heightInput = tool.locator("#scatterBoxH");
  const original = {
    x: Number(await xInput.inputValue()),
    y: Number(await yInput.inputValue()),
    w: Number(await widthInput.inputValue()),
    h: Number(await heightInput.inputValue()),
  };
  const canvas = tool.locator("#scatterPreview");
  await canvas.scrollIntoViewIfNeeded();
  let canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  const source = await canvas.evaluate((element) => ({ width: element.width, height: element.height }));

  const beforeAdd = await tool.locator(".sliceCard").count();
  await tool.locator("#scatterAddMode").click();
  const addStart = toClientPoint({ x: 700, y: 390 }, canvasBox, source);
  const addEnd = toClientPoint({ x: 740, y: 430 }, canvasBox, source);
  await page.mouse.move(addStart.x, addStart.y);
  await page.mouse.down();
  await page.mouse.move(addEnd.x, addEnd.y, { steps: 4 });
  await page.mouse.up();
  await expect(tool.locator(".sliceCard")).toHaveCount(beforeAdd + 1);
  await expect.poll(async () => Number(await xInput.inputValue())).toBeGreaterThan(690);
  await expect.poll(async () => Number(await widthInput.inputValue())).toBeGreaterThan(30);
  await tool.locator("#scatterDelete").click();
  await expect(tool.locator(".sliceCard")).toHaveCount(beforeAdd);
  await tool.locator('.sliceCard[data-box-index="0"]').click();
  await canvas.scrollIntoViewIfNeeded();
  canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  const start = toClientPoint(
    { x: original.x + original.w / 2, y: original.y + original.h / 2 },
    canvasBox,
    source,
  );
  const moved = toClientPoint(
    { x: original.x + original.w / 2 + 5, y: original.y + original.h / 2 + 4 },
    canvasBox,
    source,
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(moved.x, moved.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await xInput.inputValue())).toBeGreaterThan(original.x);
  await expect.poll(async () => Number(await yInput.inputValue())).toBeGreaterThan(original.y);

  const movedBox = {
    x: Number(await xInput.inputValue()),
    y: Number(await yInput.inputValue()),
    w: Number(await widthInput.inputValue()),
    h: Number(await heightInput.inputValue()),
  };
  const eastHandle = toClientPoint(
    { x: movedBox.x + movedBox.w, y: movedBox.y + movedBox.h / 2 },
    canvasBox,
    source,
  );
  const widened = toClientPoint(
    { x: movedBox.x + movedBox.w + 6, y: movedBox.y + movedBox.h / 2 },
    canvasBox,
    source,
  );
  await page.mouse.move(eastHandle.x, eastHandle.y);
  await page.mouse.down();
  await page.mouse.move(widened.x, widened.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await widthInput.inputValue())).toBeGreaterThan(original.w);

  await xInput.fill(String(original.x + 3));
  await xInput.blur();
  await expect(xInput).toHaveValue(String(original.x + 3));

  const beforeInputShortcut = await tool.locator(".sliceCard").count();
  await xInput.focus();
  await page.keyboard.press("Backspace");
  await expect(tool.locator(".sliceCard")).toHaveCount(beforeInputShortcut);
  await xInput.fill(String(original.x + 3));
  await xInput.blur();

  await tool.locator('.sliceCard[data-box-index="1"]').click();
  const nextBoxX = await xInput.inputValue();
  await tool.locator('.sliceCard[data-box-index="0"]').click();
  await canvas.scrollIntoViewIfNeeded();
  const active = {
    x: Number(await xInput.inputValue()),
    y: Number(await yInput.inputValue()),
    w: Number(await widthInput.inputValue()),
    h: Number(await heightInput.inputValue()),
  };
  const activeStart = toClientPoint(
    { x: active.x + active.w / 2, y: active.y + active.h / 2 },
    canvasBox,
    source,
  );
  const beforeDelete = await tool.locator(".sliceCard").count();
  await page.mouse.move(activeStart.x, activeStart.y);
  await page.mouse.down();
  await page.keyboard.press("Delete");
  await page.mouse.move(activeStart.x + 12, activeStart.y + 8);
  await page.mouse.up();
  await expect(tool.locator(".sliceCard")).toHaveCount(beforeDelete - 1);
  await expect(xInput).toHaveValue(nextBoxX);

  const beforeButtonDelete = await tool.locator(".sliceCard").count();
  await tool.locator(".sliceCardDelete").first().click();
  await expect(tool.locator(".sliceCard")).toHaveCount(beforeButtonDelete - 1);
  expect(pageErrors).toEqual([]);
});

test("smart cutout removes black backgrounds in alpha detection mode without erasing subject details", async ({
  page,
}) => {
  await page.goto("/tools/scatter-slice");
  const tool = page.frameLocator('iframe[title="零散切片"]');
  await tool.locator("body").evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    const context = canvas.getContext("2d");
    context.fillStyle = "#000000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#ec7e18";
    context.fillRect(30, 20, 40, 60);
    context.fillStyle = "#000000";
    context.fillRect(45, 40, 10, 20);
    context.fillStyle = "#ff59d6";
    context.fillRect(70, 45, 15, 4);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "alpha-black.png", { type: "image/png" }));
    const input = document.querySelector("#scatterFileInput");
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(tool.locator("#scatterSourceMeta")).toContainText("alpha-black.png");
  await tool.locator("#scatterDetect").click();
  await expect(tool.locator("#scatterStatus p")).toContainText("alpha");

  const thumbnail = tool.locator(".sliceThumbnail").first();
  const readAlpha = () =>
    thumbnail.evaluate((canvas) => {
      const rgba = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let offset = 3; offset < rgba.length; offset += 4) sum += rgba[offset];
      return {
        background: rgba[(5 * canvas.width + 5) * 4 + 3],
        enclosedBlackDetail: rgba[(50 * canvas.width + 50) * 4 + 3],
        pinkEffect: rgba[(46 * canvas.width + 75) * 4 + 3],
        sum,
      };
    });
  const smartAlpha = await readAlpha();
  await tool.locator("#scatterTransparent").uncheck();
  const originalAlpha = await readAlpha();

  expect(smartAlpha.background).toBe(0);
  expect(smartAlpha.enclosedBlackDetail).toBe(255);
  expect(smartAlpha.pinkEffect).toBe(255);
  expect(smartAlpha.sum).toBeLessThan(originalAlpha.sum);
});
