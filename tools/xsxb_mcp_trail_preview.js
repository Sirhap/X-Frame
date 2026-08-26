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
async function compositeAttackTrails(job) {
  const framePaths = Array.isArray(job.framePaths) ? job.framePaths : [];
  const bindingKey = String(job.bindingKey || "");
  const segments = usableTrailSegments(job.trails, bindingKey);
  const trailIds = segments.map((segment) => String(segment.id));
  if (!framePaths.length || !segments.length) {
    return { framePaths, bakedTrails: false, trailIds: [], tempDir: null };
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
  if (!fs.existsSync(EDITOR_SCRIPT)) {
    throw new Error(`AttackTrailEditor script is missing: ${EDITOR_SCRIPT}`);
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-trail-preview-"));
  let browser;
  try {
    browser = await launchPreviewBrowser();
    const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    await page.addScriptTag({ path: EDITOR_SCRIPT });
    const pngs = await page.evaluate(
      async ({
        trails,
        frames,
        frameIndexes: indexes,
        durations: frameDurations,
        fps: playbackFps,
        textureByPath: textures,
        profileId: profile,
        animationId: animation,
      }) => {
        const load = (src) =>
          new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("image load failed"));
            image.src = src;
          });
        const heroes = await Promise.all(frames.map((src) => load(src)));
        const loadedTextures = {};
        await Promise.all(
          Object.entries(textures).map(async ([key, src]) => {
            loadedTextures[key] = await load(src);
          }),
        );
        const width = heroes[0].width;
        const height = heroes[0].height;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        let selectedFrame = indexes[0] || 0;
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
        const editor = new window.AttackTrailEditor({
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
          localToScreen: (point) => ({ x: origin.x + point.x, y: origin.y + point.y }),
          screenToLocal: (point) => ({ x: point.x - origin.x, y: point.y - origin.y }),
          stagePoint: () => ({ x: 0, y: 0 }),
          dpr: () => 1,
          markDirty: () => {},
          pushUndo: () => {},
          draw: () => {},
          status: () => {},
          translate: (key) => key,
        });
        editor.load(trails);
        editor.enabled = true;
        editor.gpuRenderer = null;
        for (const [key, image] of Object.entries(loadedTextures)) editor.images.set(key, image);
        await editor.prepareExport();
        const results = [];
        for (let index = 0; index < heroes.length; index += 1) {
          selectedFrame = indexes[index];
          elapsed = arrival(selectedFrame, 0.99);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, width, height);
          editor.drawLayer("behind", selectedFrame, 1);
          ctx.drawImage(heroes[index], 0, 0);
          editor.drawLayer("front", selectedFrame, 1);
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
        profileId: profileId || "profile",
        animationId: animationId || "animation",
      },
    );
    const written = pngs.map((png, index) => {
      const filePath = path.join(tempDir, `frame_${String(index + 1).padStart(4, "0")}.png`);
      fs.writeFileSync(filePath, Buffer.from(String(png).split(",")[1], "base64"));
      return filePath;
    });
    return { framePaths: written, bakedTrails: true, trailIds, tempDir };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`Failed to bake attack trails into the export: ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = {
  compositeAttackTrails,
  resolveTextureFile,
  usableTrailSegments,
};
