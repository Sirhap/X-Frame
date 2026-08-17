"use strict";

const { expect, test } = require("./fixtures");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);

/**
 * Imports a disposable project that must not leak into later tests.
 * @param {import("@playwright/test").APIRequestContext} request Playwright request context.
 * @returns {Promise<void>}
 */
async function importLeakedProject(request) {
  const response = await request.post("/api/import-animation", {
    data: {
      projectLabel: "Leaked Isolation Project",
      profileLabel: "Hero",
      animationName: "leaked-idle",
      fps: 12,
      items: [1, 2].map((index) => ({
        name: `frame_${String(index).padStart(4, "0")}.png`,
        data: `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`,
      })),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

test("a previous import-animation does not leak into the next test", async ({ request }) => {
  await importLeakedProject(request);
  const polluted = await request.get("/api/projects");
  expect(polluted.ok(), await polluted.text()).toBe(true);
  const pollutedBody = await polluted.json();
  expect(pollutedBody.projects.map((project) => project.label)).toContain("Leaked Isolation Project");
});

test("each test starts from the seed project instead of leftover imports", async ({ request }) => {
  const response = await request.get("/api/projects");
  expect(response.ok(), await response.text()).toBe(true);
  const body = await response.json();
  expect(body.activeProjectId).toBe("seed-project");
  expect(body.projects.map((project) => project.label)).not.toContain("Leaked Isolation Project");
  expect(body.projects.some((project) => project.id === "seed-project")).toBe(true);
});
