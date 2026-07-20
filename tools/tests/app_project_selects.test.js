"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/app_project_selects");

/** Creates minimal select elements for the project-panel controller. */
function createElements() {
  return {
    projectSelect: { innerHTML: "", value: "", disabled: false },
    clearProject: { disabled: false },
    deleteProject: { disabled: false },
    profileSelect: { innerHTML: "", value: "" },
    groupSelect: { innerHTML: "", value: "", disabled: false },
    chainGroupSelect: { innerHTML: "", value: "" },
  };
}

test("project selects preserve active project and profile options", () => {
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
    getSelectedProfileId: () => selectedProfileId,
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
  assert.deepEqual(stored, [["xsxbFrameTuner.project", "project-2"]]);
  controller.renderProfileSelect();
  assert.equal(selectedProfileId, "all");
  assert.match(elements.profileSelect.innerHTML, /profile-1/);
  assert.doesNotMatch(elements.profileSelect.innerHTML, /profile-2/);
});

test("group filters and chain select preserve labels and selected values", () => {
  const elements = createElements();
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
    getSelectedProfileId: () => "hero",
    getGroupSearch: () => "slash",
    groupLabel: (group) => group.name,
    translate: (key) => ({ noMatchingGroups: "None", none: "No chain" })[key] || key,
  });

  assert.deepEqual(
    controller.filteredGroups().map((group) => group.uiId),
    ["hero-slash"],
  );
  assert.deepEqual(
    controller.renderGroupSelect("hero-slash").map((group) => group.uiId),
    ["hero-slash"],
  );
  assert.equal(elements.groupSelect.value, "hero-slash");
  controller.renderChainGroupSelect("hero-idle");
  assert.equal(elements.chainGroupSelect.value, "hero-idle");
  assert.match(elements.chainGroupSelect.innerHTML, /hero-slash/);
});
