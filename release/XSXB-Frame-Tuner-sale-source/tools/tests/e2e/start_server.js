"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=",
  "base64",
);
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-frame-tuner-e2e-"));
let cleaned = false;

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
 * Removes the isolated E2E root after Playwright stops its web server.
 * @returns {void}
 */
function cleanupFixtureRoot() {
  if (cleaned) return;
  cleaned = true;
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

/**
 * Seeds one editable animation while keeping all writes outside the repository.
 * @returns {void}
 */
function seedFixtureRoot() {
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

seedFixtureRoot();
process.env.XSXB_ROOT = fixtureRoot;
process.on("exit", cleanupFixtureRoot);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

require("../../animation_tuner/server");
