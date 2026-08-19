"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_navigation_context");

/** @returns {{hidden:boolean,textContent:string}} Mutable header node. */
function headerNode(text = "") {
  return { hidden: false, textContent: text };
}

/**
 * @param {{route?:string,context?:"project"|"standalone",organizerOpen?:boolean,cutoutOpen?:boolean,toolTitle?:function,group?:object|null}} [options]
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
    getCurrentGroup: () => options.group ?? null,
    getRoute: () => options.route || "import",
    getContext: () => options.context || "project",
    groupLabel: (group) => group?.label || group?.name || "",
    translate: (key) => labels[key] || key,
    toolTitle: options.toolTitle,
  });
  return { controller, eyebrow, title, save, back };
}

test("import route keeps the project identity, demotes the tool name, and offers a tuning return", () => {
  const fixture = createFixture({
    route: "import",
    toolTitle: (route) => (route === "import" ? "导入与处理动画" : ""),
  });

  fixture.controller.render();

  assert.equal(fixture.eyebrow.textContent, "Resources · 导入与处理动画");
  assert.equal(fixture.title.textContent, "Browser Temporary Workspace");
  assert.equal(fixture.save.hidden, false);
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

  assert.equal(fixture.eyebrow.textContent, "Resources · 批量抠图");
  assert.equal(fixture.title.textContent, "Browser Temporary Workspace");
  assert.equal(fixture.save.hidden, false);
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

  assert.equal(fixture.eyebrow.textContent, "Resources · 零散切片");
  assert.equal(fixture.title.textContent, "Browser Temporary Workspace");
  assert.equal(fixture.save.hidden, false);
  assert.equal(fixture.back.hidden, false);
  assert.equal(fixture.back.textContent, "← Back to Quick Tools");
});

test("rendering before an animation is loaded never calls the null-hostile group labeler", () => {
  // app.js injects groupLabel(group) which dereferences group.tuningTarget, so the
  // header must not hand it the null group that exists during boot.
  const fixture = createFixture({ route: "animation", group: null });
  fixture.controller.destroy();
  const controller = createController({
    documentRef: {
      body: { classList: { contains: () => false } },
      querySelector: () => headerNode(""),
      createElement: () => ({ textContent: "", href: "" }),
    },
    getConfig: () => null,
    getCurrentGroup: () => null,
    getRoute: () => "animation",
    getContext: () => "project",
    groupLabel: (group) => group.tuningTarget,
    translate: (key) => key,
  });

  assert.doesNotThrow(() => controller.render());
});

test("the animation being edited stays named in the header on every stage", () => {
  const group = { label: "Hero - Idle" };
  for (const route of ["animation", "boxes", "trails", "import", "cutout", "scatter", "export"]) {
    const fixture = createFixture({ route, group, toolTitle: () => "" });

    fixture.controller.render();

    assert.equal(
      fixture.title.textContent,
      "Browser Temporary Workspace · Hero - Idle",
      `route ${route} should still name the animation`,
    );
    assert.equal(fixture.save.hidden, false, `route ${route} should keep the save indicator`);
  }
});
