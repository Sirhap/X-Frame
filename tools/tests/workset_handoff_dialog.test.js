"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createController } = require("../animation_tuner/public/workset_handoff_dialog");

/** Creates the small DOM surface needed by the workset handoff controller. */
function createDom() {
  const elements = new Map();
  const documentRef = {
    activeElement: null,
    createElement,
    querySelector(selector) {
      return selector.startsWith("#") ? elements.get(selector.slice(1)) || null : null;
    },
    querySelectorAll() {
      return [];
    },
  };

  /** Creates an event-capable DOM-like element. */
  function createElement(tagName = "div") {
    const listeners = new Map();
    return {
      tagName: String(tagName).toUpperCase(),
      children: [],
      dataset: {},
      disabled: false,
      hidden: false,
      inert: false,
      required: false,
      textContent: "",
      value: "",
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      append(...children) {
        this.children.push(...children);
      },
      dispatch(type, event = {}) {
        listeners.get(type)?.({ target: this, ...event });
      },
      focus() {
        documentRef.activeElement = this;
      },
      querySelectorAll() {
        return [];
      },
      replaceChildren(...children) {
        this.children = children;
      },
      setAttribute(name, value) {
        this[name] = String(value);
      },
    };
  }

  for (const id of [
    "worksetHandoffDialog",
    "worksetHandoffClose",
    "worksetHandoffForm",
    "worksetHandoffProject",
    "worksetHandoffNewProjectField",
    "worksetHandoffNewProject",
    "worksetHandoffRows",
    "worksetHandoffImpact",
    "worksetHandoffStatus",
    "worksetHandoffSuccess",
    "worksetHandoffTargets",
    "worksetHandoffCancel",
    "worksetHandoffSubmit",
  ]) {
    elements.set(id, createElement(id.includes("Project") ? "select" : "div"));
  }
  elements.get("worksetHandoffDialog").hidden = true;
  elements.get("worksetHandoffSuccess").hidden = true;
  elements.get("worksetHandoffImpact").hidden = true;
  return { documentRef, elements };
}

/** Returns the editable controls rendered for the first workset row. */
function firstRowControls(elements) {
  const row = elements.get("worksetHandoffRows").children[0];
  return {
    type: row.children[1].children[1],
    profile: row.children[2].children[1],
    animation: row.children[3].children[1],
    target: row.children[4].children[1],
  };
}

