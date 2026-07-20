const assert = require("node:assert/strict");
const test = require("node:test");

const { createController, readMutationResponse } = require("../animation_tuner/public/app_project_mutations");

function response({ ok = true, status = 200, body = "{}" } = {}) {
  return {
    ok,
    status,
    async text() {
      return body;
    },
  };
}

function createFixture(overrides = {}) {
  const state = {
    activeProjectId: "project-a",
    config: {
      activeProject: { id: "project-a", name: "Project A" },
      dataRevision: "r1",
      projects: [{ id: "project-a" }, { id: "project-b" }],
    },
    dirty: false,
  };
  const elements = {
    clearProject: { disabled: false },
    deleteProject: { disabled: false },
    projectSelect: { disabled: false },
  };
  const values = new Map();
  const events = [];
  const controller = createController({
    elements,
    getConfig: () => state.config,
    getActiveProjectId: () => state.activeProjectId,
    getDirty: () => state.dirty,
    setDirty: (value) => {
      state.dirty = value;
    },
    setSelectedProjectId: (value) => {
      state.activeProjectId = value;
    },
    confirm: () => true,
    fetchImpl: async (url, options) => {
      events.push({ url, options });
      if (url.endsWith("/active")) return response();
      if (url.endsWith("/clear")) return response();
      if (url.endsWith("/delete")) return response({ body: '{"activeProjectId":""}' });
      throw new Error(`unexpected URL: ${url}`);
    },
    translate: (key, variables = {}) => `${key}:${variables.project || ""}`,
    projectLabel: (project) => project.name,
    resetProjectSession: () => events.push("reset"),
    loadConfig: async () => events.push("load"),
    resizeCanvas: () => events.push("resize"),
    renderProjectSelect: () => events.push("render-projects"),
    status: (message) => events.push(`status:${message}`),
    storage: {
      setItem(key, value) {
        values.set(key, value);
      },
      removeItem(key) {
        values.delete(key);
      },
    },
    ...overrides,
  });
  return { controller, elements, events, state, values };
}

test("mutation response parses JSON and reports plain-text errors", async () => {
  assert.deepEqual(await readMutationResponse(response({ body: '{"ok":true}' })), { ok: true });
  await assert.rejects(
    () => readMutationResponse(response({ ok: false, status: 409, body: "conflict" })),
    /conflict/,
  );
  await assert.rejects(
    () => readMutationResponse(response({ ok: false, status: 500, body: '{"error":"server failed"}' })),
    /server failed/,
  );
});

test("project activation honors dirty confirmation and reloads on success", async () => {
  const fixture = createFixture();
  fixture.state.dirty = true;
  const cancelledEvents = [];
  const cancelled = createFixture({
    getDirty: () => true,
    confirm: () => false,
    renderProjectSelect: () => cancelledEvents.push("render-projects"),
  });

  assert.equal(await cancelled.controller.activateProject("project-b"), false);
  assert.deepEqual(cancelledEvents, ["render-projects"]);

  fixture.state.dirty = false;
  assert.equal(await fixture.controller.activateProject("project-b"), true);
  assert.equal(fixture.state.activeProjectId, "project-b");
  assert.equal(fixture.values.get("xsxbFrameTuner.project"), "project-b");
  assert.deepEqual(
    fixture.events.map((event) => (typeof event === "string" ? event : event.url)),
    ["/api/projects/active", "reset", "load", "resize"],
  );
});

test("clear and delete project mutations restore controls in finally", async () => {
  const fixture = createFixture();

  assert.equal(await fixture.controller.clearActiveProject(), true);
  assert.equal(fixture.elements.clearProject.disabled, false);
  assert.equal(fixture.elements.deleteProject.disabled, false);
  assert.ok(fixture.events.includes("status:projectCleared:Project A"));

  assert.equal(await fixture.controller.deleteActiveProject(), true);
  assert.equal(fixture.state.activeProjectId, "");
  assert.equal(fixture.values.has("xsxbFrameTuner.project"), false);
  assert.ok(fixture.events.includes("status:projectDeleted:Project A"));
});

test("project mutation errors propagate while busy controls recover", async () => {
  const fixture = createFixture({
    fetchImpl: async () => response({ ok: false, status: 500, body: "failed" }),
  });

  await assert.rejects(() => fixture.controller.clearActiveProject(), /failed/);
  assert.equal(fixture.elements.clearProject.disabled, false);
  assert.equal(fixture.elements.deleteProject.disabled, false);
});
