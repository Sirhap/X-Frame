"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createController, normalizeFilmstripLayout } = require("../animation_tuner/public/app_shell");

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
    open: false,
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
    scrollIntoView() {},
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
    browserModeBanner: createElement(),
    attackTrailPanel: Object.assign(createElement(), { hidden: true }),
    projectContext: Object.assign(createElement(), { hidden: true }),
    filmstripPanel: createElement(),
    actionFeedback: createElement(),
    actionButtons: createElement(),
    save: createElement(),
    saveState: createElement(),
    status: createElement(),
    exportButton: createElement(),
    projectProcessingActions: createElement(),
    overviewPanel: Object.assign(createElement(), { hidden: true }),
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
    ["#browserModeBanner", elements.browserModeBanner],
    ["#attackTrailPanel", elements.attackTrailPanel],
    ["#projectContext", elements.projectContext],
    ['.panel[data-shell-category="overview"]', elements.overviewPanel],
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
      if (selector === "[data-filmstrip-layout]") return filmstripButtons;
      if (selector === "[data-app-mode]") return routeItems;
      if (selector === "[data-workbench-route]") return workbenchRouteItems;
      if (selector === ".kunkunThemeButton") return [elements.kunkun];
      if (selector === "[data-context-tool]") return contextToolActions;
      return [];
    },
  };
  const values = new Map([
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
    storage,
    workbenchRouteItems,
    contextToolActions,
    /** @param {string} selector Sidebar panel selector. @returns {string|undefined} Stamped category. */
    categoryFor(selector) {
      return (selectorMap.get(selector) || categories.get(selector))?.dataset.shellCategory;
    },
  };
}

test("shell normalizers reject unknown persisted values", () => {
  assert.equal(normalizeFilmstripLayout("grid"), "grid");
  assert.equal(normalizeFilmstripLayout("unknown"), "single");
});

test("shell restores layout preferences and exposes accessible selected state", () => {
  const fixture = createFixture();
  fixture.controller.bind();

  assert.equal(fixture.elements.body.classList.contains("sidebarCollapsed"), true);
  assert.equal(fixture.elements.sidebar.inert, true);
  assert.equal(fixture.elements.sidebar.attributes["aria-hidden"], "true");
  assert.equal(fixture.elements.workspace.attributes["aria-hidden"], "false");
  assert.equal(fixture.elements.body.dataset.appMode, "projects");
  assert.equal(fixture.elements.body.dataset.appSurface, "workspace");
  assert.equal(fixture.elements.filmstripPanel.dataset.layout, "grid");
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

test("the trails tool opens the attack trail panel instead of leaving it collapsed", () => {
  const fixture = createFixture({ pathname: "/workspace/animation/trails" });
  fixture.controller.bind();

  assert.equal(fixture.elements.body.dataset.workspaceTool, "trails");
  assert.equal(fixture.elements.attackTrailPanel.hidden, false);
  assert.equal(fixture.elements.attackTrailPanel.open, true);
});

test("the audio tool reveals the frame-audio panel", () => {
  const fixture = createFixture({ pathname: "/workspace/animation/audio" });
  fixture.controller.bind();

  assert.equal(fixture.elements.body.dataset.workspaceTool, "audio");
  const audioPanel = fixture.controller;
  assert.equal(fixture.categoryFor('[data-panel="frame-audio"]'), "audio");
  assert.equal(audioPanel && fixture.elements.body.dataset.workspaceTool, "audio");
});

test("quick tool cards number themselves so removing the local-only card does not skip 04", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/app_shell.css"), "utf8");
  const html = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/index.html"), "utf8");
  assert.match(css, /counter-reset:\s*quick-tool/);
  assert.doesNotMatch(html, /05 \/ DELIVERY/);
});

test("crowded frame tools hide brand and web-mode banner so their controls sit on screen", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/app_shell.css"), "utf8");
  for (const tool of ["trails", "attachments", "audio"]) {
    assert.match(
      css,
      new RegExp(`body\\[data-workspace-tool="${tool}"\\][\\s\\S]*?\\.brand[\\s\\S]*?display:\\s*none`),
      `${tool} should hide the brand block`,
    );
  }
  assert.match(css, /body\[data-workspace-tool="trails"\][\s\S]*?#browserModeBanner/);
});

test("sidebar panels are addressed by workspace tool, with no second tab row to disagree with", () => {
  const fixture = createFixture({ pathname: "/workspace/animation/trails" });
  fixture.controller.bind();

  assert.equal(fixture.elements.body.dataset.workspaceTool, "trails");
  assert.equal(fixture.elements.body.dataset.sidebarTab, undefined, "no second navigation vocabulary");
  assert.equal(typeof fixture.controller.setSidebarTab, "undefined", "no tab API to drift from the URL");
  assert.equal(fixture.storage.getItem("xsxbFrameTuner.activePanelTab"), null, "URL is the only truth");

  assert.equal(fixture.categoryFor('[data-panel="adjustment-base"]'), "animation");
  assert.equal(fixture.categoryFor('[data-panel="boxes"]'), "boxes");
  assert.equal(fixture.categoryFor('[data-panel="attack-trails"]'), "trails");
  assert.equal(fixture.categoryFor('[data-panel="attachment-assets"]'), "attachments");
  assert.equal(fixture.categoryFor('[data-panel="frame-audio"]'), "audio");
  assert.equal(fixture.categoryFor("#projectContext"), "overview");
  assert.equal(
    fixture.categoryFor(".animationPicker"),
    undefined,
    "the animation being edited stays switchable from every tool",
  );
});

test("overview reveals the project panel without unhiding leftover projectContext", () => {
  const fixture = createFixture({ pathname: "/workspace/animation/overview" });
  fixture.controller.bind();

  assert.equal(fixture.elements.body.dataset.workspaceTool, "overview");
  assert.equal(fixture.elements.projectContext.hidden, true);
  assert.equal(fixture.elements.projectContext.open, false);
  assert.equal(fixture.elements.overviewPanel.hidden, false);
  assert.equal(fixture.elements.overviewPanel.open, true);
});

test("every client route is served by both the local server and the Cloudflare worker", () => {
  // A route the client can reach but the servers do not allowlist returns a 404
  // document, so the tool silently disappears on reload and in production.
  const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
  const pathsIn = (source, marker) =>
    new Set(
      [...source.slice(source.indexOf(marker)).matchAll(/"(\/(?:workspace|tools|projects)[^"]*)"/g)]
        .map((match) => match[1])
        .slice(0, 40),
    );

  const clientRoutes = pathsIn(read("../animation_tuner/public/app_routing.js"), "ROUTE_BY_PATH");
  const localRoutes = pathsIn(read("../animation_tuner/server.js"), "WORKBENCH_ROUTES");
  const workerRoutes = pathsIn(read("../../cloudflare/site/src/index.mjs"), "WORKBENCH_ROUTES");

  for (const route of clientRoutes) {
    assert.ok(localRoutes.has(route), `local server does not serve ${route}`);
    assert.ok(workerRoutes.has(route), `Cloudflare worker does not serve ${route}`);
  }
});

test("the workbench ships one navigation vocabulary and an entry point for every sidebar panel", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/index.html"), "utf8");

  assert.doesNotMatch(html, /class="sidebarTabs"/, "the duplicate sidebar tab row should be gone");
  assert.doesNotMatch(html, /data-sidebar-tab=/, "no control should speak the old tab vocabulary");
  for (const route of ["overview", "animation", "boxes", "trails", "audio", "attachments"]) {
    assert.match(html, new RegExp(`data-workbench-route="${route}"`), `${route} needs a visible entry point`);
  }
});