/** Waits until an asynchronous click handler reaches an observable state. */
async function waitFor(predicate, message = "condition") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${message}.`);
}

/** Creates a standard one-frame workset. */
function workset(overrides = {}) {
  return {
    id: "idle-result",
    label: "Idle result",
    profileLabel: "hero",
    animationName: "idle",
    items: [{ name: "idle-01.png", data: "data:image/png;base64,AA==", sourceIndex: 0 }],
    ...overrides,
  };
}

/** Creates a controller fixture with overridable project adapters. */
function createFixture(overrides = {}) {
  const { documentRef, elements } = createDom();
  const calls = { apply: [], createProject: [], discardProject: [], plan: [] };
  const dependencies = {
    documentRef,
    windowRef: { location: { origin: "http://localhost:4173" } },
    getConfig: () => ({
      activeProjectId: "project-a",
      projects: [{ id: "project-a", label: "Project A" }],
    }),
    loadProjectConfig: async () => ({ groups: [] }),
    createProject: async (label) => {
      calls.createProject.push(label);
      return { projectId: "created-project", config: { groups: [], dataRevision: "new-revision" } };
    },
    discardProject: async (projectId, context) => {
      calls.discardProject.push({ projectId, context });
    },
    plan: async (payload) => {
      calls.plan.push(payload);
      return { ok: true, baseRevision: "revision-1", impacts: [] };
    },
    apply: async (payload) => {
      calls.apply.push(payload);
      return {
        results: [{ profileId: "hero", animationId: "idle" }],
      };
    },
    ...overrides,
  };
  const controller = createController(dependencies);
  controller.bind();
  return { calls, controller, elements };
}

test("workset handoff defaults to creating a new animation", async () => {
  const fixture = createFixture();
  await fixture.controller.open({ worksets: [workset()] });

  assert.equal(firstRowControls(fixture.elements).type.value, "create");
  fixture.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(() => fixture.calls.apply.length === 1, "workset application");

  assert.equal(fixture.calls.plan[0].operations[0].type, "create");
  assert.equal(fixture.calls.plan[0].operations[0].items[0].data, undefined);
  assert.equal(fixture.calls.apply[0].operations[0].items[0].data, "data:image/png;base64,AA==");
});

test("workset handoff surfaces animation name conflicts without applying", async () => {
  const fixture = createFixture({
    plan: async (payload) => {
      fixture.calls.plan.push(payload);
      return {
        ok: false,
        conflicts: [{ code: "animation_name_conflict", message: "动画名称 idle 已存在。" }],
      };
    },
  });
  await fixture.controller.open({ worksets: [workset()] });

  fixture.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(
    () => fixture.elements.get("worksetHandoffStatus").dataset.tone === "error",
    "conflict status",
  );

  assert.match(fixture.elements.get("worksetHandoffStatus").textContent, /idle 已存在/);
  assert.equal(fixture.calls.apply.length, 0);
});

test("replacement impact requires a second explicit confirmation", async () => {
  const fixture = createFixture({
    loadProjectConfig: async () => ({
      groups: [
        {
          profileId: "hero",
          profileLabel: "Hero",
          animationId: "idle",
          name: "Idle",
        },
      ],
    }),
    plan: async (payload) => {
      fixture.calls.plan.push(payload);
      return {
        ok: true,
        baseRevision: "revision-2",
        impacts: [
          {
            profileId: "hero",
            animationId: "idle",
            frames: { before: 8, after: 1 },
            visual: { removed: 1 },
          },
        ],
      };
    },
  });
  await fixture.controller.open({
    worksets: [
      workset({
        defaultType: "replace",
        targetProfileId: "hero",
        targetAnimationId: "idle",
      }),
    ],
  });

  fixture.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(() => fixture.elements.get("worksetHandoffImpact").hidden === false, "replacement impact");
  assert.equal(fixture.calls.apply.length, 0);
  assert.equal(fixture.elements.get("worksetHandoffSubmit").textContent, "确认影响并加入项目");

  fixture.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(() => fixture.calls.apply.length === 1, "confirmed replacement");
  assert.equal(fixture.calls.plan.length, 1);
  assert.equal(fixture.calls.apply[0].baseRevision, "revision-2");
});

test("successful handoff links to the selected project animation", async () => {
  const fixture = createFixture();
  await fixture.controller.open({ worksets: [workset()] });

  fixture.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(() => fixture.elements.get("worksetHandoffTargets").children.length === 1, "success target");

  const link = fixture.elements.get("worksetHandoffTargets").children[0];
  assert.equal(link.href, "/workspace?project=project-a&animation=hero%2Fidle");
  assert.equal(fixture.elements.get("worksetHandoffSuccess").hidden, false);
});

test("new project is created only once across impact confirmation", async () => {
  const fixture = createFixture({
    getConfig: () => ({ projects: [] }),
    plan: async (payload) => {
      fixture.calls.plan.push(payload);
      return {
        ok: true,
        baseRevision: "revision-created",
        impacts: [
          {
            profileId: "hero",
            animationId: "idle",
            frames: { before: 2, after: 1 },
          },
        ],
      };
    },
  });
  await fixture.controller.open({ worksets: [workset()] });
  fixture.elements.get("worksetHandoffNewProject").value = "New Project";

  fixture.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(() => fixture.elements.get("worksetHandoffImpact").hidden === false, "new project impact");
  fixture.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(() => fixture.calls.apply.length === 1, "new project application");

  assert.deepEqual(fixture.calls.createProject, ["New Project"]);
  assert.equal(fixture.calls.plan.length, 1);
  assert.equal(fixture.calls.apply[0].projectId, "created-project");
});

test("cancelling a pending new-project handoff removes the empty project shell", async () => {
  const fixture = createFixture({ getConfig: () => ({ activeProjectId: "project-a", projects: [] }) });
  await fixture.controller.open({ worksets: [workset()] });
  fixture.elements.get("worksetHandoffNewProject").value = "Temporary Project";
  fixture.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(() => fixture.calls.apply.length === 1, "new project application");
  // A successful apply owns the project, so it must not be cleaned up.
  fixture.elements.get("worksetHandoffCancel").dispatch("click");
  assert.equal(fixture.calls.discardProject.length, 0);

  const pending = createFixture({
    getConfig: () => ({ activeProjectId: "project-a", projects: [] }),
    plan: async (payload) => {
      pending.calls.plan.push(payload);
      return {
        ok: true,
        baseRevision: "new-revision",
        impacts: [{ profileId: "hero", animationId: "idle", frames: { before: 2, after: 1 } }],
      };
    },
  });
  await pending.controller.open({ worksets: [workset()] });
  pending.elements.get("worksetHandoffNewProject").value = "Abandoned Project";
  pending.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(() => pending.elements.get("worksetHandoffImpact").hidden === false, "pending impact");
  await new Promise((resolve) => setImmediate(resolve));
  pending.elements.get("worksetHandoffCancel").dispatch("click");
  await waitFor(() => pending.calls.discardProject.length === 1, "project cleanup");
  assert.deepEqual(pending.calls.discardProject[0], {
    projectId: "created-project",
    context: { baseRevision: "new-revision", restoreProjectId: "project-a" },
  });
});

test("a successful apply survives a post-apply workspace refresh failure", async () => {
  const fixture = createFixture({
    getConfig: () => ({ activeProjectId: "project-a", projects: [] }),
    onApplied: async () => {
      throw new Error("refresh unavailable");
    },
  });
  await fixture.controller.open({ worksets: [workset()] });
  fixture.elements.get("worksetHandoffNewProject").value = "Durable Project";

  fixture.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(() => fixture.calls.apply.length === 1, "successful project apply");
  await waitFor(
    () => fixture.elements.get("worksetHandoffSuccess").hidden === false,
    "success state after refresh failure",
  );

  assert.equal(fixture.calls.discardProject.length, 0);
  assert.match(fixture.elements.get("worksetHandoffStatus").textContent, /动画已加入项目/);
  fixture.elements.get("worksetHandoffCancel").dispatch("click");
  assert.equal(fixture.calls.discardProject.length, 0);
});

test("switching away from an uncommitted new project removes its empty shell", async () => {
  const fixture = createFixture({
    plan: async (payload) => {
      fixture.calls.plan.push(payload);
      return {
        ok: true,
        baseRevision: "new-revision",
        impacts: [{ profileId: "hero", animationId: "idle", frames: { before: 2, after: 1 } }],
      };
    },
  });
  await fixture.controller.open({ worksets: [workset()] });
  const projectSelect = fixture.elements.get("worksetHandoffProject");
  projectSelect.value = "__new__";
  projectSelect.dispatch("change");
  await waitFor(
    () =>
      fixture.elements.get("worksetHandoffNewProjectField").hidden === false &&
      fixture.elements.get("worksetHandoffSubmit").disabled === false,
    "ready new-project fields",
  );
  fixture.elements.get("worksetHandoffNewProject").value = "Unused Project";
  fixture.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(() => fixture.elements.get("worksetHandoffImpact").hidden === false, "pending impact");

  projectSelect.value = "project-a";
  projectSelect.dispatch("change");
  await waitFor(() => fixture.calls.discardProject.length === 1, "abandoned project cleanup");

  assert.deepEqual(fixture.calls.discardProject[0], {
    projectId: "created-project",
    context: { baseRevision: "new-revision", restoreProjectId: "project-a" },
  });
});

test("a failed empty-project cleanup restores the still-owned project selection", async () => {
  const fixture = createFixture({
    discardProject: async () => {
      throw new Error("cleanup unavailable");
    },
    plan: async (payload) => {
      fixture.calls.plan.push(payload);
      return {
        ok: true,
        baseRevision: "new-revision",
        impacts: [{ profileId: "hero", animationId: "idle", frames: { before: 2, after: 1 } }],
      };
    },
  });
  await fixture.controller.open({ worksets: [workset()] });
  const projectSelect = fixture.elements.get("worksetHandoffProject");
  projectSelect.value = "__new__";
  projectSelect.dispatch("change");
  await waitFor(
    () => fixture.elements.get("worksetHandoffSubmit").disabled === false,
    "ready new-project target",
  );
  fixture.elements.get("worksetHandoffNewProject").value = "Retained Project";
  fixture.elements.get("worksetHandoffSubmit").dispatch("click");
  await waitFor(() => fixture.elements.get("worksetHandoffImpact").hidden === false, "pending impact");

  projectSelect.value = "project-a";
  projectSelect.dispatch("change");
  await waitFor(() => fixture.elements.get("worksetHandoffStatus").dataset.tone === "error", "cleanup error");

  assert.equal(projectSelect.value, "created-project");
  assert.match(fixture.elements.get("worksetHandoffStatus").textContent, /cleanup unavailable/);
  assert.equal(fixture.calls.apply.length, 0);
});

test("workset handoff uses the host translator for chrome copy", async () => {
  const fixture = createFixture({
    translate: (key) => (key === "handoffSubmit" ? "Check and add" : key),
  });
  await fixture.controller.open({ worksets: [workset()] });
  assert.equal(fixture.elements.get("worksetHandoffSubmit").textContent, "Check and add");
});
