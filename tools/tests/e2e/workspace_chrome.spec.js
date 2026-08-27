"use strict";

const { expect, test } = require("./fixtures");

test("workspace chrome drops unused status text and keeps account plus shortcuts in the header", async ({
  page,
}) => {
  await page.goto("/workspace", { waitUntil: "networkidle" });

  const toolbar = page.locator(".workspace > .toolbar");
  const header = page.locator("#workspaceFlowHeader");
  const account = header.locator("#workspaceAccount");
  const shortcut = header.locator(".shortcutGuide");

  await expect(toolbar).toBeVisible();
  await expect(account).toBeVisible();
  await expect(shortcut).toBeVisible();
  await expect(page.locator(".workspace > .toolbar .shortcutGuide")).toHaveCount(0);
  await expect(page.locator("#activationManage")).toBeHidden();
  await expect(page.locator("#canvasTitle")).toBeHidden();
  await expect(page.locator("#selectionHud")).toBeHidden();
  await expect(page.locator("#hint")).toBeHidden();

  const [toolbarBox, shortcutBox, accountBox] = await Promise.all([
    toolbar.boundingBox(),
    shortcut.boundingBox(),
    account.boundingBox(),
  ]);
  expect(toolbarBox, "toolbar should render").not.toBeNull();
  expect(shortcutBox, "header shortcut should render").not.toBeNull();
  expect(accountBox, "account should render").not.toBeNull();
  expect(toolbarBox.height, "toolbar should be a single compact control row").toBeLessThanOrEqual(56);
  expect(Math.abs(shortcutBox.y - accountBox.y), "shortcut should sit on the account row").toBeLessThan(8);
  expect(
    shortcutBox.x + shortcutBox.width,
    "shortcut should sit immediately left of account",
  ).toBeLessThanOrEqual(accountBox.x + 1);

  for (const selector of [
    "#workspaceAccount",
    ".workspaceFlowChrome .shortcutGuide > summary",
    "#playPause",
    "#ghostToggle",
    "#stageZoom",
    "#stageZoomFit",
  ]) {
    const hit = page.locator(selector);
    await expect(hit).toBeVisible();
    await expect
      .poll(
        async () => {
          return hit.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const x = bounds.left + bounds.width / 2;
            const y = bounds.top + bounds.height / 2;
            if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
              return "outside the viewport";
            }
            const target = document.elementFromPoint(x, y);
            if (target === element || element.contains(target)) return "reachable";
            if (!target) return "covered by nothing";
            return `covered by ${target.tagName}${target.id ? `#${target.id}` : ""}`;
          });
        },
        { message: `${selector} should receive its own clicks` },
      )
      .toBe("reachable");
  }

  await account.click();
  await expect(page.locator("#activationPanel")).toBeVisible();
  await expect(page.locator("#accountEmail")).toBeFocused();
});

test("workspace timeline and save bar scroll with the page instead of sticking to the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/workspace", { waitUntil: "networkidle" });

  const filmstrip = page.locator(".filmstripPanel");
  const bar = page.locator("#contextActionBar");
  await expect(filmstrip).toBeVisible();
  await expect(bar).toBeVisible();

  const position = await bar.evaluate((element) => getComputedStyle(element).position);
  expect(position, "save bar should not be a sticky or fixed dock").not.toMatch(/^(sticky|fixed)$/);

  await filmstrip.evaluate((element) => {
    element.style.minHeight = "900px";
  });
  await page.evaluate(() => window.scrollTo(0, 0));

  const topAtStart = await bar.evaluate((element) => element.getBoundingClientRect().top);
  expect(
    topAtStart,
    "a tall timeline should push the save bar below the viewport, not pin it to the bottom",
  ).toBeGreaterThan(720);

  await page.evaluate(() => window.scrollBy(0, 400));
  const topAfterScroll = await bar.evaluate((element) => element.getBoundingClientRect().top);
  expect(topAfterScroll).toBeLessThan(topAtStart - 200);
});

test("workspace preview overlay captions stay compact on the stage", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/workspace/animation/boxes", { waitUntil: "networkidle" });
  await expect(page.locator("#stage")).toBeVisible();

  const overlay = await page.evaluate(async () => {
    const calls = [];
    const proto = CanvasRenderingContext2D.prototype;
    const original = proto.fillText;
    proto.fillText = function fillText(text, x, y) {
      if (this.canvas?.id === "stage") {
        const size = Number((String(this.font).match(/(\d+(?:\.\d+)?)px/) || [])[1] || 0);
        const dpr = window.devicePixelRatio || 1;
        calls.push({ text: String(text), cssPx: size / dpr, x, y });
      }
      return original.apply(this, arguments);
    };
    const checkbox = document.querySelector("#showBoxes");
    if (checkbox) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    proto.fillText = original;
    return calls;
  });

  expect(overlay.length, "stage should paint overlay captions").toBeGreaterThan(0);
  expect(Math.max(...overlay.map((item) => item.cssPx))).toBeLessThanOrEqual(10.5);
  const ticks = overlay.filter((item) => /^-?\d+$/.test(item.text));
  for (const tick of ticks) {
    expect(
      tick.y <= 48 || tick.x <= 48,
      `${tick.text} at ${tick.x},${tick.y} should hug a canvas edge`,
    ).toBeTruthy();
  }
  const hints = overlay.filter((item) => /拖动手柄|拖动框体|方向键|Hold Alt|Drag handles/.test(item.text));
  expect(hints.length, "box-edit hint should wrap into short lines").toBeGreaterThan(1);
});
