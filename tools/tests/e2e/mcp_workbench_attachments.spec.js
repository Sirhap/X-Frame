"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createXsxbMcpService } = require("../../xsxb_mcp_service");
const { encodePngRgba } = require("../../xsxb_mcp_cutout");
const { resolveE2ERoot } = require("./e2e_fixture");
const { expect, test } = require("./fixtures");

const PNG_DATA_URL = (() => {
  const rgba = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 3; y <= 14; y += 1) {
    for (let x = 6; x <= 9; x += 1) rgba.set([200, 40, 40, 255], (y * 16 + x) * 4);
  }
  return `data:image/png;base64,${encodePngRgba(rgba, 16, 16).toString("base64")}`;
})();

/** @returns {Buffer} A visible transparent weapon/effect PNG. */
function attachmentPng() {
  const rgba = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 2; y <= 5; y += 1) {
    for (let x = 1; x <= 6; x += 1) rgba.set([30, 240, 80, 255], (y * 8 + x) * 4);
  }
  return encodePngRgba(rgba, 8, 8);
}

test("MCP-created attachment is visible, selectable, layered, and stable after workbench reload", async ({
  page,
  request,
}) => {
  const importedResponse = await request.post("/api/import-animation", {
    data: {
      projectLabel: "E2E MCP attachment",
      profileLabel: "Hero",
      animationName: "mcp-attachment",
      fps: 12,
      items: [
        { name: "frame_0001.png", data: PNG_DATA_URL },
        { name: "frame_0002.png", data: PNG_DATA_URL },
      ],
    },
  });
  expect(importedResponse.ok(), await importedResponse.text()).toBe(true);
  const imported = await importedResponse.json();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-e2e-mcp-attachment-"));
  const attachmentPath = path.join(tempDir, "weapon.png");
  fs.writeFileSync(attachmentPath, attachmentPng());
  const service = createXsxbMcpService({ root: resolveE2ERoot() });
  try {
    await service.call("xsxb_add_attachment", {
      project_id: imported.activeProjectId,
      profile_id: imported.profileId,
      animation_id: imported.animationId,
      file_path: attachmentPath,
      id: "mcp-weapon",
      frame: 0,
      layer: "below",
      offset_x: 1,
      offset_y: -6,
      sync: false,
    });
  } finally {
    await service.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  await page.goto(
    `/workspace?project=${imported.activeProjectId}&profile=${imported.profileId}&animation=${imported.animationId}`,
  );
  const attachment = page.locator(".attachmentThumb");
  await expect(attachment).toHaveCount(1);
  await expect(attachment).toHaveClass(/layerBelow/);
  await attachment.click();
  await expect(attachment).toHaveClass(/selectedAttachment/);

  await page.reload();
  await expect(page.locator(".attachmentThumb")).toHaveCount(1);
  await expect(page.locator(".attachmentThumb")).toHaveClass(/layerBelow/);
});
