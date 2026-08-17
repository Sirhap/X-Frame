"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createController,
  normalizeFilmstripLayout,
  normalizeSidebarTab,
} = require("../animation_tuner/public/app_shell");

/** @returns {object} Minimal event-capable DOM element. */
function createElement() {
  const listeners = new Map();
  const classes = new Set();
  return {
    attributes: {},
    children: [],
    classList: {
      add(name) {
        classes.add(name);
      },
      contains(name) {
        return classes.has(name);
      },
      remove(name) {
        classes.delete(name);
      },
      toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      },
    },
    dataset: {},
    hidden: false,
    tabIndex: 0,
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    append(...children) {
      this.children.push(...children);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) {
        listener({ currentTarget: this, preventDefault() {}, ...event });
      }
    },
    click() {
      this.dispatch("click");
    },
    focus() {},
    removeAttribute(name) {
      delete this.attributes[name];
    },
    removeEventListener() {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name.startsWith("data-")) {
        const datasetKey = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        this.dataset[datasetKey] = String(value);
      }
    },
  };
}

/**
 * Creates a shell fixture with mapped selectors.
 * @param {{pathname?:string,navigate?:(route:string)=>Promise<boolean>|boolean,openContextTool?:(tool:string)=>Promise<boolean>|boolean}} [options] Initial browser location and navigation adapters.
 * @returns {{controller:object,elements:Record<string,object>,filmstripButtons:object[],routeItems:object[],sidebarTabs:object[],storage:object,workbenchRouteItems:object[]}}
 */
function createFixture(options = {}) {
  const elements = {
    body: createElement(),
    sidebar: createElement(),
    workspace: createElement(),
    projectHub: createElement(),
    quickToolsHub: createElement(),
    scatterSliceSurface: createElement(),
    collapse: createElement(),
    brandMark: createElement(),
    filmstripPanel: createElement(),
    actionFeedback: createElement(),
    actionButtons: createElement(),
    save: createElement(),
    saveState: createElement(),
    status: createElement(),
    exportButton: createElement(),
    projectProcessingActions: createElement(),
    cutoutCurrentFrame: createElement(),
    cutoutOpen: createElement(),
    organizerOpen: createElement(),
    kunkun: createElement(),
    toolRailTools: createElement(),
    toolRailContextMenu: createElement(),
    toolRailContextTitle: createElement(),
    toolRailContextHint: createElement(),
  };
  const contextToolActions = ["current-frame-cutout", "batch-cutout", "organizer"].map((tool) => {
    const element = createElement();
    element.dataset.contextTool = tool;
    return element;
  });
  const sidebarTabs = ["project", "transform", "boxes", "effects"].map((tab) => {
    const element = createElement();
    element.dataset.sidebarTab = tab;
    return element;
  });
  const filmstripButtons = ["single", "grid"].map((layout) => {
    const element = createElement();
    element.dataset.filmstripLayout = layout;
    return element;
  });
  const routeItems = ["projects", "tools"].map((route) => {
    const element = createElement();
    element.dataset.appMode = route;
    return element;
  });
  const workbenchRouteItems = ["cutout", "import", "scatter"].map((route) => {
    const element = createElement();
    element.dataset.workbenchRoute = route;
    return element;
  });
  const categories = new Map();
  const selectorMap = new Map([
    ["#workbenchSidebar", elements.sidebar],
    [".workspace", elements.workspace],
    ["#projectHub", elements.projectHub],
    ["#quickToolsHub", elements.quickToolsHub],
    ["#scatterSliceSurface", elements.scatterSliceSurface],
    ["#sidebarCollapse", elements.collapse],
    [".filmstripPanel", elements.filmstripPanel],
    ["#brandMark", elements.brandMark],
    [".contextActionFeedback", elements.actionFeedback],
    [".contextActionBarActions", elements.actionButtons],
    ["#save", elements.save],
    ["#saveState", elements.saveState],
    ["#status", elements.status],
    ["#exportWorkbench", elements.exportButton],
    [".projectProcessingActions", elements.projectProcessingActions],
    ["#cutoutCurrentFrame", elements.cutoutCurrentFrame],
    ["#cutoutOpen", elements.cutoutOpen],
    ["#organizerOpen", elements.organizerOpen],
    ["#toolRailTools", elements.toolRailTools],
    ["#toolRailContextMenu", elements.toolRailContextMenu],
    ["#toolRailContextTitle", elements.toolRailContextTitle],
    ["#toolRailContextHint", elements.toolRailContextHint],
  ]);
  const documentRef = {
    body: elements.body,
    querySelector(selector) {
      if (selectorMap.has(selector)) return selectorMap.get(selector);
      if (!categories.has(selector)) categories.set(selector, createElement());
      return categories.get(selector);
    },
    querySelectorAll(selector) {
      if (selector === "[data-sidebar-tab]") return sidebarTabs;
      if (selector === "[data-filmstrip-layout]") return filmstripButtons;
      if (selector === "[data-app-mode]") return routeItems;
      if (selector === "[data-workbench-route]") return workbenchRouteItems;
      if (selector === ".kunkunThemeButton") return [elements.kunkun];
      if (selector === "[data-context-tool]") return contextToolActions;
      return [];
    },
  };
  const values = new Map([
    ["xsxbFrameTuner.activePanelTab", "effects"],
    ["xsxbFrameTuner.filmstripLayout", "grid"],
    ["xsxbFrameTuner.sidebarCollapsed", "true"],
  ]);
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
  const windowRef = {
    clearTimeout() {},
    location: { pathname: options.pathname || "/workspace" },
    setTimeout() {
      return 1;
    },
  };
  const controller = createController({
    documentRef,
    storage,
    windowRef,
    navigate: options.navigate || (async () => true),
    openContextTool: options.openContextTool,
  });
  return {
    controller,
    elements,
    filmstripButtons,
    routeItems,
    sidebarTabs,
    storage,
    workbenchRouteItems,
    contextToolActions,
  };
}

