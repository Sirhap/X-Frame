(function attachXsxbNavigationContext(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBNavigationContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates breadcrumb and context-aware return-label coordination.
   * @param {{documentRef?:Document,windowRef?:Window,getConfig?:()=>object|null,getCurrentGroup?:()=>object|null,getRoute?:()=>string,getContext?:()=>"project"|"standalone",projectLabel?:(project:object)=>string,groupLabel?:(group:object)=>string}} dependencies Context dependencies.
   * @returns {{bind:()=>void,destroy:()=>void,render:()=>void}} Context operations.
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const getConfig = dependencies.getConfig || (() => null);
    const getCurrentGroup = dependencies.getCurrentGroup || (() => null);
    const getRoute = dependencies.getRoute || (() => "");
    const getContext = dependencies.getContext || (() => "project");
    const projectLabel = dependencies.projectLabel || ((project) => project?.label || project?.name || project?.id || "");
    const groupLabel = dependencies.groupLabel || ((group) => group?.name || group?.animationId || "");
    if (!documentRef?.querySelector || !documentRef?.createElement) {
      throw new TypeError("XSXB navigation context requires a document implementation.");
    }

    const elements = {
      workspace: documentRef.querySelector("#workspaceBreadcrumb"),
      cutout: documentRef.querySelector("#cutoutBreadcrumb"),
      organizer: documentRef.querySelector("#organizerBreadcrumb"),
      cutoutHome: documentRef.querySelector("#cutoutHome"),
      organizerHome: documentRef.querySelector("#organizerHome"),
    };
    let observer = null;
    let bound = false;

    /** Creates one breadcrumb node. */
    function breadcrumbItem(item) {
      const node = documentRef.createElement(item.href ? "a" : "span");
      node.textContent = item.label;
      if (item.href) node.href = item.href;
      return node;
    }

    /** Replaces one breadcrumb with ordered accessible items. */
    function renderBreadcrumb(element, items) {
      if (!element) return;
      element.replaceChildren(...items.filter((item) => item.label).map(breadcrumbItem));
    }

    /** Returns project-owned breadcrumb items for the active animation. */
    function projectItems() {
      const config = getConfig() || {};
      const group = getCurrentGroup();
      return [
        { label: "动画项目", href: "/projects" },
        { label: projectLabel(config.activeProject) || config.activeProjectId || "当前项目", href: "/workspace" },
        { label: group?.profileLabel || group?.profileId || "" },
        { label: group ? groupLabel(group) : "" },
      ];
    }

    /** Renders all visible navigation context from canonical route and modal state. */
    function render() {
      const context = getContext();
      const route = getRoute();
      const body = documentRef.body;
      const organizerVisible = body?.classList?.contains("organizerOpen");
      const cutoutVisible = body?.classList?.contains("cutoutOpen");
      const baseItems = context === "project" ? projectItems() : [{ label: "快速工具", href: "/tools" }];
      renderBreadcrumb(elements.workspace, projectItems());
      renderBreadcrumb(elements.organizer, [
        ...baseItems,
        { label: route === "import" || context === "standalone" ? "序列处理" : "帧整理" },
      ]);
      renderBreadcrumb(elements.cutout, [
        ...baseItems,
        ...(organizerVisible ? [{ label: route === "import" ? "序列处理" : "帧整理" }] : []),
        { label: "批量抠图" },
      ]);
      if (elements.organizerHome) {
        elements.organizerHome.textContent = context === "standalone" ? "← 返回快速工具" : "← 返回动画调参";
      }
      if (elements.cutoutHome) {
        elements.cutoutHome.textContent = organizerVisible && cutoutVisible
          ? "← 返回帧整理"
          : context === "standalone"
            ? "← 返回快速工具"
            : "← 返回动画调参";
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
