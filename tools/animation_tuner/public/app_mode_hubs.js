(function attachXFrameModeHubs(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameModeHubs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /** Same cap as 导入设置 → 角色名称 maxlength. */
  const MAX_NAME_LENGTH = 80;

  /**
   * Trims a project label and drops characters past the shared name cap.
   * Empty/whitespace-only input stays empty so callers can reject it.
   * @param {unknown} label Raw prompt or form value.
   * @returns {string} Persistable label, or "" when the name is missing.
   */
  function normalizeProjectName(label) {
    return String(label || "")
      .trim()
      .slice(0, MAX_NAME_LENGTH);
  }

  /**
   * Summarizes current-animation and whole-project delivery scopes without mutating project state.
   * @param {object|null} config Active project configuration.
   * @param {string|object|null} activeGroup Active group identifier or group object.
   * @returns {{currentAnimationName:string,currentFrameCount:number,currentAssetRevision:number,projectAnimationCount:number,projectFrameCount:number}}
   */
  function summarizeDeliveryScope(config, activeGroup) {
    const groups = Array.isArray(config?.groups) ? config.groups : [];
    const current =
      activeGroup && typeof activeGroup === "object"
        ? activeGroup
        : groups.find((group) =>
            [group?.id, group?.uiId, group?.animationId].filter(Boolean).includes(activeGroup),
          ) || null;
    const currentFrames = Array.isArray(current?.frames) ? current.frames : [];
    return {
      currentAnimationName: String(current?.name || current?.label || current?.animationId || "—"),
      currentFrameCount: currentFrames.length,
      currentAssetRevision: Math.max(0, ...currentFrames.map((frame) => Number(frame?.assetRevision) || 0)),
      projectAnimationCount: groups.filter((group) => Array.isArray(group?.frames) && group.frames.length)
        .length,
      projectFrameCount: groups.reduce(
        (count, group) => count + (Array.isArray(group?.frames) ? group.frames.length : 0),
        0,
      ),
    };
  }

  /**
   * Converts project delivery capabilities into concise UI-ready readiness states.
   * @param {object|null} config Active project configuration.
   * @param {{browserOnly?:boolean}} [options] Runtime capability flags.
   */
  function summarizeDeliveryReadiness(config, options = {}) {
    const handoff =
      config?.godotHandoff && typeof config.godotHandoff === "object"
        ? config.godotHandoff
        : { state: "local_only" };
    const godotState = options.browserOnly ? "local_only" : String(handoff.state || "local_only");
    const godotLabels = {
      local_only: options.browserOnly ? "需要本地版" : "尚未绑定",
      invalid_root: "根目录无效",
      sync_required: "需要同步",
      sync_failed: "同步失败",
      synced: "已同步",
      gameplay_ready: "Gameplay 就绪",
    };
    const godotTones = {
      synced: "success",
      gameplay_ready: "success",
      sync_required: "warning",
      local_only: "neutral",
      invalid_root: "danger",
      sync_failed: "danger",
    };
    const animationGroups = Array.isArray(config?.groups)
      ? config.groups.filter((group) => Array.isArray(group?.frames) && group.frames.length)
      : [];
    const petProject = config?.projectKind === "codex_pets";
    const boundAnimationCount = petProject
      ? animationGroups.filter((group) => Boolean(group?.profileId)).length
      : 0;
    const missingAnimationCount = petProject ? animationGroups.length - boundAnimationCount : 0;
    const petState = !petProject ? "unsupported" : missingAnimationCount ? "incomplete" : "ready";
    return {
      godot: {
        state: godotState,
        tone: godotTones[godotState] || "neutral",
        label: godotLabels[godotState] || "尚未绑定",
        blockers: Array.isArray(handoff.blockers) ? handoff.blockers.filter(Boolean).map(String) : [],
        warningCount: Array.isArray(handoff.warnings) ? handoff.warnings.filter(Boolean).length : 0,
      },
      codexPet: {
        state: petState,
        tone: petState === "ready" ? "success" : petState === "incomplete" ? "warning" : "neutral",
        label: petState === "ready" ? "身份完整" : petState === "incomplete" ? "需补充身份" : "非 Pet 项目",
        boundAnimationCount,
        missingAnimationCount,
      },
    };
  }

  /**
   * Copies the tuner animation into a resource-tool workset when frames and images match.
   * Profile and animation ids are optional: they are write-back keys, not a load gate.
   * @param {{currentGroup?:{frames?:object[],name?:string,profileId?:string,animationId?:string,profileLabel?:string,profileKind?:string,type?:string,speed?:number,anchorMode?:string,loop?:boolean,loopMode?:string}|null,images?:object[],groupLabel?:(group:object)=>string}} input Tuner store snapshot.
   * @returns {{name:string,profileId?:string,animationId?:string,profileLabel?:string,profileKind?:string,animationType?:string,fps?:number,anchorMode?:string,frames:object[],images:object[],loop:boolean}|null} Workset source or null.
   */
  function resolveCurrentAnimationSource(input = {}) {
    const group = input.currentGroup;
    const images = Array.isArray(input.images) ? input.images : [];
    const frames = Array.isArray(group?.frames) ? group.frames : [];
    if (!frames.length || images.length !== frames.length) return null;
    return {
      name: typeof input.groupLabel === "function" ? input.groupLabel(group) : String(group?.name || ""),
      profileId: group.profileId,
      animationId: group.animationId,
      profileLabel: group.profileLabel,
      profileKind: group.profileKind,
      animationType: group.type,
      fps: group.speed,
      anchorMode: group.anchorMode,
      frames,
      images,
      loop: group.loop === true || group.loopMode === "loop",
    };
  }

  /**
   * Creates a detached quick-tool workset from one project animation snapshot.
   * Every image passes through the injected copier so later tool edits cannot
   * mutate project-owned Canvas resources by reference.
   * @param {{name?:string,fps?:number,frames?:object[],images?:object[]}} source Project animation source.
   * @param {{copyImage:(image:object,frame:object,index:number)=>object,copyNamespace?:string}} options Copy adapters.
   * @returns {{name:string,sourceTool:"project-copy",frames:object[]}} Independent workset.
   */
  function createIndependentToolWorkset(source, options = {}) {
    if (typeof options.copyImage !== "function") {
      throw new TypeError("Project animation copy requires an image copier.");
    }
    const frames = Array.from(source?.frames || []);
    const images = Array.from(source?.images || []);
    if (!frames.length || frames.length !== images.length) {
      throw new Error("当前项目动画尚未准备好可复制的完整帧序列。");
    }
    const copyNamespace =
      String(options.copyNamespace || root?.crypto?.randomUUID?.() || Date.now()).trim() ||
      String(Date.now());
    const fallbackDurationMs = Math.max(1, Math.round(1000 / Math.max(1, Number(source?.fps) || 12)));
    return {
      name: String(source?.name || "项目动画副本"),
      sourceTool: "project-copy",
      frames: frames.map((frame, index) => ({
        id: `${copyNamespace}:${index + 1}`,
        name: String(frame?.name || `frame_${String(index + 1).padStart(4, "0")}.png`),
        image: options.copyImage(images[index], frame, index),
        enabled: frame?.enabled !== false && frame?.disabled !== true,
        assetRevision: 0,
        durationMs: Math.max(
          1,
          Number(frame?.durationMs || frame?.duration || fallbackDurationMs) || fallbackDurationMs,
        ),
      })),
    };
  }

  /**
   * Chooses the export workset for the delivery page without inventing frames.
   * Standalone tools only consume temporary worksets; project delivery only
   * consumes the current project animation. Crossing that boundary requires an
   * explicit copy operation.
   * @param {{navigationContext?:string,temporaryWorkset?:{frames?:object[]}|null,currentGroup?:{frames?:object[]}|null}} input Visible sources.
   * @returns {{kind:"temporary"|"current"|"empty",workset?:object,message?:string}} Mount source.
   */
  function resolveDeliveryExportSource(input = {}) {
    const temporaryFrames = Array.isArray(input.temporaryWorkset?.frames)
      ? input.temporaryWorkset.frames
      : [];
    const standalone = input.navigationContext === "standalone";
    if (standalone && temporaryFrames.length) {
      return { kind: "temporary", workset: input.temporaryWorkset };
    }
    const currentFrames = Array.isArray(input.currentGroup?.frames) ? input.currentGroup.frames : [];
    if (!standalone && currentFrames.length) return { kind: "current" };
    return {
      kind: "empty",
      message:
        typeof input.translate === "function"
          ? input.translate(
              input.navigationContext === "standalone" ? "exportNeedSequence" : "exportNeedFrames",
            )
          : input.navigationContext === "standalone"
            ? "请先导入需要导出的图片序列"
            : "当前动画没有可导出的帧",
    };
  }

  /**
   * Creates the project and quick-tool hub renderer.
   * @param {{documentRef?:Document,windowRef?:Window,projectLabel?:(project:object)=>string,translate?:(key:string,vars?:object)=>string,prompt?:(message:string)=>string|null,createProject?:(label:string)=>Promise<object|void>|object|void,clearProject?:(project:object)=>Promise<boolean>|boolean,deleteProject?:(project:object)=>Promise<boolean>|boolean,onError?:(error:Error)=>void}} dependencies Hub dependencies.
   * @returns {{bind:()=>void,renderProjects:(config:object|null)=>void}} Hub operations.
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const projectLabel =
      dependencies.projectLabel || ((project) => project?.label || project?.name || project?.id || "");
    const translate =
      dependencies.translate ||
      ((key, vars = {}) => {
        const defaults = {
          currentProjectEyebrow: "CURRENT PROJECT",
          projectEyebrow: "PROJECT",
          unnamedProject: "未命名项目",
          localAnimationProject: "本地动画项目",
          openProject: "打开项目 →",
          continueProject: "继续项目",
          localWorkspace: "本地工作区",
          projectGroupSummary: `${vars.count ?? 0} 个动画组`,
          projectReadySummary: `${vars.count ?? 0} 个动画组 · ${vars.frames ?? 0} 帧`,
          browserSessionProject: "浏览器临时工作区",
          clearProject: "清空项目",
          deleteProject: "删除项目",
          importProject: "导入视频 / 图片序列 →",
          projectNeedsImportSummary: "还没有动画帧 · 可从视频抽帧或导入 PNG",
          newProjectPrompt: "项目名称",
        };
        return defaults[key] || key;
      });
    if (!documentRef?.querySelector || !documentRef?.createElement) {
      throw new TypeError("XSXB mode hubs require a document implementation.");
    }

    const elements = {
      recent: documentRef.querySelector("#projectHubRecent"),
      recentTitle: documentRef.querySelector("#projectHubRecentTitle"),
      recentSummary: documentRef.querySelector("#projectHubRecentSummary"),
      continueLink: documentRef.querySelector("#projectHubContinue"),
      recentDanger: documentRef.querySelector("#projectHubRecentDanger"),
      list: documentRef.querySelector("#projectHubList"),
      empty: documentRef.querySelector("#projectHubEmpty"),
      newProject: documentRef.querySelector("#projectHubNew"),
    };
    let bound = false;

    /**
     * Returns a known animation-group count for one project.
     * @param {object} project Project registry entry.
     * @param {object|null} config Active workbench config.
     * @param {string} activeProjectId Active project identifier.
     * @returns {number|null} Group count, or null when the project state is unknown.
     */
    function projectAnimationGroupCount(project, config, activeProjectId) {
      if (project?.id === activeProjectId && Array.isArray(config?.groups)) {
        return config.groups.length;
      }
      if (!project || !Object.prototype.hasOwnProperty.call(project, "animationGroupCount")) return null;
      const count = Number(project.animationGroupCount);
      return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
    }

    /** Builds a project deep link that opens import before tuning for empty projects. */
    function projectHref(project, config, activeProjectId) {
      const groupCount = projectAnimationGroupCount(project, config, activeProjectId);
      const targetPath = groupCount === 0 ? "/workspace/resources/import" : "/workspace/animation/transform";
      const url = new URL(targetPath, windowRef.location?.origin || "http://localhost");
      if (project?.id) url.searchParams.set("project", project.id);
      return `${url.pathname}${url.search}`;
    }

    /**
     * Counts frames in the active project config, or a stored project.frameCount.
     * @returns {number|null} Frame count when known.
     */
    function projectFrameCount(project, config, activeProjectId) {
      if (project?.id === activeProjectId && Array.isArray(config?.groups)) {
        const hasFrameLists = config.groups.some((group) => Array.isArray(group?.frames));
        if (!hasFrameLists) return null;
        return config.groups.reduce(
          (total, group) => total + (Array.isArray(group?.frames) ? group.frames.length : 0),
          0,
        );
      }
      if (!project || !Object.prototype.hasOwnProperty.call(project, "frameCount")) return null;
      const count = Number(project.frameCount);
      return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
    }

    /** Product copy for a project that already has animations. */
    function projectReadySummaryText(project, config, activeProjectId) {
      const groups = projectAnimationGroupCount(project, config, activeProjectId);
      const frames = projectFrameCount(project, config, activeProjectId);
      if (groups != null && frames != null) {
        return translate("projectReadySummary", { count: groups, frames });
      }
      if (groups != null) return translate("projectGroupSummary", { count: groups });
      return translate("localAnimationProject");
    }

    /** Updates a recent-project action without replacing the accessible anchor. */
    function setProjectActionLabel(element, translationKey) {
      if (!element) return;
      const label = element.querySelector?.("[data-i18n]");
      if (label) {
        label.setAttribute("data-i18n", translationKey);
        label.textContent = translate(translationKey);
      } else {
        element.textContent = translate(translationKey);
      }
    }

    /** Returns the localized label for built-in projects and preserves user-supplied labels. */
    function displayProjectLabel(project) {
      if (project?.id === "browser-session") return translate("browserSessionProject");
      return projectLabel(project) || project?.id || translate("unnamedProject");
    }

    /**
     * Returns which destructive hub actions a project may expose.
     * @param {object} project Project registry entry.
     * @returns {{canClear:boolean,canDelete:boolean}}
     */
    function projectHubActions(project) {
      const protectedSystem = project?.id === "codex_pets" || project?.kind === "codex_pets";
      return {
        canClear: !protectedSystem,
        canDelete: !protectedSystem && project?.id !== "browser-session",
      };
    }

    /**
     * Runs a hub-level clear or delete through the host.
     * @param {"clear"|"delete"} action Requested action.
     * @param {object} project Target project.
     * @returns {Promise<void>}
     */
    async function runProjectAction(action, project) {
      const handler = action === "delete" ? dependencies.deleteProject : dependencies.clearProject;
      if (typeof handler !== "function") return;
      try {
        await handler(project);
      } catch (error) {
        dependencies.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }

    /**
     * Builds the clear/delete controls for a project card or the recent row.
     * @param {object} project Project registry entry.
     * @returns {HTMLElement} Action row.
     */
    function createProjectActionButtons(project) {
      const actions = documentRef.createElement("div");
      actions.className = "projectHubCardActions";
      const { canClear, canDelete } = projectHubActions(project);
      if (canClear) {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.dataset.projectAction = "clear";
        button.dataset.projectId = String(project.id || "");
        button.textContent = translate("clearProject");
        button.addEventListener("click", (event) => {
          event.preventDefault?.();
          event.stopPropagation?.();
          void runProjectAction("clear", project);
        });
        actions.append(button);
      }
      if (canDelete) {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.className = "secondary dangerAction";
        button.dataset.projectAction = "delete";
        button.dataset.projectId = String(project.id || "");
        button.textContent = translate("deleteProject");
        button.addEventListener("click", (event) => {
          event.preventDefault?.();
          event.stopPropagation?.();
          void runProjectAction("delete", project);
        });
        actions.append(button);
      }
      actions.hidden = !canClear && !canDelete;
      return actions;
    }

    /** Creates one accessible project card without HTML string interpolation. */
    function createProjectCard(project, activeProjectId, config) {
      const card = documentRef.createElement("article");
      card.className = "projectHubCard";
      const groupCount = projectAnimationGroupCount(project, config, activeProjectId);
      const needsImport = groupCount === 0;
      const link = documentRef.createElement("a");
      link.className = "projectHubCardLink";
      link.href = projectHref(project, config, activeProjectId);
      if (groupCount !== null) card.dataset.projectState = needsImport ? "needs-import" : "ready";
      link.setAttribute("data-document-navigation", "");
      const eyebrow = documentRef.createElement("span");
      eyebrow.textContent = translate(
        project.id === activeProjectId ? "currentProjectEyebrow" : "projectEyebrow",
      );
      const title = documentRef.createElement("h2");
      title.textContent = displayProjectLabel(project);
      const summary = documentRef.createElement("p");
      summary.textContent = needsImport
        ? translate("projectNeedsImportSummary")
        : projectReadySummaryText(project, config, activeProjectId);
      const action = documentRef.createElement("strong");
      action.textContent = translate(needsImport ? "importProject" : "openProject");
      link.append(eyebrow, title, summary, action);
      card.append(link, createProjectActionButtons(project));
      return card;
    }

    /** Renders the current project registry into the project hub. */
    function renderProjects(config) {
      const projects = Array.from(config?.projects || []);
      const activeProjectId = config?.activeProjectId || config?.activeProject?.id || "";
      const recent = projects.find((project) => project.id === activeProjectId) || projects[0] || null;
      if (elements.list) {
        elements.list.replaceChildren(
          ...projects.map((project) => createProjectCard(project, activeProjectId, config)),
        );
      }
      if (elements.empty) elements.empty.hidden = projects.length > 0;
      if (elements.recent) elements.recent.hidden = !recent;
      if (!recent) return;
      const recentGroupCount = projectAnimationGroupCount(recent, config, activeProjectId);
      const recentNeedsImport = recentGroupCount === 0;
      if (elements.recentTitle) elements.recentTitle.textContent = displayProjectLabel(recent);
      if (elements.recentSummary) {
        elements.recentSummary.textContent = recentNeedsImport
          ? translate("projectNeedsImportSummary")
          : projectReadySummaryText(recent, config, activeProjectId);
      }
      if (elements.continueLink) {
        elements.continueLink.href = projectHref(recent, config, activeProjectId);
        if (recentGroupCount !== null) {
          elements.continueLink.dataset.projectState = recentNeedsImport ? "needs-import" : "ready";
        }
        setProjectActionLabel(elements.continueLink, recentNeedsImport ? "importProject" : "continueProject");
      }
      if (elements.recentDanger) {
        const recentActions = createProjectActionButtons(recent);
        elements.recentDanger.replaceChildren(...recentActions.children);
        elements.recentDanger.hidden = recentActions.hidden;
        elements.recentDanger.className = recentActions.className;
      }
    }

    /** Binds the hub-level creation entry once. */
    function bind() {
      if (bound) return;
      bound = true;
      elements.newProject?.addEventListener("click", async (event) => {
        event.preventDefault?.();
        const promptImpl = dependencies.prompt || windowRef.prompt?.bind(windowRef);
        const label = normalizeProjectName(promptImpl?.(translate("newProjectPrompt")) || "");
        if (!label) return;
        if (typeof dependencies.createProject === "function") {
          try {
            const result = await dependencies.createProject(label);
            const projectId = String(result?.projectId || result?.id || result?.activeProjectId || "");
            const url = new URL(
              "/workspace/resources/import",
              windowRef.location?.origin || "http://localhost",
            );
            if (projectId) url.searchParams.set("project", projectId);
            windowRef.location.assign(`${url.pathname}${url.search}`);
          } catch (error) {
            dependencies.onError?.(error instanceof Error ? error : new Error(String(error)));
          }
          return;
        }
        const url = new URL("/workspace/resources/import", windowRef.location?.origin || "http://localhost");
        url.searchParams.set("createProject", "1");
        url.searchParams.set("projectName", label);
        windowRef.location.assign(`${url.pathname}${url.search}`);
      });
    }

    return { bind, renderProjects };
  }

  return Object.freeze({
    MAX_NAME_LENGTH,
    createIndependentToolWorkset,
    createController,
    normalizeProjectName,
    resolveCurrentAnimationSource,
    resolveDeliveryExportSource,
    summarizeDeliveryReadiness,
    summarizeDeliveryScope,
  });
});