test("shell normalizers reject unknown persisted values", () => {
  assert.equal(normalizeSidebarTab("effects"), "effects");
  assert.equal(normalizeSidebarTab("unknown"), "transform");
  assert.equal(normalizeFilmstripLayout("grid"), "grid");
  assert.equal(normalizeFilmstripLayout("unknown"), "single");
});

test("shell restores layout preferences and exposes accessible selected state", () => {
  const fixture = createFixture();
  fixture.controller.bind();

  assert.equal(fixture.elements.body.dataset.sidebarTab, "effects");
  assert.equal(fixture.elements.body.classList.contains("sidebarCollapsed"), true);
  assert.equal(fixture.elements.sidebar.inert, true);
  assert.equal(fixture.elements.sidebar.attributes["aria-hidden"], "true");
  assert.equal(fixture.elements.workspace.attributes["aria-hidden"], "false");
  assert.equal(fixture.elements.body.dataset.appMode, "projects");
  assert.equal(fixture.elements.body.dataset.appSurface, "workspace");
  assert.equal(fixture.elements.filmstripPanel.dataset.layout, "grid");
  assert.equal(fixture.sidebarTabs[3].attributes["aria-selected"], "true");
  assert.equal(fixture.filmstripButtons[1].attributes["aria-pressed"], "true");
  assert.equal(fixture.routeItems[0].attributes["aria-current"], "page");
  assert.deepEqual(fixture.elements.actionButtons.children, [
    fixture.elements.exportButton,
    fixture.elements.save,
  ]);
  assert.deepEqual(fixture.elements.projectProcessingActions.children, [
    fixture.elements.cutoutCurrentFrame,
    fixture.elements.organizerOpen,
    fixture.elements.cutoutOpen,
  ]);
});

