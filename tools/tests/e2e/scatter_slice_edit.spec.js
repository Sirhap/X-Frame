"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { expect, test } = require("./fixtures");

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

/**
 * Loads the former generated sample through the real file-input path.
 * @param {import("@playwright/test").Page} tool Integrated scatter tool page.
 * @param {string} [fileName] Browser file name.
 * @returns {Promise<void>}
 */
async function loadGeneratedScatterImage(tool, fileName = "scatter-test.png") {
  await tool.locator("body").evaluate(async (_, requestedFileName) => {
    const canvas = document.createElement("canvas");
    canvas.width = 760;
    canvas.height = 440;
    const context = canvas.getContext("2d");
    context.fillStyle = "#98d79b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const poses = [
      [58, 70],
      [220, 82],
      [390, 64],
      [574, 88],
      [108, 274],
      [336, 252],
      [584, 280],
    ];
    poses.forEach(([x, y], index) => {
      context.fillStyle = "#111923";
      context.fillRect(x, y, 38, 64);
      context.fillRect(x - 13, y + 52, 82, 21);
      context.fillStyle = index % 2 ? "#f7b84b" : "#f05b62";
      context.fillRect(x + 8, y + 13, 20, 20);
      context.fillStyle = "#087f68";
      context.fillRect(x + 55, y + 27, 14, 14);
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], requestedFileName, { type: "image/png" }));
    const input = document.querySelector("#scatterFileInput");
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, fileName);
  await expect(tool.locator("#scatterSourceMeta")).toContainText(fileName);
}

/**
 * Reads the selected box geometry from the compact canvas toolbar.
 * @param {import("@playwright/test").Page} tool Integrated scatter tool page.
 * @returns {Promise<{x:number,y:number,w:number,h:number}>}
 */
async function readActiveBox(tool) {
  const text = await tool.locator("#scatterActiveBox").innerText();
  const match = /X:(\d+) Y:(\d+) W:(\d+) H:(\d+)/.exec(text);
  if (!match) throw new Error(`无法读取选中切片：${text}`);
  return { x: Number(match[1]), y: Number(match[2]), w: Number(match[3]), h: Number(match[4]) };
}

/**
 * Expands the workflow step containing a control before interacting with it.
 * @param {import("@playwright/test").Page} tool Integrated scatter tool page.
 * @param {string} selector Control selector.
 * @returns {Promise<void>}
 */
async function revealControl(tool, selector) {
  await tool.locator(selector).evaluate((element) => {
    const panel = element.closest("details");
    if (panel) panel.open = true;
  });
}

test("detected slices can be moved, resized, edited, and deleted before export", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/tools/scatter-slice");
  const tool = page;
  await loadGeneratedScatterImage(tool);
  await expect(tool.locator("#scatterSample")).toHaveCount(0);
  await expect(
    tool.locator(
      "#scatterMergeGap, #scatterMinPixels, #scatterMinSide, #scatterBoxX, #scatterBoxY, #scatterBoxW, #scatterBoxH, #scatterPadding, #scatterColumns",
    ),
  ).toHaveCount(0);
  await expect(tool.locator("#scatterThreshold")).toHaveCount(1);
  await tool.locator("#scatterDetect").click();
  await expect.poll(() => tool.locator(".sliceCard").count()).toBeGreaterThan(0);
  await expect(tool.locator("#scatterDetect")).toHaveText(/智能识别主体|Detect subjects/);
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

  const original = await readActiveBox(tool);
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
  await expect.poll(async () => (await readActiveBox(tool)).x).toBeGreaterThan(690);
  await expect.poll(async () => (await readActiveBox(tool)).w).toBeGreaterThan(30);
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
  await expect.poll(async () => (await readActiveBox(tool)).x).toBeGreaterThan(original.x);
  await expect.poll(async () => (await readActiveBox(tool)).y).toBeGreaterThan(original.y);

  const movedBox = await readActiveBox(tool);
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
  await expect.poll(async () => (await readActiveBox(tool)).w).toBeGreaterThan(original.w);

  const beforeInputShortcut = await tool.locator(".sliceCard").count();
  const animationNameInput = tool.locator("#scatterAnimationName");
  await revealControl(tool, "#scatterAnimationName");
  await animationNameInput.focus();
  await page.keyboard.press("Backspace");
  await expect(tool.locator(".sliceCard")).toHaveCount(beforeInputShortcut);

  await tool.locator('.sliceCard[data-box-index="1"]').click();
  const nextBoxX = (await readActiveBox(tool)).x;
  await tool.locator('.sliceCard[data-box-index="0"]').click();
  await canvas.scrollIntoViewIfNeeded();
  const active = await readActiveBox(tool);
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
  await expect.poll(async () => (await readActiveBox(tool)).x).toBe(nextBoxX);

  const beforeButtonDelete = await tool.locator(".sliceCard").count();
  await tool.locator(".sliceCardDelete").first().click();
  await expect(tool.locator(".sliceCard")).toHaveCount(beforeButtonDelete - 1);
  expect(pageErrors).toEqual([]);
});

