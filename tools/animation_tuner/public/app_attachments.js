(function initializeAttachmentModule(globalScope, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  globalScope.XFrameAppAttachments = api;
})(globalThis, function createAttachmentModule() {
  "use strict";

  /**
   * Creates the attachment asset and frame-instance controller.
   * @param {object} dependencies Explicit application dependencies.
   * @param {(assets:object[],context:{projectId:string,baseRevision:string})=>Promise<object|void>} [dependencies.persistAssetLibrary] Optional browser-session persistence adapter.
   * @returns {object} Attachment operations used by the application.
   */
  function createController(dependencies) {
    if (!dependencies?.fetchImpl || !dependencies?.fileReaderConstructor || !dependencies?.imageConstructor) {
      throw new TypeError("Attachment dependencies are required.");
    }
    const {
      fetchImpl,
      fileReaderConstructor,
      imageConstructor,
      getActiveProjectId,
      getConfig,
      getCurrentGroup,
      getLanguage,
      getAttachmentAssets,
      setAttachmentAssets,
      getFrameImageAttachments,
      setFrameImageAttachments,
      getSelectedAttachmentId,
      selectedFrameIndexes,
      getSelectedFrame,
      newLocalId,
      normalizeFrameImageAttachment,
      attachmentLayerOrder,
      frameImageAttachmentKey,
      frameImageAttachmentMetadata,
      nextAboveAttachmentLayerOrder,
      clampFrameIndex,
      pushUndo,
      clearSelectedAttachment,
      loadImageCached,
      selectFrameImageAttachment,
      markDirty,
      renderFilmstrip,
      syncFrameInputs,
      draw,
      status,
      translate,
      buildOneToOneSequencePlan,
      requestConfirmation = async () => true,
      persistAssetLibrary,
    } = dependencies;

    let assetRemovalSnapshot = null;
    let assetLibraryMutationGeneration = 0;

    if (typeof buildOneToOneSequencePlan !== "function") {
      throw new TypeError("Attachment sequence planner is required.");
    }

    /**
     * Reads a browser file as a data URL.
     * @param {File|Blob} file Source file.
     * @returns {Promise<string>} Encoded file contents.
     */
    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new fileReaderConstructor();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("File read failed"));
        reader.readAsDataURL(file);
      });
    }

    /**
     * Measures image dimensions without rejecting malformed image data.
     * @param {string} dataUrl Encoded image.
     * @returns {Promise<{width:number,height:number}>} Natural image dimensions or zeroes.
     */
    function imageSizeFromDataUrl(dataUrl) {
      return new Promise((resolve) => {
        const image = new imageConstructor();
        image.onload = () =>
          resolve({
            width: image.naturalWidth || image.width || 0,
            height: image.naturalHeight || image.height || 0,
          });
        image.onerror = () => resolve({ width: 0, height: 0 });
        image.src = dataUrl;
      });
    }

    /**
     * Uploads a file into the current project's reusable attachment directory.
     * @param {File} file Image file.
     * @param {string} id Stable attachment identifier.
     * @returns {Promise<object>} Stored image descriptor.
     */
    async function uploadFrameAttachmentImage(file, id) {
      const data = await readFileAsDataUrl(file);
      return uploadFrameAttachmentData(data, {
        id,
        name: file.name || "image",
        type: file.type || "",
      });
    }

    /**
     * Uploads image data into the current project's reusable attachment directory.
     * @param {string} data Image data URL.
     * @param {{id:string,name:string,type?:string}} source Asset metadata.
     * @returns {Promise<object>} Stored image descriptor.
     */
    async function uploadFrameAttachmentData(data, source) {
      const size = await imageSizeFromDataUrl(data);
      const response = await fetchImpl("/api/frame-attachment-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: getActiveProjectId(),
          id: source.id,
          name: source.name || "image",
          type: source.type || "",
          width: size.width,
          height: size.height,
          data,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      return result.image;
    }

    /**
     * Returns a stable asset-library key for one animation group.
     * @param {object|null} [group=getCurrentGroup()] Animation group.
     * @returns {string} Group asset key.
     */
    function attachmentAssetGroupKey(group = getCurrentGroup()) {
      return group
        ? `${group.profileId || group.tuningTarget || "profile"}/${group.animationId || group.name}`
        : "";
    }

    /**
     * Captures the project identity and optimistic-concurrency token for one asset-library write.
     * @param {string} [groupKey=attachmentAssetGroupKey()] Animation asset-library key.
     * @returns {{projectId:string,groupKey:string,baseRevision:string,config:object|null}} Immutable write context.
     */
    function captureAttachmentAssetLibraryContext(groupKey = attachmentAssetGroupKey()) {
      const config = getConfig();
      return {
        projectId: String(getActiveProjectId() || ""),
        groupKey: String(groupKey || ""),
        baseRevision: String(config?.dataRevision || ""),
        config: config || null,
      };
    }

    /**
     * Reports whether an optimistic library replacement still owns the visible project state.
     * @param {{projectId:string}} context Captured write context.
     * @param {object[]} optimisticAssets Array installed before persistence began.
     * @param {number} generation Controller mutation generation.
     * @returns {boolean} Whether rollback or success UI may safely touch the current state.
     */
    function ownsVisibleAttachmentAssetLibrary(context, optimisticAssets, generation) {
      return (
        String(getActiveProjectId() || "") === context.projectId &&
        assetLibraryMutationGeneration === generation &&
        getAttachmentAssets() === optimisticAssets
      );
    }

    /**
     * Persists the current project asset library immediately.
     * @param {{assets?:object[],projectId?:string,baseRevision?:string,config?:object|null}} [options] Frozen write payload.
     * @returns {Promise<void>}
     */
    async function persistAttachmentAssets(options = {}) {
      const config = options.config === undefined ? getConfig() : options.config;
      const assets = options.assets || getAttachmentAssets();
      const projectId =
        options.projectId === undefined
          ? String(getActiveProjectId() || "")
          : String(options.projectId || "");
      const baseRevision =
        options.baseRevision === undefined
          ? String(config?.dataRevision || "")
          : String(options.baseRevision || "");
      if (typeof persistAssetLibrary === "function") {
        const result = await persistAssetLibrary(assets, { projectId, baseRevision });
        if (result?.dataRevision && config) config.dataRevision = result.dataRevision;
        return;
      }
      const response = await fetchImpl("/api/attachment-assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, baseRevision, assets }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      if (result.dataRevision && config) config.dataRevision = result.dataRevision;
    }

    /**
     * Returns whether the current project and animation group can restore the latest asset-library removal.
     * @param {string} [groupKey=attachmentAssetGroupKey()] Current animation asset-library key.
     * @returns {boolean} Whether an in-scope removal snapshot exists.
     */
    function canUndoAttachmentAssetRemoval(groupKey = attachmentAssetGroupKey()) {
      return Boolean(
        assetRemovalSnapshot?.entries?.length &&
          assetRemovalSnapshot.projectId === String(getActiveProjectId() || "") &&
          assetRemovalSnapshot.groupKey === String(groupKey || ""),
      );
    }

    /**
     * Replaces the asset-library list and rolls browser state back when persistence fails.
     * Physical content-addressed image files and placed frame instances are intentionally untouched.
     * @param {object[]} nextAssets Next reusable asset list.
     * @param {object[]} previousAssets Rollback asset list.
     * @param {{projectId:string,groupKey:string,baseRevision:string,config:object|null}} context Frozen write context.
     * @returns {Promise<boolean>} Whether the optimistic replacement still owns the visible project state.
     */
    async function commitAttachmentAssetLibrary(nextAssets, previousAssets, context) {
      const generation = ++assetLibraryMutationGeneration;
      setAttachmentAssets(nextAssets);
      const optimisticAssets = getAttachmentAssets();
      try {
        await persistAttachmentAssets({
          assets: optimisticAssets,
          projectId: context.projectId,
          baseRevision: context.baseRevision,
          config: context.config,
        });
      } catch (error) {
        if (ownsVisibleAttachmentAssetLibrary(context, optimisticAssets, generation)) {
          assetLibraryMutationGeneration += 1;
          setAttachmentAssets(previousAssets);
          renderFilmstrip();
        }
        throw error;
      }
      return ownsVisibleAttachmentAssetLibrary(context, optimisticAssets, generation);
    }

    /**
     * Removes reusable asset references from one animation group without changing placed frame attachments.
     * @param {Iterable<string>} assetIds Stable reusable asset identifiers.
     * @param {string} [groupKey=attachmentAssetGroupKey()] Animation asset-library key.
     * @returns {Promise<number>} Number of removed reusable asset references.
     */
    async function removeAttachmentAssets(assetIds, groupKey = attachmentAssetGroupKey()) {
      const normalizedGroupKey = String(groupKey || "");
      const context = captureAttachmentAssetLibraryContext(normalizedGroupKey);
      const sourceIds = typeof assetIds === "string" ? [assetIds] : assetIds || [];
      const ids = new Set(Array.from(sourceIds, (id) => String(id || "")).filter(Boolean));
      if (!normalizedGroupKey || !ids.size) return 0;

      const previousAssets = getAttachmentAssets().slice();
      const entries = [];
      const nextAssets = previousAssets.filter((asset, index) => {
        const remove =
          String(asset?.groupKey || "") === normalizedGroupKey && ids.has(String(asset?.id || ""));
        if (remove) entries.push({ asset, index });
        return !remove;
      });
      if (!entries.length) return 0;

      const ownsVisibleState = await commitAttachmentAssetLibrary(nextAssets, previousAssets, context);
      if (
        assetRemovalSnapshot?.projectId === context.projectId &&
        assetRemovalSnapshot?.groupKey === context.groupKey
      ) {
        assetRemovalSnapshot = null;
      }
      if (ownsVisibleState) {
        assetRemovalSnapshot = {
          projectId: context.projectId,
          groupKey: normalizedGroupKey,
          entries,
        };
        renderFilmstrip();
        status(translate("assetRemovedFromLibrary", { count: entries.length }));
      }
      return entries.length;
    }

    /**
     * Restores the latest in-scope asset-library removal while preserving assets added afterward.
     * @param {string} [groupKey=attachmentAssetGroupKey()] Animation asset-library key.
     * @returns {Promise<number>} Number of restored reusable asset references.
     */
    async function undoAttachmentAssetRemoval(groupKey = attachmentAssetGroupKey()) {
      if (!canUndoAttachmentAssetRemoval(groupKey)) return 0;
      const snapshot = assetRemovalSnapshot;
      const context = captureAttachmentAssetLibraryContext(snapshot.groupKey);
      const previousAssets = getAttachmentAssets().slice();
      const nextAssets = previousAssets.slice();
      const existingKeys = new Set(
        nextAssets.map((asset) => `${String(asset?.groupKey || "")}\u0000${String(asset?.id || "")}`),
      );
      let restored = 0;
      for (const entry of snapshot.entries.slice().sort((left, right) => left.index - right.index)) {
        const assetKey = `${String(entry.asset?.groupKey || "")}\u0000${String(entry.asset?.id || "")}`;
        if (existingKeys.has(assetKey)) continue;
        nextAssets.splice(Math.min(Math.max(0, entry.index), nextAssets.length), 0, entry.asset);
        existingKeys.add(assetKey);
        restored += 1;
      }
      if (!restored) {
        assetRemovalSnapshot = null;
        renderFilmstrip();
        return 0;
      }

      const ownsVisibleState = await commitAttachmentAssetLibrary(nextAssets, previousAssets, context);
      if (assetRemovalSnapshot === snapshot) assetRemovalSnapshot = null;
      if (ownsVisibleState) {
        renderFilmstrip();
        status(translate("assetRestoredToLibrary", { count: restored }));
      }
      return restored;
    }

    /**
     * Creates independent attachment instances of one asset on target frames.
     * @param {object} asset Reusable image asset.
     * @param {number[]} [frameIndexes=selectedFrameIndexes()] Target frame indexes.
     * @param {object|null} [group=getCurrentGroup()] Target animation group.
     * @returns {number} Number of created instances.
     */
    function applyAttachmentAsset(asset, frameIndexes = selectedFrameIndexes(), group = getCurrentGroup()) {
      if (!asset?.path || !group || !frameIndexes.length) return 0;
      pushUndo("apply attachment asset");
      const attachments = getFrameImageAttachments();
      for (const frameIndex of frameIndexes) {
        attachments.push(
          normalizeFrameImageAttachment({
            ...asset,
            id: newLocalId("layer"),
            assetId: asset.id,
            key: frameImageAttachmentKey(frameIndex, group),
            metadata: frameImageAttachmentMetadata(frameIndex, group),
            layer: "above",
            layerOrder: nextAboveAttachmentLayerOrder(frameIndex, group),
            transform: { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 },
          }),
        );
      }
      clearSelectedAttachment();
      loadImageCached(asset).catch(() => null);
      markDirty();
      renderFilmstrip();
      draw();
      status(translate("assetApplied", { count: frameIndexes.length }));
      return frameIndexes.length;
    }

    /**
     * Applies naturally sorted assets to selected frames as one undoable sequence.
     * @param {object[]} assets Selected reusable image assets.
     * @param {number[]} [frameIndexes=selectedFrameIndexes()] Target owner frames.
     * @param {object|null} [group=getCurrentGroup()] Target animation group.
     * @returns {Promise<number>} Number of created attachment instances.
     */
    async function applyAttachmentAssetSequence(
      assets,
      frameIndexes = selectedFrameIndexes(),
      group = getCurrentGroup(),
    ) {
      const plan = buildOneToOneSequencePlan({ assets, frameIndexes, ownerFrames: group?.frames });
      if (!plan.ok) {
        const messageKey =
          plan.code === "no_assets"
            ? "assetSequenceNoAssets"
            : plan.code === "no_frames"
              ? "assetSequenceNoFrames"
              : "assetSequenceCountMismatch";
        status(
          translate(messageKey, {
            assetCount: plan.assetCount,
            frameCount: plan.frameCount,
          }),
        );
        return 0;
      }

      const existingAttachments = getFrameImageAttachments();
      const targetKeys = new Set(
        plan.entries.map((entry) => frameImageAttachmentKey(entry.frameIndex, group)),
      );
      const existingCount = existingAttachments.filter((attachment) =>
        targetKeys.has(String(attachment.key || attachment.frameKey || "")),
      ).length;
      const canvasMessageKey =
        plan.canvas.mode === "shared"
          ? "assetSequenceCanvasShared"
          : plan.canvas.mode === "review"
            ? "assetSequenceCanvasReview"
            : "assetSequenceCanvasUnknown";
      const firstEntry = plan.entries[0];
      const lastEntry = plan.entries.at(-1);
      const confirmed = await requestConfirmation(
        translate("assetSequenceConfirmMessage", { count: plan.entries.length }),
        [
          [translate("assetSequenceFrameRange"), `${firstEntry.frameIndex + 1}–${lastEntry.frameIndex + 1}`],
          [translate("assetSequenceAssetCount"), plan.assetCount],
          [translate("assetSequenceAlignment"), translate(canvasMessageKey)],
          [translate("assetSequenceMapping"), `${firstEntry.asset.name} → ${lastEntry.asset.name}`],
          [translate("assetSequenceExisting"), existingCount],
        ],
        {
          title: translate("assetSequenceConfirmTitle"),
          confirmLabel: translate("assetSequenceConfirmApply"),
          cancelLabel: translate("cancel"),
          tone: "warning",
        },
      );
      if (!confirmed) return 0;

      pushUndo("apply attachment sequence");
      for (const entry of plan.entries) {
        existingAttachments.push(
          normalizeFrameImageAttachment({
            ...entry.asset,
            id: newLocalId("layer"),
            assetId: entry.asset.id,
            key: frameImageAttachmentKey(entry.frameIndex, group),
            metadata: frameImageAttachmentMetadata(entry.frameIndex, group),
            layer: "above",
            layerOrder: nextAboveAttachmentLayerOrder(entry.frameIndex, group),
            transform: entry.transform,
          }),
        );
        loadImageCached(entry.asset).catch(() => null);
      }
      clearSelectedAttachment();
      markDirty();
      renderFilmstrip();
      draw();
      status(translate("assetSequenceApplied", { count: plan.entries.length }));
      return plan.entries.length;
    }

    /**
     * Uploads processed images and adds them to the active group's asset library.
     * @param {Array<{name?:string,data?:string,image?:HTMLCanvasElement,type?:string}>} items Image sources.
     * @returns {Promise<number>} Added asset count.
     */
    async function addImagesToCurrentGroupAssets(items) {
      const currentGroup = getCurrentGroup();
      if (!currentGroup) {
        throw new Error(getLanguage() === "zh" ? "请先选择当前动画。" : "Select an animation first.");
      }
      const groupKey = attachmentAssetGroupKey(currentGroup);
      const added = [];
      try {
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          const data = item.data || item.image?.toDataURL?.("image/png") || "";
          if (!data) continue;
          const id = newLocalId("asset");
          const image = await uploadFrameAttachmentData(data, {
            id,
            name: item.name || `asset_${String(index + 1).padStart(4, "0")}.png`,
            type: item.type || "image/png",
          });
          added.push({ id, ...image, groupKey });
        }
        getAttachmentAssets().push(...added);
        await persistAttachmentAssets();
        renderFilmstrip();
        status(translate("assetAdded", { count: added.length }));
        return added.length;
      } catch (error) {
        setAttachmentAssets(
          getAttachmentAssets().filter((asset) => !added.some((addedAsset) => addedAsset.id === asset.id)),
        );
        throw error;
      }
    }

    /**
     * Uploads and binds an image file to one animation frame.
     * @param {File|null} file Image file.
     * @param {number} [index=getSelectedFrame()] Frame index.
     * @param {object|null} [group=getCurrentGroup()] Animation group.
     * @returns {Promise<boolean>} Whether an attachment was added.
     */
    async function bindFrameImageAttachmentFile(file, index = getSelectedFrame(), group = getCurrentGroup()) {
      if (!file || !group) return false;
      const frameIndex = clampFrameIndex(index, group);
      const id = newLocalId("layer");
      try {
        const image = await uploadFrameAttachmentImage(file, id);
        pushUndo("add attached image");
        const attachment = normalizeFrameImageAttachment({
          id,
          key: frameImageAttachmentKey(frameIndex, group),
          metadata: frameImageAttachmentMetadata(frameIndex, group),
          name: image.name || file.name || "image",
          path: image.path,
          assetHash: image.assetHash,
          type: image.type || file.type || "",
          width: image.width,
          height: image.height,
          layer: "above",
          layerOrder: nextAboveAttachmentLayerOrder(frameIndex, group),
          transform: { scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 },
        });
        getFrameImageAttachments().push(attachment);
        await loadImageCached(attachment).catch(() => null);
        selectFrameImageAttachment(attachment, frameIndex, group);
        markDirty();
        status(translate("frameAttachmentAdded", { name: attachment.name }));
        return true;
      } catch (error) {
        status(
          translate("frameAttachmentUploadFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        return false;
      }
    }

    /**
     * Removes one frame attachment instance.
     * @param {string} attachmentId Attachment identifier.
     * @returns {void}
     */
    function removeFrameImageAttachment(attachmentId) {
      const attachments = getFrameImageAttachments();
      if (!attachments.some((entry) => entry.id === attachmentId)) return;
      pushUndo("remove attached image");
      setFrameImageAttachments(attachments.filter((entry) => entry.id !== attachmentId));
      if (getSelectedAttachmentId() === attachmentId) clearSelectedAttachment();
      markDirty();
      syncFrameInputs();
      renderFilmstrip();
      draw();
      status(translate("frameAttachmentRemoved"));
    }

    /**
     * Normalizes frame attachments and their stable per-frame layer order for saving.
     * @returns {object[]} Serializable attachment descriptors.
     */
    function collectFrameImageAttachmentsForSave() {
      const normalized = getFrameImageAttachments().map((attachment) =>
        normalizeFrameImageAttachment(attachment),
      );
      const byFrame = new Map();
      normalized.forEach((attachment, index) => {
        const key = attachment.key || attachment.frameKey || `__missing_${index}`;
        if (!byFrame.has(key)) byFrame.set(key, []);
        byFrame.get(key).push({ attachment, index });
      });
      byFrame.forEach((entries) => {
        const above = entries
          .filter((entry) => attachmentLayerOrder(entry.attachment) > 0)
          .sort(
            (left, right) =>
              attachmentLayerOrder(right.attachment) - attachmentLayerOrder(left.attachment) ||
              left.index - right.index,
          );
        above.forEach((entry, orderIndex) => {
          entry.attachment.layerOrder = above.length - orderIndex;
          entry.attachment.layer = "above";
        });
        const below = entries
          .filter((entry) => attachmentLayerOrder(entry.attachment) < 0)
          .sort(
            (left, right) =>
              attachmentLayerOrder(right.attachment) - attachmentLayerOrder(left.attachment) ||
              left.index - right.index,
          );
        below.forEach((entry, orderIndex) => {
          entry.attachment.layerOrder = -(orderIndex + 1);
          entry.attachment.layer = "below";
        });
      });
      return normalized;
    }

    return {
      addImagesToCurrentGroupAssets,
      applyAttachmentAsset,
      applyAttachmentAssetSequence,
      attachmentAssetGroupKey,
      bindFrameImageAttachmentFile,
      canUndoAttachmentAssetRemoval,
      collectFrameImageAttachmentsForSave,
      imageSizeFromDataUrl,
      persistAttachmentAssets,
      readFileAsDataUrl,
      removeAttachmentAssets,
      removeFrameImageAttachment,
      undoAttachmentAssetRemoval,
      uploadFrameAttachmentData,
      uploadFrameAttachmentImage,
    };
  }

  return Object.freeze({ createController });
});
