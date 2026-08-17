(function attachXsxbNavigationContext(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBNavigationContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const RESOURCE_ROUTES = new Set(["import", "organizer", "cutout", "scatter"]);
  const DELIVERY_ROUTES = new Set(["export", "godot", "codex-pet"]);

  /**
   * Creates breadcrumb and context-aware return-label coordination.
   * @param {{documentRef?:Document,windowRef?:Window,getConfig?:()=>object|null,getCurrentGroup?:()=>object|null,getRoute?:()=>string,getContext?:()=>"project"|"standalone",projectLabel?:(project:object)=>string,groupLabel?:(group:object)=>string,translate?:(key:string,variables?:object)=>string,toolTitle?:(route:string)=>string}} dependencies Context dependencies.
   * @returns {{bind:()=>void,destroy:()=>void,render:()=>void}} Context operations.
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const getConfig = dependencies.getConfig || (() => null);
    const getRoute = dependencies.getRoute || (() => "");
    const getContext = dependencies.getContext || (() => "project");
    const projectLabel =
      dependencies.projectLabel || ((project) => project?.label || project?.name || project?.id || "");
    const translate = dependencies.translate || ((key) => key);
    const toolTitle = dependencies.toolTitle || (() => "");
    if (!documentRef?.querySelector || !documentRef?.createElement) {
      throw new TypeError("XSXB navigation context requires a document implementation.");
    }

    const elements = {
      eyebrow: documentRef.querySelector("#workspaceFlowEyebrow"),
      title: documentRef.querySelector("#workspaceFlowProject"),
      save: documentRef.querySelector("#workspaceSaveIndicator"),
      back: documentRef.querySelector("#workspaceFlowBack"),
    };
    let observer = null;
    let bound = false;

    /** Returns the localized project label for animation and delivery pages. */
    function activeProjectTitle() {
      const config = getConfig() || {};
      const activeProjectId = config.activeProject?.id || config.activeProjectId || "";
      if (activeProjectId === "browser-session") return translate("browserSessionProject");
      return projectLabel(config.activeProject) || activeProjectId || translate("currentProject");
    }

    /** Returns the stage eyebrow key for one route. */
    function stageKey(route) {
      if (RESOURCE_ROUTES.has(route)) return "stageResources";
      if (DELIVERY_ROUTES.has(route)) return "stageDelivery";
      return "stageAnimation";
    }

    /** Returns the visible flow-header title for one route. */
    function titleForRoute(route) {
      if (RESOURCE_ROUTES.has(route)) {
        return (
          toolTitle(route) ||
          (route === "cutout" ? translate("batchCutout") : "") ||
          (route === "scatter" ? translate("scatterSliceTitle") : "") ||
          activeProjectTitle()
        );
      }
      return activeProjectTitle();
    }

    /** Returns the back-button label for the current tool stack. */
    function backLabel(route) {
      const body = documentRef.body;
      const organizerVisible = body?.classList?.contains("organizerOpen");
      const cutoutVisible = body?.classList?.contains("cutoutOpen");
      if (route === "cutout" && organizerVisible && cutoutVisible) return translate("returnOrganizer");
      if (getContext() === "standalone") return translate("returnQuickTools");
      return translate("returnTuning");
    }

    /** Renders all visible navigation context from canonical route and modal state. */
    function render() {
      const route = getRoute();
      const resourcePage = RESOURCE_ROUTES.has(route);
      if (elements.eyebrow) elements.eyebrow.textContent = translate(stageKey(route));
      if (elements.title) elements.title.textContent = titleForRoute(route);
      if (elements.save) elements.save.hidden = resourcePage;
      if (elements.back) {
        elements.back.hidden = !resourcePage;
        elements.back.textContent = backLabel(route);
      }
    }

    /** Binds route and modal-state synchronization once. */
    function bind() {
      if (bound) return;
      bound = true;
      windowRef.addEventListener?.("xsxb:routechange", render);
      windowRef.addEventListener?.("popstate", render);
      if (typeof windowRef.MutationObserver === "function" && documentRef.body) {
        observer = new windowRef.MutationObserver(render);
        observer.observe(documentRef.body, { attributes: true, attributeFilter: ["class"] });
      }
      render();
    }

    /** Removes observers and event listeners. */
    function destroy() {
      if (!bound) return;
      bound = false;
      windowRef.removeEventListener?.("xsxb:routechange", render);
      windowRef.removeEventListener?.("popstate", render);
      observer?.disconnect();
      observer = null;
    }

    return { bind, destroy, render };
  }

  return Object.freeze({ createController });
});
