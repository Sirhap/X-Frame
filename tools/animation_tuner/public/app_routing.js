(function attachXsxbAppRouting(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppRouting = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const ROUTE_BY_PATH = Object.freeze({
    "/tools/cutout": "cutout",
    "/tools/import": "import",
    "/tools/organizer": "organizer",
  });
  const PATH_BY_ROUTE = Object.freeze({
    cutout: "/tools/cutout",
    import: "/tools/import",
    organizer: "/tools/organizer",
  });
  const VALID_ROUTES = new Set(Object.keys(PATH_BY_ROUTE));

  /**
   * Creates the route and workbench coordination controller.
   * @param {{
   *   elements?:Record<string,object|null|undefined>,
   *   getConfig?:()=>object|null,
   *   getLanguage?:()=>string,
   *   getCurrentGroup?:()=>object|null,
   *   getHomeHubDismissed?:()=>boolean,
   *   setHomeHubDismissed?:(dismissed:boolean)=>void,
   *   getSelectedProfileId?:()=>string,
   *   getSelectedFrame?:()=>number,
   *   getActiveProjectId?:()=>string,
   *   getBatchCutout?:()=>object|null,
   *   getFrameOrganizer?:()=>object|null,
   *   translate?:(key:string,variables?:object)=>string,
   *   projectLabel?:(project:object|null|undefined)=>string,
   *   groupLabel?:(group:object|null|undefined)=>string,
   *   windowRef?:Window,
   *   documentRef?:Document,
   *   storage?:Storage|null,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   renderHomeHub:()=>void,
   *   currentWorkbenchRoute:()=>string,
   *   updateDocumentTitle:()=>void,
   *   syncWorkbenchRoute:(route:string,options?:{push?:boolean})=>void,
   *   applyWorkbenchRoute:()=>Promise<boolean>,
   *   syncUrlState:(options?:{push?:boolean})=>void,
   * }} Route operations.
   */
  function createController(dependencies = {}) {
    const {
      elements = {},
      getConfig = () => null,
      getLanguage = () => "zh",
      getCurrentGroup = () => null,
      getHomeHubDismissed = () => true,
      setHomeHubDismissed = () => {},
      getSelectedProfileId = () => "all",
      getSelectedFrame = () => 0,
      getActiveProjectId = () => "",
      getBatchCutout = () => null,
      getFrameOrganizer = () => null,
      translate = (key) => key,
      projectLabel = (project) => String(project?.name || ""),
      groupLabel = (group) => String(group?.name || ""),
      windowRef = root,
    } = dependencies;
    const documentRef = dependencies.documentRef ?? windowRef.document ?? root.document;
    const storage = dependencies.storage ?? resolveStorage(windowRef);
    let applyRouteQueue = Promise.resolve();

    /**
     * Reads a route-related storage value without breaking private browsing.
     * @param {string} key Storage key.
     * @returns {string} Stored value or an empty string.
     */
    function readStorage(key) {
      try {
        return storage?.getItem(key) || "";
      } catch (_error) {
        return "";
      }
    }

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
     * Updates the browser tab title from the active route and animation.
     * @returns {void}
     */
    function updateDocumentTitle() {
      const route = currentWorkbenchRoute();
      const routeLabels = {
        cutout: translate("homeCutoutTitle"),
        import: translate("homeImportTitle"),
        organizer: translate("homeOrganizerTitle"),
      };
      const currentGroup = getCurrentGroup();
      const context = routeLabels[route] || (currentGroup ? groupLabel(currentGroup) : "");
      if (documentRef) documentRef.title = context ? `${context} · XSXB Frame Tuner` : "XSXB Frame Tuner";
    }

    /**
     * Renders the home dashboard summary and visibility state.
     * @returns {void}
     */
    function renderHomeHub() {
      if (!elements.homeHub) return;
      const config = getConfig();
      const currentGroup = getCurrentGroup();
      const language = getLanguage();
      elements.homeHub.hidden = currentWorkbenchRoute() !== "" || getHomeHubDismissed();
      elements.homeHubOpen?.setAttribute("aria-pressed", String(!elements.homeHub.hidden));
      if (elements.homeRecentProject) {
        elements.homeRecentProject.textContent = projectLabel(config?.activeProject) || "—";
      }
      const groups = Array.isArray(config?.groups) ? config.groups : [];
      const profiles = Array.isArray(config?.profiles) ? config.profiles : [];
      const numberFormatter = new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en");
      if (elements.homeAnimationCount)
        elements.homeAnimationCount.textContent = numberFormatter.format(groups.length);
      if (elements.homeFrameCount) {
        const frameCount = groups.reduce(
          (total, group) => total + (Array.isArray(group.frames) ? group.frames.length : 0),
          0,
        );
        elements.homeFrameCount.textContent = numberFormatter.format(frameCount);
      }
      if (elements.homeProfileCount)
        elements.homeProfileCount.textContent = numberFormatter.format(profiles.length);
      if (elements.homeRecentAnimation) {
        elements.homeRecentAnimation.textContent = currentGroup ? groupLabel(currentGroup) : "—";
      }
      if (elements.homeProjectPath) {
        elements.homeProjectPath.textContent =
          config?.activeProject?.workspacePath || config?.workspaceRoot || "—";
      }
      if (elements.homeLastEdited) {
        const timestamp = Date.parse(readStorage("xsxbFrameTuner.lastEditedAt"));
        elements.homeLastEdited.textContent = Number.isFinite(timestamp)
          ? new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(timestamp)
          : "—";
      }
      if (elements.homeRecentTool) {
        const recent = readStorage("xsxbFrameTuner.recentWorkbench");
        const labels = {
          cutout: translate("homeCutoutTitle"),
          import: translate("homeImportTitle"),
          organizer: translate("homeOrganizerTitle"),
        };
        elements.homeRecentTool.textContent = labels[recent] || "—";
      }
      updateDocumentTitle();
    }

    /**
     * Writes a workbench route without disturbing project or frame state.
     * @param {"cutout"|"organizer"|"import"|""} route Destination route.
     * @param {{push?:boolean}} [options] History behavior.
     * @returns {void}
     */
    function syncWorkbenchRoute(route, options = {}) {
      const targetPath = PATH_BY_ROUTE[route] || "/";
      const currentPath = windowRef.location?.pathname || "/";
      const legacyRoute = new URLSearchParams(windowRef.location?.search || "").has("tool");
      if (!route) setHomeHubDismissed(true);
      if (currentWorkbenchRoute() === route && currentPath === targetPath && !legacyRoute) {
        renderHomeHub();
        return;
      }
      const url = new URL(windowRef.location.href);
      url.pathname = targetPath;
      url.searchParams.delete("tool");
      const method = options.push ? "pushState" : "replaceState";
      windowRef.history[method]({ xsxbWorkbench: route || "home" }, "", url);
      if (route) writeStorage("xsxbFrameTuner.recentWorkbench", route);
      renderHomeHub();
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
      if (!route) setHomeHubDismissed(true);
      if (new URLSearchParams(windowRef.location?.search || "").has("tool")) {
        syncWorkbenchRoute(route);
      }
      renderHomeHub();
      const batchCutout = getBatchCutout();
      const frameOrganizer = getFrameOrganizer();
      if (!routeControllerAvailable(route, batchCutout, frameOrganizer)) {
        syncWorkbenchRoute("");
        return false;
      }
      try {
        if (route === "cutout") {
          if (frameOrganizer?.isOpen()) {
            const organizerRoute = frameOrganizer.getMode?.() === "import" ? "import" : "organizer";
            const closed = await closeWorkbench(frameOrganizer, { syncRoute: false });
            if (!closed) {
              syncWorkbenchRoute(organizerRoute);
              return false;
            }
          }
          if (!batchCutout?.isOpen()) batchCutout?.open({ syncRoute: false });
          return true;
        }
        if (batchCutout?.isOpen()) {
          const closed = await closeWorkbench(batchCutout, null, { syncRoute: false });
          if (!closed) {
            syncWorkbenchRoute("cutout");
            return false;
          }
          await Promise.resolve();
        }
        if (route === "organizer" || route === "import") {
          const targetMode = route === "import" ? "import" : "edit";
          if (!frameOrganizer?.isOpen() || frameOrganizer.getMode?.() !== targetMode) {
            if (frameOrganizer?.isOpen()) {
              const organizerRoute = frameOrganizer.getMode?.() === "import" ? "import" : "organizer";
              const closed = await closeWorkbench(frameOrganizer, { syncRoute: false });
              if (!closed) {
                syncWorkbenchRoute(organizerRoute);
                return false;
              }
            }
            const open = targetMode === "import" ? frameOrganizer?.openImport : frameOrganizer?.open;
            await open?.({ syncRoute: false });
          }
          return true;
        }
        if (frameOrganizer?.isOpen()) {
          const organizerRoute = frameOrganizer.getMode?.() === "import" ? "import" : "organizer";
          const closed = await closeWorkbench(frameOrganizer, { syncRoute: false });
          if (!closed) {
            syncWorkbenchRoute(organizerRoute);
            return false;
          }
        }
        return true;
      } catch (error) {
        syncWorkbenchRoute(visibleWorkbenchRoute(batchCutout, frameOrganizer));
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
      const selectedProfileId = getSelectedProfileId();
      const entries = {
        project: getActiveProjectId(),
        profile: selectedProfileId !== "all" ? selectedProfileId : "",
        group: currentGroup?.uiId || "",
        frame: currentGroup ? String(getSelectedFrame()) : "",
      };
      for (const [key, value] of Object.entries(entries)) {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      const method = options.push ? "pushState" : "replaceState";
      windowRef.history[method]({ xsxbSelection: true }, "", url);
    }

    return {
      applyWorkbenchRoute,
      currentWorkbenchRoute,
      renderHomeHub,
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
