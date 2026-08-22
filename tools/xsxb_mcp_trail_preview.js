"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EDITOR_SCRIPT = path.join(__dirname, "animation_tuner/public/attack_trails.js");
const FALLBACK_TEXTURE = path.join(
  __dirname,
  "animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
);

/**
 * Segments that the Tuner mesh will actually draw.
 * @param {object} trails Normalized attack_trails.json.
 * @param {string} bindingKey profile/animation key.
 * @returns {object[]} Segments with at least two sticks.
 */
function usableTrailSegments(trails, bindingKey) {
  return (trails?.bindings?.[bindingKey] || []).filter(
    (segment) =>
      segment &&
      segment.enabled !== false &&
      segment.generated !== false &&
      Array.isArray(segment.sticks) &&
      segment.sticks.length >= 2,
  );
}

/**
 * Resolves a trail texture PNG from the XSXB root, then the built-in preset.
 * @param {string} requested Repo-relative or absolute path.
 * @param {string} root XSXB root.
 * @returns {string} Existing file path.
 */
function resolveTextureFile(requested, root) {
  const candidates = [
    requested && path.isAbsolute(requested) ? requested : "",
    requested && root ? path.resolve(root, requested) : "",
    FALLBACK_TEXTURE,
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Attack trail texture is missing. Looked for: ${requested || FALLBACK_TEXTURE}`);
}

/**
 * Encodes a local PNG as a data URL for the headless compositor.
 * @param {string} filePath PNG path.
 * @returns {string} data:image/png;base64,…
 */
function dataUrl(filePath) {
  return `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`;
}

/**
 * Launches a headless browser that can run AttackTrailEditor.
 * @returns {Promise<object>} Playwright browser.
 */
async function launchPreviewBrowser() {
  const { chromium } = require("playwright");
  try {
    return await chromium.launch({ channel: "msedge", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

/**
 * Composites Tuner attack-trail meshes onto animation frames.
 * When the binding has no drawable trail, the source paths are returned unchanged.
 *
 * @param {object} job Composite job.
 * @param {string[]} job.framePaths Source PNG paths in export order.
 * @param {number[]} job.frameIndexes Absolute 0-based indexes for those paths.
 * @param {number[]} job.durations Per-absolute-frame durations in seconds.
 * @param {number} job.fps Playback fps.
 * @param {object} job.trails Normalized attack_trails.json.
 * @param {string} job.bindingKey profile/animation key.
 * @param {string} job.root XSXB root used to resolve textures.
 * @returns {Promise<{framePaths:string[],bakedTrails:boolean,trailIds:string[],tempDir:?string}>}
 */
async function compositeWithPage(job, page) {
  const framePaths = Array.isArray(job.framePaths) ? job.framePaths : [];
  const bindingKey = String(job.bindingKey || "");
  const segments = usableTrailSegments(job.trails, bindingKey);
  const attachments = (Array.isArray(job.attachments) ? job.attachments : []).filter(
    (attachment) => attachment?.absolutePath && fs.existsSync(attachment.absolutePath),
  );
  const trailIds = segments.map((segment) => String(segment.id));
  const attachmentIds = [...new Set(attachments.map((attachment) => String(attachment.id || "")))].filter(
    Boolean,
  );
  if (!framePaths.length || (!segments.length && !attachments.length)) {
    return {
      framePaths,
      bakedTrails: false,
      trailIds: [],
      bakedAttachments: false,
      attachmentIds: [],
      tempDir: null,
    };
  }
  const first = framePaths[0];
  if (!fs.existsSync(first)) throw new Error(`Cannot composite trails: missing frame ${first}`);
  const frameIndexes = Array.isArray(job.frameIndexes)
    ? job.frameIndexes
    : framePaths.map((_, index) => index);
  if (frameIndexes.length !== framePaths.length) {
    throw new Error("frameIndexes must align with framePaths.");
  }
  const fps = Number(job.fps) > 0 ? Number(job.fps) : 12;
  const durations = Array.isArray(job.durations) && job.durations.length ? job.durations : [];
  const [profileId, animationId] = bindingKey.split("/");
  const textureByPath = {};
  for (const segment of segments) {
    const requested = segment.texture?.path || job.trails?.presetTexture?.path || FALLBACK_TEXTURE;
    const absolute = resolveTextureFile(requested, job.root);
    textureByPath[segment.texture?.path || requested] = dataUrl(absolute);
  }
  const attachmentImages = { ...(job.attachmentImageSources || {}) };
  for (const attachment of attachments) {
    attachmentImages[attachment.absolutePath] ||= dataUrl(attachment.absolutePath);
  }
  if (!fs.existsSync(EDITOR_SCRIPT)) {
    throw new Error(`AttackTrailEditor script is missing: ${EDITOR_SCRIPT}`);
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-trail-preview-"));
  try {
    const pngs = await page.evaluate(
      async ({
        trails,
        frames,
        frameIndexes: indexes,
        durations: frameDurations,
        fps: playbackFps,
        textureByPath: textures,
        attachments: attachmentEntries,
        attachmentImages: attachmentSources,
        visualScales,
        hasTrails,
        profileId: profile,
        animationId: animation,
      }) => {
        window.__xsxbMcpImageCache ||= new Map();
        const load = (src) => {
          if (window.__xsxbMcpImageCache.has(src)) return window.__xsxbMcpImageCache.get(src);
          const pending = new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("image load failed"));
            image.src = src;
          });
          window.__xsxbMcpImageCache.set(src, pending);
          return pending;
        };
        const heroes = await Promise.all(frames.map((src) => load(src)));
        const loadedTextures = {};
        await Promise.all(
          Object.entries(textures).map(async ([key, src]) => {
            loadedTextures[key] = await load(src);
          }),
        );
        const loadedAttachments = {};
        await Promise.all(
          Object.entries(attachmentSources).map(async ([key, src]) => {
            loadedAttachments[key] = await load(src);
          }),
        );
        const width = heroes[0].width;
        const height = heroes[0].height;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        let selectedFrame = indexes[0] || 0;
        let selectedScale = 1;
        let elapsed = 0;
        const origin = { x: width / 2, y: height };
        const arrival = (frame, phase) => {
          const target = Math.min(
            Math.max(0, Math.round(Number(frame) || 0)),
            Math.max(0, frameDurations.length - 1),
          );
          let time = 0;
          for (let index = 0; index < target; index += 1) time += frameDurations[index] || 0;
          time += (frameDurations[target] || 1 / playbackFps) * Number(phase || 0);
          return time;
        };
        const editor = hasTrails
          ? new window.AttackTrailEditor({
              ctx,
              projectId: () => "export",
              projectKind: () => "godot",
              group: () => ({
                profileId: profile,
                animationId: animation,
                name: animation,
                runtimeAnimation: `${profile}/${animation}`,
              }),
              groups: () => [],
              selectedFrame: () => selectedFrame,
              currentImage: () => heroes[Math.max(0, indexes.indexOf(selectedFrame))],
              loadTexture: async (texture) =>
                loadedTextures[texture?.path] || loadedTextures[Object.keys(loadedTextures)[0]],
              frameArrival: arrival,
              animationElapsed: () => elapsed,
              animationTiming: () => {
                const total = frameDurations.reduce((sum, value) => sum + (value || 0), 0);
                return {
                  duration: total || heroes.length / playbackFps,
                  lastPlayableFrameStart: Math.max(0, total - (frameDurations.at(-1) || 1 / playbackFps)),
                };
              },
              localToScreen: (point) => ({
                x: origin.x + point.x * selectedScale,
                y: origin.y + point.y * selectedScale,
              }),
              screenToLocal: (point) => ({
                x: (point.x - origin.x) / selectedScale,
                y: (point.y - origin.y) / selectedScale,
              }),
              stagePoint: () => ({ x: 0, y: 0 }),
              dpr: () => 1,
              markDirty: () => {},
              pushUndo: () => {},
              draw: () => {},
              status: () => {},
              translate: (key) => key,
            })
          : null;
        if (editor) {
          editor.load(trails);
          editor.enabled = true;
          editor.gpuRenderer = null;
          for (const [key, image] of Object.entries(loadedTextures)) editor.images.set(key, image);
          await editor.prepareExport();
        }
        const drawAttachments = (layer) => {
          const matches = attachmentEntries
            .filter(
              (attachment) =>
                Number(attachment.frame) === selectedFrame &&
                (layer === "below"
                  ? attachment.layer === "below" || Number(attachment.layerOrder) < 0
                  : attachment.layer !== "below" && Number(attachment.layerOrder) >= 0),
            )
            .sort((left, right) => Number(left.layerOrder || 0) - Number(right.layerOrder || 0));
          for (const attachment of matches) {
            const image = loadedAttachments[attachment.absolutePath];
            if (!image) continue;
            const transform = attachment.transform || {};
            const scale = Number(transform.scale ?? 1);
            const scaleX = Number(transform.scaleX ?? scale) * selectedScale;
            const scaleY = Number(transform.scaleY ?? scale) * selectedScale;
            const offset = transform.offset || {};
            ctx.save();
            ctx.translate(
              origin.x + Number(offset.x || 0) * selectedScale,
              origin.y + Number(offset.y || 0) * selectedScale,
            );
            ctx.rotate((Number(transform.rotation || 0) * Math.PI) / 180);
            ctx.drawImage(
              image,
              (-image.width * scaleX) / 2,
              (-image.height * scaleY) / 2,
              image.width * scaleX,
              image.height * scaleY,
            );
            ctx.restore();
          }
        };
        const results = [];
        for (let index = 0; index < heroes.length; index += 1) {
          selectedFrame = indexes[index];
          selectedScale = Number(visualScales[index]) > 0 ? Number(visualScales[index]) : 1;
          elapsed = arrival(selectedFrame, 0.99);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, width, height);
          drawAttachments("below");
          editor?.drawLayer("behind", selectedFrame, 1);
          ctx.drawImage(heroes[index], 0, 0);
          drawAttachments("above");
          editor?.drawLayer("front", selectedFrame, 1);
          results.push(canvas.toDataURL("image/png"));
        }
        return results;
      },
      {
        trails: job.trails,
        frames: framePaths.map((filePath) => dataUrl(filePath)),
        frameIndexes,
        durations:
          durations.length >= Math.max(...frameIndexes) + 1 ? durations : framePaths.map(() => 1 / fps),
        fps,
        textureByPath,
        attachments,
        attachmentImages,
        visualScales: Array.isArray(job.visualScales) ? job.visualScales : framePaths.map(() => 1),
        hasTrails: segments.length > 0,
        profileId: profileId || "profile",
        animationId: animationId || "animation",
      },
    );
    const written = pngs.map((png, index) => {
      const filePath = path.join(tempDir, `frame_${String(index + 1).padStart(4, "0")}.png`);
      fs.writeFileSync(filePath, Buffer.from(String(png).split(",")[1], "base64"));
      return filePath;
    });
    return {
      framePaths: written,
      bakedTrails: segments.length > 0,
      trailIds,
      bakedAttachments: attachments.length > 0,
      attachmentIds,
      tempDir,
    };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`Failed to bake attack trails into the export: ${error.message}`);
  }
}

/**
 * Creates one lazy compositor session that reuses its browser and page.
 * @param {{launchBrowserImpl?:Function,idleMs?:number}} [options] Session options.
 * @returns {{composite:(job:object)=>Promise<object>,close:()=>Promise<void>,stats:{browserLaunches:number,uniqueAttachmentLoads:number}}} Session.
 */
function createCompositeSession(options = {}) {
  const launchBrowserImpl = options.launchBrowserImpl || launchPreviewBrowser;
  const idleMs = Number.isFinite(Number(options.idleMs)) ? Math.max(0, Number(options.idleMs)) : 1000;
  const stats = { browserLaunches: 0, uniqueAttachmentLoads: 0 };
  const attachmentSourceCache = new Map();
  let browser = null;
  let page = null;
  let idleTimer = null;

  async function close() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const activePage = page;
    const activeBrowser = browser;
    page = null;
    browser = null;
    if (activePage && !activePage.isClosed?.()) await activePage.close().catch(() => {});
    if (activeBrowser) await activeBrowser.close().catch(() => {});
  }

  function scheduleIdleClose() {
    if (!idleMs) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void close(), idleMs);
    idleTimer.unref?.();
  }

  async function ensurePage() {
    if (page && !page.isClosed?.() && browser?.isConnected?.() !== false) return page;
    await close();
    browser = await launchBrowserImpl();
    stats.browserLaunches += 1;
    page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    await page.addScriptTag({ path: EDITOR_SCRIPT });
    return page;
  }

  async function composite(job) {
    const attachments = Array.isArray(job?.attachments) ? job.attachments : [];
    const trails = usableTrailSegments(job?.trails, String(job?.bindingKey || ""));
    if (!attachments.length && !trails.length) {
      return {
        framePaths: Array.isArray(job?.framePaths) ? job.framePaths : [],
        bakedTrails: false,
        trailIds: [],
        bakedAttachments: false,
        attachmentIds: [],
        tempDir: null,
      };
    }
    const attachmentImageSources = {};
    for (const attachment of attachments) {
      const absolutePath = String(attachment?.absolutePath || "");
      if (absolutePath && !attachmentSourceCache.has(absolutePath)) {
        attachmentSourceCache.set(absolutePath, dataUrl(absolutePath));
        stats.uniqueAttachmentLoads += 1;
      }
      if (absolutePath) attachmentImageSources[absolutePath] = attachmentSourceCache.get(absolutePath);
    }
    const activePage = await ensurePage();
    try {
      return await compositeWithPage({ ...job, attachmentImageSources }, activePage);
    } finally {
      scheduleIdleClose();
    }
  }

  return { composite, close, stats };
}

/**
 * Backward-compatible one-shot compositor.
 * @param {object} job Composite job.
 * @returns {Promise<object>} Composite result.
 */
async function compositeAttackTrails(job) {
  const session = createCompositeSession({ idleMs: 0 });
  try {
    return await session.composite(job);
  } finally {
    await session.close();
  }
}

module.exports = {
  compositeAttackTrails,
  createCompositeSession,
  resolveTextureFile,
  usableTrailSegments,
};
