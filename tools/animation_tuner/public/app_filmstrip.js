(function attachFilmstripModule(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppFilmstrip = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the filmstrip rendering controller.
   *
   * The controller owns DOM construction for the attachment asset tray while
   * application state and mutations remain explicit injected dependencies.
   *
   * @param {object} dependencies Controller dependencies.
   * @param {HTMLElement} dependencies.filmstrip Filmstrip root element.
   * @param {string} dependencies.attachmentAssetDragType Custom drag MIME type.
   * @param {() => Array<object>} dependencies.getAttachmentAssets Returns all attachment assets.
   * @param {() => object|null} dependencies.getCurrentGroup Returns the active animation group.
   * @param {() => string} dependencies.getAttachmentAssetGroupKey Returns the active asset group key.
   * @param {(key:string, values?:object) => string} dependencies.translate Translates UI copy.
   * @param {(value:unknown) => string} dependencies.escapeHtml Escapes interpolated HTML.
   * @param {(asset:object) => string} dependencies.assetUrl Resolves an asset preview URL.
   * @param {() => number} dependencies.getSelectedFrameCount Returns selected frame count.
   * @param {(asset:object) => void} dependencies.applyAttachmentAsset Applies an asset to selected frames.
   * @param {(file:File) => Promise<string>} dependencies.readFileAsDataUrl Reads a file as a data URL.
   * @param {(images:Array<object>) => Promise<unknown>} dependencies.addImagesToCurrentGroupAssets Adds imported assets.
   * @param {(message:string) => void} dependencies.status Reports status messages.
   * @param {() => Promise<void>} dependencies.deleteSelectedAnimationFrames Deletes selected frames.
   * @param {() => Promise<void>} dependencies.clearCurrentAnimation Clears the active animation.
   * @param {Document} [dependencies.document] Document implementation.
   * @returns {{renderAttachmentAssetTray:() => void}} Filmstrip controller.
   */
  function createController(dependencies) {
    if (!dependencies?.filmstrip) throw new TypeError("Filmstrip dependencies are required.");
    const {
      filmstrip,
      attachmentAssetDragType,
      getAttachmentAssets,
      getCurrentGroup,
      getAttachmentAssetGroupKey,
      translate,
      escapeHtml,
      assetUrl,
      getSelectedFrameCount,
      applyAttachmentAsset,
      readFileAsDataUrl,
      addImagesToCurrentGroupAssets,
      status,
      deleteSelectedAnimationFrames,
      clearCurrentAnimation,
    } = dependencies;
    const documentApi = dependencies.document || root.document;

    /**
     * Creates a draggable attachment asset card.
     * @param {object} asset Attachment asset metadata.
     * @returns {HTMLElement} Rendered asset card.
     */
    function createAttachmentAssetCard(asset) {
      const card = documentApi.createElement("article");
      card.className = "attachmentAssetCard";
      card.draggable = true;
      card.title = `${asset.name}\n${translate("assetApplySelected")}`;
      card.innerHTML = `
        <img src="${assetUrl(asset)}" alt="" width="${Math.max(1, Number(asset.width || 1))}" height="${Math.max(1, Number(asset.height || 1))}" loading="lazy">
        <span>${escapeHtml(asset.name)}</span>
        <button type="button">${escapeHtml(translate("assetApplySelected"))}</button>
      `;
      card.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(attachmentAssetDragType, asset.id);
      });
      card.querySelector("button")?.addEventListener("click", () => {
        applyAttachmentAsset(asset);
      });
      return card;
    }

    /**
     * Imports selected image files into the active group's reusable asset list.
     * @param {HTMLInputElement} input File input whose selection should be imported.
     * @returns {Promise<void>}
     */
    async function importAttachmentAssets(input) {
      try {
        const files = Array.from(input.files || []);
        const images = await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type,
            data: await readFileAsDataUrl(file),
          })),
        );
        await addImagesToCurrentGroupAssets(images);
      } catch (error) {
        status(error instanceof Error ? error.message : String(error));
      }
    }

    /**
     * Renders reusable images for the current group before the frame stacks.
     * @returns {void}
     */
    function renderAttachmentAssetTray() {
      const currentGroup = getCurrentGroup();
      const groupAssets = getAttachmentAssets().filter(
        (asset) => asset.groupKey === getAttachmentAssetGroupKey(),
      );
      const tray = documentApi.createElement("section");
      tray.className = "attachmentAssetTray";
      tray.innerHTML = `
        <header><strong>${escapeHtml(translate("assetLibrary"))}</strong><button type="button" class="assetImportButton" aria-label="${escapeHtml(translate("assetImport"))}" title="${escapeHtml(translate("assetImport"))}">＋</button></header>
        <input class="assetImportInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
        <div class="attachmentAssetList"></div>
        ${groupAssets.length ? "" : `<small>${escapeHtml(translate("assetLibraryEmpty"))}</small>`}
        <div class="animationFrameActions">
          <button type="button" class="secondary deleteSelectedFrames">${escapeHtml(translate("deleteSelectedFrames"))} (${getSelectedFrameCount()})</button>
          <button type="button" class="secondary dangerAction clearAnimation">${escapeHtml(translate("clearAnimation"))}</button>
        </div>
      `;
      const list = tray.querySelector(".attachmentAssetList");
      groupAssets.forEach((asset) => list?.appendChild(createAttachmentAssetCard(asset)));

      const input = tray.querySelector(".assetImportInput");
      tray.querySelector(".assetImportButton")?.addEventListener("click", () => input?.click());
      input?.addEventListener("change", () => {
        void importAttachmentAssets(input);
      });

      const canDeleteFrames = Boolean(
        currentGroup?.profileId && currentGroup?.animationId && currentGroup.frames?.length,
      );
      const deleteFramesButton = tray.querySelector(".deleteSelectedFrames");
      const clearAnimationButton = tray.querySelector(".clearAnimation");
      deleteFramesButton.disabled = !canDeleteFrames;
      clearAnimationButton.disabled = !canDeleteFrames;
      deleteFramesButton.addEventListener("click", () => {
        deleteSelectedAnimationFrames().catch((error) =>
          status(translate("frameMutationFailed", { message: error.message })),
        );
      });
      clearAnimationButton.addEventListener("click", () => {
        clearCurrentAnimation().catch((error) =>
          status(translate("frameMutationFailed", { message: error.message })),
        );
      });
      filmstrip.appendChild(tray);
    }

    return { renderAttachmentAssetTray };
  }

  return Object.freeze({ createController });
});
