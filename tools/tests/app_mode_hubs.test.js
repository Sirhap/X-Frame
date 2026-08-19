"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createController,
  resolveDeliveryExportSource,
  summarizeDeliveryReadiness,
  summarizeDeliveryScope,
} = require("../animation_tuner/public/app_mode_hubs");

test("delivery scope separates the active animation from the whole project", () => {
  const summary = summarizeDeliveryScope(
    {
      groups: [
        { id: "idle", name: "Idle", frames: [{ id: "idle-1", assetRevision: 2 }] },
        {
          id: "attack",
          name: "Attack",
          frames: [
            { id: "attack-1", assetRevision: 3 },
            { id: "attack-2", assetRevision: 5 },
          ],
        },
      ],
    },
    "attack",
  );

  assert.deepEqual(summary, {
    currentAnimationName: "Attack",
    currentFrameCount: 2,
    currentAssetRevision: 5,
    projectAnimationCount: 2,
    projectFrameCount: 3,
  });
});

test("delivery readiness reports real Godot blockers and Pet identity coverage", () => {
  const readiness = summarizeDeliveryReadiness(
    {
      projectKind: "codex_pets",
      godotHandoff: {
        state: "sync_required",
        blockers: ["重新同步资源"],
        warnings: ["缺少预览场景"],
      },
      groups: [
        { profileId: "pet-a", frames: [{ id: "a" }] },
        { profileId: "", frames: [{ id: "b" }] },
      ],
    },
    { browserOnly: false },
  );

  assert.deepEqual(readiness.godot, {
    state: "sync_required",
    tone: "warning",
    label: "需要同步",
    blockers: ["重新同步资源"],
    warningCount: 1,
  });
  assert.deepEqual(readiness.codexPet, {
    state: "incomplete",
    tone: "warning",
    label: "需补充身份",
    boundAnimationCount: 1,
    missingAnimationCount: 1,
  });
});

test("browser delivery identifies local Godot handoff as unavailable", () => {
  const readiness = summarizeDeliveryReadiness(
    { projectKind: "animation", groups: [], godotHandoff: { state: "synced" } },
    { browserOnly: true },
  );

  assert.equal(readiness.godot.state, "local_only");
  assert.equal(readiness.godot.label, "需要本地版");
  assert.equal(readiness.codexPet.state, "unsupported");
  assert.equal(readiness.codexPet.label, "非 Pet 项目");
  assert.equal(readiness.codexPet.boundAnimationCount, 0);
  assert.equal(readiness.codexPet.missingAnimationCount, 0);
});

/** Creates the DOM subset required by the project-hub renderer. */
function createElement(tagName = "div") {
  const attributes = new Map();
  const listeners = new Map();
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    dataset: {},
    hidden: false,
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    append(...children) {
      this.children.push(...children);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) {
        listener({ preventDefault() {}, ...event });
      }
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    querySelector(selector) {
      if (selector !== "[data-i18n]") return null;
      return this.children.find((child) => child.getAttribute?.("data-i18n")) || null;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
  };
}

/** Creates a minimal project-hub document with inspectable output elements. */
function createFixture() {
  const elements = {
    "#projectHubRecent": createElement(),
    "#projectHubRecentTitle": createElement(),
    "#projectHubRecentSummary": createElement(),
    "#projectHubContinue": createElement("a"),
    "#projectHubList": createElement(),
    "#projectHubEmpty": createElement(),
    "#projectHubNew": createElement("button"),
  };
  const continueLabel = createElement("span");
  continueLabel.setAttribute("data-i18n", "continueProject");
  elements["#projectHubContinue"].append(continueLabel);
  return {
    elements,
    documentRef: {
      createElement,
      querySelector: (selector) => elements[selector] || null,
    },
  };
}

test("project cards opt into guarded document navigation", () => {
  const fixture = createFixture();
  const controller = createController({
    documentRef: fixture.documentRef,
    windowRef: { location: { origin: "http://localhost" } },
  });

  controller.renderProjects({
    activeProjectId: "active",
    projects: [
      { id: "active", label: "Active" },
      { id: "test", label: "test" },
    ],
  });

  const testCard = fixture.elements["#projectHubList"].children[1];
  assert.equal(testCard.href, "/workspace/animation/transform?project=test");
  assert.equal(testCard.getAttribute("data-document-navigation"), "");
});

test("empty project cards open the project-scoped importer", () => {
  const fixture = createFixture();
  const controller = createController({
    documentRef: fixture.documentRef,
    windowRef: { location: { origin: "http://localhost" } },
  });

  controller.renderProjects({
    activeProjectId: "empty",
    projects: [{ id: "empty", label: "Empty", animationGroupCount: 0 }],
  });

  const card = fixture.elements["#projectHubList"].children[0];
  assert.equal(card.href, "/workspace/resources/import?project=empty");
  assert.equal(card.dataset.projectState, "needs-import");
  assert.equal(fixture.elements["#projectHubContinue"].href, "/workspace/resources/import?project=empty");
  assert.equal(fixture.elements["#projectHubContinue"].children[0].textContent, "导入视频 / 图片序列 →");
  assert.equal(
    fixture.elements["#projectHubContinue"].children[0].getAttribute("data-i18n"),
    "importProject",
  );
});

