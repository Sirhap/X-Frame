"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_navigation_context");

/** Creates a breadcrumb host that records rendered children. */
function breadcrumbHost() {
  return {
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
  };
}

test("navigation context localizes system breadcrumbs and return actions", () => {
  const workspace = breadcrumbHost();
  const organizer = breadcrumbHost();
  const cutout = breadcrumbHost();
  const organizerHome = { textContent: "" };
  const cutoutHome = { textContent: "" };
  const elements = {
    "#workspaceBreadcrumb": workspace,
    "#organizerBreadcrumb": organizer,
    "#cutoutBreadcrumb": cutout,
    "#organizerHome": organizerHome,
    "#cutoutHome": cutoutHome,
  };
  const labels = {
    projectHubTitle: "Animation Projects",
    browserSessionProject: "Browser Temporary Workspace",
    currentProject: "Current Project",
    quickToolsTitle: "Quick Tools",
    sequenceTool: "Sequence Processing",
    frameOrganizer: "Frame Organizer",
    batchCutout: "Batch Cutout",
    returnQuickTools: "← Back to Quick Tools",
    returnTuning: "← Back to Animation Tuning",
    returnOrganizer: "← Back to Frame Organizer",
  };
  const controller = createController({
    documentRef: {
      body: { classList: { contains: () => false } },
      querySelector: (selector) => elements[selector] || null,
      createElement: () => ({ textContent: "", href: "" }),
    },
    getConfig: () => ({
      activeProjectId: "browser-session",
      activeProject: { id: "browser-session", label: "浏览器临时工作区" },
    }),
    getCurrentGroup: () => null,
    getRoute: () => "import",
    getContext: () => "project",
    translate: (key) => labels[key] || key,
  });

  controller.render();

  assert.deepEqual(
    workspace.children.map((child) => child.textContent),
    ["Animation Projects", "Browser Temporary Workspace"],
  );
  assert.deepEqual(
    organizer.children.map((child) => child.textContent),
    ["Animation Projects", "Browser Temporary Workspace", "Sequence Processing"],
  );
  assert.equal(organizerHome.textContent, "← Back to Animation Tuning");
  assert.equal(cutoutHome.textContent, "← Back to Animation Tuning");
});
