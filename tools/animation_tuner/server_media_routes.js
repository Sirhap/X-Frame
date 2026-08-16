"use strict";

const { planWorksetOperations } = require("./public/workset_handoff_core");

/**
 * Creates media and animation mutation route handlers.
 *
 * The dispatcher intentionally keeps the same route order and delegates every
 * mutation to the injected server operation.  Keeping filesystem snapshots,
 * project write queues, and Godot synchronization in the route body preserves
 * the behavior of the original handlers while making the HTTP entry point
 * easier to navigate and test.
 * @param {{send:Function,readJsonBody:Function,assertPremiumAccess?:(request:object,pathname:string,payload:object)=>unknown,withProjectWrite:Function,projectStore:object,projectFromRequest:Function,requiredProjectFromRequest:Function,projectDataRevision:Function,createFilesystemSnapshot:Function,managedProjectPaths:Function,saveTransactionPaths?:Function,rollbackFilesystemSnapshot:Function,fs:object,path:object,root:string,decodeDataUrl:Function,saveFrameAudioBindings:Function,saveFrameAttachmentImage:Function,saveAttachmentAssets:Function,replaceFrameImage:Function,replaceAnimationImages:Function,deleteAnimation:Function,importAnimation:Function,reorganizeAnimation:Function,syncGodotProjectAsync:Function,syncFrameAudioAsync:Function,syncGodotRuntimeProjectId:Function,godotMirrorPath:Function,validateProject:Function,godotHandoffService?:{status:(project:object)=>object}}} dependencies Route dependencies.
 * @returns {{handleMediaRoute:(req:object,res:object,parsed:URL)=>Promise<boolean>}} Media route dispatcher.
 */
