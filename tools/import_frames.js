const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { EMPTY_ATTACK_TRAILS, normalizeAttackTrails } = require("./attack_trails");
const { stripAnimationOwnedData } = require("./animation_mutations");
const {
  EMPTY_MANIFEST,
  EMPTY_TUNING,
  createProjectStore,
  godotProjectName,
  requireFps,
  slug,
} = require("./project_store");
const { syncGodotProject } = require("./godot_sync");
const { upsertEstimatedFrameBoxes } = require("./box_estimator");
const { ensureInitialCharacterScale } = require("./import_scale");

const ROOT = path.resolve(__dirname, "..");
const projectStore = createProjectStore(ROOT);

function usage() {
  console.log(`Usage:
node tools/import_frames.js --profile <id> --animation <id> --source <png_folder> [--project <id>] [--project-root <godot_project_root>] [--label <name>] [--fps 12] [--type actor] [--anchor canvas_bottom_center|canvas_left_bottom] [--replace]
`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "replace") {
      args.replace = true;
    } else {
      args[key] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Creates a detached JSON-compatible copy for rollback.
 * @param {unknown} value Source value.
 * @returns {unknown} Cloned value.
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return { width: 0, height: 0 };
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function ensureProfile(manifest, profileId, label) {
  manifest.profiles = Array.isArray(manifest.profiles) ? manifest.profiles : [];
  let profile = manifest.profiles.find((entry) => entry.id === profileId);
  if (!profile) {
    profile = {
      id: profileId,
      label: label || profileId,
      kind: "actor",
      bodyScale: 1,
      runtimeScale: 1,
      animations: [],
    };
    manifest.profiles.push(profile);
  }
  profile.animations = Array.isArray(profile.animations) ? profile.animations : [];
  return profile;
}

function samePath(left, right) {
  if (!left || !right) return false;
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function projectForImport(args, store = projectStore) {
  let registry = store.readRegistry();
  let projectRoot = String(args["project-root"] || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (projectRoot) {
    projectRoot = path.resolve(projectRoot);
    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
      throw new Error(`Project root not found: ${projectRoot}`);
    }
  }
  if (projectRoot && !args.project) {
    const existingByRoot = registry.projects.find((entry) => samePath(entry.projectRoot, projectRoot));
    if (existingByRoot) return existingByRoot;
    const label = godotProjectName(projectRoot) || path.basename(projectRoot);
    registry = store.addProject({ label, projectRoot });
    const project = registry.projects.find((entry) => entry.id === registry.activeProjectId);
    if (!project) throw new Error(`Project not found after adding ${label}`);
    return project;
  }

  const requestedId = args.project ? slug(args.project) : registry.activeProjectId;
  let project = registry.projects.find((entry) => entry.id === requestedId);
  if (!project && (args.project || projectRoot)) {
    registry = store.addProject({
      id: args.project ? requestedId : path.basename(projectRoot),
      label: args.project || path.basename(projectRoot),
      projectRoot,
    });
    project = registry.projects.find((entry) => entry.id === registry.activeProjectId);
  }
  if (!project) throw new Error(`Project not found: ${requestedId}`);

  if (projectRoot && project.projectRoot && !samePath(project.projectRoot, projectRoot)) {
    throw new Error(
      `Project id "${project.id}" is already bound to ${project.projectRoot}. Use a different --project id for ${projectRoot}.`,
    );
  }

  if (projectRoot && !project.projectRoot) {
    project.projectRoot = projectRoot;
    registry.activeProjectId = project.id;
    registry = store.writeRegistry(registry);
    project = registry.projects.find((entry) => entry.id === registry.activeProjectId);
  }
  return project;
}

/**
 * Imports a PNG folder as one animation.
 * @param {object} args Parsed CLI arguments.
 * @param {{root?:string,projectStore?:object,quiet?:boolean}} [options] Optional store injection.
 * @returns {{projectId:string,profileId:string,animationId:string,fps:number,frameCount:number,replaced:boolean}}
 * Import result.
 */
function importFrames(args, options = {}) {
  const root = options.root || ROOT;
  const store = options.projectStore || projectStore;
  const sourceDir = path.resolve(args.source);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Source folder not found: ${sourceDir}`);
  }

  const pngs = fs
    .readdirSync(sourceDir)
    .filter((name) => path.extname(name).toLowerCase() === ".png")
    .sort(naturalSort);
  if (!pngs.length) throw new Error(`No PNG files found in ${sourceDir}`);
  const fps = requireFps(args.fps);

  const project = projectForImport(args, store);
  const paths = store.projectPaths(project);
  const workspaceAssets = path.join(paths.workspaceDir, "assets");
  const profileId = slug(args.profile);
  const animationId = slug(args.animation);
  const targetDir = path.join(workspaceAssets, profileId, animationId);
  const operationId = crypto.randomBytes(8).toString("hex");
  const stagingDir = `${targetDir}.import-${operationId}`;
  const backupDir = `${targetDir}.backup-${operationId}`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const frameFiles = [];
  const manifest = store.readJson(paths.manifest, EMPTY_MANIFEST);
  const tuning = store.readJson(paths.tuning, EMPTY_TUNING);
  const audioBindings = store.readJson(paths.frameAudio, []);
  const imageAttachments = store.readJson(paths.frameImageAttachments, []);
  const attachmentAssets = store.readJson(paths.attachmentAssets, []);
  const attackTrails = normalizeAttackTrails(store.readJson(paths.attackTrails, EMPTY_ATTACK_TRAILS));
  const originals = {
    manifest: clone(manifest),
    tuning: clone(tuning),
    frameAudio: clone(audioBindings),
    frameImageAttachments: clone(imageAttachments),
    attachmentAssets: clone(attachmentAssets),
    attackTrails: clone(attackTrails),
  };
  const profile = ensureProfile(manifest, profileId, args.label || args.profile);
  const existingIndex = profile.animations.findIndex((entry) => entry.id === animationId);
  if (existingIndex >= 0 && !args.replace) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw new Error(`Animation already exists: ${profileId}/${animationId}. Pass --replace to replace it.`);
  }
  let nextAudio = audioBindings;
  let nextAttachments = imageAttachments;
  let nextAssets = attachmentAssets;
  let nextTrails = attackTrails;
  if (existingIndex >= 0 && args.replace) {
    const stripped = stripAnimationOwnedData({
      tuning,
      audioBindings,
      imageAttachments,
      attachmentAssets,
      attackTrails,
      profile,
      animation: profile.animations[existingIndex],
    });
    tuning.frame_visual_overrides = stripped.tuning.frame_visual_overrides;
    tuning.frame_playback_overrides = stripped.tuning.frame_playback_overrides;
    tuning.frame_box_overrides = stripped.tuning.frame_box_overrides;
    tuning.values = stripped.tuning.values;
    nextAudio = stripped.frameAudioBindings;
    nextAttachments = stripped.frameImageAttachments;
    nextAssets = stripped.attachmentAssets;
    nextTrails = stripped.attackTrails;
  }
  let frames;
  try {
    frames = pngs.map((name, index) => {
      const frameName = `frame_${String(index + 1).padStart(4, "0")}.png`;
      const source = path.join(sourceDir, name);
      const stagingPath = path.join(stagingDir, frameName);
      const finalPath = path.join(targetDir, frameName);
      fs.copyFileSync(source, stagingPath);
      frameFiles.push(stagingPath);
      const size = getPngSize(stagingPath);
      if (size.width < 1 || size.height < 1) throw new Error(`Invalid PNG frame: ${source}`);
      return {
        id: `frame_${String(index + 1).padStart(4, "0")}`,
        name: frameName,
        path: path.relative(root, finalPath).replaceAll("\\", "/"),
        duration: 1,
        ...size,
      };
    });
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
  const animation = {
    id: animationId,
    name: args.animation,
    type: args.type || "actor",
    anchorMode: args.anchor || "canvas_bottom_center",
    fps,
    source: path.relative(root, targetDir).replaceAll("\\", "/"),
    frames,
  };
  if (existingIndex >= 0) profile.animations[existingIndex] = animation;
  else profile.animations.push(animation);

  const scaleResult = ensureInitialCharacterScale(
    tuning,
    profileId,
    project.projectRoot,
    frameFiles.map((filePath) => ({ filePath, animationId, animationName: args.animation })),
  );
  upsertEstimatedFrameBoxes(tuning, profileId, animation, frameFiles, {
    replace: args.replace || existingIndex < 0,
  });
  let backupCreated = false;
  let directoryInstalled = false;
  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir);
      backupCreated = true;
    }
    fs.renameSync(stagingDir, targetDir);
    directoryInstalled = true;
    store.writeJson(paths.manifest, manifest);
    store.writeJson(paths.tuning, tuning);
    store.writeJson(paths.frameAudio, nextAudio);
    store.writeJson(paths.frameImageAttachments, nextAttachments);
    store.writeJson(paths.attachmentAssets, nextAssets);
    store.writeJson(paths.attackTrails, nextTrails);
  } catch (error) {
    if (directoryInstalled && fs.existsSync(targetDir))
      fs.rmSync(targetDir, { recursive: true, force: true });
    if (backupCreated && fs.existsSync(backupDir)) fs.renameSync(backupDir, targetDir);
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    store.writeJson(paths.manifest, originals.manifest);
    store.writeJson(paths.tuning, originals.tuning);
    store.writeJson(paths.frameAudio, originals.frameAudio);
    store.writeJson(paths.frameImageAttachments, originals.frameImageAttachments);
    store.writeJson(paths.attachmentAssets, originals.attachmentAssets);
    store.writeJson(paths.attackTrails, originals.attackTrails);
    throw error;
  }
  if (backupCreated) {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not remove import backup ${backupDir}: ${error.message}`);
    }
  }
  const godotSync = syncGodotProject(root, store, project, { manifest, tuning });
  if (!options.quiet) {
    console.log(`Imported ${frames.length} frames`);
    console.log(`Project: ${project.id}`);
    console.log(`Profile: ${profileId}`);
    console.log(`Animation: ${animationId}`);
    console.log(`Target: ${path.relative(root, targetDir)}`);
    if (scaleResult.changed) {
      console.log(`Initial scale: ${scaleResult.scale}`);
    }
    if (godotSync.ok) {
      console.log(
        `Godot assets: ${godotSync.copiedFrames}/${godotSync.frameCount} frames synced to ${godotSync.assetRoot}`,
      );
    }
  }
  return {
    projectId: project.id,
    profileId,
    animationId,
    fps,
    frameCount: frames.length,
    replaced: existingIndex >= 0,
    targetDirectory: targetDir,
    godotSync,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.profile || !args.animation || !args.source) {
    usage();
    process.exit(1);
  }
  importFrames(args);
}

if (require.main === module) {
  main();
}

module.exports = { importFrames, parseArgs };
