(function attachXsxbAppToolActions(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppToolActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the workbench actions that mutate animation and organizer data.
   *
   * The editor state remains owned by app.js. Every mutable value and side
   * effect is injected so these actions preserve the existing API while being
   * independently testable.
   *
   * @param {object} [dependencies] Action state and collaborator callbacks.
   * @returns {object} Animation tool actions.
   */
  function createController(dependencies = {}) {
    const {
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      getSelectedFrameIndexes = () => [],
      getActiveProjectId = () => "",
      getConfig = () => null,
      getLanguage = () => "zh",
      browserOnly = false,
      getFrameMutationPending = () => false,
      setFrameMutationPending = () => {},
      setDirty = () => {},
      setSelectedProjectId = () => {},
      fetchImpl = root?.fetch,
      confirm = async () => false,
      storage = resolveStorage(root),
      translate = (key) => key,
      status = () => {},
      outputCore = root?.BatchCutoutOutputCore,
      readMutationResponse = defaultReadMutationResponse,
      resetProjectSession = () => {},
      loadConfig = async () => {},
      resizeCanvas = () => {},
      selectGroup = async () => {},
      deleteBrowserSessionFrames = async () => {},
      deleteBrowserSessionAnimation = async () => {},
      clearImageCache = () => {},
      clearImageElements = () => {},
      setOpaqueRectCache = () => {},
      premiumFeatures = root?.XSXBPremiumFeatures,
      onFramesChanged = () => {},
    } = dependencies;

    /**
     * Clears decoded-image caches after a server-side frame mutation.
     * @returns {void}
     */
    function clearImageCaches() {
      clearImageCache();
      clearImageElements();
      setOpaqueRectCache(new WeakMap());
    }

    /**
     * Replaces all PNG files in the active animation group with processed
     * cutout results.
     * @param {Array<{data:string}>} outputs Processed PNG data URLs in frame order.
     * @param {{premiumFeatures?:string[]}} [options] Premium output metadata.
     * @returns {Promise<void>}
     */
    async function applyCutoutOutputsToCurrentAnimation(outputs, options = {}) {
      const group = getCurrentGroup();
      if (!group?.frames?.length) throw new Error("No active animation.");
      if (!outputCore?.createAnimationReplacementPayload) {
        throw new Error("Batch cutout output core is unavailable.");
      }
      const payload = outputCore.createAnimationReplacementPayload(
        getActiveProjectId(),
        group.frames,
        outputs,
      );
      const response = await requireFetch()("/api/replace-animation", {
        method: "POST",
        headers: mutationHeaders(options.premiumFeatures),
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await response.text());
      clearImageCaches();
      const frameIndex = getSelectedFrame();
      await selectGroup(group, { frameIndex, preserveView: true });
      onFramesChanged({ type: "assets-replaced", frameIndexes: group.frames.map((_frame, index) => index) });
    }

    /**
     * Replaces only one frame while retaining the animation order and selection.
     * @param {{data:string}} output Processed PNG output for the selected frame.
     * @param {{frameIndex?:number,premiumFeatures?:string[]}} [options] Target frame and premium metadata.
     * @returns {Promise<void>}
     */
    async function applyCutoutOutputToCurrentFrame(output, options = {}) {
      const group = getCurrentGroup();
      const requestedIndex = Number.isInteger(options.frameIndex) ? options.frameIndex : getSelectedFrame();
      const frameIndex = Math.max(0, requestedIndex);
      const frame = group?.frames?.[frameIndex];
      if (!frame) throw new Error("No active animation frame.");
      if (!outputCore?.createAnimationReplacementPayload) {
        throw new Error("Batch cutout output core is unavailable.");
      }
      const payload = outputCore.createAnimationReplacementPayload(getActiveProjectId(), [frame], [output]);
      const response = await requireFetch()("/api/replace-animation", {
        method: "POST",
        headers: mutationHeaders(options.premiumFeatures),
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await response.text());
      clearImageCaches();
      await selectGroup(group, { frameIndex, preserveView: true });
      onFramesChanged({ type: "assets-replaced", frameIndexes: [frameIndex] });
    }

    /**
     * Applies a staged frame organizer plan and reloads project configuration.
     * @param {Array<object>} items Ordered organizer frame plan.
     * @param {{premiumFeatures?:string[]}} [options] Premium output metadata.
     * @returns {Promise<void>}
     */
    async function applyFrameOrganizerPlan(items, options = {}) {
      const group = getCurrentGroup();
      if (!group?.profileId || !group?.animationId) {
        throw new Error("The active group is not a manifest animation.");
      }
      const response = await requireFetch()("/api/reorganize-animation", {
        method: "POST",
        headers: mutationHeaders(options.premiumFeatures),
        body: JSON.stringify({
          projectId: getActiveProjectId(),
          profileId: group.profileId,
          animationId: group.animationId,
          baseRevision: getConfig()?.dataRevision || "",
          items,
        }),
      });
      await readMutationResponse(response);
      resetProjectSession();
      clearImageCaches();
      await loadConfig();
      resizeCanvas();
      onFramesChanged({ type: "frames-reorganized" });
    }

    /**
     * Deletes the selected frames and atomically renumbers all remaining frame
     * data.
     * @returns {Promise<boolean>} Whether frames were deleted.
     */
    async function deleteSelectedAnimationFrames() {
      const group = getCurrentGroup();
      if (getFrameMutationPending() || !group?.profileId || !group?.animationId || !group.frames?.length) {
        return false;
      }
      const indexes = getSelectedFrameIndexes(group);
      if (!indexes.length) return false;
      if (indexes.length === group.frames.length) return clearCurrentAnimation();
      if (
        !(await confirm(translate("deleteFramesConfirm", { count: indexes.length }), {
          title: translate("deleteSelectedFrames"),
          confirmLabel: translate("deleteSelectedFrames"),
          tone: "danger",
        }))
      )
        return false;
      const removedIndexes = new Set(indexes);
      const items = group.frames
        .map((frame, sourceIndex) => ({ frame, sourceIndex }))
        .filter(({ sourceIndex }) => !removedIndexes.has(sourceIndex))
        .map(({ frame, sourceIndex }) => ({
          sourceIndex,
          sourcePath: frame.path,
          name: frame.name,
        }));
      setFrameMutationPending(true);
      try {
        if (browserOnly) await deleteBrowserSessionFrames(indexes);
        else await applyFrameOrganizerPlan(items);
        status(translate("framesDeleted", { count: indexes.length }));
        return true;
      } finally {
        setFrameMutationPending(false);
      }
    }

    /**
     * Deletes the current manifest animation and all Frame Tuner data owned by
     * it.
     * @returns {Promise<boolean>} Whether the animation was deleted.
     */
    async function clearCurrentAnimation() {
      const group = getCurrentGroup();
      if (getFrameMutationPending() || !group?.profileId || !group?.animationId || !group.frames?.length) {
        return false;
      }
      const animationLabel = group.name || group.animationId;
      if (
        !(await confirm(
          translate("clearAnimationConfirm", {
            animation: animationLabel,
            count: group.frames.length,
          }),
          {
            title: translate("clearAnimation"),
            confirmLabel: translate("clearAnimation"),
            tone: "danger",
          },
        ))
      )
        return false;
      setFrameMutationPending(true);
      try {
        if (browserOnly) {
          await deleteBrowserSessionAnimation(group);
          status(translate("animationCleared", { animation: animationLabel }));
          return true;
        }
        const response = await requireFetch()("/api/delete-animation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: getActiveProjectId(),
            profileId: group.profileId,
            animationId: group.animationId,
            baseRevision: getConfig()?.dataRevision || "",
          }),
        });
        await readMutationResponse(response);
        resetProjectSession();
        setDirty(false);
        await loadConfig();
        resizeCanvas();
        status(translate("animationCleared", { animation: animationLabel }));
        return true;
      } finally {
        setFrameMutationPending(false);
      }
    }

    /**
     * Creates a new manifest animation from a staged browser workset.
     * @param {object} metadata Project, profile, animation, type, and FPS metadata.
     * @param {Array<object>} items Ordered PNG workset.
     * @param {{premiumFeatures?:string[]}} [options] Premium output metadata.
     * @returns {Promise<object>} Imported animation response.
     */
    async function createAnimationFromOrganizer(metadata, items, options = {}) {
      let response;
      try {
        response = await requireFetch()("/api/import-animation", {
          method: "POST",
          headers: mutationHeaders(options.premiumFeatures),
          body: JSON.stringify({
            ...metadata,
            items,
          }),
        });
      } catch (error) {
        throw new Error(
          getLanguage() === "zh"
            ? "本地服务连接已断开。请重新启动 XSXB Frame Tuner 服务并刷新页面后重试。"
            : "The local XSXB Frame Tuner service is disconnected. Restart it, refresh the page, and try again.",
          { cause: error },
        );
      }
      const responseText = await response.text();
      let result = null;
      try {
        result = JSON.parse(responseText);
      } catch {
        result = null;
      }
      if (!response.ok || !result?.ok) {
        if (result?.code === "animation_exists") {
          throw new Error(
            getLanguage() === "zh"
              ? "动画名称已存在。请换一个动画名称，或先删除同名动画后再导入。"
              : "An animation with this name already exists. Choose another name or delete the existing animation first.",
          );
        }
        throw new Error(result?.error || responseText || `HTTP ${response.status}`);
      }
      setSelectedProjectId(result.activeProjectId);
      try {
        storage?.setItem("xsxbFrameTuner.project", result.activeProjectId);
      } catch (_error) {
        // In-memory state and the server response remain authoritative.
      }
      resetProjectSession();
      clearImageCaches();
      await loadConfig();
      const config = getConfig();
      const importedGroup = config?.groups?.find(
        (group) => group.profileId === result.profileId && group.animationId === result.animationId,
      );
      if (importedGroup && importedGroup.uiId !== getCurrentGroup()?.uiId) {
        await selectGroup(importedGroup, { fitView: true });
      }
      resizeCanvas();
      return result;
    }

    /**
     * Resolves the injected fetch implementation with a clear failure mode.
     * @returns {typeof fetch} Fetch implementation.
     */
    function requireFetch() {
      if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
      return fetchImpl;
    }

    /**
     * Builds mutation headers while making premium writes explicit to the server.
     * @param {Iterable<string>|string[]} featureIds Premium feature identifiers.
     * @returns {Record<string,string>} Request headers.
     */
    function mutationHeaders(featureIds) {
      const normalized = premiumFeatures?.normalizeFeatureIds?.(featureIds) || [];
      return {
        "content-type": "application/json",
        ...(normalized.length ? { "x-xsxb-premium-features": normalized.join(",") } : {}),
      };
    }

    return {
      applyCutoutOutputToCurrentFrame,
      applyCutoutOutputsToCurrentAnimation,
      applyFrameOrganizerPlan,
      deleteSelectedAnimationFrames,
      clearCurrentAnimation,
      createAnimationFromOrganizer,
    };
  }

  /**
   * Reads a project mutation response while preserving server error text.
   * @param {Response} response Fetch response.
   * @returns {Promise<object>} Parsed mutation payload.
   */
  async function defaultReadMutationResponse(response) {
    const responseText = await response.text();
    let result = null;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = null;
    }
    if (!response.ok) throw new Error(result?.error || responseText || `HTTP ${response.status}`);
    return result || {};
  }

  /**
   * Resolves localStorage without throwing in privacy-restricted contexts.
   * @param {typeof globalThis} scope Browser global object.
   * @returns {Storage|null} Available storage or null.
   */
  function resolveStorage(scope) {
    try {
      return scope?.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  return { createController };
});