test("populated project cards continue to the tuning workbench", () => {
  const fixture = createFixture();
  const controller = createController({
    documentRef: fixture.documentRef,
    windowRef: { location: { origin: "http://localhost" } },
  });

  controller.renderProjects({
    activeProjectId: "ready",
    groups: [{ name: "idle" }],
    projects: [{ id: "ready", label: "Ready", animationGroupCount: 2 }],
  });

  const card = fixture.elements["#projectHubList"].children[0];
  assert.equal(card.href, "/workspace/animation/transform?project=ready");
  assert.equal(card.dataset.projectState, "ready");
  assert.equal(fixture.elements["#projectHubContinue"].href, "/workspace/animation/transform?project=ready");
  assert.equal(fixture.elements["#projectHubContinue"].children[0].textContent, "继续项目");
  assert.equal(
    fixture.elements["#projectHubContinue"].children[0].getAttribute("data-i18n"),
    "continueProject",
  );
});

test("browser session project uses the active language label", () => {
  const fixture = createFixture();
  const controller = createController({
    documentRef: fixture.documentRef,
    windowRef: { location: { origin: "http://localhost" } },
    translate: (key) => (key === "browserSessionProject" ? "Browser Temporary Workspace" : key),
  });

  controller.renderProjects({
    activeProjectId: "browser-session",
    projects: [{ id: "browser-session", label: "浏览器临时工作区" }],
  });

  const projectCard = fixture.elements["#projectHubList"].children[0];
  assert.equal(projectCard.children[1].textContent, "Browser Temporary Workspace");
  assert.equal(fixture.elements["#projectHubRecentTitle"].textContent, "Browser Temporary Workspace");
});

test("recent project summary does not expose the machine-specific absolute workspace path", () => {
  const fixture = createFixture();
  const controller = createController({
    documentRef: fixture.documentRef,
    windowRef: { location: { origin: "http://localhost" } },
    translate: (key, vars = {}) => (key === "projectGroupSummary" ? `${vars.workspace}` : key),
  });

  controller.renderProjects({
    activeProjectId: "ready",
    projects: [
      {
        id: "ready",
        label: "Ready",
        animationGroupCount: 2,
        workspacePath: "/Users/example/private/project",
      },
    ],
  });

  const summary = fixture.elements["#projectHubRecentSummary"].textContent;
  assert.equal(summary.includes("/Users/example/private/project"), false);
  assert.match(summary, /…\/(?:private\/)?project/u);
});

test("New Project asks for a name before creating and opening import", async () => {
  const fixture = createFixture();
  const assigned = [];
  const created = [];
  const controller = createController({
    documentRef: fixture.documentRef,
    windowRef: {
      location: { origin: "http://localhost", assign: (url) => assigned.push(url) },
    },
    prompt: () => "QA Temp",
    createProject: async (label) => {
      created.push(label);
      return { projectId: "qa-temp" };
    },
    translate: (key) => key,
  });

  controller.bind();
  fixture.elements["#projectHubNew"].dispatch("click");
  await Promise.resolve();

  assert.deepEqual(created, ["QA Temp"]);
  assert.deepEqual(assigned, ["/workspace/resources/import?project=qa-temp"]);
});

test("empty New Project name does not navigate away from the hub", async () => {
  const fixture = createFixture();
  const assigned = [];
  const controller = createController({
    documentRef: fixture.documentRef,
    windowRef: {
      location: { origin: "http://localhost", assign: (url) => assigned.push(url) },
    },
    prompt: () => "   ",
    createProject: async () => {
      throw new Error("should not create");
    },
    translate: (key) => key,
  });

  controller.bind();
  fixture.elements["#projectHubNew"].dispatch("click");
  await Promise.resolve();

  assert.deepEqual(assigned, []);
});

test("standalone export falls back to the current animation when the temp workset is empty", () => {
  const currentGroup = { frames: [{ id: "idle-1" }] };
  assert.deepEqual(
    resolveDeliveryExportSource({
      navigationContext: "standalone",
      temporaryWorkset: { frames: [] },
      currentGroup,
    }),
    { kind: "current" },
  );
  assert.equal(
    resolveDeliveryExportSource({
      navigationContext: "standalone",
      temporaryWorkset: null,
      currentGroup: { frames: [] },
    }).kind,
    "empty",
  );
  assert.equal(
    resolveDeliveryExportSource({
      navigationContext: "standalone",
      temporaryWorkset: null,
      currentGroup: { frames: [] },
      translate: (key) => (key === "exportNeedSequence" ? "Import an image sequence to export first" : key),
    }).message,
    "Import an image sequence to export first",
  );
});
