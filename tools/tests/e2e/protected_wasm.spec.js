"use strict";

const { expect, test } = require("@playwright/test");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const DIST_ROOT = path.join(PROJECT_ROOT, "dist");
const MANIFEST_PATH = path.join(DIST_ROOT, "asset-manifest.json");
const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
});
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);
const WORKBENCH_PATHS = new Set([
  "/projects",
  "/tools",
  "/tools/import",
  "/tools/cutout",
  "/tools/organizer",
  "/tools/scatter-slice",
  "/workspace",
]);

let productionOrigin = "";
let productionServer = null;
let productionManifest = null;

/**
 * Sends one bounded response from the generated production directory.
 * @param {import("node:http").IncomingMessage} request HTTP request.
 * @param {import("node:http").ServerResponse} response HTTP response.
 * @returns {void}
 */
function serveProductionAsset(request, response) {
  try {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const relativePath = decodeURIComponent(
      requestUrl.pathname === "/" || WORKBENCH_PATHS.has(requestUrl.pathname)
        ? "/index.html"
        : requestUrl.pathname,
    );
    const filePath = path.resolve(DIST_ROOT, `.${relativePath}`);
    const insideDist = filePath === DIST_ROOT || filePath.startsWith(`${DIST_ROOT}${path.sep}`);
    if (!insideDist || !["GET", "HEAD"].includes(request.method || "")) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    if (!stat?.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const body = fs.readFileSync(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": body.length,
      "Content-Type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
  }
}

/**
 * Starts an isolated static server for the generated production tree.
 * @returns {Promise<{origin:string,server:import("node:http").Server}>} Listening server.
 */
function startProductionServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serveProductionAsset);
    const fail = (error) => {
      server.close();
      reject(error);
    };
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", fail);
      const address = server.address();
      if (!address || typeof address === "string") {
        fail(new Error("Production test server did not expose a TCP port."));
        return;
      }
      resolve({ origin: `http://127.0.0.1:${address.port}`, server });
    });
  });
}

/**
 * Closes the isolated static server and reports shutdown failures.
 * @param {import("node:http").Server|null} server Listening server.
 * @returns {Promise<void>}
 */
function closeProductionServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Finds one required generated asset by its stable manifest role.
 * @param {string} role Stable asset role.
 * @returns {{role:string,path:string,mediaType:string}} Manifest asset.
 */
function requiredAsset(role) {
  const asset = productionManifest?.assets?.find((candidate) => candidate.role === role);
  if (!asset) throw new Error(`Production manifest is missing ${role}.`);
  return asset;
}

test.beforeAll(async () => {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error("Production dist is missing. Run npm run build:production before browser verification.");
  }
  try {
    productionManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    ({ origin: productionOrigin, server: productionServer } = await startProductionServer());
  } catch (error) {
    await closeProductionServer(productionServer).catch(() => {});
    throw error;
  }
});

test.afterAll(async () => {
  await closeProductionServer(productionServer);
});

