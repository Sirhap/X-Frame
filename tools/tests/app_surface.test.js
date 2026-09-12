"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const {
  applyAppSurface,
  resolveAppSurface,
  resolveToolOverlay,
} = require("../animation_tuner/public/app_surface");

test("resource import and cutout are tool surfaces, not the tuner workspace", () => {
  assert.equal(resolveAppSurface("/workspace/resources/import"), "tool");
  assert.equal(resolveAppSurface("/workspace/resources/cutout"), "tool");
  assert.equal(resolveAppSurface("/workspace/tools/organizer"), "tool");
  assert.equal(resolveAppSurface("/workspace/tools/cutout"), "tool");
  assert.equal(resolveAppSurface("/tools/organizer"), "tool");
  assert.equal(resolveAppSurface("/tools/cutout"), "tool");
  assert.equal(resolveAppSurface("/tools/import"), "tool");
});

test("scatter, delivery, hubs, and tuner keep their own surfaces", () => {
  assert.equal(resolveAppSurface("/workspace/resources/scatter"), "scatter");
  assert.equal(resolveAppSurface("/tools/scatter-slice"), "scatter");
  assert.equal(resolveAppSurface("/workspace/delivery/export"), "delivery");
  assert.equal(resolveAppSurface("/tools/export"), "delivery");
  assert.equal(resolveAppSurface("/projects"), "projects");
  assert.equal(resolveAppSurface("/tools"), "tools");
  assert.equal(resolveAppSurface("/workspace"), "workspace");
  assert.equal(resolveAppSurface("/workspace/animation/transform"), "workspace");
});

test("tool overlays match the resource path before app boot", () => {
  assert.equal(resolveToolOverlay("/workspace/resources/import"), "organizer");
  assert.equal(resolveToolOverlay("/workspace/resources/cutout"), "cutout");
  assert.equal(resolveToolOverlay("/workspace/resources/scatter"), "");
  assert.equal(resolveToolOverlay("/workspace/animation/transform"), "");
});

test("applyAppSurface never touches workbench overlays", () => {
  const classes = new Set(["cutoutOpen"]);
  const organizerModal = { hidden: true, id: "organizerModal" };
  const cutoutModal = { hidden: false, id: "cutoutModal" };
  const workspace = { hidden: true };
  const documentRef = {
    documentElement: {
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    },
    body: {
      attributes: {},
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
        toggle(name, on) {
          if (on) classes.add(name);
          else classes.delete(name);
        },
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    },
    getElementById(id) {
      if (id === "organizerModal") return organizerModal;
      if (id === "cutoutModal") return cutoutModal;
      return null;
    },
    querySelector() {
      return workspace;
    },
  };

  applyAppSurface(documentRef, "/workspace/resources/import");

  assert.equal(cutoutModal.hidden, false, "a live cutout session must survive the surface pass");
  assert.equal(classes.has("cutoutOpen"), true);
  assert.equal(
    organizerModal.hidden,
    true,
    "the organizer must stay closed so its controller still opens and loads frames",
  );
  assert.equal(classes.has("organizerOpen"), false);
});

test("applyAppSurface hides the tuner on a tool route", () => {
  const classes = new Set();
  const organizerModal = { hidden: true, id: "organizerModal" };
  const cutoutModal = { hidden: true, id: "cutoutModal" };
  const workspace = { hidden: false };
  const documentRef = {
    documentElement: {
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    },
    body: {
      attributes: {},
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
        toggle(name, on) {
          if (on) classes.add(name);
          else classes.delete(name);
        },
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    },
    getElementById(id) {
      if (id === "organizerModal") return organizerModal;
      if (id === "cutoutModal") return cutoutModal;
      return null;
    },
    querySelector(selector) {
      return selector === ".workspace" || selector === "#mainWorkbench > .workspace" ? workspace : null;
    },
  };

  applyAppSurface(documentRef, "/workspace/resources/import");

  assert.equal(documentRef.documentElement.attributes["data-app-surface"], "tool");
  assert.equal(documentRef.body.attributes["data-app-surface"], "tool");
  assert.equal(workspace.hidden, true);
  assert.equal(organizerModal.hidden, true);
  assert.equal(cutoutModal.hidden, true);
  assert.equal(classes.size, 0);
});

test("workbench HTML resolves resource tools before app.js boots", () => {
  const html = fs.readFileSync(
    new URL("../animation_tuner/public/index.html", `file://${__dirname}/`),
    "utf8",
  );
  const head = html.slice(0, html.indexOf("</head>"));
  assert.match(head, /src="\/app_surface\.js"/u);
  assert.match(html, /function revealXsxbSurface\(\)/u);
  assert.match(html, /XFrameAppSurface\?\.applyAppSurface/u);
});