test("five logo activations persist and reveal the kunkun theme", () => {
  const fixture = createFixture();
  fixture.controller.bind();
  for (let index = 0; index < 5; index += 1) fixture.elements.brandMark.dispatch("click");

  assert.equal(fixture.elements.kunkun.hidden, false);
  assert.equal(fixture.storage.getItem("xsxbFrameTuner.kunkunUnlocked"), "true");
});

test("quick tool cards use in-app workbench navigation", async () => {
  const routes = [];
  const fixture = createFixture({
    pathname: "/tools",
    navigate: async (route) => routes.push(route),
  });
  fixture.controller.bind();

  fixture.workbenchRouteItems[0].dispatch("click");
  await Promise.resolve();

  assert.deepEqual(routes, ["cutout"]);
});

test("context tools keep the active animation in the workbench and delegate the selected tool", async () => {
  const opened = [];
  const fixture = createFixture({
    openContextTool: async (tool) => {
      opened.push(tool);
      return tool === "current-frame-cutout";
    },
  });
  fixture.controller.bind();
  fixture.elements.toolRailTools.dispatch("focus");
  assert.equal(fixture.elements.toolRailContextMenu.hidden, false);

  let currentFrameCutoutTriggered = false;
  fixture.elements.cutoutCurrentFrame.addEventListener("click", () => {
    currentFrameCutoutTriggered = true;
  });
  fixture.contextToolActions[0].dispatch("click");
  await Promise.resolve();
  assert.deepEqual(opened, ["current-frame-cutout"]);
  assert.equal(currentFrameCutoutTriggered, true);
});

test("scatter slice uses the shared tool shell surface", () => {
  const fixture = createFixture();
  fixture.controller.bind();
  fixture.controller.destroy();
  fixture.controller = createController({
    documentRef: {
      body: fixture.elements.body,
      querySelector(selector) {
        const mapped = {
          "#workbenchSidebar": fixture.elements.sidebar,
          ".workspace": fixture.elements.workspace,
          "#projectHub": fixture.elements.projectHub,
          "#quickToolsHub": fixture.elements.quickToolsHub,
          "#scatterSliceSurface": fixture.elements.scatterSliceSurface,
        };
        return mapped[selector] || createElement();
      },
      querySelectorAll() {
        return [];
      },
    },
    windowRef: { location: { pathname: "/tools/scatter-slice" } },
    storage: fixture.storage,
  });
  fixture.controller.bind();

  assert.equal(fixture.elements.body.dataset.appMode, "tools");
  assert.equal(fixture.elements.body.dataset.appSurface, "scatter");
  assert.equal(fixture.elements.scatterSliceSurface.hidden, false);
  assert.equal(fixture.elements.workspace.inert, true);
});

test("top-level routes expose exactly one primary surface", () => {
  const cases = [
    {
      pathname: "/workspace",
      surface: "workspace",
      visible: "workspace",
    },
    {
      pathname: "/projects",
      surface: "projects",
      visible: "projectHub",
    },
    {
      pathname: "/tools",
      surface: "tools",
      visible: "quickToolsHub",
    },
    {
      pathname: "/tools/scatter-slice",
      surface: "scatter",
      visible: "scatterSliceSurface",
    },
    {
      pathname: "/tools/cutout",
      surface: "tool",
      visible: null,
    },
    {
      pathname: "/workspace/resources/import",
      surface: "tool",
      visible: null,
    },
    {
      pathname: "/workspace/resources/cutout",
      surface: "tool",
      visible: null,
    },
  ];

  for (const routeCase of cases) {
    const fixture = createFixture({ pathname: routeCase.pathname });
    fixture.controller.bind();

    assert.equal(fixture.elements.body.dataset.appSurface, routeCase.surface, routeCase.pathname);
    assert.equal(fixture.elements.sidebar.hidden, routeCase.visible !== "workspace", routeCase.pathname);
    for (const surface of ["workspace", "projectHub", "quickToolsHub", "scatterSliceSurface"]) {
      assert.equal(
        fixture.elements[surface].hidden,
        surface !== routeCase.visible,
        `${routeCase.pathname}: ${surface}`,
      );
    }
  }
});
