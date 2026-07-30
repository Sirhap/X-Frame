(function attachXsxbAppShell(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const STORAGE_KEYS = Object.freeze({
    sidebarCollapsed: "xsxbFrameTuner.sidebarCollapsed",
    activePanelTab: "xsxbFrameTuner.activePanelTab",
    filmstripLayout: "xsxbFrameTuner.filmstripLayout",
    kunkunUnlocked: "xsxbFrameTuner.kunkunUnlocked",
  });
  const SIDEBAR_TABS = Object.freeze(["project", "transform", "boxes", "effects"]);
  const FILMSTRIP_LAYOUTS = Object.freeze(["single", "grid"]);
  const ROUTE_BY_PATH = Object.freeze({
    "/workspace": "",
    "/tools/import": "import",
    "/tools/organizer": "organizer",
    "/tools/cutout": "cutout",
  });

  /**
   * Returns a supported sidebar tab.
   * @param {unknown} value Persisted tab value.
   * @returns {"project"|"transform"|"boxes"|"effects"} Safe tab.
   */
  function normalizeSidebarTab(value) {
    return SIDEBAR_TABS.includes(String(value)) ? String(value) : "transform";
  }

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
   * }} [dependencies] Browser dependencies and route adapter.
   * @returns {{
   *   bind:()=>void,
   *   destroy:()=>void,
   *   setSidebarTab:(tab:string)=>void,
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
    if (!documentRef?.querySelector || !documentRef?.querySelectorAll) {
      throw new TypeError("XSXB App Shell requires a document-like query interface.");
    }

    const elements = {
      body: documentRef.body,
      sidebar: documentRef.querySelector("#workbenchSidebar"),
      workspace: documentRef.querySelector(".workspace"),
      collapse: documentRef.querySelector("#sidebarCollapse"),
      sidebarTabs: Array.from(documentRef.querySelectorAll("[data-sidebar-tab]")),
      filmstripPanel: documentRef.querySelector(".filmstripPanel"),
      filmstripButtons: Array.from(documentRef.querySelectorAll("[data-filmstrip-layout]")),
      routeItems: Array.from(documentRef.querySelectorAll("[data-workbench-route]")),
      brandMark: documentRef.querySelector("#brandMark"),
      kunkunButtons: Array.from(documentRef.querySelectorAll(".kunkunThemeButton")),
      actionFeedback: documentRef.querySelector(".contextActionFeedback"),
      actionButtons: documentRef.querySelector(".contextActionBarActions"),
    };
    const disposers = [];
    let bound = false;
    let logoClickCount = 0;
    let logoClickTimer = 0;
    let routeObserver = null;

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

    /** Assigns existing sidebar blocks to stable information-architecture tabs. */
    function categorizeSidebar() {
      const categorySelectors = {
        project: [
          "#projectContext",
          "#importAnimationOpen",
          ".animationPicker",
          '[data-panel="scene-reference"]',
        ],
        transform: ['[data-panel="adjustment-base"]'],
        boxes: ['[data-panel="boxes"]'],
        effects: ['[data-panel="attachment-assets"]', '[data-panel="attack-trails"]'],
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

    /** @param {string} rawTab Requested tab. */
    function setSidebarTab(rawTab) {
      const tab = normalizeSidebarTab(rawTab);
      if (elements.body) elements.body.dataset.sidebarTab = tab;
      for (const button of elements.sidebarTabs) {
        const active = button.dataset.sidebarTab === tab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
        button.tabIndex = active ? 0 : -1;
      }
      writePreference(STORAGE_KEYS.activePanelTab, tab);
    }

    /** @param {boolean} collapsed Whether the parameter sidebar is hidden. */
    function setSidebarCollapsed(collapsed) {
      const isCollapsed = Boolean(collapsed);
      elements.body?.classList.toggle("sidebarCollapsed", isCollapsed);
      elements.collapse?.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      elements.collapse?.setAttribute("aria-label", isCollapsed ? "展开参数栏" : "折叠参数栏");
      elements.collapse?.setAttribute("title", isCollapsed ? "展开参数栏" : "折叠参数栏");
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

    /** Synchronizes tool-rail selection with the canonical deep-link route. */
    function syncActiveRoute() {
      const path = String(windowRef.location?.pathname || "/").replace(/\/+$/, "") || "/";
      const route = ROUTE_BY_PATH[path] ?? "";
      for (const item of elements.routeItems) {
        const active = item.dataset.workbenchRoute === route;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      }
      elements.body?.setAttribute("data-workbench", route || "workspace");
      syncHiddenWorkbenchAccessibility();
    }

    /** Removes visually hidden workbench regions from keyboard and screen-reader navigation. */
    function syncHiddenWorkbenchAccessibility() {
      const toolOpen = elements.body?.dataset.workbench !== "workspace";
      const sidebarHidden = toolOpen || elements.body?.classList.contains("sidebarCollapsed");
      if (elements.sidebar) {
        elements.sidebar.inert = Boolean(sidebarHidden);
        elements.sidebar.setAttribute("aria-hidden", sidebarHidden ? "true" : "false");
      }
      if (elements.workspace) {
        elements.workspace.inert = Boolean(toolOpen);
        elements.workspace.setAttribute("aria-hidden", toolOpen ? "true" : "false");
      }
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

    /** @param {KeyboardEvent} event Sidebar roving-tab keyboard event. */
    function handleSidebarKeydown(event) {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = Math.max(0, elements.sidebarTabs.indexOf(event.currentTarget));
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? elements.sidebarTabs.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + elements.sidebarTabs.length) %
              elements.sidebarTabs.length;
      const next = elements.sidebarTabs[nextIndex];
      setSidebarTab(next.dataset.sidebarTab);
      next.focus();
    }

    /** @param {MouseEvent} event Tool-rail navigation event. */
    async function handleRouteClick(event) {
      event.preventDefault();
      const route = event.currentTarget.dataset.workbenchRoute || "";
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
      setSidebarTab(readPreference(storage, STORAGE_KEYS.activePanelTab, "transform"));
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

      for (const tab of elements.sidebarTabs) {
        listen(tab, "click", () => setSidebarTab(tab.dataset.sidebarTab));
        listen(tab, "keydown", handleSidebarKeydown);
      }
      for (const button of elements.filmstripButtons) {
        listen(button, "click", () => setFilmstripLayout(button.dataset.filmstripLayout));
      }
      for (const item of elements.routeItems) listen(item, "click", handleRouteClick);
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
      const target = Object.entries(ROUTE_BY_PATH).find(([, value]) => value === route)?.[0] || "/workspace";
      windowRef.location.assign(target);
      return true;
    }

    return {
      bind,
      destroy,
      setFilmstripLayout,
      setSidebarCollapsed,
      setSidebarTab,
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
    SIDEBAR_TABS,
    STORAGE_KEYS,
    createController,
    normalizeFilmstripLayout,
    normalizeSidebarTab,
    readPreference,
  });
});
