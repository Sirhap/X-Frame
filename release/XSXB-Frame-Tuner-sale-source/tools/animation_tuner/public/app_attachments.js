(function initializeAttachmentModule(globalScope, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  globalScope.XSXBAppAttachments = api;
})(globalThis, function createAttachmentModule() {
  "use strict";

  /**
   * Creates the attachment asset and frame-instance controller.
   * @param {object} dependencies Explicit application dependencies.
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
    } = dependencies;

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
     * Persists the current project asset library immediately.
     * @returns {Promise<void>}
     */
    async function persistAttachmentAssets() {
      const response = await fetchImpl("/api/attachment-assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: getActiveProjectId(), assets: getAttachmentAssets() }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      const config = getConfig();
      if (result.dataRevision && config) config.dataRevision = result.dataRevision;
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
      attachmentAssetGroupKey,
      bindFrameImageAttachmentFile,
      collectFrameImageAttachmentsForSave,
      imageSizeFromDataUrl,
      persistAttachmentAssets,
      readFileAsDataUrl,
      removeFrameImageAttachment,
      uploadFrameAttachmentData,
      uploadFrameAttachmentImage,
    };
  }

  return Object.freeze({ createController });
});
