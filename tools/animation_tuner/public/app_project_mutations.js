(function attachXFrameProjectMutations(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameProjectMutations = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Reads a JSON mutation response and preserves the server error message.
   * @param {Response} response Fetch response.
   * @returns {Promise<object>} Parsed payload.
   */
  async function readMutationResponse(response) {
    const responseText = await response.text();
    let result = null;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = null;
    }
    if (!response.ok) throw new Error(result?.error || responseText || `HTTP ${response.status}`);
    return result || {};
  }

  /**
   * Creates project activation and destructive-mutation operations.
   * @param {{
   *   elements?:{clearProject?:object,deleteProject?:object,projectSelect?:object},
   *   getConfig?:()=>object|null,
   *   getActiveProjectId?:()=>string,
   *   getDirty?:()=>boolean,
   *   setDirty?:(value:boolean)=>void,
   *   setSelectedProjectId?:(value:string)=>void,
   *   confirm?:(message:string,options?:object)=>boolean|Promise<boolean>,
   *   fetchImpl?:typeof fetch,
   *   translate?:(key:string,variables?:object)=>string,
   *   projectLabel?:(project:object)=>string,
   *   resetProjectSession?:()=>void,
   *   loadConfig?:()=>Promise<void>,
   *   resizeCanvas?:()=>void,
   *   renderProjectSelect?:()=>void,
   *   status?:(message:string)=>void,
   *   storage?:Storage|null,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   activateProject:(projectId:string)=>Promise<boolean>,
   *   clearActiveProject:()=>Promise<boolean>,
   *   clearProject:(projectId?:string)=>Promise<boolean>,
   *   deleteActiveProject:()=>Promise<boolean>,
   *   deleteProject:(projectId?:string)=>Promise<boolean>,
   *   readMutationResponse:typeof readMutationResponse,
   *   setProjectMutationBusy:(busy:boolean)=>void,
   * }} Project mutation operations.
   */
  function createController(dependencies = {}) {
    const {
      elements = {},
      getConfig = () => null,
      getActiveProjectId = () => "",
      getDirty = () => false,
      setDirty = () => {},
      setSelectedProjectId = () => {},
      confirm = () => true,
      fetchImpl = root.fetch,
      translate = (key) => key,
      projectLabel = (project) => String(project?.name || project?.id || ""),
      resetProjectSession = () => {},
      loadConfig = async () => {},
      resizeCanvas = () => {},
      renderProjectSelect = () => {},
      status = () => {},
      storage = resolveStorage(root),
    } = dependencies;

    /**
     * Disables project controls while a mutation is in flight.
     * @param {boolean} busy Whether a project mutation is running.
     * @returns {void}
     */
    function setProjectMutationBusy(busy) {
      const disabled = Boolean(busy);
      if (elements.clearProject) elements.clearProject.disabled = disabled || !getActiveProjectId();
      if (elements.deleteProject) elements.deleteProject.disabled = disabled || !getActiveProjectId();
      if (elements.projectSelect) {
        elements.projectSelect.disabled = disabled || !getConfig()?.projects?.length;
      }
    }

    /**
     * Resolves a project from the active config, including listed-but-inactive shells.
     * @param {string} [projectId] Requested project id.
     * @returns {object|null} Project record.
     */
    function resolveProject(projectId) {
      const config = getConfig() || {};
      const id = String(projectId || getActiveProjectId() || "");
      if (!id) return null;
      if (config.activeProject?.id === id) return config.activeProject;
      return Array.from(config.projects || []).find((project) => project.id === id) || null;
    }

    /** Codex Pets cannot be cleared or deleted from the project list. */
    function isProtectedClear(project) {
      return project?.id === "codex_pets" || project?.kind === "codex_pets";
    }

    /** Browser session and Codex Pets cannot be deleted. */
    function isProtectedDelete(project) {
      return isProtectedClear(project) || project?.id === "browser-session";
    }

    /**
     * Activates a project and reloads the editor session.
     * @param {string} projectId Target project identifier.
     * @returns {Promise<boolean>} Whether activation completed.
     */
    async function activateProject(projectId) {
      if (!projectId || projectId === getActiveProjectId()) return false;
      if (
        getDirty() &&
        !(await confirm(translate("projectSwitchConfirm"), {
          tone: "warning",
        }))
      ) {
        renderProjectSelect();
        return false;
      }
      if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
      const response = await fetchImpl("/api/projects/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!response.ok) throw new Error(await response.text());
      setSelectedProjectId(projectId);
      writeStorage("xsxbFrameTuner.project", projectId);
      resetProjectSession();
      setDirty(false);
      await loadConfig();
      resizeCanvas();
      return true;
    }

    /**
     * Clears content owned by one project.
     * @param {string} [projectId] Target project; defaults to the active project.
     * @returns {Promise<boolean>} Whether the project was cleared.
     */
    async function clearProject(projectId) {
      const project = resolveProject(projectId);
      if (!project?.id) return false;
      if (isProtectedClear(project)) {
        status(translate("codexPetsProjectProtected"));
        return false;
      }
      const label = projectLabel(project);
      if (
        !(await confirm(translate("clearProjectConfirm", { project: label }), {
          title: translate("clearProject"),
          confirmLabel: translate("clearProject"),
          tone: "danger",
        }))
      )
        return false;
      const isActive = project.id === getActiveProjectId();
      setProjectMutationBusy(true);
      try {
        if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
        const body = { projectId: project.id };
        if (isActive && getConfig()?.dataRevision) body.baseRevision = getConfig().dataRevision;
        const response = await fetchImpl("/api/projects/clear", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        await readMutationResponse(response);
        if (isActive) {
          resetProjectSession();
          setDirty(false);
        }
        await loadConfig();
        if (isActive) resizeCanvas();
        status(translate("projectCleared", { project: label }));
        return true;
      } finally {
        setProjectMutationBusy(false);
      }
    }

    /**
     * Clears content owned by the active project.
     * @returns {Promise<boolean>} Whether the project was cleared.
     */
    function clearActiveProject() {
      return clearProject(getActiveProjectId());
    }

    /**
     * Deletes one project without touching its external Godot root.
     * @param {string} [projectId] Target project; defaults to the active project.
     * @returns {Promise<boolean>} Whether the project was deleted.
     */
    async function deleteProject(projectId) {
      const project = resolveProject(projectId);
      if (!project?.id) return false;
      if (isProtectedDelete(project)) {
        status(
          translate(
            project.id === "browser-session" ? "browserSessionCannotDelete" : "codexPetsProjectProtected",
          ),
        );
        return false;
      }
      const label = projectLabel(project);
      if (
        !(await confirm(translate("deleteProjectConfirm", { project: label }), {
          title: translate("deleteProject"),
          confirmLabel: translate("deleteProject"),
          tone: "danger",
        }))
      )
        return false;
      const isActive = project.id === getActiveProjectId();
      setProjectMutationBusy(true);
      try {
        if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
        const body = { projectId: project.id };
        if (isActive && getConfig()?.dataRevision) body.baseRevision = getConfig().dataRevision;
        const response = await fetchImpl("/api/projects/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await readMutationResponse(response);
        if (isActive) {
          const nextProjectId = String(result.activeProjectId || "");
          setSelectedProjectId(nextProjectId);
          if (nextProjectId) writeStorage("xsxbFrameTuner.project", nextProjectId);
          else removeStorage("xsxbFrameTuner.project");
          resetProjectSession();
          setDirty(false);
        }
        await loadConfig();
        if (isActive) resizeCanvas();
        status(translate("projectDeleted", { project: label }));
        return true;
      } finally {
        setProjectMutationBusy(false);
      }
    }

    /**
     * Deletes the active project without touching its external Godot root.
     * @returns {Promise<boolean>} Whether the project was deleted.
     */
    function deleteActiveProject() {
      return deleteProject(getActiveProjectId());
    }

    /**
     * Writes project selection to storage without making storage mandatory.
     * @param {string} key Storage key.
     * @param {string} value Storage value.
     * @returns {void}
     */
    function writeStorage(key, value) {
      try {
        storage?.setItem(key, value);
      } catch (_error) {
        // Project state remains authoritative in memory and server response.
      }
    }

    /**
     * Removes project selection from storage without throwing.
     * @param {string} key Storage key.
     * @returns {void}
     */
    function removeStorage(key) {
      try {
        storage?.removeItem(key);
      } catch (_error) {
        // Storage is optional.
      }
    }

    return {
      activateProject,
      clearActiveProject,
      clearProject,
      deleteActiveProject,
      deleteProject,
      readMutationResponse,
      setProjectMutationBusy,
    };
  }

  /**
   * Resolves localStorage without throwing in privacy-restricted contexts.
   * @param {typeof globalThis} scope Browser global object.
   * @returns {Storage|null} Available storage or null.
   */
  function resolveStorage(scope) {
    try {
      return scope.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  return { createController, readMutationResponse };
});
