#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(process.env.XSXB_PERF_WORKSPACE_ROOT || ROOT);
const PROJECT_ID = String(process.env.XSXB_PERF_PROJECT_ID || "Goblin_Run_Test");
const PORT = 5192;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REAL_VIDEOS = {
  exportedPreview: {
    path: path.resolve(
      process.env.XSXB_PERF_PREVIEW_VIDEO || path.join(ROOT, "output/video-watermark-test/preview.mp4"),
    ),
    fps: 12,
  },
  goblinRun16Frames: {
    path: path.resolve(
      process.env.XSXB_PERF_GOBLIN_VIDEO ||
        path.join(ROOT, ".codex-artifacts/run-cutout-review/goblin_run_preview_16f.mp4"),
    ),
    fps: 6,
  },
};
const DEFAULT_CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * Returns a Chromium executable that can decode the repository's H.264 reference video.
 * Playwright's bundled Chromium may not include the proprietary H.264 codec on macOS.
 * @returns {string|undefined}
 */
function browserExecutablePath() {
  const configuredPath = process.env.CHROME_EXECUTABLE;
  if (configuredPath) return configuredPath;
  return fs.existsSync(DEFAULT_CHROME_EXECUTABLE) ? DEFAULT_CHROME_EXECUTABLE : undefined;
}

/**
 * Returns a linear-interpolated percentile from a numeric sample list.
 * @param {number[]} values Sample values in milliseconds.
 * @param {number} percentile Requested percentile in the inclusive 0..1 range.
 * @returns {number} Rounded percentile value.
 */
function percentile(values, percentile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, percentile * (sorted.length - 1)));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return Number((sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)).toFixed(2));
}

/**
 * Waits until the local tuner server accepts requests or reports its startup failure.
 * @param {import("node:child_process").ChildProcess} server Server process.
 * @returns {Promise<void>}
 */
async function waitForServer(server) {
  const deadline = Date.now() + 10_000;
  let startupError = "";
  server.stderr?.on("data", (chunk) => {
    startupError += chunk.toString();
  });
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(startupError || "Tuner server stopped during startup.");
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // The server is still binding its local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(startupError || "Timed out waiting for the tuner server.");
}

/**
 * Attaches a browser-side long-task recorder before the measured interaction.
 * @param {import("playwright").Page} page Browser page.
 * @returns {Promise<void>}
 */
async function startLongTaskTrace(page) {
  await page.evaluate(() => {
    window.__xsxbLongTasks = [];
    if (typeof PerformanceObserver !== "function") return;
    const observer = new PerformanceObserver((entries) => {
      entries.getEntries().forEach((entry) => window.__xsxbLongTasks.push(entry.duration));
    });
    try {
      observer.observe({ type: "longtask", buffered: true });
      window.__xsxbLongTaskObserver = observer;
    } catch {
      // Chromium may omit longtask support in a constrained headless build.
    }
  });
}

/**
 * Measures extraction of one repository MP4 through the production browser UI.
 * @param {import("playwright").Page} page Browser page.
 * @param {{path:string,fps:number}} source Material source and its intended extraction rate.
 * @returns {Promise<{elapsedMs:number,frames:number,longTaskCount:number,longTaskMaxMs:number}>}
 */
async function measureVideoExtraction(page, source) {
  await page.goto(`${BASE_URL}/tools/import`);
  await page.locator("#organizerVideoInput").setInputFiles(source.path);
  const mediaStateHandle = await page.waitForFunction(() => {
    const video = document.querySelector("#organizerVideoElement");
    if (!video) return null;
    if (video.error) return { error: video.error.message || `MediaError ${video.error.code}` };
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      return { width: video.videoWidth, height: video.videoHeight };
    }
    return null;
  });
  const mediaState = await mediaStateHandle.jsonValue();
  if (mediaState.error) throw new Error(`Browser could not decode the real video: ${mediaState.error}`);
  await page.locator("#organizerVideoFpsNumber").fill(String(source.fps));
  await page.locator("#organizerVideoFpsNumber").dispatchEvent("input");
  await startLongTaskTrace(page);
  const startedAt = Date.now();
  await page.locator("#organizerVideoExtract").click();
  await page.waitForFunction(
    () => {
      const videoPanel = document.querySelector("#organizerVideoPanel");
      return Boolean(videoPanel?.hidden) && document.querySelectorAll(".organizerFrame").length > 0;
    },
    null,
    {
      timeout: 45_000,
    },
  );
  const elapsedMs = Date.now() - startedAt;
  const details = await page.evaluate(() => {
    const longTasks = Array.isArray(window.__xsxbLongTasks) ? window.__xsxbLongTasks : [];
    window.__xsxbLongTaskObserver?.disconnect();
    return {
      frames: document.querySelectorAll(".organizerFrame").length,
      longTaskCount: longTasks.length,
      longTaskMaxMs: Math.max(0, ...longTasks),
    };
  });
  return { elapsedMs, ...details };
}

/**
 * Finds the collision-box outline painted by the production canvas renderer.
 * @param {import("playwright").Page} page Browser page.
 * @returns {Promise<{left:number,right:number,top:number,bottom:number}>} Canvas-pixel bounds.
 */
async function findCollisionBoxBounds(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#stage");
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) throw new Error("Editor stage is unavailable.");
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        if (red > 130 || green < 180 || blue < 80 || blue > 180 || green - red < 70) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) throw new Error("Collision-box outline was not rendered.");
    return { left, right, top, bottom };
  });
}

