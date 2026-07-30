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
 * @returns {{controller:object,elements:Record<string,object>,storage:object}}
 */
function createFixture() {
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
    kunkun: createElement(),
  };
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
      if (selector === ".kunkunThemeButton") return [elements.kunkun];
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
    location: { pathname: "/workspace" },
    setTimeout() {
      return 1;
    },
  };
  const controller = createController({ documentRef, storage, windowRef, navigate: async () => true });
  return { controller, elements, filmstripButtons, routeItems, sidebarTabs, storage };
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
});

test("five logo activations persist and reveal the kunkun theme", () => {
  const fixture = createFixture();
  fixture.controller.bind();
  for (let index = 0; index < 5; index += 1) fixture.elements.brandMark.dispatch("click");

  assert.equal(fixture.elements.kunkun.hidden, false);
  assert.equal(fixture.storage.getItem("xsxbFrameTuner.kunkunUnlocked"), "true");
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