test("detected scatter boxes survive a delayed workbench hydrate without routing to organizer", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.goto("/tools/scatter-slice");
  await loadGeneratedScatterImage(page, "scatter-sheet.png");
  await page.locator("#scatterDetect").click();
  await expect.poll(() => page.locator(".sliceCard").count()).toBeGreaterThan(0);
  const boxCount = await page.locator(".sliceCard").count();
  const groupCount = await page.locator(".sliceGroup").count();
  expect(boxCount).toBeGreaterThan(0);
  expect(groupCount).toBeGreaterThan(0);

  await page.waitForTimeout(11_000);
  await page.evaluate(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect.poll(() => page.evaluate(() => window.location.pathname)).not.toMatch(/organizer|import/u);

  await expect(page).toHaveURL(/\/tools\/scatter-slice(?:[?#].*)?$/u);
  await expect(page.locator("#scatterSliceSurface")).toBeVisible();
  await expect(page.locator("#organizerModal")).toBeHidden();
  await expect(page.locator(".sliceCard")).toHaveCount(boxCount);
  await expect(page.locator(".sliceGroup")).toHaveCount(groupCount);
  await expect(page.locator("#scatterPreview")).toBeVisible();
});

test("standalone scatter slices enter the shared temporary organizer workset", async ({ page }) => {
  await page.goto("/tools/scatter-slice");
  await loadGeneratedScatterImage(page, "temporary-scatter.png");
  await page.locator("#scatterDetect").click();
  await expect.poll(() => page.locator(".sliceCard").count()).toBeGreaterThan(0);
  const detectedCount = await page.locator(".sliceCard").count();
  await expect(page.locator("#scatterStageAction")).toHaveText("应用到工作集");

  await page.locator("#scatterStageAction").click();

  await expect(page).toHaveURL(/\/tools\/organizer/);
  await expect(page.locator("#organizerModal")).toBeVisible();
  await expect(page.locator(".organizerFrame")).toHaveCount(detectedCount);
  const retainedFrames = await page.evaluate(() => globalThis.XFrameTemporaryWorkset.getSnapshot().frames);
  expect(retainedFrames).toHaveLength(detectedCount);
  expect(retainedFrames.every((frame) => frame.id.startsWith("scatter:"))).toBe(true);
  expect(retainedFrames.every((frame) => /^动画组 .+-\d{3}\.png$/u.test(frame.name))).toBe(true);
  await expect(page.locator("#worksetHandoffDialog")).toBeHidden();
  await expect(page.locator("#organizerCreationModeField")).toBeVisible();
  await expect(page.locator("#organizerCreationMode")).toHaveValue("groups");
  await expect(page.locator("#organizerApply")).toHaveText(/创建 \d+ 个动画并进入调参/u);

  const expectedAnimationNames = [
    ...new Set(retainedFrames.map((frame) => frame.name.replace(/-\d{3}\.png$/u, ""))),
  ];
  await page.locator("#organizerApply").click();
  await expect(page.locator("#organizerConfirmMessage")).toContainText("创建");
  await expect(page.locator("#organizerConfirmDetails")).toContainText(
    `按组创建 ${expectedAnimationNames.length} 个动画`,
  );
  if (process.env.XSXB_CAPTURE_DIR) {
    await page.screenshot({
      path: path.join(process.env.XSXB_CAPTURE_DIR, "round-6-group-creation.png"),
      fullPage: false,
    });
  }
  await page.locator("#organizerConfirmAccept").click();

  await expect(page.locator("#organizerModal")).toBeHidden();
  await expect(page).toHaveURL(/\/workspace/);
  const animationOptions = await page.locator("#groupSelect option").allTextContents();
  for (const animationName of expectedAnimationNames) {
    expect(animationOptions.some((label) => label.includes(animationName))).toBe(true);
  }
  const beforeReload = await page.evaluate(() =>
    globalThis.XFrameWorkspace.getSnapshot().frames.map((frame) => ({
      id: frame.id,
      persistedId: frame.persistedId,
      revision: frame.assetRevision,
    })),
  );
  const scatterFramesBeforeReload = beforeReload.filter(
    (frame) => frame.persistedId?.startsWith("scatter:") || frame.id.includes(":scatter:"),
  );
  expect(scatterFramesBeforeReload, JSON.stringify(beforeReload)).toHaveLength(detectedCount);
  await page.reload();
  await expect(page.locator(".app")).toBeVisible();
  await expect(page.locator("#playPause")).toBeEnabled();
  await expect(page.locator("#playbackAvailability")).toContainText("帧可播放");
  const afterReload = await page.evaluate(() =>
    globalThis.XFrameWorkspace.getSnapshot()
      .frames.filter((frame) => frame.persistedId?.startsWith("scatter:") || frame.id.includes(":scatter:"))
      .map((frame) => ({ id: frame.id, persistedId: frame.persistedId, revision: frame.assetRevision })),
  );
  expect(afterReload).toEqual(scatterFramesBeforeReload);
  if (process.env.XSXB_CAPTURE_DIR) {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await page.screenshot({
        path: path.join(
          process.env.XSXB_CAPTURE_DIR,
          `final-animation-workspace-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: false,
      });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  await page.locator('[data-workbench-route="export"]').first().click();
  await expect(page).toHaveURL(/\/workspace\/delivery\/export/);
  await expect(page.locator("#deliverySurface")).toBeVisible();
  await expect(page.locator("#deliveryGodotAnimationCount")).toHaveText(`${animationOptions.length} 个`);
  const projectFrameCount = await page.evaluate(() => globalThis.XFrameWorkspace.getSnapshot().frames.length);
  await expect(page.locator("#deliveryGodotFrameCount")).toHaveText(`${projectFrameCount} 帧`);
  await expect(page.locator("#deliveryPetCurrentAnimation")).not.toHaveText("—");
  await expect(page.locator("#deliveryGodotStatus")).toHaveText("尚未绑定");
  await expect(page.locator("#deliveryGodotStatus")).toHaveAttribute("data-tone", "neutral");
  await expect(page.locator("#deliveryGodotChecks")).toContainText("尚未绑定");
  await expect(page.locator("#deliveryPetStatus")).toHaveText("非 Pet 项目");
  await expect(page.locator("#deliveryPetBoundCount")).toHaveText("0 个");
  await expect(page.locator("#deliveryPetChecks")).toContainText("当前项目不是 Codex Pet 项目");
  if (process.env.XSXB_CAPTURE_DIR) {
    await page.screenshot({
      path: path.join(process.env.XSXB_CAPTURE_DIR, "round-7-delivery-hub.png"),
      fullPage: false,
    });
  }
  await expect(page.locator("#mediaExportDialog")).toBeVisible();
  await expect(page.locator("#mediaExportDialog")).toHaveAttribute("data-presentation", "embedded");
  await expect(page.locator("#mediaExportDialog")).toContainText("Sprite Sheet 预览");
  if (process.env.XSXB_CAPTURE_DIR) {
    await page.screenshot({
      path: path.join(process.env.XSXB_CAPTURE_DIR, "round-7-export-dialog.png"),
      fullPage: false,
    });
  }
});

test("automatic recognition ignores a decorative border and connected editor grid", async ({ page }) => {
  await page.goto("/tools/scatter-slice");
  const tool = page;
  await tool.locator("body").evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 140;
    const context = canvas.getContext("2d");
    context.fillStyle = "#28a08c";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#94d6ff";
    context.fillRect(0, 0, canvas.width, 2);
    context.fillRect(0, canvas.height - 2, canvas.width, 2);
    context.fillRect(0, 0, 2, canvas.height);
    context.fillRect(canvas.width - 2, 0, 2, canvas.height);
    for (const y of [35, 105]) context.fillRect(0, y, canvas.width, 1);
    for (const x of [50, 150]) context.fillRect(x, 0, 1, canvas.height);
    context.fillStyle = "#111923";
    context.fillRect(18, 58, 10, 20);
    context.fillRect(82, 58, 10, 20);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "grid-sprites.png", { type: "image/png" }));
    const input = document.querySelector("#scatterFileInput");
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(tool.locator("#scatterColorValue")).toHaveText("#28A08C");
  await tool.locator("#scatterDetect").click();
  await expect(tool.locator(".sliceCard")).toHaveCount(2);
  await expect(tool.locator("#scatterStatus p")).toContainText("已过滤");
});

test("smart cutout keys a black plate including enclosed plate pixels without erasing the subject", async ({
  page,
}) => {
  await page.goto("/tools/scatter-slice");
  const tool = page;
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
  await revealControl(tool, "#scatterMode");
  await tool.locator("#scatterMode").selectOption("alpha");
  await expect(tool.locator("#scatterStatus p")).toContainText("alpha");

  const thumbnail = tool.locator(".sliceThumbnail").first();
  const readAlpha = () =>
    thumbnail.evaluate((canvas) => {
      const rgba = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let offset = 3; offset < rgba.length; offset += 4) sum += rgba[offset];
      return {
        background: rgba[(5 * canvas.width + 5) * 4 + 3],
        enclosedBlackPlate: rgba[(50 * canvas.width + 50) * 4 + 3],
        orangeSubject: rgba[(25 * canvas.width + 35) * 4 + 3],
        pinkEffect: rgba[(46 * canvas.width + 75) * 4 + 3],
        sum,
      };
    });
  const smartAlpha = await readAlpha();
  await revealControl(tool, "#scatterTransparent");
  await tool.locator("#scatterTransparent").uncheck();
  const originalAlpha = await readAlpha();

  expect(smartAlpha.background).toBe(0);
  expect(smartAlpha.enclosedBlackPlate).toBe(0);
  expect(smartAlpha.orangeSubject).toBe(255);
  expect(smartAlpha.pinkEffect).toBe(255);
  expect(smartAlpha.sum).toBeLessThan(originalAlpha.sum);
});

test("workspace editing supports multi-select, group management, history, and cross-group dragging", async ({
  page,
}) => {
  await page.goto("/tools/scatter-slice");
  const tool = page;
  await loadGeneratedScatterImage(tool);
  await tool.locator("#scatterDetect").click();
  await expect.poll(() => tool.locator(".sliceCard").count()).toBeGreaterThan(3);

  const originalGroupCount = await tool.locator(".sliceGroup").count();
  await tool.locator(".sliceCard").nth(0).click();
  await tool
    .locator(".sliceCard")
    .nth(1)
    .click({ modifiers: ["Meta"] });
  await expect(tool.locator("#scatterActiveBox")).toContainText("已选 2");
  await expect(tool.locator("#scatterNormalizeBoxes")).toBeEnabled();
  await tool.locator("#scatterNormalizeBoxes").click();

  const firstGroup = tool.locator(".sliceGroup").first();
  const groupName = firstGroup.locator(".sliceGroupName");
  await groupName.fill("待机");
  await groupName.press("Enter");
  await expect(groupName).toHaveValue("待机");

  await firstGroup.getByRole("button", { name: /所选切片.*新建动画组/ }).click();
  await expect(tool.locator(".sliceGroup")).toHaveCount(originalGroupCount + 1);
  await tool.locator("#scatterUndo").click();
  await expect(tool.locator(".sliceGroup")).toHaveCount(originalGroupCount);
  await tool.locator("#scatterRedo").click();
  await expect(tool.locator(".sliceGroup")).toHaveCount(originalGroupCount + 1);

  const firstGroupId = await tool.locator(".sliceGroup").first().getAttribute("data-group-id");
  await tool.locator(".sliceGroup").first().getByRole("button", { name: /下移/ }).click();
  await expect(tool.locator(".sliceGroup").nth(1)).toHaveAttribute("data-group-id", firstGroupId);
  await tool.locator("#scatterUndo").click();
  await expect(tool.locator(".sliceGroup").first()).toHaveAttribute("data-group-id", firstGroupId);

  const sourceGroup = tool.locator(".sliceGroup").first();
  const targetGroup = tool.locator(".sliceGroup").last();
  const sourceCount = await sourceGroup.locator(".sliceCardShell").count();
  const targetCount = await targetGroup.locator(".sliceCardShell").count();
  const targetGroupId = await targetGroup.getAttribute("data-group-id");
  await sourceGroup
    .locator(".sliceCardShell")
    .first()
    .evaluate((source, targetGroupId) => {
      const target = document.querySelector(`.sliceGroup[data-group-id="${targetGroupId}"] .sliceGrid`);
      if (!target) throw new Error("找不到拖拽测试目标");
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
      source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
    }, targetGroupId);
  await expect(sourceGroup.locator(".sliceCardShell")).toHaveCount(sourceCount - 1);
  await expect(targetGroup.locator(".sliceCardShell")).toHaveCount(targetCount + 1);
  await tool.locator("#scatterUndo").click();
  await expect(sourceGroup.locator(".sliceCardShell")).toHaveCount(sourceCount);
});

test("real-material cleanup refreshes automatic names and selects small slices in one action", async ({
  page,
}) => {
  await page.goto("/tools/scatter-slice");
  const tool = page;
  const animationName = tool.locator("#scatterAnimationName");
  await revealControl(tool, "#scatterAnimationName");

  await loadGeneratedScatterImage(tool, "first-sheet.png");
  await expect(animationName).toHaveValue("first-sheet");
  await loadGeneratedScatterImage(tool, "second-sheet.png");
  await expect(animationName).toHaveValue("second-sheet");
  await animationName.fill("custom-run");
  await loadGeneratedScatterImage(tool, "third-sheet.png");
  await expect(animationName).toHaveValue("custom-run");

  await tool.locator("#scatterDetect").click();
  const canvas = tool.locator("#scatterPreview");
  await canvas.scrollIntoViewIfNeeded();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  const source = await canvas.evaluate((element) => ({ width: element.width, height: element.height }));
  await tool.locator("#scatterAddMode").click();
  const addStart = toClientPoint({ x: 720, y: 18 }, canvasBox, source);
  const addEnd = toClientPoint({ x: 732, y: 30 }, canvasBox, source);
  await page.mouse.move(addStart.x, addStart.y);
  await page.mouse.down();
  await page.mouse.move(addEnd.x, addEnd.y, { steps: 3 });
  await page.mouse.up();

  const frameCount = await tool.locator(".sliceCard").count();
  expect(frameCount).toBeGreaterThan(3);
  await tool.locator("#scatterSmallSliceRatio").selectOption("0.3");
  await tool.locator("#scatterSelectSmallSlices").click();
  const selectedCount = await tool.locator('.sliceCard[aria-pressed="true"]').count();
  expect(selectedCount).toBeGreaterThan(0);
  expect(selectedCount).toBeLessThan(frameCount);
  await expect(tool.locator("#scatterStatus")).toContainText(`已按尺寸选择 ${selectedCount} 个小切片`);
});

test("uniform output produces equal frame canvases for each separate project workset", async ({ page }) => {
  await page.goto("/tools/scatter-slice");
  const tool = page;
  await loadGeneratedScatterImage(tool);
  await tool.locator("#scatterDetect").click();
  await expect.poll(() => tool.locator(".sliceCard").count()).toBeGreaterThan(3);

  const canvas = tool.locator("#scatterPreview");
  await canvas.scrollIntoViewIfNeeded();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  const source = await canvas.evaluate((element) => ({ width: element.width, height: element.height }));
  await tool.locator("#scatterAddMode").click();
  const addStart = toClientPoint({ x: 710, y: 16 }, canvasBox, source);
  const addEnd = toClientPoint({ x: 728, y: 34 }, canvasBox, source);
  await page.mouse.move(addStart.x, addStart.y);
  await page.mouse.down();
  await page.mouse.move(addEnd.x, addEnd.y, { steps: 3 });
  await page.mouse.up();

  await page.evaluate(() => {
    window.XFrameOpenWorksetHandoff = async (payload) => {
      window.__scatterHandoff = payload;
    };
  });
  await tool.locator("#scatterAddProject").click();

  const dimensions = await page.evaluate(async () => {
    const readSize = (data) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = () => reject(new Error("无法读取交接 PNG"));
        image.src = data;
      });
    return Promise.all(
      window.__scatterHandoff.worksets.map(async (workset) =>
        Promise.all(workset.items.map((item) => readSize(item.data))),
      ),
    );
  });

  for (const worksetDimensions of dimensions) {
    assert.equal(new Set(worksetDimensions.map((size) => size.join("x"))).size, 1);
  }

  await revealControl(tool, "#scatterUniformOutput");
  await tool.locator("#scatterUniformOutput").uncheck();
  await tool.locator("#scatterAddProject").click();
  const variableDimensions = await page.evaluate(async () => {
    const readSize = (data) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = () => reject(new Error("无法读取交接 PNG"));
        image.src = data;
      });
    return Promise.all(
      window.__scatterHandoff.worksets.map(async (workset) =>
        Promise.all(workset.items.map((item) => readSize(item.data))),
      ),
    );
  });
  assert.ok(
    variableDimensions.some(
      (worksetDimensions) => new Set(worksetDimensions.map((size) => size.join("x"))).size > 1,
    ),
  );
});
