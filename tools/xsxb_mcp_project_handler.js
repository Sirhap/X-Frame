"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { EMPTY_ATTACK_TRAILS, normalizeAttackTrails } = require("./attack_trails");
const { EMPTY_TUNING, slug } = require("./project_store");
const { booleanFlag } = require("./xsxb_mcp_arguments");

/**
 * Creates project lifecycle and filtered Godot-sync handlers.
 * @param {{projectStore:object,context:object,registryProject:Function,manifestFor:Function,synchronize:Function,readSfxBindings:Function,attachmentFrameForSelection:Function}} dependencies Service dependencies.
 * @returns {{createProject:(args?:object)=>object,syncGodot:(args?:object)=>Promise<object>}} Project handlers.
 */
function createProjectHandlers(dependencies) {
  const {
    projectStore,
    context,
    registryProject,
    manifestFor,
    synchronize,
    readSfxBindings,
    attachmentFrameForSelection,
  } = dependencies;

  /**
   * Creates an empty local project without requiring a Godot binding.
   * @param {object} args MCP arguments.
   * @returns {object} Project creation receipt.
   */
  function createProject(args = {}) {
    const registry = projectStore.readRegistry();
    const label = String(args.label || args.id || "New Project").trim() || "New Project";
    const baseId = slug(args.id || label, "project");
    const usedIds = new Set(registry.projects.map((project) => String(project.id)));
    let projectId = baseId;
    let suffix = 2;
    while (usedIds.has(projectId)) {
      projectId = `${baseId}_${suffix}`;
      suffix += 1;
    }
    const kind = slug(args.kind || "godot", "godot");
    const projectRoot = String(args.project_root || "").trim();
    if (projectRoot) {
      const absoluteRoot = path.resolve(projectRoot);
      if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
        throw new Error(`Project folder not found: ${absoluteRoot}`);
      }
    }
    const preview = {
      id: projectId,
      label: label.slice(0, 80),
      kind,
      projectRoot: projectRoot ? path.resolve(projectRoot) : "",
      dataDir: `data/projects/${projectId}`,
      workspaceDir: `workspace/projects/${projectId}`,
    };
    if (booleanFlag(args.dry_run)) {
      return { projectId, created: false, dryRun: true, project: preview };
    }
    const written = projectStore.addProject({
      id: projectId,
      label: preview.label,
      kind,
      projectRoot: preview.projectRoot,
    });
    const project = written.projects.find((entry) => entry.id === written.activeProjectId);
    context.projectId = project.id;
    context.profileId = "";
    context.animationId = "";
    return {
      projectId: project.id,
      created: true,
      dryRun: false,
      activeProjectId: written.activeProjectId,
      project: projectStore.projectForClient(project),
    };
  }

  /**
   * Builds one profile/animation inventory from a manifest.
   * @param {object} manifest Project manifest.
   * @returns {Array<{profileId:string,animationId:string,frameCount:number}>} Inventory.
   */
  function animationInventory(manifest) {
    return (manifest.profiles || []).flatMap((profile) =>
      (profile.animations || []).map((animation) => ({
        profileId: String(profile.id),
        animationId: String(animation.id || animation.name),
        frameCount: Array.isArray(animation.frames) ? animation.frames.length : 0,
      })),
    );
  }

  /**
   * Synchronizes either the complete project or an explicit reviewed animation subset.
   * @param {object} args MCP arguments.
   * @returns {Promise<object>} Sync or dry-run receipt.
   */
  async function syncGodot(args = {}) {
    const dryRun = booleanFlag(args.dry_run);
    const project = registryProject(args.project_id || args.project, !dryRun);
    const manifest = manifestFor(project);
    const inventory = animationInventory(manifest);
    const availableAnimationIds = inventory.map((entry) => entry.animationId);
    if (dryRun) {
      return {
        projectId: project.id,
        requested: false,
        dryRun: true,
        availableAnimationIds,
        animations: inventory,
      };
    }
    const requestedIds = Array.isArray(args.include_animation_ids)
      ? [...new Set(args.include_animation_ids.map((value) => String(value).trim()).filter(Boolean))]
      : [];
    const selected = requestedIds.length
      ? inventory.filter(
          (entry) =>
            requestedIds.includes(entry.animationId) ||
            requestedIds.includes(`${entry.profileId}/${entry.animationId}`),
        )
      : inventory;
    const unknown = requestedIds.filter(
      (id) =>
        !inventory.some(
          (entry) => id === entry.animationId || id === `${entry.profileId}/${entry.animationId}`,
        ),
    );
    if (unknown.length) throw new Error(`Animation not found for Godot sync: ${unknown.join(", ")}`);
    const selectedKeys = new Set(selected.map((entry) => `${entry.profileId}/${entry.animationId}`));
    const options = { force: booleanFlag(args.force) };
    if (requestedIds.length) {
      const paths = projectStore.projectPaths(project);
      options.manifest = filterManifest(manifest, selectedKeys);
      options.tuning = filterTuning(
        structuredClone(projectStore.readJson(paths.tuning, EMPTY_TUNING)),
        selectedKeys,
      );
      options.frameAudioBindings = readSfxBindings(paths).filter((binding) =>
        [...selectedKeys].some((bindingKey) => String(binding.key || "").startsWith(`${bindingKey}:`)),
      );
      const selectedAnimations = (manifest.profiles || []).flatMap((profile) =>
        (profile.animations || [])
          .filter((animation) => selectedKeys.has(`${profile.id}/${animation.id || animation.name}`))
          .map((animation) => ({ project, profile, animation })),
      );
      const attachments = projectStore.readJson(paths.frameImageAttachments, []);
      options.frameImageAttachments = (Array.isArray(attachments) ? attachments : []).filter((attachment) =>
        selectedAnimations.some((selection) => attachmentFrameForSelection(attachment, selection) !== null),
      );
      const trails = normalizeAttackTrails(projectStore.readJson(paths.attackTrails, EMPTY_ATTACK_TRAILS));
      trails.bindings = Object.fromEntries(
        Object.entries(trails.bindings).filter(([bindingKey]) => selectedKeys.has(bindingKey)),
      );
      options.attackTrails = trails;
    }
    return {
      projectId: project.id,
      force: booleanFlag(args.force),
      dryRun: false,
      includedAnimationIds: selected.map((entry) => entry.animationId),
      availableAnimationIds,
      ...synchronize(project, true, options),
    };
  }

  return { createProject, syncGodot };
}

