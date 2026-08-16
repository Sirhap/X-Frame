(function attachXsxbAppRouting(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppRouting = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const ROUTE_BY_PATH = Object.freeze({
    "/projects": "projects",
    "/tools": "tools",
    "/tools/cutout": "cutout",
    "/tools/import": "import",
    "/tools/organizer": "import",
    "/tools/export": "export",
    "/tools/scatter-slice": "scatter",
    "/workspace/tools/cutout": "cutout",
    "/workspace/tools/organizer": "organizer",
    "/workspace/resources/import": "organizer",
    "/workspace/resources/cutout": "cutout",
    "/workspace/resources/scatter": "scatter",
    "/workspace/animation/transform": "animation",
    "/workspace/animation/boxes": "boxes",
    "/workspace/animation/trails": "trails",
    "/workspace/animation/audio": "audio",
    "/workspace/animation/attachments": "attachments",
    "/workspace/delivery/export": "export",
    "/workspace/delivery/godot": "godot",
    "/workspace/delivery/codex-pet": "codex-pet",
  });
  const STANDALONE_PATH_BY_ROUTE = Object.freeze({
    cutout: "/tools/cutout",
    import: "/tools/organizer",
    organizer: "/tools/organizer",
    projects: "/projects",
    scatter: "/tools/scatter-slice",
    tools: "/tools",
    export: "/tools/export",
  });
  const PROJECT_PATH_BY_ROUTE = Object.freeze({
    cutout: "/workspace/resources/cutout",
    import: "/workspace/resources/import",
    organizer: "/workspace/resources/import",
    projects: "/projects",
    tools: "/tools",
    animation: "/workspace/animation/transform",
    boxes: "/workspace/animation/boxes",
    trails: "/workspace/animation/trails",
    audio: "/workspace/animation/audio",
    attachments: "/workspace/animation/attachments",
    scatter: "/workspace/resources/scatter",
    export: "/workspace/delivery/export",
    godot: "/workspace/delivery/godot",
    "codex-pet": "/workspace/delivery/codex-pet",
  });
  const WORKSPACE_PATH = "/workspace";
  const VALID_ROUTES = new Set([
    "cutout",
    "import",
    "organizer",
    "projects",
    "scatter",
    "tools",
    "animation",
    "boxes",
    "trails",
    "audio",
    "attachments",
    "export",
    "godot",
    "codex-pet",
  ]);

  /**
   * Creates the route and workbench coordination controller.
   * @param {{
   *   getCurrentGroup?:()=>object|null,
   *   getSelectedFrame?:()=>number,
   *   getActiveProjectId?:()=>string,
   *   getBatchCutout?:()=>object|null,
   *   getFrameOrganizer?:()=>object|null,
   *   getWorkspaceDirty?:()=>boolean,
   *   requestWorkspaceDecision?:()=>Promise<"save"|"discard"|"cancel">,
   *   saveWorkspace?:()=>Promise<void>,
   *   discardWorkspaceChanges?:()=>Promise<void>,
   *   translate?:(key:string,variables?:object)=>string,
   *   groupLabel?:(group:object|null|undefined)=>string,
   *   windowRef?:Window,
   *   documentRef?:Document,
   *   storage?:Storage|null,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   currentWorkbenchRoute:()=>string,
   *   currentNavigationContext:()=>"project"|"standalone",
   *   updateDocumentTitle:()=>void,
   *   syncWorkbenchRoute:(route:string,options?:{push?:boolean})=>void,
   *   applyWorkbenchRoute:()=>Promise<boolean>,
   *   syncUrlState:(options?:{push?:boolean})=>void,
   * }} Route operations.
   */
  function createController(dependencies = {}) {
    const {
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      getActiveProjectId = () => "",
      getBatchCutout = () => null,
      getFrameOrganizer = () => null,
      getWorkspaceDirty = () => false,
      requestWorkspaceDecision = async () => "discard",
      saveWorkspace = async () => {},
      discardWorkspaceChanges = async () => {},
      translate = (key) => key,
      groupLabel = (group) => String(group?.name || ""),
      activateWorkspaceRoute = () => {},
      getTemporaryWorkset = () => null,
      openTemporaryCutout = () => false,
      windowRef = root,
    } = dependencies;
    const documentRef = dependencies.documentRef ?? windowRef.document ?? root.document;
    const storage = dependencies.storage ?? resolveStorage(windowRef);
    let applyRouteQueue = Promise.resolve();

    /**
     * Writes a route-related storage value without blocking navigation.
     * @param {string} key Storage key.
     * @param {string} value Value to persist.
     * @returns {void}
     */
    function writeStorage(key, value) {
      try {
        storage?.setItem(key, value);
      } catch (_error) {
        // Storage is optional; history navigation remains the source of truth.
      }
    }

    /**
     * Reads the workbench route encoded in the current URL.
     * @returns {"cutout"|"organizer"|"import"|""} Active workbench route.
     */
    function currentWorkbenchRoute() {
      const pathname = String(windowRef.location?.pathname || "/").replace(/\/+$/, "") || "/";
      if (ROUTE_BY_PATH[pathname]) return ROUTE_BY_PATH[pathname];
      const legacyRoute = new URLSearchParams(windowRef.location?.search || "").get("tool") || "";
      return VALID_ROUTES.has(legacyRoute) ? legacyRoute : "";
    }

    /**
     * Returns the ownership domain encoded by the current path.
     * @returns {"project"|"standalone"} Current navigation domain.
     */
    function currentNavigationContext() {
      const pathname = String(windowRef.location?.pathname || "/");
      return pathname === "/projects" || pathname === "/workspace" || pathname.startsWith("/workspace/")
        ? "project"
        : "standalone";
    }

    /**
     * Updates the browser tab title from the active route and animation.
     * @returns {void}
     */
    function updateDocumentTitle() {
      const route = currentWorkbenchRoute();
      const routeLabels = {
        cutout: translate("homeCutoutTitle"),
        import: translate("homeImportTitle"),
        organizer: translate("homeOrganizerTitle"),
        projects: translate("projectHubTitle"),
        scatter: translate("scatterSliceTitle"),
        tools: translate("quickToolsTitle"),
        animation: "动画编辑",
        boxes: "碰撞框",
        trails: "攻击拖尾",
        audio: "帧音频",
        attachments: "附加素材",
        export: "文件导出",
        godot: "Godot 交付",
        "codex-pet": "Codex Pet",
      };
      const currentGroup = getCurrentGroup();
      const context = routeLabels[route] || (currentGroup ? groupLabel(currentGroup) : "");
      if (documentRef) documentRef.title = context ? `${context} · XSXB Frame Tuner` : "XSXB Frame Tuner";
    }

    /**
     * Writes a workbench route without disturbing project or frame state.
     * @param {"cutout"|"organizer"|"import"|""} route Destination route.
     * @param {{push?:boolean,context?:"project"|"standalone"}} [options] History behavior.
     * @returns {void}
     */
    function syncWorkbenchRoute(route, options = {}) {
      const context = options.context || currentNavigationContext();
      const routePaths = context === "project" ? PROJECT_PATH_BY_ROUTE : STANDALONE_PATH_BY_ROUTE;
      const targetPath = routePaths[route] || WORKSPACE_PATH;
      const currentPath = windowRef.location?.pathname || "/";
      const legacyRoute = new URLSearchParams(windowRef.location?.search || "").has("tool");
      if (currentWorkbenchRoute() === route && currentPath === targetPath && !legacyRoute) {
        updateDocumentTitle();
        return;
      }
      const url = new URL(windowRef.location.href);
      url.pathname = targetPath;
      url.searchParams.delete("tool");
      if (!targetPath.startsWith(`${WORKSPACE_PATH}/`) && targetPath !== WORKSPACE_PATH) {
        for (const key of ["project", "group", "frame", "animation"]) url.searchParams.delete(key);
      }
      const method = options.push ? "pushState" : "replaceState";
      windowRef.history[method]({ xsxbWorkbench: route || "home" }, "", url);
      if (route) writeStorage("xsxbFrameTuner.recentWorkbench", route);
      updateDocumentTitle();
      if (typeof windowRef.dispatchEvent === "function" && typeof windowRef.CustomEvent === "function") {
        windowRef.dispatchEvent(new windowRef.CustomEvent("xsxb:routechange", { detail: { route } }));
      }
    }

    /** Returns the safe parent destination for a failed or cancelled route. */
    function restoreParentRoute() {
      if (currentNavigationContext() === "standalone") syncWorkbenchRoute("tools", { context: "standalone" });
      else syncWorkbenchRoute("");
    }

    /**
     * Returns whether a workbench exposes the methods required by a route.
     * @param {string} route Requested route.
     * @param {object|null} batchCutout Cutout controller.
     * @param {object|null} frameOrganizer Organizer controller.
     * @returns {boolean} Whether the route can be opened.
     */
    function routeControllerAvailable(route, batchCutout, frameOrganizer) {
      if (route === "cutout") {
        return typeof batchCutout?.isOpen === "function" && typeof batchCutout?.open === "function";
      }
      if (route === "organizer") {
        return typeof frameOrganizer?.isOpen === "function" && typeof frameOrganizer?.open === "function";
      }
      if (route === "import") {
        return (
          typeof frameOrganizer?.isOpen === "function" && typeof frameOrganizer?.openImport === "function"
        );
      }
      return true;
    }

    /**
     * Returns the route represented by the currently open workbench.
     * @param {object|null} batchCutout Cutout controller.
     * @param {object|null} frameOrganizer Organizer controller.
     * @returns {string} Visible workbench route or home.
     */
    function visibleWorkbenchRoute(batchCutout, frameOrganizer) {
      if (batchCutout?.isOpen?.()) return "cutout";
      if (frameOrganizer?.isOpen?.()) {
        return frameOrganizer.getMode?.() === "import" ? "import" : "organizer";
      }
      return "";
    }

    /**
     * Closes a workbench through its async or synchronous close API.
     * @param {object|null} controller Workbench controller.
     * @param {...unknown} args Close arguments.
     * @returns {Promise<boolean>} Whether closing was accepted.
     */
    async function closeWorkbench(controller, ...args) {
      if (!controller) return true;
      if (typeof controller.requestClose === "function")
        return Boolean(await controller.requestClose(...args));
      if (typeof controller.close === "function") {
        controller.close(...args);
        return true;
      }
      return false;
    }

    /**
     * Applies the current URL route once. Calls are serialized by the public
     * wrapper so asynchronous close/open operations cannot finish out of order.
     * @returns {Promise<boolean>} Whether the requested route was applied.
     */
    async function applyWorkbenchRouteNow() {
      const route = currentWorkbenchRoute();
      if (new URLSearchParams(windowRef.location?.search || "").has("tool")) {
        syncWorkbenchRoute(route);
      }
      updateDocumentTitle();
      const batchCutout = getBatchCutout();
      const frameOrganizer = getFrameOrganizer();
      if (!routeControllerAvailable(route, batchCutout, frameOrganizer)) {
        restoreParentRoute();
        return false;
      }
      try {
        const visibleRoute = visibleWorkbenchRoute(batchCutout, frameOrganizer);
        const temporarySessionActive =
          currentNavigationContext() === "standalone" && Boolean(getTemporaryWorkset()?.frames?.length);
        if (route && !visibleRoute && getWorkspaceDirty()) {
          const decision = await requestWorkspaceDecision();
          if (decision === "cancel") {
            syncWorkbenchRoute("", { context: "project" });
            return false;
          }
          if (decision === "save") await saveWorkspace();
          else if (decision === "discard") await discardWorkspaceChanges();
          else {
            syncWorkbenchRoute("", { context: "project" });
            return false;
          }
        }
        if (route === "cutout") {
          if (frameOrganizer?.isOpen()) {
            const organizerRoute = frameOrganizer.getMode?.() === "import" ? "import" : "organizer";
            const closed = await closeWorkbench(frameOrganizer, {
              syncRoute: false,
              force: temporarySessionActive,
            });
            if (!closed) {
              syncWorkbenchRoute(organizerRoute);
              return false;
            }
          }
          if (!batchCutout?.isOpen()) {
            const temporaryWorkset =
              currentNavigationContext() === "standalone" ? getTemporaryWorkset() : null;
            const openedTemporary = temporaryWorkset?.frames?.length
              ? openTemporaryCutout(temporaryWorkset)
              : false;
            if (!openedTemporary) batchCutout?.open({ syncRoute: false });
          }
          return true;
        }
        if (batchCutout?.isOpen()) {
          const closed = await closeWorkbench(batchCutout, null, {
            syncRoute: false,
            force: temporarySessionActive,
          });
          if (!closed) {
            syncWorkbenchRoute("cutout");
            return false;
          }
          await Promise.resolve();
        }
        if (route === "organizer" || route === "import") {
          const hasCurrentFrames = Boolean(getCurrentGroup()?.frames?.length);
          const targetMode = route === "import" || !hasCurrentFrames ? "import" : "edit";
          if (!frameOrganizer?.isOpen() || frameOrganizer.getMode?.() !== targetMode) {
            if (frameOrganizer?.isOpen()) {
              const organizerRoute = frameOrganizer.getMode?.() === "import" ? "import" : "organizer";
              const closed = await closeWorkbench(frameOrganizer, {
                syncRoute: false,
                force: temporarySessionActive,
              });
              if (!closed) {
                syncWorkbenchRoute(organizerRoute);
                return false;
              }
            }
            const temporaryWorkset =
              currentNavigationContext() === "standalone" ? getTemporaryWorkset() : null;
            if (temporaryWorkset?.frames?.length && frameOrganizer?.openWorkset) {
              await frameOrganizer.openWorkset(temporaryWorkset, { syncRoute: false });
            } else {
              const open = targetMode === "import" ? frameOrganizer?.openImport : frameOrganizer?.open;
              await open?.({ syncRoute: false });
            }
          }
          return true;
        }
        if (frameOrganizer?.isOpen()) {
          const organizerRoute = frameOrganizer.getMode?.() === "import" ? "import" : "organizer";
          const closed = await closeWorkbench(frameOrganizer, {
            syncRoute: false,
            force: temporarySessionActive,
          });
          if (!closed) {
            syncWorkbenchRoute(organizerRoute);
            return false;
          }
        }
        if (["animation", "boxes", "trails", "audio", "attachments"].includes(route)) {
          activateWorkspaceRoute(route);
          return true;
        }
        if (["export", "godot", "codex-pet"].includes(route)) {
          activateWorkspaceRoute(route);
          return true;
        }
        if (route === "projects" || route === "tools" || route === "scatter") return true;
        return true;
      } catch (error) {
        const visibleRoute = visibleWorkbenchRoute(batchCutout, frameOrganizer);
        if (visibleRoute) syncWorkbenchRoute(visibleRoute);
        else restoreParentRoute();
        throw error;
      }
    }

    /**
     * Opens or closes workbenches to match the current browser URL in order.
     * @returns {Promise<boolean>} Whether the requested route was applied.
     */
    function applyWorkbenchRoute() {
      const task = applyRouteQueue.then(() => applyWorkbenchRouteNow());
      applyRouteQueue = task.catch(() => false);
      return task;
    }

    /**
     * Persists the navigable project/group/frame selection in the browser URL.
     * @param {{push?:boolean}} [options] History behavior.
     * @returns {void}
     */
    function syncUrlState(options = {}) {
      const url = new URL(windowRef.location.href);
      const currentGroup = getCurrentGroup();
      const ownsProjectSelection =
        url.pathname === WORKSPACE_PATH || url.pathname.startsWith(`${WORKSPACE_PATH}/`);
      const entries = {
        project: ownsProjectSelection ? getActiveProjectId() : "",
        group: ownsProjectSelection ? currentGroup?.uiId || "" : "",
        frame: ownsProjectSelection && currentGroup ? String(getSelectedFrame()) : "",
      };
      for (const [key, value] of Object.entries(entries)) {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      url.searchParams.delete("animation");
      const method = options.push ? "pushState" : "replaceState";
      windowRef.history[method]({ xsxbSelection: true }, "", url);
    }

    return {
      applyWorkbenchRoute,
      currentNavigationContext,
      currentWorkbenchRoute,
      syncUrlState,
      syncWorkbenchRoute,
      updateDocumentTitle,
    };
  }

  /**
   * Resolves localStorage without throwing when browser access is denied.
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

  return { createController };
});