/**
 * Measures continuous pointer dragging of one collision box over the loaded real 15-frame project.
 * This only mutates the transient browser session; it never sends a save request to the local API.
 * @param {import("playwright").Page} page Browser page.
 * @returns {Promise<{frames:number,samples:number,p50Ms:number,p95Ms:number,p99Ms:number,longTaskCount:number,longTaskMaxMs:number}>}
 */
async function measureBoxDrag(page) {
  await page.goto(`${BASE_URL}/?project=${encodeURIComponent(PROJECT_ID)}`);
  await page.locator("#stage").waitFor({ state: "visible" });
  const frameThumbs = page.locator("#filmstrip .thumb[data-frame-index]");
  await page.waitForFunction(
    () => document.querySelectorAll("#filmstrip .thumb[data-frame-index]").length >= 15,
  );
  const frameCount = await frameThumbs.count();
  await frameThumbs.first().click();
  await frameThumbs.nth(frameCount - 1).click({ modifiers: ["Shift"] });
  await page.locator('details[data-panel="boxes"] > summary').click();
  await page.locator("#showBoxes").evaluate((input) => {
    if (!input.checked) input.click();
  });
  await page.locator('[data-box-choice="collisionbox"]').evaluate((input) => {
    if (!input.checked) input.click();
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const bounds = await findCollisionBoxBounds(page);
  const stageBox = await page.locator("#stage").boundingBox();
  if (!stageBox) throw new Error("Editor stage has no layout bounds.");
  const canvasSize = await page
    .locator("#stage")
    .evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
  const toClientPoint = (x, y) => ({
    x: stageBox.x + (x / canvasSize.width) * stageBox.width,
    y: stageBox.y + (y / canvasSize.height) * stageBox.height,
  });
  const center = toClientPoint((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
  await page.evaluate(() => {
    const stage = document.querySelector("#stage");
    window.__xsxbBoxDragSamples = [];
    stage.addEventListener(
      "pointermove",
      (event) => {
        event.__xsxbTraceStartedAt = performance.now();
      },
      true,
    );
    stage.addEventListener("pointermove", (event) => {
      requestAnimationFrame(() => {
        window.__xsxbBoxDragSamples.push(performance.now() - event.__xsxbTraceStartedAt);
      });
    });
  });
  await startLongTaskTrace(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (let index = 1; index <= 120; index += 1) {
    await page.mouse.move(center.x + index / 2, center.y - index / 4, { steps: 1 });
  }
  await page.mouse.up();
  await page.waitForTimeout(100);
  const details = await page.evaluate(() => {
    const longTasks = Array.isArray(window.__xsxbLongTasks) ? window.__xsxbLongTasks : [];
    window.__xsxbLongTaskObserver?.disconnect();
    return {
      samples: window.__xsxbBoxDragSamples || [],
      longTaskCount: longTasks.length,
      longTaskMaxMs: Math.max(0, ...longTasks),
    };
  });
  return {
    frames: frameCount,
    samples: details.samples.length,
    p50Ms: percentile(details.samples, 0.5),
    p95Ms: percentile(details.samples, 0.95),
    p99Ms: percentile(details.samples, 0.99),
    longTaskCount: details.longTaskCount,
    longTaskMaxMs: details.longTaskMaxMs,
  };
}

/**
 * Runs all browser real-material traces and returns their portable report.
 * @returns {Promise<{
 *   videoExtraction:Record<string, Awaited<ReturnType<typeof measureVideoExtraction>>>,
 *   boxDrag:Awaited<ReturnType<typeof measureBoxDrag>>,
 * }>}
 */
async function runRealBrowserBaseline() {
  for (const [name, source] of Object.entries(REAL_VIDEOS)) {
    if (!fs.existsSync(source.path)) {
      const variable = name === "exportedPreview" ? "XSXB_PERF_PREVIEW_VIDEO" : "XSXB_PERF_GOBLIN_VIDEO";
      throw new Error(`Missing ${name} video: ${source.path}. Set ${variable} to an MP4 path.`);
    }
  }
  const registryPath = path.join(WORKSPACE_ROOT, "data/projects.json");
  if (!fs.existsSync(registryPath)) {
    throw new Error(
      `Missing tuner registry: ${registryPath}. Set XSXB_PERF_WORKSPACE_ROOT to a populated tuner workspace.`,
    );
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (!Array.isArray(registry.projects) || !registry.projects.some((project) => project?.id === PROJECT_ID)) {
    throw new Error(
      `Missing browser benchmark project: ${PROJECT_ID}. Set XSXB_PERF_PROJECT_ID to a project in ${registryPath}.`,
    );
  }
  const server = spawn(process.execPath, ["tools/animation_tuner/server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), XSXB_ROOT: WORKSPACE_ROOT },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let browser = null;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true, executablePath: browserExecutablePath() });
    const videoExtraction = {};
    for (const [name, source] of Object.entries(REAL_VIDEOS)) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      videoExtraction[name] = await measureVideoExtraction(page, source);
      await page.close();
    }
    const editorPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const boxDrag = await measureBoxDrag(editorPage);
    await editorPage.close();
    return { videoExtraction, boxDrag };
  } finally {
    await browser?.close();
    if (server.exitCode == null) server.kill("SIGTERM");
  }
}

/**
 * Executes the CLI and prints a JSON report.
 * @returns {Promise<void>}
 */
async function main() {
  const unsupported = process.argv.slice(2).find((argument) => argument !== "--json");
  if (unsupported) throw new Error(`Unknown argument: ${unsupported}`);
  process.stdout.write(`${JSON.stringify(await runRealBrowserBaseline(), null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Real browser benchmark failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { measureBoxDrag, measureVideoExtraction, runRealBrowserBaseline };