/**
 * Keeps only the animations selected for delivery.
 * @param {object} manifest Source manifest.
 * @param {Set<string>} selectedKeys profile/animation keys.
 * @returns {object} Filtered clone.
 */
function filterManifest(manifest, selectedKeys) {
  const filtered = structuredClone(manifest);
  filtered.profiles = (filtered.profiles || [])
    .map((profile) => ({
      ...profile,
      animations: (profile.animations || []).filter((animation) =>
        selectedKeys.has(`${profile.id}/${animation.id || animation.name}`),
      ),
    }))
    .filter((profile) => profile.animations.length);
  return filtered;
}

/**
 * Removes animation-owned tuning records that are outside the delivery subset.
 * @param {object} tuning Source tuning clone.
 * @param {Set<string>} selectedKeys profile/animation keys.
 * @returns {object} Filtered tuning.
 */
function filterTuning(tuning, selectedKeys) {
  for (const field of ["frame_visual_overrides", "frame_playback_overrides", "frame_box_overrides"]) {
    tuning[field] = Object.fromEntries(
      Object.entries(tuning[field] || {}).filter(([key]) =>
        [...selectedKeys].some((bindingKey) => key.startsWith(`${bindingKey}:`)),
      ),
    );
  }
  tuning.values = Object.fromEntries(
    Object.entries(tuning.values || {}).filter(([key]) => {
      const groupMatch = /^profiles\.([^.]+)\.groups\.([^.]+)\./u.exec(key);
      return !groupMatch || selectedKeys.has(`${groupMatch[1]}/${groupMatch[2]}`);
    }),
  );
  return tuning;
}

module.exports = { createProjectHandlers, filterManifest, filterTuning };
