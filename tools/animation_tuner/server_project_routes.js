"use strict";

const CODEX_PETS_PROJECT_ID = "codex_pets";

/**
 * Creates project registry and project lifecycle route handlers.
 *
 * The route order and response payloads intentionally mirror the handlers that
 * previously lived in server.js.  Dependencies are injected so this module
 * only delegates work and does not alter project-store or filesystem logic.
 * @param {{send:Function,readJsonBody:Function,withProjectWrite:Function,projectStore:object,requiredProjectFromRequest:Function,projectDataRevision:Function,createFilesystemSnapshot:Function,managedProjectPaths:Function,clearProjectContent:Function,rollbackFilesystemSnapshot:Function,projectsResponse:Function,godotHandoffService?:object,fs:object}} dependencies Route dependencies.
 * @returns {{handleProjectRoute:(req:object,res:object,parsed:URL)=>Promise<boolean>}} Project route dispatcher.
 */
function createProjectRoutes(dependencies = {}) {
  const {
    send,
    readJsonBody,
    withProjectWrite,
    projectStore,
    requiredProjectFromRequest,
    projectDataRevision,
    createFilesystemSnapshot,
    managedProjectPaths,
    clearProjectContent,
    rollbackFilesystemSnapshot,
    projectsResponse,
    godotHandoffService,
    fs,
  } = dependencies;

  /**
   * Handles project registry, clear, and delete endpoints.
   * @param {import("node:http").IncomingMessage} req Incoming request.
   * @param {import("node:http").ServerResponse} res Outgoing response.
   * @param {URL} parsed Parsed request URL.
   * @returns {Promise<boolean>} True when this dispatcher handled the request.
   */
  async function handleProjectRoute(req, res, parsed) {
    if (req.method === "GET" && parsed.pathname === "/api/projects") {
      send(res, 200, projectsResponse());
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/projects") {
      const payload = await readJsonBody(req, parsed.pathname);
      await withProjectWrite("__registry__", () => {
        const registry = projectStore.addProject(payload);
        return send(res, 200, {
          ok: true,
          activeProjectId: registry.activeProjectId,
          projects: registry.projects.map(projectStore.projectForClient),
        });
      });
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/projects/active") {
      const payload = await readJsonBody(req, parsed.pathname);
      await withProjectWrite("__registry__", () => {
        const registry = projectStore.setActiveProject(payload.projectId);
        return send(res, 200, {
          ok: true,
          activeProjectId: registry.activeProjectId,
          projects: registry.projects.map(projectStore.projectForClient),
        });
      });
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/projects/handoff") {
      const payload = await readJsonBody(req, parsed.pathname);
      const initial = requiredProjectFromRequest(payload.projectId);
      await withProjectWrite(initial.project.id, () =>
        withProjectWrite("__registry__", async () => {
          const { project } = requiredProjectFromRequest(payload.projectId);
          try {
            const result = await godotHandoffService.execute(project, payload);
            return send(res, 200, { ok: true, ...result });
          } catch (error) {
            if (!error?.status || !error?.code) throw error;
            return send(res, Number(error.status), {
              error: String(error.message || error),
              code: String(error.code),
              ...(error.details && typeof error.details === "object" ? error.details : {}),
            });
          }
        }),
      );
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/projects/clear") {
      const payload = await readJsonBody(req, parsed.pathname);
      const { project } = requiredProjectFromRequest(payload.projectId);
      await withProjectWrite(project.id, async () => {
        const currentRevision = projectDataRevision(project);
        if (payload.baseRevision && payload.baseRevision !== currentRevision) {
          return send(res, 409, {
            error: "Project data changed in another window. Reload before clearing it.",
            code: "revision_conflict",
            dataRevision: currentRevision,
          });
        }
        const transaction = await createFilesystemSnapshot(managedProjectPaths(project));
        try {
          const godotSync = await clearProjectContent(project);
          const dataRevision = projectDataRevision(project);
          await transaction.dispose();
          return send(res, 200, {
            ok: true,
            projectId: project.id,
            dataRevision,
            godotSync,
            godotHandoff: godotHandoffService?.status(project),
          });
        } catch (error) {
          return rollbackFilesystemSnapshot(
            transaction,
            error,
            "Project clear failed and rollback was incomplete.",
          );
        }
      });
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/projects/delete") {
      const payload = await readJsonBody(req, parsed.pathname);
      const initial = requiredProjectFromRequest(payload.projectId);
      await withProjectWrite(initial.project.id, () =>
        withProjectWrite("__registry__", async () => {
          const { registry, project } = requiredProjectFromRequest(payload.projectId);
          if (project.id === CODEX_PETS_PROJECT_ID || project.kind === "codex_pets") {
            return send(res, 409, {
              error:
                "The Codex Pets system project cannot be deleted. Remove custom pets individually instead.",
              code: "protected_system_project",
            });
          }
          const currentRevision = projectDataRevision(project);
          if (payload.baseRevision && payload.baseRevision !== currentRevision) {
            return send(res, 409, {
              error: "Project data changed in another window. Reload before deleting it.",
              code: "revision_conflict",
              dataRevision: currentRevision,
            });
          }
          const transaction = await createFilesystemSnapshot([
            projectStore.path,
            ...managedProjectPaths(project),
          ]);
          try {
            for (const targetPath of managedProjectPaths(project)) {
              await fs.promises.rm(targetPath, { recursive: true, force: true });
            }
            registry.projects = registry.projects.filter((entry) => entry.id !== project.id);
            if (
              registry.activeProjectId === project.id ||
              !registry.projects.some((entry) => entry.id === registry.activeProjectId)
            ) {
              registry.activeProjectId = registry.projects[0]?.id || "";
            }
            const nextRegistry = projectStore.writeRegistry(registry);
            await transaction.dispose();
            return send(res, 200, {
              ok: true,
              deletedProjectId: project.id,
              activeProjectId: nextRegistry.activeProjectId,
              projects: nextRegistry.projects.map(projectStore.projectForClient),
            });
          } catch (error) {
            return rollbackFilesystemSnapshot(
              transaction,
              error,
              "Project deletion failed and rollback was incomplete.",
            );
          }
        }),
      );
      return true;
    }
    return false;
  }

  return { handleProjectRoute };
}

module.exports = { createProjectRoutes };