function createMediaRoutes(dependencies = {}) {
  const {
    send,
    readJsonBody,
    assertPremiumAccess = () => {},
    withProjectWrite,
    projectStore,
    projectFromRequest,
    requiredProjectFromRequest,
    projectDataRevision,
    createFilesystemSnapshot,
    managedProjectPaths,
    saveTransactionPaths = () => [],
    rollbackFilesystemSnapshot,
    fs,
    path,
    root,
    decodeDataUrl,
    saveFrameAudioBindings,
    saveFrameAttachmentImage,
    saveAttachmentAssets,
    replaceFrameImage,
    replaceAnimationImages,
    deleteAnimation,
    importAnimation,
    reorganizeAnimation,
    syncGodotProjectAsync,
    syncFrameAudioAsync,
    syncGodotRuntimeProjectId,
    godotMirrorPath,
    validateProject,
    godotHandoffService = { status: () => ({ state: "local_only" }) },
  } = dependencies;

  /** Removes nested transaction targets so parent snapshots remain unambiguous during rollback. */
  function compactTransactionPaths(inputPaths) {
    const targets = [
      ...new Set(
        Array.from(inputPaths || [])
          .filter(Boolean)
          .map((entry) => path.resolve(entry)),
      ),
    ];
    return targets.filter(
      (target) =>
        !targets.some((candidate) => candidate !== target && target.startsWith(`${candidate}${path.sep}`)),
    );
  }

  /** Restores and disposes import transactions in reverse mutation order. */
  async function rollbackImportTransactions(transactions, cause) {
    const failures = [];
    for (const transaction of Array.from(transactions || [])
      .filter(Boolean)
      .reverse()) {
      try {
        await transaction.restore();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const transaction of Array.from(transactions || []).filter(Boolean)) {
      try {
        await transaction.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) {
      throw new AggregateError([cause, ...failures], "Animation import failed and rollback was incomplete.");
    }
    throw cause;
  }

  /** Reads all project-owned state required for workset preflight. */
  function worksetPlanningState(project) {
    const paths = projectStore.projectPaths(project);
    return {
      manifest: projectStore.readJson(paths.manifest, { schemaVersion: 1, profiles: [] }),
      tuning: projectStore.readJson(paths.tuning, {}),
      frameAudioBindings: projectStore.readJson(paths.frameAudio, []),
      frameImageAttachments: projectStore.readJson(paths.frameImageAttachments, []),
      attackTrails: projectStore.readJson(paths.attackTrails, { schemaVersion: 8, bindings: {} }),
    };
  }

  /** Produces a data-free operation summary suitable for an HTTP preflight response. */
  function publicWorksetOperation(operation) {
    return {
      id: operation.id,
      type: operation.type,
      profileId: operation.profileId,
      profileLabel: operation.profileLabel,
      animationId: operation.animationId,
      animationName: operation.animationName,
      frameCount: operation.frameCount,
    };
  }

  /** Plans one mixed workset batch against the latest project revision. */
  function planProjectWorksets(project, operations) {
    const plan = planWorksetOperations({
      ...worksetPlanningState(project),
      operations,
      slug: (value, fallback) => projectStore.slug(value, fallback),
    });
    return {
      ok: plan.ok,
      operations: plan.operations.map(publicWorksetOperation),
      conflicts: plan.conflicts,
      impacts: plan.impacts,
      baseRevision: projectDataRevision(project),
    };
  }

  /**
   * Handles frame media, animation import, and animation mutation endpoints.
   * @param {import("node:http").IncomingMessage} req Incoming request.
   * @param {import("node:http").ServerResponse} res Outgoing response.
   * @param {URL} parsed Parsed request URL.
   * @returns {Promise<boolean>} True when this dispatcher handled the request.
   */
  async function handleMediaRoute(req, res, parsed) {
    if (req.method === "POST" && parsed.pathname === "/api/project-worksets/plan") {
      const payload = await readJsonBody(req, parsed.pathname);
      const { project } = requiredProjectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      return send(res, 200, planProjectWorksets(project, payload.operations));
    }
    if (req.method === "POST" && parsed.pathname === "/api/project-worksets/apply") {
      const payload = await readJsonBody(req, parsed.pathname);
      assertPremiumAccess(req, parsed.pathname, payload);
      const { project } = requiredProjectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      await withProjectWrite(project.id, async () => {
        const currentRevision = projectDataRevision(project);
        if (payload.baseRevision && payload.baseRevision !== currentRevision) {
          return send(res, 409, {
            error: "Project data changed after workset preflight. Reload the target project and try again.",
            code: "revision_conflict",
            dataRevision: currentRevision,
          });
        }
        const plan = planWorksetOperations({
          ...worksetPlanningState(project),
          operations: payload.operations,
          slug: (value, fallback) => projectStore.slug(value, fallback),
        });
        if (!plan.ok) {
          return send(res, 409, {
            error: "Workset targets require attention before they can be applied.",
            code: "workset_conflict",
            conflicts: plan.conflicts,
            dataRevision: currentRevision,
          });
        }
        const transaction = await createFilesystemSnapshot(
          compactTransactionPaths([...managedProjectPaths(project), ...saveTransactionPaths(project)]),
        );
        let responsePayload;
        try {
          const results = [];
          for (const operation of plan.operations) {
            if (operation.type === "replace") {
              const organized = reorganizeAnimation({
                root,
                projectStore,
                project,
                profileId: operation.profileId,
                animationId: operation.animationId,
                items: operation.items,
              });
              const externalDirectory = godotMirrorPath(project, organized.targetDir);
              if (externalDirectory)
                await fs.promises.rm(externalDirectory, { recursive: true, force: true });
              results.push({
                id: operation.id,
                type: operation.type,
                profileId: operation.profileId,
                animationId: operation.animationId,
                frameCount: organized.frameCount,
              });
              continue;
            }
            const imported = importAnimation({
              root,
              projectStore,
              project,
              profileId: operation.profileId,
              profileLabel: operation.profileLabel,
              profileKind: String(operation.profileKind || "actor"),
              animationId: operation.animationId,
              animationName: operation.animationName,
              animationType: String(operation.animationType || "actor"),
              anchorMode: String(operation.anchorMode || "canvas_bottom_center"),
              fps: Number(operation.fps || 12),
              items: operation.items,
            });
            results.push({
              id: operation.id,
              type: operation.type,
              profileId: imported.profileId,
              animationId: imported.animationId,
              frameCount: imported.frameCount,
            });
          }
          const finalState = worksetPlanningState(project);
          const godotSync = await syncGodotProjectAsync(project, finalState);
          const runtimeProjectIdFiles = syncGodotRuntimeProjectId(project);
          const dataRevision = projectDataRevision(project);
          responsePayload = {
            ok: true,
            results,
            dataRevision,
            godotSync,
            godotHandoff: godotHandoffService.status(project),
            runtimeProjectIdFiles,
            warnings: validateProject(project, finalState.manifest),
          };
        } catch (error) {
          return rollbackFilesystemSnapshot(
            transaction,
            error,
            "Workset batch failed and rollback was incomplete.",
          );
        }
        await transaction.dispose();
        return send(res, 200, responsePayload);
      });
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/frame-audio") {
      const payload = await readJsonBody(req, parsed.pathname);
      assertPremiumAccess(req, parsed.pathname, payload);
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      await withProjectWrite(project.id, async () => {
        const bindings = Array.isArray(payload.frameAudioBindings)
          ? payload.frameAudioBindings
          : Object.entries(payload.frameAudioBindings || {}).map(([key, value]) => ({
              key,
              ...(value && typeof value === "object" ? value : {}),
            }));
        const paths = projectStore.projectPaths(project);
        const transaction = await createFilesystemSnapshot([
          paths.frameAudio,
          project?.projectRoot ? path.join(path.resolve(project.projectRoot), "xsxb_frame_tuner") : "",
        ]);
        try {
          saveFrameAudioBindings(bindings, project);
          const godotAudioSync = await syncFrameAudioAsync(project, bindings);
          await transaction.dispose();
          return send(res, 200, {
            ok: true,
            frameAudioCount: bindings.length,
            godotAudioSync,
            dataRevision: projectDataRevision(project),
            godotHandoff: godotHandoffService.status(project),
          });
        } catch (error) {
          return rollbackFilesystemSnapshot(
            transaction,
            error,
            "Frame audio sync failed and rollback was incomplete.",
          );
        }
      });
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/frame-attachment-image") {
      const payload = await readJsonBody(req, parsed.pathname);
      assertPremiumAccess(req, parsed.pathname, payload);
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      await withProjectWrite(project.id, () =>
        send(res, 200, {
          ok: true,
          image: saveFrameAttachmentImage(payload, project),
          dataRevision: projectDataRevision(project),
          godotHandoff: godotHandoffService.status(project),
        }),
      );
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/attachment-assets") {
      const payload = await readJsonBody(req, parsed.pathname);
      assertPremiumAccess(req, parsed.pathname, payload);
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      await withProjectWrite(project.id, () => {
        const currentRevision = projectDataRevision(project);
        if (payload.baseRevision && payload.baseRevision !== currentRevision) {
          return send(res, 409, {
            error: "Project data changed in another window. Reload before updating attachment assets.",
            code: "revision_conflict",
            dataRevision: currentRevision,
          });
        }
        return send(res, 200, {
          ok: true,
          assets: saveAttachmentAssets(payload.assets, project),
          dataRevision: projectDataRevision(project),
          godotHandoff: godotHandoffService.status(project),
        });
      });
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/replace-frame") {
      const payload = await readJsonBody(req, parsed.pathname);
      assertPremiumAccess(req, parsed.pathname, payload);
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      await withProjectWrite(project.id, () =>
        send(res, 200, {
          ok: true,
          frame: replaceFrameImage(payload, project),
          dataRevision: projectDataRevision(project),
          godotHandoff: godotHandoffService.status(project),
        }),
      );
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/replace-animation") {
      const payload = await readJsonBody(req, parsed.pathname);
      assertPremiumAccess(req, parsed.pathname, payload);
      const { project } = projectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      const frames = Array.isArray(payload.frames) ? payload.frames : [];
      const files = Array.isArray(payload.files) ? payload.files : [];
      await withProjectWrite(project.id, async () => {
        const godotOutput = project?.projectRoot
          ? path.join(path.resolve(project.projectRoot), "xsxb_frame_tuner")
          : "";
        const transaction = await createFilesystemSnapshot([godotOutput]);
        let replacement = null;
        try {
          replacement = replaceAnimationImages(frames, files, project);
          const godotSync = await syncGodotProjectAsync(project);
          await transaction.dispose();
          return send(res, 200, {
            ok: true,
            frames: replacement.frames,
            godotSync,
            dataRevision: projectDataRevision(project),
            godotHandoff: godotHandoffService.status(project),
          });
        } catch (error) {
          try {
            replacement?.rollback();
            await transaction.restore();
          } catch (rollbackError) {
            await transaction.dispose();
            throw new AggregateError(
              [error, rollbackError],
              "Godot synchronization failed and animation rollback was incomplete.",
            );
          }
          await transaction.dispose();
          throw error;
        }
      });
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/delete-animation") {
      const payload = await readJsonBody(req, parsed.pathname);
      const { project } = requiredProjectFromRequest(payload.projectId);
      await withProjectWrite(project.id, async () => {
        const currentRevision = projectDataRevision(project);
        if (payload.baseRevision && payload.baseRevision !== currentRevision) {
          return send(res, 409, {
            error: "Project data changed in another window. Reload before deleting the animation.",
            code: "revision_conflict",
            dataRevision: currentRevision,
          });
        }
        const transaction = await createFilesystemSnapshot(managedProjectPaths(project));
        try {
          const deleted = deleteAnimation({
            root,
            projectStore,
            project,
            profileId: String(payload.profileId || ""),
            animationId: String(payload.animationId || ""),
          });
          const externalDirectory = godotMirrorPath(project, deleted.removedDirectory);
          if (externalDirectory) {
            await fs.promises.rm(externalDirectory, { recursive: true, force: true });
          }
          const godotSync = await syncGodotProjectAsync(project, {
            manifest: deleted.manifest,
            tuning: deleted.tuning,
            frameAudioBindings: deleted.frameAudioBindings,
            frameImageAttachments: deleted.frameImageAttachments,
            attackTrails: deleted.attackTrails,
          });
          const dataRevision = projectDataRevision(project);
          await transaction.dispose();
          return send(res, 200, {
            ok: true,
            removedFrames: deleted.removedFrames,
            attackTrails: deleted.attackTrails,
            dataRevision,
            godotSync,
            godotHandoff: godotHandoffService.status(project),
          });
        } catch (error) {
          return rollbackFilesystemSnapshot(
            transaction,
            error,
            "Animation deletion failed and rollback was incomplete.",
          );
        }
      });
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/import-animation") {
      const payload = await readJsonBody(req, parsed.pathname);
      assertPremiumAccess(req, parsed.pathname, payload);
      const items = Array.isArray(payload.items) ? payload.items : [];
      const profileLabel = String(payload.profileLabel || "").trim();
      const animationName = String(payload.animationName || "").trim();
      const projectLabel = String(payload.projectLabel || "").trim();
      if (!items.length) throw new Error("Import at least one animation frame.");
      if (!profileLabel || !animationName) throw new Error("Profile and animation names are required.");
      if (!payload.projectId && !projectLabel)
        throw new Error("A project name is required when creating a local project.");
      const hasInvalidPng = items.some((item) => {
        const decoded = decodeDataUrl(item?.data);
        return (
          decoded?.mime !== "image/png" ||
          decoded.buffer.length < 24 ||
          decoded.buffer.toString("ascii", 1, 4) !== "PNG" ||
          decoded.buffer.readUInt32BE(16) < 1 ||
          decoded.buffer.readUInt32BE(20) < 1
        );
      });
      if (hasInvalidPng) {
        throw new Error("Every imported frame must contain PNG image data.");
      }
      const requestedProjectId = payload.projectId ? projectStore.slug(payload.projectId) : "";
      await withProjectWrite(requestedProjectId || "__registry__", async () => {
        const registryTransaction = await createFilesystemSnapshot([projectStore.path]);
        let projectTransaction = null;
        let responsePayload = null;
        let transactionsDisposed = false;
        try {
          let registry = projectStore.readRegistry();
          let project = requestedProjectId
            ? registry.projects.find((entry) => entry.id === requestedProjectId)
            : null;
          if (requestedProjectId && !project) throw new Error(`Project not found: ${payload.projectId}`);
          if (!project) {
            registry = projectStore.addProject({ label: projectLabel });
            project = projectStore.resolveProject(registry, registry.activeProjectId);
          } else if (registry.activeProjectId !== project.id) {
            registry = projectStore.setActiveProject(project.id);
            project = projectStore.resolveProject(registry, project.id);
          }
          projectTransaction = await createFilesystemSnapshot(managedProjectPaths(project));
          const imported = importAnimation({
            root,
            projectStore,
            project,
            profileId: projectStore.slug(payload.profileId || profileLabel, "character"),
            profileLabel,
            profileKind: String(payload.profileKind || "actor"),
            animationId: projectStore.slug(payload.animationId || animationName, "animation"),
            animationName,
            animationType: String(payload.animationType || "actor"),
            anchorMode: String(payload.anchorMode || "canvas_bottom_center"),
            fps: Number(payload.fps || 12),
            items,
          });
          const godotSync = await syncGodotProjectAsync(project, {
            manifest: imported.manifest,
            tuning: imported.tuning,
          });
          const runtimeProjectIdFiles = syncGodotRuntimeProjectId(project);
          responsePayload = {
            ok: true,
            activeProjectId: project.id,
            profileId: imported.profileId,
            animationId: imported.animationId,
            frameCount: imported.frameCount,
            godotSync,
            godotHandoff: godotHandoffService.status(project),
            dataRevision: projectDataRevision(project),
            runtimeProjectIdFiles,
            warnings: validateProject(project, imported.manifest),
          };
          await projectTransaction.dispose();
          await registryTransaction.dispose();
          transactionsDisposed = true;
        } catch (error) {
          if (transactionsDisposed) throw error;
          return rollbackImportTransactions([projectTransaction, registryTransaction], error);
        }
        return send(res, 200, responsePayload);
      });
      return true;
    }
    if (req.method === "POST" && parsed.pathname === "/api/reorganize-animation") {
      const payload = await readJsonBody(req, parsed.pathname);
      assertPremiumAccess(req, parsed.pathname, payload);
      const { project } = requiredProjectFromRequest(payload.projectId || parsed.searchParams.get("project"));
      await withProjectWrite(project.id, async () => {
        const currentRevision = projectDataRevision(project);
        if (payload.baseRevision && payload.baseRevision !== currentRevision) {
          return send(res, 409, {
            error: "Project data changed in another window. Reload before deleting frames.",
            code: "revision_conflict",
            dataRevision: currentRevision,
          });
        }
        const transaction = await createFilesystemSnapshot(managedProjectPaths(project));
        try {
          const organized = reorganizeAnimation({
            root,
            projectStore,
            project,
            profileId: String(payload.profileId || ""),
            animationId: String(payload.animationId || ""),
            items: payload.items,
          });
          const externalDirectory = godotMirrorPath(project, organized.targetDir);
          if (externalDirectory) {
            await fs.promises.rm(externalDirectory, { recursive: true, force: true });
          }
          const godotSync = await syncGodotProjectAsync(project, {
            manifest: organized.manifest,
            tuning: organized.tuning,
            frameAudioBindings: organized.frameAudioBindings,
            frameImageAttachments: organized.frameImageAttachments,
          });
          const runtimeProjectIdFiles = syncGodotRuntimeProjectId(project);
          const dataRevision = projectDataRevision(project);
          await transaction.dispose();
          return send(res, 200, {
            ok: true,
            frameCount: organized.frameCount,
            dataRevision,
            godotSync,
            godotHandoff: godotHandoffService.status(project),
            runtimeProjectIdFiles,
            warnings: validateProject(project, organized.manifest),
          });
        } catch (error) {
          return rollbackFilesystemSnapshot(
            transaction,
            error,
            "Frame deletion failed and rollback was incomplete.",
          );
        }
      });
      return true;
    }
    return false;
  }

  return { handleMediaRoute };
}

module.exports = { createMediaRoutes };
