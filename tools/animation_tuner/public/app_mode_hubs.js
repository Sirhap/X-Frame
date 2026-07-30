(function attachXsxbModeHubs(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBModeHubs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the project and quick-tool hub renderer.
   * @param {{documentRef?:Document,windowRef?:Window,projectLabel?:(project:object)=>string}} dependencies Hub dependencies.
   * @returns {{bind:()=>void,renderProjects:(config:object|null)=>void}} Hub operations.
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const projectLabel =
      dependencies.projectLabel || ((project) => project?.label || project?.name || project?.id || "");
    if (!documentRef?.querySelector || !documentRef?.createElement) {
      throw new TypeError("XSXB mode hubs require a document implementation.");
    }

    const elements = {
      recent: documentRef.querySelector("#projectHubRecent"),
      recentTitle: documentRef.querySelector("#projectHubRecentTitle"),
      recentSummary: documentRef.querySelector("#projectHubRecentSummary"),
      continueLink: documentRef.querySelector("#projectHubContinue"),
      list: documentRef.querySelector("#projectHubList"),
      empty: documentRef.querySelector("#projectHubEmpty"),
      newProject: documentRef.querySelector("#projectHubNew"),
    };
    let bound = false;

    /** Builds a workspace deep link for one project. */
    function projectHref(project) {
      const url = new URL("/workspace", windowRef.location?.origin || "http://localhost");
      if (project?.id) url.searchParams.set("project", project.id);
      return `${url.pathname}${url.search}`;
    }

    /** Creates one accessible project card without HTML string interpolation. */
    function createProjectCard(project, activeProjectId) {
      const card = documentRef.createElement("a");
      card.className = "projectHubCard";
      card.href = projectHref(project);
      const eyebrow = documentRef.createElement("span");
      eyebrow.textContent = project.id === activeProjectId ? "CURRENT PROJECT" : "PROJECT";
      const title = documentRef.createElement("h2");
      title.textContent = projectLabel(project) || project.id || "未命名项目";
      const summary = documentRef.createElement("p");
      summary.textContent = project.workspacePath || project.projectRoot || "本地动画项目";
      const action = documentRef.createElement("strong");
      action.textContent = "打开项目 →";
      card.append(eyebrow, title, summary, action);
      return card;
    }

    /** Renders the current project registry into the project hub. */
    function renderProjects(config) {
      const projects = Array.from(config?.projects || []);
      const activeProjectId = config?.activeProjectId || config?.activeProject?.id || "";
      const recent = projects.find((project) => project.id === activeProjectId) || projects[0] || null;
      if (elements.list) {
        elements.list.replaceChildren(
          ...projects.map((project) => createProjectCard(project, activeProjectId)),
        );
      }
      if (elements.empty) elements.empty.hidden = projects.length > 0;
      if (elements.recent) elements.recent.hidden = !recent;
      if (!recent) return;
      if (elements.recentTitle) elements.recentTitle.textContent = projectLabel(recent) || recent.id;
      if (elements.recentSummary) {
        const groupCount = Number(config?.groups?.length || 0);
        elements.recentSummary.textContent = `${groupCount} 个动画组 · ${recent.workspacePath || recent.projectRoot || "本地工作区"}`;
      }
      if (elements.continueLink) elements.continueLink.href = projectHref(recent);
    }

    /** Binds the hub-level creation entry once. */
    function bind() {
      if (bound) return;
      bound = true;
      elements.newProject?.addEventListener("click", () => {
        windowRef.location.assign("/tools/organizer?createProject=1");
      });
    }

    return { bind, renderProjects };
  }

  return Object.freeze({ createController });
});
