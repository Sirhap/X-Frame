(function attachXsxbWorkbenchExport(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBWorkbenchExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Confirms activation and obtains a short-lived server permit for final output.
   * @param {{ensureActivated:(featureIds:string[])=>Promise<boolean>,fetchImpl?:typeof fetch}} dependencies Authorization collaborators.
   * @param {string[]} featureIds Export capabilities represented by the output.
   * @returns {Promise<object|null>} Signed permit payload, or null when activation is cancelled.
   */
  async function authorizeExport(dependencies, featureIds) {
    if (typeof dependencies?.ensureActivated !== "function") {
      throw new TypeError("Export activation dependency is required.");
    }
    if (!(await dependencies.ensureActivated(featureIds))) return null;
    const fetchImpl = dependencies.fetchImpl || root?.fetch;
    if (typeof fetchImpl !== "function") throw new Error("Export authorization is unavailable.");
    const response = await fetchImpl("/api/export/authorize", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: featureIds }),
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      payload = {};
    }
    if (!response.ok || payload.authorized !== true || !payload.permit) {
      throw new Error(payload.error || "Export authorization failed.");
    }
    return payload;
  }

  /**
   * Creates the browser workbench export boundary.
   * @param {{browserRuntime:object,premiumFeatures:object,ensureActivated:(featureIds:string[])=>Promise<boolean>,getCurrentGroup:()=>object|null,getTuningSnapshot:(group:object)=>object,getAttachmentAssets:()=>object[],fetchImpl?:typeof fetch,status:(message:string)=>void,translate:(key:string,variables?:object)=>string}} dependencies Export collaborators.
   * @returns {{exportCurrentAnimation:()=>Promise<object|null>}} Workbench export operations.
   */
  function createController(dependencies = {}) {
    const {
      browserRuntime,
      premiumFeatures,
      ensureActivated,
      getCurrentGroup,
      getTuningSnapshot,
      getAttachmentAssets,
      fetchImpl = root?.fetch,
      status,
      translate,
    } = dependencies;
    if (
      typeof browserRuntime?.exportWorkbenchPackage !== "function" ||
      typeof premiumFeatures?.detectExportFeatures !== "function" ||
      typeof premiumFeatures?.normalizeFeatureIds !== "function" ||
      typeof ensureActivated !== "function" ||
      typeof getCurrentGroup !== "function" ||
      typeof getTuningSnapshot !== "function" ||
      typeof getAttachmentAssets !== "function" ||
      typeof status !== "function" ||
      typeof translate !== "function"
    ) {
      throw new TypeError("Workbench export dependencies are required.");
    }

    /** @returns {Promise<object|null>} Export result or null when activation is cancelled. */
    async function exportCurrentAnimation() {
      const group = getCurrentGroup();
      if (!group?.frames?.length) throw new Error(translate("exportNoAnimation"));
      const tuning = getTuningSnapshot(group);
      const featureIds = premiumFeatures.normalizeFeatureIds([
        "organizer.output",
        ...premiumFeatures.detectExportFeatures({
          sourceFeatures: group.premiumFeatures,
          tuner: tuning,
        }),
      ]);
      const authorization = await authorizeExport({ ensureActivated, fetchImpl }, featureIds);
      if (!authorization) return null;
      const groupKey = `${group.profileId || "profile"}/${group.animationId || group.name}`;
      const attachmentAssets = getAttachmentAssets().filter((asset) => asset.groupKey === groupKey);
      status(translate("exportPreparing"));
      const result = await browserRuntime.exportWorkbenchPackage(
        {
          animationId: group.animationId,
          animationName: group.name || group.animationId,
          profileLabel: group.profileLabel,
          animationType: group.type,
          fps: group.speed,
          anchorMode: group.anchorMode,
        },
        group.frames.map((frame) => ({ name: frame.name, data: frame.path })),
        { tuning, premiumFeatures: featureIds, attachmentAssets },
        { authorization, fetchImpl },
      );
      status(translate("exportComplete", { count: result.frameCount }));
      return result;
    }

    return Object.freeze({ exportCurrentAnimation });
  }

  return Object.freeze({ authorizeExport, createController });
});
