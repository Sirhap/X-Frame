const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { EMPTY_MANIFEST, EMPTY_TUNING, createProjectStore, godotProjectName, slug } = require("./project_store");
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

function projectForImport(args) {
  let registry = projectStore.readRegistry();
  let projectRoot = String(args["project-root"] || "").trim().replace(/^["']|["']$/g, "");
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
    registry = projectStore.addProject({ label, projectRoot });
    const project = registry.projects.find((entry) => entry.id === registry.activeProjectId);
    if (!project) throw new Error(`Project not found after adding ${label}`);
    return project;
  }

  const requestedId = args.project ? slug(args.project) : registry.activeProjectId;
  let project = registry.projects.find((entry) => entry.id === requestedId);
  if (!project && (args.project || projectRoot)) {
    registry = projectStore.addProject({
      id: args.project ? requestedId : path.basename(projectRoot),
      label: args.project || path.basename(projectRoot),
      projectRoot,
    });
    project = registry.projects.find((entry) => entry.id === registry.activeProjectId);
  }
  if (!project) throw new Error(`Project not found: ${requestedId}`);

  if (projectRoot && project.projectRoot && !samePath(project.projectRoot, projectRoot)) {
    throw new Error(`Project id "${project.id}" is already bound to ${project.projectRoot}. Use a different --project id for ${projectRoot}.`);
  }

  if (projectRoot && !project.projectRoot) {
    project.projectRoot = projectRoot;
    registry.activeProjectId = project.id;
    registry = projectStore.writeRegistry(registry);
    project = registry.projects.find((entry) => entry.id === registry.activeProjectId);
  }
  return project;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.profile || !args.animation || !args.source) {
    usage();
    process.exit(1);
  }

  const sourceDir = path.resolve(args.source);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Source folder not found: ${sourceDir}`);
  }

  const pngs = fs.readdirSync(sourceDir)
    .filter((name) => path.extname(name).toLowerCase() === ".png")
    .sort(naturalSort);
  if (!pngs.length) throw new Error(`No PNG files found in ${sourceDir}`);

  const project = projectForImport(args);
  const paths = projectStore.projectPaths(project);
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
  const manifest = projectStore.readJson(paths.manifest, EMPTY_MANIFEST);
  const tuning = projectStore.readJson(paths.tuning, EMPTY_TUNING);
  const originals = {
    manifest: clone(manifest),
    tuning: clone(tuning),
  };
  const profile = ensureProfile(manifest, profileId, args.label || args.profile);
  const existingIndex = profile.animations.findIndex((entry) => entry.id === animationId);
  if (existingIndex >= 0 && !args.replace) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw new Error(`Animation already exists: ${profileId}/${animationId}. Pass --replace to replace it.`);
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
        path: path.relative(ROOT, finalPath).replaceAll("\\", "/"),
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
    fps: Number(args.fps || 12),
    source: path.relative(ROOT, targetDir).replaceAll("\\", "/"),
    frames,
  };
  if (existingIndex >= 0) profile.animations[existingIndex] = animation;
  else profile.animations.push(animation);

  const scaleResult = ensureInitialCharacterScale(
    tuning,
    profileId,
    project.projectRoot,
    frameFiles.map((filePath) => ({ filePath, animationId, animationName: args.animation }))
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
    projectStore.writeJson(paths.manifest, manifest);
    projectStore.writeJson(paths.tuning, tuning);
  } catch (error) {
    if (directoryInstalled && fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    if (backupCreated && fs.existsSync(backupDir)) fs.renameSync(backupDir, targetDir);
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    projectStore.writeJson(paths.manifest, originals.manifest);
    projectStore.writeJson(paths.tuning, originals.tuning);
    throw error;
  }
  if (backupCreated) {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not remove import backup ${backupDir}: ${error.message}`);
    }
  }
  const godotSync = syncGodotProject(ROOT, projectStore, project, { manifest, tuning });
  console.log(`Imported ${frames.length} frames`);
  console.log(`Project: ${project.id}`);
  console.log(`Profile: ${profileId}`);
  console.log(`Animation: ${animationId}`);
  console.log(`Target: ${path.relative(ROOT, targetDir)}`);
  if (scaleResult.changed) {
    console.log(`Initial scale: ${scaleResult.scale}`);
  }
  if (godotSync.ok) {
    console.log(`Godot assets: ${godotSync.copiedFrames}/${godotSync.frameCount} frames synced to ${godotSync.assetRoot}`);
  }
}

main();
