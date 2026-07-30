"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createProjectRoutes } = require("../animation_tuner/server_project_routes");

/** @param {object} [projectOverrides] Project fields to override. @returns {object} Route test harness. */
function createHarness(projectOverrides = {}) {
  const responses = [];
  const project = { id: "project-a", ...projectOverrides };
  const registry = { activeProjectId: project.id, projects: [project] };
  const projectStore = {
    path: "/registry.json",
    addProject: () => registry,
    setActiveProject: () => registry,
    writeRegistry: () => registry,
    projectForClient: (entry) => ({ id: entry.id }),
  };
  const routes = createProjectRoutes({
    send: (_res, status, payload) => {
      responses.push({ status, payload });
    },
    readJsonBody: async (_req, pathname) => {
      assert.match(pathname, /^\/api\/projects/);
      return { projectId: project.id };
    },
    withProjectWrite: async (_projectId, operation) => operation(),
    projectStore,
    requiredProjectFromRequest: () => ({ registry, project }),
    projectDataRevision: () => "revision-a",
    createFilesystemSnapshot: async () => ({
      dispose: async () => {},
      restore: async () => {},
    }),
    managedProjectPaths: () => ["/project-a"],
    clearProjectContent: async () => ({ ok: true }),
    rollbackFilesystemSnapshot: async (_transaction, error) => {
      throw error;
    },
    godotHandoffService: {
      execute: async () => ({
        godotSync: { ok: true },
        godotHandoff: { state: "synced" },
        dataRevision: "revision-a",
      }),
      status: () => ({ state: "synced" }),
    },
    projectsResponse: () => ({ activeProjectId: registry.activeProjectId }),
    fs: { promises: { rm: async () => {} } },
  });
  return { routes, responses, project };
}

test("project route dispatcher preserves registry responses", async () => {
  const { routes, responses } = createHarness();
  const handled = await routes.handleProjectRoute(
    { method: "GET" },
    {},
    new URL("http://127.0.0.1/api/projects"),
  );
  assert.equal(handled, true);
  assert.deepEqual(responses, [{ status: 200, payload: { activeProjectId: "project-a" } }]);
});

test("project route dispatcher keeps clear responses and ignores unrelated paths", async () => {
  const { routes, responses } = createHarness();
  const clearRequest = { method: "POST" };
  const handled = await routes.handleProjectRoute(
    clearRequest,
    {},
    new URL("http://127.0.0.1/api/projects/clear"),
  );
  assert.equal(handled, true);
  assert.equal(responses[0].status, 200);

  const unmatched = await routes.handleProjectRoute(
    { method: "GET" },
    {},
    new URL("http://127.0.0.1/api/unknown"),
  );
  assert.equal(unmatched, false);
});

test("project handoff route exposes structured success and conflicts", async () => {
  const success = createHarness();
  const handled = await success.routes.handleProjectRoute(
    { method: "POST" },
    {},
    new URL("http://127.0.0.1/api/projects/handoff"),
  );
  assert.equal(handled, true);
  assert.deepEqual(success.responses[0], {
    status: 200,
    payload: {
      ok: true,
      godotSync: { ok: true },
      godotHandoff: { state: "synced" },
      dataRevision: "revision-a",
    },
  });

  const conflict = createHarness();
  conflict.routes = createProjectRoutes({
    send: (_res, status, payload) => conflict.responses.push({ status, payload }),
    readJsonBody: async () => ({ projectId: conflict.project.id, action: "bind" }),
    withProjectWrite: async (_id, operation) => operation(),
    requiredProjectFromRequest: () => ({ project: conflict.project }),
    godotHandoffService: {
      execute: async () => {
        const error = new Error("Confirm rebind.");
        error.status = 409;
        error.code = "rebind_confirmation_required";
        error.details = { currentProjectRoot: "/old" };
        throw error;
      },
    },
  });
  await conflict.routes.handleProjectRoute(
    { method: "POST" },
    {},
    new URL("http://127.0.0.1/api/projects/handoff"),
  );
  assert.deepEqual(conflict.responses[0], {
    status: 409,
    payload: {
      error: "Confirm rebind.",
      code: "rebind_confirmation_required",
      currentProjectRoot: "/old",
    },
  });
});

test("project deletion protects the Codex Pets system project", async () => {
  const fixture = createHarness({ id: "codex_pets", kind: "codex_pets" });
  const handled = await fixture.routes.handleProjectRoute(
    { method: "POST" },
    {},
    new URL("http://127.0.0.1/api/projects/delete"),
  );
  assert.equal(handled, true);
  assert.deepEqual(fixture.responses, [
    {
      status: 409,
      payload: {
        error: "The Codex Pets system project cannot be deleted. Remove custom pets individually instead.",
        code: "protected_system_project",
      },
    },
  ]);
});