test("@cross-browser production workbench opens the new-animation importer without startup errors", async ({
  page,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${productionOrigin}/workspace`, { waitUntil: "load" });
  await page.locator('[data-sidebar-tab="project"]').click();
  await expect(page.locator("#importAnimationOpen")).toBeVisible();
  await page.locator("#importAnimationOpen").click();

  await expect(page.locator("#organizerModal")).toBeVisible();
  await expect(page.locator("#organizerModal")).not.toHaveAttribute("hidden", "");
  expect(pageErrors).toEqual([]);
});

test("@cross-browser browser imports remain available after switching to the project hub", async ({
  page,
}) => {
  await page.goto(`${productionOrigin}/tools/import`, { waitUntil: "load" });
  await page.locator("#organizerAnimationName").fill("browser-session-idle");
  await page.locator("#organizerFileInput").setInputFiles([
    { name: "frame_0001.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
    { name: "frame_0002.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG },
  ]);
  await expect(page.locator(".organizerFrame")).toHaveCount(2);
  await page.locator("#organizerApply").click();
  await expect(page.locator("#organizerConfirmPanel")).toBeVisible();
  await page.locator("#organizerConfirmAccept").click();

  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.locator(".thumb")).toHaveCount(2);
  await page.locator('a[data-app-mode="projects"]').click();
  await expect(page).toHaveURL(/\/projects/);
  await expect(page.locator("#projectHubRecentSummary")).toContainText("1 个动画组");
});

test("@cross-browser production includes the embedded scatter-slice workbench", async ({ page }) => {
  const response = await page.goto(`${productionOrigin}/scatter-slice.html?embedded=1`, {
    waitUntil: "load",
  });

  expect(response?.status()).toBe(200);
  await expect(page.locator("#scatterWorkbench")).toBeVisible();
  await expect(page.locator("#scatterTransparent")).toBeDisabled();
});

test("@cross-browser English mode localizes the browser workbench shell", async ({ page }) => {
  await page.goto(`${productionOrigin}/workspace`, { waitUntil: "load" });
  await page.locator('[data-language="en"]').click();

  await expect(page.locator('a[data-app-mode="projects"]')).toContainText("Projects");
  await expect(page.locator('a[data-app-mode="tools"]')).toContainText("Tools");
  await expect(page.locator("#sidebarCollapse")).toContainText("Sidebar");
  await expect(page.locator('button[data-sidebar-tab="transform"]')).toHaveText("Transform");
  await expect(page.locator("#browserModeBanner strong")).toHaveText("Assets stay in this browser");
  await page.locator('a[data-app-mode="projects"]').click();
  await expect(page.locator("#projectHubTitle")).toHaveText("Animation Projects");
  await expect(page.locator("#projectHubRecentSummary")).toContainText("animation groups");
});

test("@cross-browser production Worker loads WASM locally without pixel POST", async ({ page }) => {
  const workerAsset = requiredAsset("product-algorithm");
  const wasmAsset = requiredAsset("protected-core");
  const requests = [];
  const wasmResponses = [];
  page.on("request", (request) => {
    requests.push({
      method: request.method(),
      postDataBytes: request.postDataBuffer()?.byteLength || 0,
      resourceType: request.resourceType(),
      url: request.url(),
    });
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === `/${wasmAsset.path}`) {
      wasmResponses.push({ contentType: response.headers()["content-type"], status: response.status() });
    }
  });

  await page.goto(`${productionOrigin}/`, { waitUntil: "load" });
  await expect.poll(() => page.evaluate(() => globalThis.__XSXB_PRODUCTION__ === true)).toBe(true);
  expect(await page.evaluate(() => globalThis.__XSXB_BUILD_ID__)).toBe(productionManifest.buildId);

  const result = await page.evaluate(
    ({ sourceBytes, workerUrl }) =>
      new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error("Production Worker timed out.")), 15_000);
        const worker = new Worker(workerUrl);
        const finish = (callback, value) => {
          clearTimeout(timeoutId);
          worker.terminate();
          callback(value);
        };
        worker.onerror = (event) => finish(reject, new Error(event.message || "Production Worker failed."));
        worker.onmessage = (event) => {
          if (!event.data?.ok) {
            finish(reject, new Error(event.data?.error || "Production Worker rejected the request."));
            return;
          }
          finish(resolve, {
            automatic: Array.from(new Uint8ClampedArray(event.data.automaticBuffer)),
            pixels: Array.from(new Uint8ClampedArray(event.data.dataBuffer)),
          });
        };
        const source = Uint8ClampedArray.from(sourceBytes);
        worker.postMessage(
          {
            id: "protected-browser-reference-replace",
            operation: "product-cutout",
            protocolVersion: 1,
            sourceBuffer: source.buffer,
            width: 3,
            height: 1,
            options: { automaticCutout: false },
            repairs: [
              {
                mode: "recolor",
                scope: "global",
                x: 0,
                y: 0,
                color: { r: 9, g: 8, b: 7, a: 255 },
                tolerance: 2,
              },
            ],
          },
          [source.buffer],
        );
      }),
    {
      sourceBytes: [100, 100, 100, 255, 110, 100, 100, 255, 111, 100, 100, 255],
      workerUrl: `${productionOrigin}/${workerAsset.path}`,
    },
  );

  expect(result.automatic).toEqual([100, 100, 100, 255, 110, 100, 100, 255, 111, 100, 100, 255]);
  expect(result.pixels).toEqual([9, 8, 7, 255, 9, 8, 7, 255, 111, 100, 100, 255]);
  expect(wasmResponses).toEqual([{ contentType: "application/wasm", status: 200 }]);
  expect(requests.filter((request) => new URL(request.url).pathname === `/${wasmAsset.path}`)).toEqual([
    expect.objectContaining({
      method: "GET",
      postDataBytes: 0,
      resourceType: "fetch",
    }),
  ]);
  expect(requests.filter((request) => request.method === "POST")).toEqual([]);
});
