"use strict";

const defaultFs = require("node:fs");
const defaultPath = require("node:path");
const DEFAULT_GDSCRIPT_SKIP_DIRS = new Set([".git", ".godot", "addons", "node_modules", "_external_vfx"]);

/**
 * Creates project view and runtime-id synchronization operations.
 * @param {{root:string,projectStore:object,projectFromRequest:Function,emptyTuning:object,tuningForClient:Function,readManifest:Function,readTuningFile:Function,buildGroups:Function,validateProject:Function,profileForClient:Function,listSceneFiles:Function,readFrameAudioBindings:Function,readFrameImageAttachments:Function,readAttachmentAssets:Function,projectDataRevision:Function,relativeProjectPath?:(filePath:string,projectRoot:string)=>string,fs?:object,path?:object}} dependencies Project view dependencies.
 * @returns {{syncGodotRuntimeProjectId:Function,configResponse:Function,projectsResponse:Function}} Project view operations.
 */
function createProjectView(dependencies = {}) {
  const {
    root,
    projectStore,
    projectFromRequest,
    emptyTuning,
    tuningForClient,
    readManifest,
    readTuningFile,
    buildGroups,
    validateProject,
    profileForClient,
    listSceneFiles,
    readFrameAudioBindings,
    readFrameImageAttachments,
    readAttachmentAssets,
    projectDataRevision,
    relativeProjectPath: relativeProjectPathApi,
    fs: fsApi = defaultFs,
    path: pathApi = defaultPath,
  } = dependencies;
  const fs = fsApi;
  const path = pathApi;
  const GDSCRIPT_SKIP_DIRS = DEFAULT_GDSCRIPT_SKIP_DIRS;
  const relativeProjectPath =
    relativeProjectPathApi ||
    ((filePath, projectRoot) => path.relative(projectRoot, filePath).split(path.sep).join("/"));

  function syncGodotRuntimeProjectId(project) {
    const projectRoot = project?.projectRoot ? path.resolve(String(project.projectRoot)) : "";
    const projectId = String(project?.id || "");
    const changed = [];
    if (!projectRoot || !projectId || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory())
      return changed;

    const walk = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!GDSCRIPT_SKIP_DIRS.has(entry.name)) walk(fullPath);
          continue;
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".gd") continue;
        let text = "";
        try {
          text = fs.readFileSync(fullPath, "utf8");
        } catch {
          continue;
        }
        const next = text.replace(
          /(const\s+XSXB_PROJECT_ID\s*:\s*String\s*=\s*)"([^"]*)"/g,
          `$1"${projectId}"`,
        );
        if (next === text) continue;
        fs.writeFileSync(fullPath, next);
        changed.push(relativeProjectPath(fullPath, projectRoot));
      }
    };

    walk(projectRoot);
    return changed;
  }

  function configResponse(projectId) {
    const { registry, project } = projectFromRequest(projectId, { activate: true });
    if (!project) {
      return {
        root,
        workspaceRoot: path.join(root, "workspace"),
        workspaceAllRoot: path.join(root, "workspace"),
        projectRoot: "",
        activeProjectId: "",
        activeProject: null,
        projects: [],
        scenes: [],
        profiles: [],
        frameAudioBindings: [],
        frameImageAttachments: [],
        attachmentAssets: [],
        dataRevision: "",
        tuning: tuningForClient(emptyTuning),
        tuningDefaults: {},
        bossTuning: {},
        act2StatueBossTuning: {},
        act2StatueBossDefaults: {},
        huangXianTuning: {},
        huangXianDefaults: {},
        huangXianManifest: {},
        soulTuning: {},
        soulDefaults: {},
        soulManifest: {},
        yechengPropTuning: {},
        yechengPropDefaults: {},
        warnings: ["当前 tuner 没有项目。点击“导入动画”可从图片序列或视频创建本地项目。"],
        references: {
          playerCanonicalIdleHeight: 0,
          playerSpriteCenterX: 0,
          playerSpriteFootY: 0,
          playerFloorTopOffsetY: 0,
          bossFloorTopOffsetY: 0,
        },
        groups: [],
      };
    }
    const manifest = readManifest(project);
    const tuningFile = readTuningFile(project);
    const groups = buildGroups(manifest, tuningFile);
    const warnings = validateProject(project, manifest);
    if (!groups.length) {
      warnings.unshift("当前项目没有动画组。点击“导入动画”可导入 PNG 序列或本地视频。");
    }
    const projectClient = projectStore.projectForClient(project);
    return {
      root,
      workspaceRoot: projectStore.projectWorkspaceDir(project),
      workspaceAllRoot: path.join(root, "workspace"),
      projectRoot: project.projectRoot,
      activeProjectId: project.id,
      activeProject: projectClient,
      projects: registry.projects.map(projectStore.projectForClient),
      scenes: listSceneFiles(project.projectRoot),
      profiles: manifest.profiles.map(profileForClient),
      frameAudioBindings: readFrameAudioBindings(project),
      frameImageAttachments: readFrameImageAttachments(project),
      attachmentAssets: readAttachmentAssets(project),
      dataRevision: projectDataRevision(project),
      tuning: tuningForClient(tuningFile),
      tuningDefaults: {},
      bossTuning: {},
      act2StatueBossTuning: {},
      act2StatueBossDefaults: {},
      huangXianTuning: {},
      huangXianDefaults: {},
      huangXianManifest: {},
      soulTuning: {},
      soulDefaults: {},
      soulManifest: {},
      yechengPropTuning: {},
      yechengPropDefaults: {},
      warnings,
      references: {
        playerCanonicalIdleHeight: 0,
        playerSpriteCenterX: 0,
        playerSpriteFootY: 0,
        playerFloorTopOffsetY: 0,
        bossFloorTopOffsetY: 0,
      },
      groups,
    };
  }

  function projectsResponse() {
    const registry = projectStore.readRegistry();
    return {
      activeProjectId: registry.activeProjectId,
      projects: registry.projects.map(projectStore.projectForClient),
    };
  }

  return { syncGodotRuntimeProjectId, configResponse, projectsResponse };
}

module.exports = { createProjectView };
