(function attachXsxbAppShell(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const STORAGE_KEYS = Object.freeze({
    sidebarCollapsed: "xsxbFrameTuner.sidebarCollapsed",
    filmstripLayout: "xsxbFrameTuner.filmstripLayout",
    kunkunUnlocked: "xsxbFrameTuner.kunkunUnlocked",
  });
  const FILMSTRIP_LAYOUTS = Object.freeze(["single", "grid"]);
  const TOOL_ROUTE_BY_PATH = Object.freeze({
    "/tools/cutout": "cutout",
    "/tools/import": "import",
    "/tools/organizer": "import",
    "/tools/scatter-slice": "scatter",
    "/workspace/tools/cutout": "cutout",
    "/workspace/tools/organizer": "organizer",
    "/workspace/resources/import": "organizer",
    "/workspace/resources/cutout": "cutout",
    "/workspace/resources/scatter": "scatter",
    "/workspace/animation/overview": "overview",
    "/workspace/animation/transform": "animation",
    "/workspace/animation/boxes": "boxes",
    "/workspace/animation/trails": "trails",
    "/workspace/animation/audio": "audio",
    "/workspace/animation/attachments": "attachments",
    "/workspace/delivery/export": "export",
    "/workspace/delivery/godot": "godot",
    "/workspace/delivery/codex-pet": "codex-pet",
    "/tools/export": "export",
  });

  /**
   * Returns a supported filmstrip layout.
   * @param {unknown} value Persisted layout value.
   * @returns {"single"|"grid"} Safe layout.
   */
  function normalizeFilmstripLayout(value) {
    return FILMSTRIP_LAYOUTS.includes(String(value)) ? String(value) : "single";
  }

  /**
   * Reads a local preference without breaking startup when storage is blocked.
   * @param {Storage|null} storage Browser storage.
   * @param {string} key Preference key.
   * @param {string} fallback Fallback value.
   * @returns {string} Stored or fallback value.
   */
  function readPreference(storage, key, fallback = "") {
    try {
      return storage?.getItem(key) ?? fallback;
    } catch (_error) {
      return fallback;
    }
  }

  /**
   * Creates the desktop creative-tool application shell.
   * @param {{
   *   documentRef?:Document,
   *   windowRef?:Window,
   *   storage?:Storage|null,
   *   navigate?:(route:string)=>Promise<boolean>|boolean,
   *   openContextTool?:(tool:string)=>Promise<boolean>|boolean,
   *   translate?:(key:string)=>string,
   * }} [dependencies] Browser dependencies and route adapter.
   * @returns {{
   *   bind:()=>void,
   *   destroy:()=>void,
   *   setFilmstripLayout:(layout:string)=>void,
   *   setSidebarCollapsed:(collapsed:boolean)=>void,
   *   syncActiveRoute:()=>void,
   * }} Shell controller.
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const storage = dependencies.storage ?? resolveStorage(windowRef);
    const navigate = dependencies.navigate || defaultNavigate;
    const openContextTool = dependencies.openContextTool || (() => true);
    const translate =
      dependencies.translate ||
      ((key) => ({ collapseSidebar: "折叠参数栏", expandSidebar: "展开参数栏" })[key] || key);
    if (!documentRef?.querySelector || !documentRef?.querySelectorAll) {
      throw new TypeError("XSXB App Shell requires a document-like query interface.");
    }

    const elements = {
      body: documentRef.body,
      sidebar: documentRef.querySelector("#workbenchSidebar"),
      workspace: documentRef.querySelector(".workspace"),
      projectHub: documentRef.querySelector("#projectHub"),
      quickToolsHub: documentRef.querySelector("#quickToolsHub"),
      scatterSliceSurface: documentRef.querySelector("#scatterSliceSurface"),
      deliverySurface: documentRef.querySelector("#deliverySurface"),
      collapse: documentRef.querySelector("#sidebarCollapse"),
      filmstripPanel: documentRef.querySelector(".filmstripPanel"),
      filmstripButtons: Array.from(documentRef.querySelectorAll("[data-filmstrip-layout]")),
      routeItems: Array.from(documentRef.querySelectorAll("[data-app-mode]")),
      workbenchRouteItems: Array.from(documentRef.querySelectorAll("[data-workbench-route]")),
      brandMark: documentRef.querySelector("#brandMark"),
      kunkunButtons: Array.from(documentRef.querySelectorAll(".kunkunThemeButton")),
      actionFeedback: documentRef.querySelector(".contextActionFeedback"),
      actionButtons: documentRef.querySelector(".contextActionBarActions"),
      toolRailTools: documentRef.querySelector("#toolRailTools"),
      toolRailContextMenu: documentRef.querySelector("#toolRailContextMenu"),
      toolRailContextTitle: documentRef.querySelector("#toolRailContextTitle"),
      toolRailContextHint: documentRef.querySelector("#toolRailContextHint"),
      toolRailContextActions: Array.from(documentRef.querySelectorAll("[data-context-tool]")),
      workflowStages: Array.from(documentRef.querySelectorAll("[data-workspace-stage]")),
      workflowTools: Array.from(documentRef.querySelectorAll("[data-stage-tools]")),
      workflowRouteItems: Array.from(documentRef.querySelectorAll(".workspaceSecondaryTabs a")),
      workspaceAccount: documentRef.querySelector("#workspaceAccount"),
      workspaceFlowBack: documentRef.querySelector("#workspaceFlowBack"),
    };
    const disposers = [];
    let bound = false;
    let logoClickCount = 0;
    let logoClickTimer = 0;
    let routeObserver = null;
    let contextToolMenuTimer = 0;

    /** Clears a pending delayed tool-menu transition. @returns {void} */
    function clearContextToolMenuTimer() {
      windowRef.clearTimeout?.(contextToolMenuTimer);
      contextToolMenuTimer = 0;
    }

    /** Updates the contextual tool menu from the active workbench selection. @returns {boolean} */
    function updateContextToolMenu() {
      const frameCount = documentRef.querySelectorAll(".thumb").length;
      const isWorkspace = elements.body?.dataset.appSurface === "workspace";
      const available = isWorkspace && frameCount > 0;
      if (elements.toolRailContextTitle) {
        elements.toolRailContextTitle.textContent = available
          ? `当前动画 · ${frameCount} 帧`
          : "没有可带入工具的动画帧";
      }
      if (elements.toolRailContextHint) {
        elements.toolRailContextHint.textContent = available
          ? "在项目内处理，结果会回写到当前动画。"
          : "先选择一个动画，再使用当前帧或批量处理工具。";
      }
      for (const action of elements.toolRailContextActions) action.disabled = !available;
      return available;
    }

    /** Shows the delayed contextual tools without leaving the current project. @returns {void} */
    function showContextToolMenu() {
      clearContextToolMenuTimer();
      if (!elements.toolRailContextMenu || !updateContextToolMenu()) return;
      elements.toolRailContextMenu.hidden = false;
      elements.toolRailTools?.setAttribute("aria-expanded", "true");
    }

    /** Hides the contextual tools. @returns {void} */
    function hideContextToolMenu() {
      clearContextToolMenuTimer();
      if (elements.toolRailContextMenu) elements.toolRailContextMenu.hidden = true;
      elements.toolRailTools?.setAttribute("aria-expanded", "false");
    }

    /** Starts a delayed visibility change. @param {boolean} visible Whether to show the menu. @returns {void} */
    function scheduleContextToolMenu(visible) {
      clearContextToolMenuTimer();
      contextToolMenuTimer = windowRef.setTimeout?.(
        visible ? showContextToolMenu : hideContextToolMenu,
        visible ? 450 : 160,
      );
    }

    /** Runs one context-aware tool in the existing workbench document. @param {Event} event Trigger event. */
    async function handleContextToolAction(event) {
      const target = event.currentTarget;
      const tool = target?.dataset?.contextTool;
      const selector =
        tool === "current-frame-cutout"
          ? "#cutoutCurrentFrame"
          : tool === "batch-cutout"
            ? "#cutoutOpen"
            : tool === "organizer"
              ? "#organizerOpen"
              : "";
      const action = selector ? documentRef.querySelector(selector) : null;
      if (!action || action.disabled) return;
      hideContextToolMenu();
      if (await openContextTool(tool)) action.click();
    }

    /** @param {string} key @param {string|boolean} value */
    function writePreference(key, value) {
      try {
        storage?.setItem(key, String(value));
      } catch (_error) {
        // UI preferences remain usable for the current session.
      }
    }

    /** @param {EventTarget|null} target @param {string} type @param {(event:Event)=>void} listener */
    function listen(target, type, listener) {
      target?.addEventListener?.(type, listener);
      disposers.push(() => target?.removeEventListener?.(type, listener));
    }

    /**
     * Assigns sidebar blocks to the workspace tool that owns them, so the URL is the
     * only thing that decides which panel is on screen. Blocks left uncategorized —
     * the animation picker — stay visible on every tool because they are context
     * rather than one tool's parameters.
     */
    function categorizeSidebar() {
      const categorySelectors = {
        overview: [
          "#projectContext",
          "#importAnimationOpen",
          '[data-panel="project-processing"]',
          '[data-panel="scene-reference"]',
        ],
        animation: ['[data-panel="adjustment-base"]'],
        boxes: ['[data-panel="boxes"]'],
        trails: ['[data-panel="attack-trails"]'],
        audio: ['[data-panel="frame-audio"]'],
        attachments: ['[data-panel="attachment-assets"]'],
      };
      for (const [category, selectors] of Object.entries(categorySelectors)) {
        for (const selector of selectors) {
          documentRef.querySelector(selector)?.setAttribute("data-shell-category", category);
        }
      }
    }

    /** Moves persistent workspace actions into the shared bottom action bar. */
    function mountContextActions() {
      const saveState = documentRef.querySelector("#saveState");
      const status = documentRef.querySelector("#status");
      const save = documentRef.querySelector("#save");
      const exportButton = documentRef.querySelector("#exportWorkbench");
      if (elements.actionFeedback) {
        if (saveState) elements.actionFeedback.append(saveState);
        if (status) elements.actionFeedback.append(status);
      }
      if (elements.actionButtons) {
        if (exportButton) elements.actionButtons.append(exportButton);
        if (save) elements.actionButtons.append(save);
      }
    }

    /** Moves animation-owned preprocessing actions beside the selected animation. */
    function mountProjectProcessingActions() {
      const target = documentRef.querySelector(".projectProcessingActions");
      const organizer = documentRef.querySelector("#organizerOpen");
      const cutout = documentRef.querySelector("#cutoutOpen");
      const currentFrameCutout = documentRef.querySelector("#cutoutCurrentFrame");
      if (!target) return;
      if (currentFrameCutout) target.append(currentFrameCutout);
      if (organizer) target.append(organizer);
      if (cutout) target.append(cutout);
    }

    /**
     * Expands the panel the active tool exists to edit, so landing on a tool never
     * shows a collapsed summary the user has to hunt for. Deliberately does not
     * scroll: this runs on every route sync, and scrolling the panel into view
     * drags the whole document and pushes the workspace toolbar off screen.
     * @param {string} tool Active workspace tool.
     */
    function revealToolPanel(tool) {
      const panel = documentRef.querySelector(
        tool === "trails" ? "#attackTrailPanel" : `[data-shell-category="${tool}"]`,
      );
      if (!panel) return;
      panel.hidden = false;
      panel.removeAttribute?.("hidden");
      panel.open = true;
    }

    /** @param {boolean} collapsed Whether the parameter sidebar is hidden. */
    function setSidebarCollapsed(collapsed) {
      const isCollapsed = Boolean(collapsed);
      elements.body?.classList.toggle("sidebarCollapsed", isCollapsed);
      elements.collapse?.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      const label = translate(isCollapsed ? "expandSidebar" : "collapseSidebar");
      elements.collapse?.setAttribute("aria-label", label);
      elements.collapse?.setAttribute("title", label);
      syncHiddenWorkbenchAccessibility();
      writePreference(STORAGE_KEYS.sidebarCollapsed, isCollapsed);
    }

    /** @param {string} rawLayout Requested filmstrip layout. */
    function setFilmstripLayout(rawLayout) {
      const layout = normalizeFilmstripLayout(rawLayout);
      if (elements.filmstripPanel) elements.filmstripPanel.dataset.layout = layout;
      for (const button of elements.filmstripButtons) {
        const active = button.dataset.filmstripLayout === layout;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }
      writePreference(STORAGE_KEYS.filmstripLayout, layout);
    }

    /** Returns the top-level product mode represented by one path. */
    function appModeForPath(path) {
      return path === "/projects" || path === "/workspace" || path.startsWith("/workspace/")
        ? "projects"
        : "tools";
    }

    /** Returns the project workflow stage represented by one route. */
    function workspaceStageForRoute(route, path) {
      // Hubs are not a stage; claiming one lights up "resources" while the user is
      // still choosing a project.
      if (["projects", "tools"].includes(route)) return "";
      if (["export", "godot", "codex-pet"].includes(route)) return "delivery";
      if (
        ["overview", "animation", "boxes", "trails", "audio", "attachments"].includes(route) ||
        path === "/workspace"
      ) {
        return "animation";
      }
      return "resources";
    }

    /** Synchronizes tool-rail selection and visible surface with the canonical route. */
    function syncActiveRoute() {
      const path = String(windowRef.location?.pathname || "/").replace(/\/+$/, "") || "/";
      const route =
        TOOL_ROUTE_BY_PATH[path] ?? (path === "/projects" ? "projects" : path === "/tools" ? "tools" : "");
      const appMode = appModeForPath(path);
      const workspaceStage = workspaceStageForRoute(route, path);
      for (const item of elements.routeItems) {
        const active = item.dataset.appMode === appMode;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      }
      elements.body?.setAttribute("data-workbench", route || "workspace");
      elements.body?.setAttribute("data-app-mode", appMode);
      elements.body?.setAttribute("data-workspace-stage", workspaceStage);
      elements.body?.setAttribute("data-workspace-tool", route || "animation");
      for (const item of elements.workflowStages) {
        const active = item.dataset.workspaceStage === workspaceStage;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      }
      for (const group of elements.workflowTools) {
        group.classList.toggle("active", group.dataset.stageTools === workspaceStage);
      }
      revealToolPanel(route || "animation");
      for (const item of elements.workflowRouteItems) {
        const active = item.dataset.workbenchRoute === (route || "animation");
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      }
      const surface =
        root.XSXBAppSurface?.resolveAppSurface?.(path) ||
        (path === "/projects"
          ? "projects"
          : path === "/tools"
            ? "tools"
            : ["export", "godot", "codex-pet"].includes(route)
              ? "delivery"
              : route === "scatter"
                ? "scatter"
                : ["animation", "boxes", "trails", "audio", "attachments"].includes(route)
                  ? "workspace"
                  : route
                    ? "tool"
                    : "workspace");
      documentRef.documentElement?.setAttribute?.("data-app-surface", surface);
      elements.body?.setAttribute("data-app-surface", surface);
      if (elements.body?.dataset.appSurface !== "workspace") hideContextToolMenu();
      syncHiddenWorkbenchAccessibility();
    }

    /** Removes visually hidden workbench regions from keyboard and screen-reader navigation. */
    function syncHiddenWorkbenchAccessibility() {
      const surface = elements.body?.dataset.appSurface || "workspace";
      const workspaceVisible = surface === "workspace";
      const sidebarHidden = !workspaceVisible || elements.body?.classList.contains("sidebarCollapsed");
      if (elements.sidebar) {
        elements.sidebar.hidden = !workspaceVisible;
        elements.sidebar.inert = Boolean(sidebarHidden);
        elements.sidebar.setAttribute("aria-hidden", sidebarHidden ? "true" : "false");
      }
      if (elements.workspace) {
        elements.workspace.hidden = !workspaceVisible;
        elements.workspace.inert = Boolean(!workspaceVisible);
        elements.workspace.setAttribute("aria-hidden", workspaceVisible ? "false" : "true");
      }
      syncHubVisibility(elements.projectHub, surface === "projects");
      syncHubVisibility(elements.quickToolsHub, surface === "tools");
      syncHubVisibility(elements.scatterSliceSurface, surface === "scatter");
      syncHubVisibility(elements.deliverySurface, surface === "delivery");
    }

    /** @param {HTMLElement|null} hub Hub surface. @param {boolean} visible Whether it is active. */
    function syncHubVisibility(hub, visible) {
      if (!hub) return;
      hub.hidden = !visible;
      hub.inert = !visible;
      hub.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    /** Reveals the optional easter-egg theme without occupying normal UI. */
    function unlockKunkunTheme() {
      for (const button of elements.kunkunButtons) button.hidden = false;
      elements.body?.classList.add("kunkunUnlocked");
      writePreference(STORAGE_KEYS.kunkunUnlocked, true);
      if (elements.actionFeedback) {
        elements.actionFeedback.dataset.shellMessage = "彩蛋主题已解锁";
        windowRef.setTimeout?.(() => delete elements.actionFeedback.dataset.shellMessage, 2400);
      }
    }

    /** Counts intentional logo clicks and unlocks the easter egg on the fifth click. */
    function handleBrandActivation() {
      logoClickCount += 1;
      windowRef.clearTimeout?.(logoClickTimer);
      if (logoClickCount >= 5) {
        logoClickCount = 0;
        unlockKunkunTheme();
        return;
      }
      logoClickTimer = windowRef.setTimeout?.(() => {
        logoClickCount = 0;
      }, 1800);
    }

    /** @param {MouseEvent} event Tool-rail navigation event. */
    async function handleRouteClick(event) {
      event.preventDefault();
      const route =
        event.currentTarget.dataset.workbenchRoute || event.currentTarget.dataset.appMode || "projects";
      try {
        await navigate(route);
      } finally {
        syncActiveRoute();
      }
    }

    /** Binds shell behavior once. */
    function bind() {
      if (bound) return;
      bound = true;
      categorizeSidebar();
      mountContextActions();
      mountProjectProcessingActions();
      setFilmstripLayout(readPreference(storage, STORAGE_KEYS.filmstripLayout, "single"));
      setSidebarCollapsed(readPreference(storage, STORAGE_KEYS.sidebarCollapsed, "false") === "true");
      const themePreference = readPreference(storage, "xsxbFrameTuner.theme", "dark");
      if (
        themePreference === "kunkun" ||
        readPreference(storage, STORAGE_KEYS.kunkunUnlocked, "false") === "true"
      ) {
        unlockKunkunTheme();
      }
      syncActiveRoute();

      for (const button of elements.filmstripButtons) {
        listen(button, "click", () => setFilmstripLayout(button.dataset.filmstripLayout));
      }
      for (const item of elements.routeItems) listen(item, "click", handleRouteClick);
      for (const item of elements.workbenchRouteItems) listen(item, "click", handleRouteClick);
      elements.toolRailTools?.setAttribute("aria-expanded", "false");
      elements.toolRailTools?.setAttribute("aria-controls", "toolRailContextMenu");
      listen(elements.toolRailTools, "pointerenter", () => scheduleContextToolMenu(true));
      listen(elements.toolRailTools, "pointerleave", () => scheduleContextToolMenu(false));
      listen(elements.toolRailTools, "focus", showContextToolMenu);
      listen(elements.toolRailContextMenu, "pointerenter", clearContextToolMenuTimer);
      listen(elements.toolRailContextMenu, "pointerleave", () => scheduleContextToolMenu(false));
      listen(elements.toolRailContextMenu, "focusout", (event) => {
        if (!elements.toolRailContextMenu?.contains(event.relatedTarget)) scheduleContextToolMenu(false);
      });
      for (const action of elements.toolRailContextActions) listen(action, "click", handleContextToolAction);
      listen(elements.workspaceAccount, "click", () =>
        documentRef.querySelector("#activationManage")?.click(),
      );
      listen(elements.workspaceFlowBack, "click", () => {
        if (elements.body?.dataset.workspaceTool !== "scatter") return;
        navigate(elements.body?.dataset.appMode === "projects" ? "animation" : "tools");
      });
      listen(documentRef, "keydown", (event) => {
        if (event.key === "Escape") hideContextToolMenu();
      });
      listen(elements.collapse, "click", () =>
        setSidebarCollapsed(!elements.body?.classList.contains("sidebarCollapsed")),
      );
      listen(elements.brandMark, "click", handleBrandActivation);
      listen(elements.brandMark, "keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") handleBrandActivation();
      });
      listen(windowRef, "popstate", syncActiveRoute);
      listen(windowRef, "xsxb:routechange", syncActiveRoute);

      if (typeof windowRef.MutationObserver === "function" && elements.body) {
        routeObserver = new windowRef.MutationObserver(syncActiveRoute);
        routeObserver.observe(elements.body, { attributes: true, attributeFilter: ["class"] });
      }
    }

    /** Removes shell event listeners and observers. */
    function destroy() {
      for (const dispose of disposers.splice(0)) dispose();
      routeObserver?.disconnect();
      routeObserver = null;
      bound = false;
    }

    /** @param {string} route Fallback route. @returns {boolean} */
    function defaultNavigate(route) {
      const target = route === "tools" ? "/tools" : "/projects";
      windowRef.location.assign(target);
      return true;
    }

    return {
      bind,
      destroy,
      setFilmstripLayout,
      setSidebarCollapsed,
      syncActiveRoute,
    };
  }

  /** @param {Window|typeof globalThis} scope @returns {Storage|null} */
  function resolveStorage(scope) {
    try {
      return scope?.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  return Object.freeze({
    FILMSTRIP_LAYOUTS,
    STORAGE_KEYS,
    createController,
    normalizeFilmstripLayout,
    readPreference,
  });
});
