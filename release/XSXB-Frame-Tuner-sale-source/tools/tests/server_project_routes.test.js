"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createProjectRoutes } = require("../animation_tuner/server_project_routes");

function createHarness() {
  const responses = [];
  const project = { id: "project-a" };
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
