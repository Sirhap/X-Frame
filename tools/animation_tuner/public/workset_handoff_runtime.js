(function attachXsxbWorksetHandoffRuntime(root, factory) {
  "use strict";

  const core =
    root?.XSXBWorksetHandoffCore ||
    (typeof module === "object" && module.exports ? require("./workset_handoff_core") : null);
  const api = factory(root, core);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBWorksetHandoffRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root, core) => {
  "use strict";

  if (!core?.planWorksetOperations) throw new Error("Workset handoff core is required.");

  /** Clones JSON-compatible project session state. */
  function cloneValue(value, structuredCloneImpl = root?.structuredClone) {
    if (typeof structuredCloneImpl === "function") return structuredCloneImpl(value);
    return JSON.parse(JSON.stringify(value));
  }

  /** Converts rendered workbench groups into the manifest shape used by the planner. */
  function manifestFromGroups(groups) {
    const profiles = new Map();
    for (const group of Array.from(groups || [])) {
      if (!group?.profileId || !group?.animationId) continue;
      if (!profiles.has(group.profileId)) {
        profiles.set(group.profileId, {
          id: group.profileId,
          label: group.profileLabel || group.profileId,
          kind: group.profileKind || "actor",
          animations: [],
        });
      }
      profiles.get(group.profileId).animations.push({
        id: group.animationId,
        name: group.name || group.animationId,
        frames: Array.from(group.frames || []),
      });
    }
    return { schemaVersion: 1, profiles: Array.from(profiles.values()) };
  }

  /** Reads a JSON response while preserving the server's structured error message. */
  async function readJsonResponse(response) {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const conflictMessage = Array.from(result.conflicts || [], (conflict) => conflict.message)
        .filter(Boolean)
        .join("\n");
      throw new Error(conflictMessage || result.error || `HTTP ${response.status}`);
    }
    return result;
  }

  /**
   * Creates the server-backed handoff adapter.
   * @param {{fetchImpl?:typeof fetch}} dependencies Network dependencies.
   * @returns {{loadProjectConfig:(projectId:string)=>Promise<object>,createProject:(label:string)=>Promise<object>,discardProject:(projectId:string,context?:object)=>Promise<void>,plan:(payload:object)=>Promise<object>,apply:(payload:object)=>Promise<object>}} Adapter operations.
   */
  function createLocalAdapter(dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl || root?.fetch;
    if (typeof fetchImpl !== "function") throw new TypeError("Local workset handoff requires fetch.");

    /** Posts one JSON mutation. */
    async function post(pathname, payload) {
      const response = await fetchImpl(pathname, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return readJsonResponse(response);
    }

    return {
      async loadProjectConfig(projectId) {
        const response = await fetchImpl(`/api/config?project=${encodeURIComponent(projectId)}`);
        return readJsonResponse(response);
      },
      async createProject(label) {
        const registry = await post("/api/projects", { label });
        const projectId = registry.activeProjectId;
        if (!projectId) throw new Error("Project creation did not return an active project.");
        return { projectId, config: await this.loadProjectConfig(projectId) };
      },
      async discardProject(projectId, context = {}) {
        await post("/api/projects/delete", {
          projectId,
          baseRevision: context.baseRevision || "",
        });
        if (context.restoreProjectId) {
          await post("/api/projects/active", { projectId: context.restoreProjectId });
        }
      },
      plan: (payload) => post("/api/project-worksets/plan", payload),
      apply: (payload) => post("/api/project-worksets/apply", payload),
    };
  }

  /**
   * Creates the atomic browser-session handoff adapter.
   * @param {{browserRuntime:object,getProjectConfig:(projectId:string)=>object|null,commitProjectConfig:(projectId:string,config:object)=>object,createProject:(label:string)=>{projectId:string,config:object},discardProject?:(projectId:string)=>void,structuredCloneImpl?:typeof structuredClone}} dependencies Browser state dependencies.
   * @returns {{loadProjectConfig:(projectId:string)=>Promise<object>,createProject:(label:string)=>Promise<object>,discardProject:(projectId:string)=>Promise<void>,plan:(payload:object)=>Promise<object>,apply:(payload:object)=>Promise<object>}} Adapter operations.
   */
  function createBrowserAdapter(dependencies = {}) {
    const { browserRuntime } = dependencies;
    for (const name of ["getProjectConfig", "commitProjectConfig", "createProject"]) {
      if (typeof dependencies[name] !== "function") {
        throw new TypeError(`Browser workset handoff requires ${name}.`);
      }
    }
    if (
      typeof browserRuntime?.createSessionAnimationGroup !== "function" ||
      typeof browserRuntime?.reorganizeSessionAnimation !== "function"
    ) {
      throw new TypeError("Browser workset handoff requires the browser animation runtime.");
    }
    /** Returns a content-derived revision shared by all browser-session mutations. */
    function revision(projectId) {
      const config = dependencies.getProjectConfig(projectId);
      if (!config) return `browser-session:${projectId}:missing`;
      let hash = 2166136261;
      const update = (value) => {
        const text = String(value || "");
        for (let index = 0; index < text.length; index += 1) {
          hash ^= text.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
      };
      for (const group of Array.from(config.groups || [])) {
        update(`${group.profileId}/${group.animationId}:${group.frames?.length || 0}`);
        for (const frame of Array.from(group.frames || [])) {
          update(frame.name);
          update(frame.path);
          update(frame.duration);
        }
      }
      update(JSON.stringify(config.tuning || {}));
      update(JSON.stringify(config.frameAudioBindings || {}));
      update(JSON.stringify(config.frameImageAttachments || []));
      update(JSON.stringify(config.attackTrails || {}));
      return `browser-session:${projectId}:${(hash >>> 0).toString(16)}`;
    }

    /** Creates planner input from one browser project config. */
    function planningState(config, operations) {
      return {
        manifest: manifestFromGroups(config?.groups),
        tuning: config?.tuning || {},
        frameAudioBindings: config?.frameAudioBindings || {},
        frameImageAttachments: config?.frameImageAttachments || [],
        attackTrails: config?.attackTrails || { schemaVersion: 8, bindings: {} },
        operations,
      };
    }

    /** Applies one replacement to the cloned browser project state. */
    function replaceAnimation(config, operation) {
      const group = config.groups.find(
        (entry) => entry.profileId === operation.profileId && entry.animationId === operation.animationId,
      );
      if (!group)
        throw new Error(`Animation target is unavailable: ${operation.profileId}/${operation.animationId}`);
      const result = browserRuntime.reorganizeSessionAnimation(group, operation.items, {
        frameVisualOverrides: config.tuning?.frame_visual_overrides,
        framePlaybackOverrides: config.tuning?.frame_playback_overrides,
        frameBoxOverrides: config.tuning?.frame_box_overrides,
        frameAudioBindings: config.frameAudioBindings,
        frameImageAttachments: config.frameImageAttachments,
        attackTrails: config.attackTrails,
        premiumFeatures: operation.premiumFeatures,
      });
      config.tuning = {
        ...(config.tuning || {}),
        frame_visual_overrides: result.frameVisualOverrides,
        frame_playback_overrides: result.framePlaybackOverrides,
        frame_box_overrides: result.frameBoxOverrides,
      };
      config.frameAudioBindings = result.frameAudioBindings;
      config.frameImageAttachments = result.frameImageAttachments;
      config.attackTrails = result.attackTrails;
      return group;
    }

    /** Loads a project, auto-creating a persisted browser session shell on first save. */
    async function resolveProjectConfig(projectId) {
      let config = dependencies.getProjectConfig(projectId);
      if (!config && typeof browserRuntime.ensureSessionProject === "function") {
        await browserRuntime.ensureSessionProject(projectId);
        config = dependencies.getProjectConfig(projectId);
      }
      if (!config) throw new Error(`Project not found: ${projectId}`);
      return config;
    }

    return {
      async loadProjectConfig(projectId) {
        const config = await resolveProjectConfig(projectId);
        return cloneValue(config, dependencies.structuredCloneImpl);
      },
      async createProject(label) {
        return dependencies.createProject(label);
      },
      async discardProject(projectId) {
        await dependencies.discardProject?.(projectId);
      },
      async plan(payload) {
        const config = await resolveProjectConfig(payload.projectId);
        const plan = core.planWorksetOperations(planningState(config, payload.operations));
        return { ...plan, baseRevision: revision(payload.projectId) };
      },
      async apply(payload) {
        await resolveProjectConfig(payload.projectId);
        if (payload.baseRevision !== revision(payload.projectId)) {
          throw new Error(
            "Project data changed after workset preflight. Reload the target project and try again.",
          );
        }
        const source = dependencies.getProjectConfig(payload.projectId);
        if (!source) throw new Error(`Project not found: ${payload.projectId}`);
        const working = cloneValue(source, dependencies.structuredCloneImpl);
        working.groups = Array.from(working.groups || []);
        working.profiles = Array.from(working.profiles || []);
        const plan = core.planWorksetOperations(planningState(working, payload.operations));
        if (!plan.ok) {
          const message = plan.conflicts.map((conflict) => conflict.message).join("\n");
          throw new Error(message || "Workset targets require attention before they can be applied.");
        }
        const results = [];
        for (const operation of plan.operations) {
          let group;
          if (operation.type === "replace") {
            group = replaceAnimation(working, operation);
          } else {
            group = browserRuntime.createSessionAnimationGroup(
              {
                ...operation,
                animationId: operation.animationId,
                premiumFeatures: operation.premiumFeatures || [],
              },
              operation.items,
              working.groups,
            );
            working.groups.push(group);
            if (!working.profiles.some((profile) => profile.id === group.profileId)) {
              working.profiles.push({
                id: group.profileId,
                label: group.profileLabel,
                kind: group.profileKind,
              });
            }
          }
          results.push({
            id: operation.id,
            type: operation.type,
            profileId: group.profileId,
            animationId: group.animationId,
            frameCount: group.frames.length,
          });
        }
        await dependencies.commitProjectConfig(payload.projectId, working);
        const dataRevision = revision(payload.projectId);
        return { ok: true, projectId: payload.projectId, results, dataRevision };
      },
    };
  }

  return Object.freeze({ cloneValue, createBrowserAdapter, createLocalAdapter, manifestFromGroups });
});