test("empty attachment tray and trail quick-start stay compact enough to leave trail mode on screen", () => {
  const filmstrip = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/filmstrip.css"),
    "utf8",
  );
  const trails = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/attack_trails.css"),
    "utf8",
  );
  const trayBlock = filmstrip.match(/\.attachmentAssetTray\s*\{[^}]+\}/)?.[0] || "";
  const minHeight = Number((trayBlock.match(/min-height:\s*(\d+)/) || [])[1] || 999);
  assert.ok(minHeight <= 80, `empty tray min-height should be compact, got ${minHeight}px`);
  assert.match(trails, /\.attackTrailQuickStart\s*\{[^}]*display:\s*flex/);
  assert.match(trails, /\.attackTrailQuickStart button\s*\{[^}]*width:\s*auto/);
});

test("narrow chrome wraps flow tabs instead of clipping their labels", () => {
  const shell = fs.readFileSync(path.resolve(__dirname, "../animation_tuner/public/app_shell.css"), "utf8");
  const cutout = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/cutout_settings.css"),
    "utf8",
  );
  const organizer = fs.readFileSync(
    path.resolve(__dirname, "../animation_tuner/public/organizer_workspace.css"),
    "utf8",
  );
  assert.match(shell, /\.workspaceSecondaryTabs\s*\{[^}]*overflow:\s*visible/);
  assert.match(shell, /@media \(max-width: 1180px\)[\s\S]*flex-wrap:\s*wrap/);
  assert.match(cutout, /\.cutoutSettingTabs button > span\s*\{[^}]*white-space:\s*normal/);
  assert.match(
    cutout,
    /@media \(max-width: 1100px\)[\s\S]*\.cutoutSettingTabs \.premiumOption::after[\s\S]*display:\s*none/,
  );
  assert.match(organizer, /\.organizerFrameTag\s*\{[^}]*overflow:\s*visible/);
});
