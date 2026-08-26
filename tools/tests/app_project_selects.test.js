"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_project_selects");

/** Creates minimal select elements for the project-panel controller. */
function createElements() {
  const projectContextClasses = new Set();
  return {
    projectContext: {
      classList: {
        toggle(name, enabled) {
          if (enabled) projectContextClasses.add(name);
          else projectContextClasses.delete(name);
        },
        contains: (name) => projectContextClasses.has(name),
      },
    },
    currentProjectLabel: { textContent: "" },
    projectSelect: { innerHTML: "", value: "", disabled: false },
    clearProject: { disabled: false },
    deleteProject: { disabled: false },
    groupSelect: { innerHTML: "", value: "", disabled: false },
    groupSearch: { disabled: false },
    groupFilterField: { hidden: false },
    chainGroupSelect: { innerHTML: "", value: "" },
  };
}

test("project selects preserve the active project and retire the profile filter", () => {
  const elements = createElements();
  const stored = [];
  const config = {
    activeProjectId: "project-2",
    projects: [
      { id: "project-1", label: "One" },
      { id: "project-2", label: "Two" },
    ],
    profiles: [
      { id: "profile-1", label: "Hero" },
      { id: "profile-2", label: "Unused" },
    ],
    groups: [{ uiId: "group-1", profileId: "profile-1", name: "Slash" }],
  };
  let selectedProjectId = "project-1";
  let selectedProfileId = "all";
  const controller = createController({
    elements,
    getConfig: () => config,
    setSelectedProjectId: (value) => {
      selectedProjectId = value;
    },
    setSelectedProfileId: (value) => {
      selectedProfileId = value;
    },
    storage: { setItem: (...args) => stored.push(args) },
    projectLabel: (project) => project.label,
    groupLabel: (group) => group.name,
    translate: (key) => ({ allCharacters: "All", noMatchingGroups: "None", none: "No chain" })[key] || key,
  });

  controller.renderProjectSelect();
  assert.equal(selectedProjectId, "project-2");
  assert.equal(elements.projectSelect.value, "project-2");
  assert.equal(elements.projectSelect.disabled, false);
  assert.equal(elements.currentProjectLabel.textContent, "Two");
  assert.equal(elements.projectContext.classList.contains("singleProject"), false);
  assert.deepEqual(stored, [["xsxbFrameTuner.project", "project-2"]]);
  controller.renderProfileSelect();
  assert.equal(selectedProfileId, "all");
});

test("project selects protect the Codex Pets system project from clear and delete actions", () => {
  const elements = createElements();
  const controller = createController({
    elements,
    getConfig: () => ({
      activeProjectId: "codex_pets",
      projects: [{ id: "codex_pets", kind: "codex_pets", label: "Codex Pets" }],
    }),
    projectLabel: (project) => project.label,
    translate: (key) => (key === "codexPetsProjectProtected" ? "protected" : key),
    storage: { setItem() {} },
  });

  controller.renderProjectSelect();

  assert.equal(elements.clearProject.disabled, true);
  assert.equal(elements.deleteProject.disabled, true);
  assert.equal(elements.deleteProject.title, "protected");
});

test("project selects keep browser-session clearable but not deletable", () => {
  const elements = createElements();
  const controller = createController({
    elements,
    getConfig: () => ({
      activeProjectId: "browser-session",
      projects: [{ id: "browser-session", label: "浏览器临时工作区" }],
    }),
    projectLabel: (project) => project.label,
    translate: (key) => key,
    storage: { setItem() {} },
  });

  controller.renderProjectSelect();

  assert.equal(elements.clearProject.disabled, false);
  assert.equal(elements.deleteProject.disabled, true);
  assert.equal(elements.deleteProject.title, "browserSessionCannotDelete");
});

test("small group lists stay visible and chain select preserves its value", () => {
  const elements = createElements();
  let groupSearch = "slash";
  const config = {
    groups: [
      {
        uiId: "hero-slash",
        profileId: "hero",
        name: "Slash",
        type: "sprite",
        source: "hero",
      },
      {
        uiId: "hero-idle",
        profileId: "hero",
        name: "Idle",
        type: "sprite",
        source: "hero",
      },
    ],
    profiles: [{ id: "hero", label: "Hero" }],
  };
  const controller = createController({
    elements,
    getConfig: () => config,
    getGroupSearch: () => groupSearch,
    setGroupSearch: (value) => {
      groupSearch = value;
    },
    groupLabel: (group) => group.name,
    translate: (key) => ({ noMatchingGroups: "None", none: "No chain" })[key] || key,
  });

  assert.deepEqual(
    controller.filteredGroups().map((group) => group.uiId),
    ["hero-slash", "hero-idle"],
  );
  assert.deepEqual(
    controller.renderGroupSelect("hero-slash").map((group) => group.uiId),
    ["hero-slash", "hero-idle"],
  );
  assert.equal(groupSearch, "");
  assert.equal(elements.groupSelect.value, "hero-slash");
  assert.equal(elements.groupSearch.disabled, false);
  assert.equal(elements.groupFilterField.hidden, true);
  controller.renderChainGroupSelect("hero-idle");
  assert.equal(elements.chainGroupSelect.value, "hero-idle");
  assert.match(elements.chainGroupSelect.innerHTML, /hero-slash/);
});

test("large animation lists support search", () => {
  const elements = createElements();
  const groups = Array.from({ length: 9 }, (_value, index) => ({
    uiId: `animation-${index}`,
    profileId: index < 5 ? "hero" : "enemy",
    profileLabel: index < 5 ? "Hero" : "Enemy",
    name: index === 7 ? "Slash" : `Idle ${index}`,
  }));
  const controller = createController({
    elements,
    getConfig: () => ({ groups }),
    getGroupSearch: () => "slash",
    groupLabel: (group) => `${group.profileLabel} - ${group.name}`,
    translate: (key) => ({ noMatchingGroups: "None", otherAnimations: "Other" })[key] || key,
  });

  const visibleGroups = controller.renderGroupSelect("animation-7");

  assert.deepEqual(
    visibleGroups.map((group) => group.uiId),
    ["animation-7"],
  );
  assert.equal(elements.groupFilterField.hidden, false);
  assert.equal(elements.groupSelect.value, "animation-7");
});

test("animation options use character optgroups", () => {
  const elements = createElements();
  const groups = [
    { uiId: "hero-idle", profileId: "hero", profileLabel: "Hero", name: "Idle" },
    { uiId: "enemy-run", profileId: "enemy", profileLabel: "Enemy", name: "Run" },
  ];
  const controller = createController({
    elements,
    getConfig: () => ({ groups }),
    groupLabel: (group) => `${group.profileLabel} - ${group.name}`,
    translate: (key) => ({ otherAnimations: "Other" })[key] || key,
  });

  const markup = controller.groupOptionsMarkup(groups);

  assert.match(markup, /<optgroup label="Hero">/);
  assert.match(markup, /<option value="hero-idle">Idle<\/option>/);
  assert.doesNotMatch(markup, />Hero - Idle</);
});

test("empty projects disable the unnecessary group search", () => {
  const elements = createElements();
  const controller = createController({
    elements,
    getConfig: () => ({ groups: [] }),
    translate: (key) => ({ noMatchingGroups: "None" })[key] || key,
  });

  assert.deepEqual(controller.renderGroupSelect(), []);
  assert.equal(elements.groupSelect.disabled, true);
  assert.equal(elements.groupSearch.disabled, true);
  assert.equal(elements.groupFilterField.hidden, true);
});
