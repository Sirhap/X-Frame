"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_navigation_context");

/** @returns {{hidden:boolean,textContent:string}} Mutable header node. */
function headerNode(text = "") {
  return { hidden: false, textContent: text };
}

/**
 * @param {{route?:string,context?:"project"|"standalone",organizerOpen?:boolean,cutoutOpen?:boolean,toolTitle?:function}} [options]
 * @returns {{controller:object,eyebrow:object,title:object,save:object,back:object}}
 */
function createFixture(options = {}) {
  const eyebrow = headerNode("PROJECT WORKSPACE");
  const title = headerNode("当前项目");
  const save = headerNode("已保存");
  const back = headerNode("");
  const bodyClasses = new Set();
  if (options.organizerOpen) bodyClasses.add("organizerOpen");
  if (options.cutoutOpen) bodyClasses.add("cutoutOpen");
  const labels = {
    stageResources: "Resources",
    stageAnimation: "Animation",
    stageDelivery: "Delivery",
    browserSessionProject: "Browser Temporary Workspace",
    currentProject: "Current Project",
    scatterSliceTitle: "Scatter Slice",
    batchCutout: "Batch Cutout",
    returnQuickTools: "← Back to Quick Tools",
    returnTuning: "← Back to Animation Tuning",
    returnOrganizer: "← Back to Frame Organizer",
  };
  const controller = createController({
    documentRef: {
      body: { classList: { contains: (name) => bodyClasses.has(name) } },
      querySelector: (selector) =>
        ({
          "#workspaceFlowEyebrow": eyebrow,
          "#workspaceFlowProject": title,
          "#workspaceSaveIndicator": save,
          "#workspaceFlowBack": back,
        })[selector] || null,
      createElement: () => ({ textContent: "", href: "" }),
    },
    getConfig: () => ({
      activeProjectId: "browser-session",
      activeProject: { id: "browser-session", label: "浏览器临时工作区" },
    }),
    getCurrentGroup: () => null,
    getRoute: () => options.route || "import",
    getContext: () => options.context || "project",
    translate: (key) => labels[key] || key,
    toolTitle: options.toolTitle,
  });
  return { controller, eyebrow, title, save, back };
}

test("import route shows the tool title, hides save, and offers a tuning return", () => {
  const fixture = createFixture({
    route: "import",
    toolTitle: (route) => (route === "import" ? "导入与处理动画" : ""),
  });

  fixture.controller.render();

  assert.equal(fixture.eyebrow.textContent, "Resources");
  assert.equal(fixture.title.textContent, "导入与处理动画");
  assert.equal(fixture.save.hidden, true);
  assert.equal(fixture.back.hidden, false);
  assert.equal(fixture.back.textContent, "← Back to Animation Tuning");
});

test("cutout opened from organizer uses the organizer return label", () => {
  const fixture = createFixture({
    route: "cutout",
    organizerOpen: true,
    cutoutOpen: true,
    toolTitle: (route) => (route === "cutout" ? "批量抠图" : ""),
  });

  fixture.controller.render();

  assert.equal(fixture.eyebrow.textContent, "Resources");
  assert.equal(fixture.title.textContent, "批量抠图");
  assert.equal(fixture.save.hidden, true);
  assert.equal(fixture.back.hidden, false);
  assert.equal(fixture.back.textContent, "← Back to Frame Organizer");
});

test("animation route shows the project name and save state", () => {
  const fixture = createFixture({ route: "animation" });

  fixture.controller.render();

  assert.equal(fixture.eyebrow.textContent, "Animation");
  assert.equal(fixture.title.textContent, "Browser Temporary Workspace");
  assert.equal(fixture.save.hidden, false);
  assert.equal(fixture.back.hidden, true);
});

test("delivery route keeps the project name and save state", () => {
  const fixture = createFixture({ route: "export" });

  fixture.controller.render();

  assert.equal(fixture.eyebrow.textContent, "Delivery");
  assert.equal(fixture.title.textContent, "Browser Temporary Workspace");
  assert.equal(fixture.save.hidden, false);
  assert.equal(fixture.back.hidden, true);
});

test("standalone scatter returns to quick tools", () => {
  const fixture = createFixture({
    route: "scatter",
    context: "standalone",
    toolTitle: (route) => (route === "scatter" ? "零散切片" : ""),
  });

  fixture.controller.render();

  assert.equal(fixture.eyebrow.textContent, "Resources");
  assert.equal(fixture.title.textContent, "零散切片");
  assert.equal(fixture.save.hidden, true);
  assert.equal(fixture.back.hidden, false);
  assert.equal(fixture.back.textContent, "← Back to Quick Tools");
});
