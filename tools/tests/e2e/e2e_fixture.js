"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ensureCodexPetsProject } = require("../../codex_pets");
const { createProjectStore } = require("../../project_store");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);
const DEFAULT_E2E_ROOT = path.join(os.tmpdir(), "x-frame-e2e");
const TRASH_DIRECTORY = ".reset-trash";
let retiredCount = 0;

/**
 * Writes JSON fixture data with the same formatting as the production store.
 * @param {string} filePath Destination path.
 * @param {unknown} value Serializable fixture value.
 * @returns {void}
 */
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Seeds one editable animation while keeping all writes inside the given root.
 * @param {string} fixtureRoot Isolated workspace root.
 * @returns {void}
 */
function seedFixtureRoot(fixtureRoot) {
  const projectId = "seed-project";
  const dataDirectory = path.join(fixtureRoot, "data", "projects", projectId);
  const animationDirectory = path.join(
    fixtureRoot,
    "workspace",
    "projects",
    projectId,
    "assets",
    "hero",
    "idle",
  );
  fs.mkdirSync(animationDirectory, { recursive: true });
  fs.writeFileSync(path.join(animationDirectory, "frame_0001.png"), ONE_PIXEL_PNG);
  fs.writeFileSync(path.join(animationDirectory, "frame_0002.png"), ONE_PIXEL_PNG);
  writeJson(path.join(fixtureRoot, "data", "projects.json"), {
    schemaVersion: 1,
    activeProjectId: projectId,
    projects: [
      {
        id: projectId,
        label: "E2E Seed Project",
        projectRoot: "",
        dataDir: `data/projects/${projectId}`,
        workspaceDir: `workspace/projects/${projectId}`,
      },
    ],
  });
  writeJson(path.join(dataDirectory, "animation_manifest.json"), {
    schemaVersion: 1,
    profiles: [
      {
        id: "hero",
        label: "Hero",
        kind: "actor",
        bodyScale: 1,
        runtimeScale: 1,
        supports: [
          "character_transform",
          "group_transform",
          "frame_transform",
          "frame_playback",
          "frame_boxes",
          "reference_frame",
        ],
        animations: [
          {
            id: "idle",
            name: "Idle",
            type: "actor",
            anchorMode: "canvas_bottom_center",
            fps: 12,
            source: `workspace/projects/${projectId}/assets/hero/idle`,
            frames: [1, 2].map((number) => ({
              id: `frame_${String(number).padStart(4, "0")}`,
              name: `frame_${String(number).padStart(4, "0")}.png`,
              path: `workspace/projects/${projectId}/assets/hero/idle/frame_${String(number).padStart(4, "0")}.png`,
              duration: 1,
              width: 1,
              height: 1,
            })),
          },
        ],
      },
    ],
  });
  writeJson(path.join(dataDirectory, "animation_tuning.json"), {
    schemaVersion: 1,
    values: {},
    scene_settings: {},
    frame_visual_overrides: {},
    frame_playback_overrides: {},
    frame_box_overrides: {},
  });
  writeJson(path.join(dataDirectory, "frame_audio_bindings.json"), {});
  writeJson(path.join(dataDirectory, "frame_image_attachments.json"), []);
  writeJson(path.join(dataDirectory, "attachment_assets.json"), []);
}

/**
 * Wipes leftover projects and restores the deterministic seed workspace.
 * @param {string} fixtureRoot Isolated workspace root.
 * @returns {void}
 */
function resetFixtureRoot(fixtureRoot) {
  const trashRoot = path.join(fixtureRoot, TRASH_DIRECTORY);
  // The seed project is retired like every other project: animations imported by
  // a previous test would otherwise survive and collide with identically named
  // imports later in the run.
  for (const kind of ["data", "workspace"]) {
    const parent = path.join(fixtureRoot, kind, "projects");
    if (!fs.existsSync(parent)) continue;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      retireDirectory(path.join(parent, entry.name), trashRoot);
    }
  }
  // The registry is overwritten rather than unlinked: a missing projects.json
  // makes any in-flight request crash the server process.
  seedFixtureRoot(fixtureRoot);
  assertSeedOnly(fixtureRoot);
  purgeTrash(trashRoot);
}

/**
 * Renames a project directory out of the way instead of deleting it in place.
 * The server can still be flushing the previous test's writes, and an in-place
 * recursive delete then fails with ENOTEMPTY no matter how often it retries.
 * @param {string} target Directory to retire.
 * @param {string} trashRoot Directory that collects retired trees.
 * @returns {void}
 */
function retireDirectory(target, trashRoot) {
  fs.mkdirSync(trashRoot, { recursive: true });
  fs.renameSync(target, path.join(trashRoot, `${Date.now()}-${retiredCount}`));
  retiredCount += 1;
}

/**
 * Deletes retired trees on a best-effort basis; whatever is still busy now is
 * simply collected by a later reset.
 * @param {string} trashRoot Directory that collects retired trees.
 * @returns {void}
 */
function purgeTrash(trashRoot) {
  if (!fs.existsSync(trashRoot)) return;
  for (const entry of fs.readdirSync(trashRoot)) {
    try {
      fs.rmSync(path.join(trashRoot, entry), { recursive: true, force: true });
    } catch {
      // A retired tree that is still being written to is dropped next time.
    }
  }
}

/**
 * Fails loudly when a reset leaves assets behind, because a partial reset turns
 * into confusing "asset folder already exists" errors much later in the run.
 * @param {string} fixtureRoot Isolated workspace root.
 * @returns {void}
 */
function assertSeedOnly(fixtureRoot) {
  const assets = path.join(fixtureRoot, "workspace", "projects", "seed-project", "assets");
  const animations = fs
    .readdirSync(assets)
    .flatMap((profile) =>
      fs.readdirSync(path.join(assets, profile)).map((animation) => `${profile}/${animation}`),
    );
  if (animations.length === 1 && animations[0] === "hero/idle") return;
  throw new Error(`E2E workspace reset left stale animations behind: ${animations.join(", ")}`);
}

/**
 * Restores the E2E workspace to the same state the Playwright server starts with.
 * @param {string} fixtureRoot Isolated workspace root.
 * @returns {void}
 */
function resetE2EWorkspace(fixtureRoot) {
  resetFixtureRoot(fixtureRoot);
  ensureCodexPetsProject(createProjectStore(fixtureRoot));
}

/**
 * Resolves the shared E2E workspace root used by the Playwright server and tests.
 * @returns {string} Absolute fixture root.
 */
function resolveE2ERoot() {
  return process.env.XSXB_E2E_ROOT || DEFAULT_E2E_ROOT;
}

module.exports = {
  DEFAULT_E2E_ROOT,
  ONE_PIXEL_PNG,
  resetE2EWorkspace,
  resetFixtureRoot,
  resolveE2ERoot,
  seedFixtureRoot,
};
