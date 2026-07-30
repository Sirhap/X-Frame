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
   * @param {HTMLElement} dependencies.attachmentAssetTrayHost Sidebar host for reusable assets.
   * @param {() => string} [dependencies.getActiveProjectId] Returns the active project identifier.
   * @param {HTMLButtonElement|null} dependencies.deleteSelectedFramesButton Frame deletion action.
   * @param {HTMLButtonElement|null} dependencies.clearAnimationButton Animation clear action.
   * @param {string} dependencies.attachmentAssetDragType Custom drag MIME type.
   * @param {() => Array<object>} dependencies.getAttachmentAssets Returns all attachment assets.
   * @param {() => object|null} dependencies.getCurrentGroup Returns the active animation group.
   * @param {() => string} dependencies.getAttachmentAssetGroupKey Returns the active asset group key.
   * @param {(key:string, values?:object) => string} dependencies.translate Translates UI copy.
   * @param {(value:unknown) => string} dependencies.escapeHtml Escapes interpolated HTML.
   * @param {(asset:object) => string} dependencies.assetUrl Resolves an asset preview URL.
   * @param {() => number} dependencies.getSelectedFrameCount Returns selected frame count.
   * @param {(asset:object) => void} dependencies.applyAttachmentAsset Applies an asset to selected frames.
   * @param {(assets:object[]) => Promise<number>} dependencies.applyAttachmentAssetSequence Applies a one-to-one asset sequence.
   * @param {(assetIds:Iterable<string>,groupKey?:string) => Promise<number>} dependencies.removeAttachmentAssets Removes reusable asset references.
   * @param {(groupKey?:string) => Promise<number>} dependencies.undoAttachmentAssetRemoval Restores the latest reusable asset removal.
   * @param {(groupKey?:string) => boolean} dependencies.canUndoAttachmentAssetRemoval Reports whether removal can be restored.
   * @param {(file:File) => Promise<string>} dependencies.readFileAsDataUrl Reads a file as a data URL.
   * @param {(images:Array<object>) => Promise<unknown>} dependencies.addImagesToCurrentGroupAssets Adds imported assets.
   * @param {(message:string) => void} dependencies.status Reports status messages.
   * @param {() => Promise<void>} dependencies.deleteSelectedAnimationFrames Deletes selected frames.
   * @param {() => Promise<void>} dependencies.clearCurrentAnimation Clears the active animation.
   * @param {Document} [dependencies.document] Document implementation.
   * @returns {{renderAttachmentAssetTray:() => void,syncFrameActions:() => void}} Filmstrip controller.
   */
  function createController(dependencies) {
    if (!dependencies?.filmstrip || !dependencies?.attachmentAssetTrayHost) {
      throw new TypeError("Filmstrip dependencies are required.");
    }
    const {
      attachmentAssetTrayHost,
      getActiveProjectId = () => "",
      deleteSelectedFramesButton,
      clearAnimationButton,
      attachmentAssetDragType,
      getAttachmentAssets,
      getCurrentGroup,
      getAttachmentAssetGroupKey,
      translate,
      escapeHtml,
      assetUrl,
      getSelectedFrameCount,
      applyAttachmentAsset,
      applyAttachmentAssetSequence,
      removeAttachmentAssets = async () => 0,
      undoAttachmentAssetRemoval = async () => 0,
      canUndoAttachmentAssetRemoval = () => false,
      readFileAsDataUrl,
      addImagesToCurrentGroupAssets,
      status,
      deleteSelectedAnimationFrames,
      clearCurrentAnimation,
    } = dependencies;
    const documentApi = dependencies.document || root.document;
    const sequenceSelectionByGroup = new Map();

    /** Returns the project and animation identity used to guard asynchronous focus recovery. */
    function assetLibraryContextKey() {
      return `${String(getActiveProjectId() || "")}\u0000${String(getAttachmentAssetGroupKey() || "")}`;
    }

    /**
     * Restores keyboard focus to one asset sequence checkbox after the tray is rebuilt.
     * @param {string} assetId Reusable asset identifier.
     * @returns {void}
     */
    function focusAttachmentAssetSequenceChoice(assetId) {
      const choices = attachmentAssetTrayHost.querySelectorAll?.(".attachmentAssetSequenceChoice");
      const target = Array.from(choices || []).find(
        (choice) => String(choice.dataset?.assetId || "") === String(assetId || ""),
      );
      target?.focus();
    }

    /** Returns persistent per-group sequence selection and removes unavailable assets. */
    function sequenceSelection(groupKey, assets) {
      const selectedIds = sequenceSelectionByGroup.get(groupKey) || new Set();
      const availableIds = new Set(assets.map((asset) => String(asset.id || "")));
      for (const assetId of selectedIds) {
        if (!availableIds.has(assetId)) selectedIds.delete(assetId);
      }
      sequenceSelectionByGroup.set(groupKey, selectedIds);
      return selectedIds;
    }

    /**
     * Runs one persisted asset-library mutation with visible error recovery and deterministic focus.
     * @param {()=>Promise<number>} operation Asset-library operation.
     * @param {string} errorKey Translation key used when persistence fails.
     * @param {string} focusSelector Control to focus after a successful rerender.
     * @param {string} [failureFocusSelector=".assetImportButton"] Control to focus after a failed rerender.
     * @returns {Promise<number>} Number of affected reusable assets.
     */
    async function runAssetLibraryAction(
      operation,
      errorKey,
      focusSelector,
      failureFocusSelector = ".assetImportButton",
    ) {
      const contextKey = assetLibraryContextKey();
      try {
        const count = await operation();
        if (!count) return 0;
        if (assetLibraryContextKey() !== contextKey) return count;
        renderAttachmentAssetTray();
        attachmentAssetTrayHost.querySelector(focusSelector)?.focus();
        return count;
      } catch (error) {
        status(
          translate(errorKey, {
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        if (assetLibraryContextKey() !== contextKey) return 0;
        renderAttachmentAssetTray();
        attachmentAssetTrayHost.querySelector(failureFocusSelector)?.focus();
        return 0;
      }
    }

    /**
     * Synchronizes low-frequency frame actions with the active animation.
     * @returns {void}
     */
    function syncFrameActions() {
      const currentGroup = getCurrentGroup();
      const canMutateFrames = Boolean(
        currentGroup?.profileId && currentGroup?.animationId && currentGroup.frames?.length,
      );
      if (deleteSelectedFramesButton) {
        const selectedCount = getSelectedFrameCount();
        deleteSelectedFramesButton.disabled = !canMutateFrames;
        deleteSelectedFramesButton.setAttribute(
          "aria-label",
          `${translate("deleteSelectedFrames")} (${selectedCount})`,
        );
      }
      if (clearAnimationButton) clearAnimationButton.disabled = !canMutateFrames;
    }

    deleteSelectedFramesButton?.addEventListener("click", () => {
      deleteSelectedAnimationFrames().catch((error) =>
        status(translate("frameMutationFailed", { message: error.message })),
      );
    });
    clearAnimationButton?.addEventListener("click", () => {
      clearCurrentAnimation().catch((error) =>
        status(translate("frameMutationFailed", { message: error.message })),
      );
    });

    /**
     * Creates a draggable attachment asset card.
     * @param {object} asset Attachment asset metadata.
     * @param {Set<string>} selectedIds Current reusable-asset selection.
     * @param {string} groupKey Current animation asset-library key.
     * @returns {HTMLElement} Rendered asset card.
     */
    function createAttachmentAssetCard(asset, selectedIds, groupKey) {
      const card = documentApi.createElement("article");
      card.className = "attachmentAssetCard";
      card.draggable = true;
      card.title = `${asset.name}\n${translate("assetApplySelected")}`;
      card.dataset.sequenceSelected = selectedIds.has(String(asset.id || "")) ? "true" : "false";
      card.innerHTML = `
        <label class="attachmentAssetSequenceToggle" title="${escapeHtml(translate("assetSequenceSelect", { name: asset.name }))}">
          <input class="attachmentAssetSequenceChoice" data-asset-id="${escapeHtml(String(asset.id || ""))}" type="checkbox" ${card.dataset.sequenceSelected === "true" ? "checked" : ""} aria-label="${escapeHtml(translate("assetSequenceSelect", { name: asset.name }))}">
        </label>
        <img src="${assetUrl(asset)}" alt="" width="${Math.max(1, Number(asset.width || 1))}" height="${Math.max(1, Number(asset.height || 1))}" loading="lazy">
        <span>${escapeHtml(asset.name)}</span>
        <div class="attachmentAssetCardActions">
          <button type="button" class="attachmentAssetApply">${escapeHtml(translate("assetApplySelected"))}</button>
          <button type="button" class="attachmentAssetRemove" aria-label="${escapeHtml(translate("assetRemoveNamed", { name: asset.name }))}" title="${escapeHtml(translate("assetRemoveNamed", { name: asset.name }))}">${escapeHtml(translate("assetRemove"))}</button>
        </div>
      `;
      card.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(attachmentAssetDragType, asset.id);
      });
      card.querySelector(".attachmentAssetApply")?.addEventListener("click", () => {
        applyAttachmentAsset(asset);
      });
      card.querySelector(".attachmentAssetRemove")?.addEventListener("click", (event) => {
        event.stopPropagation();
        void runAssetLibraryAction(
          () => removeAttachmentAssets([asset.id], groupKey),
          "assetRemoveFailed",
          ".attachmentAssetUndo",
        );
      });
      card.querySelector(".attachmentAssetSequenceChoice")?.addEventListener("change", (event) => {
        const assetId = String(asset.id || "");
        if (event.currentTarget.checked) selectedIds.add(assetId);
        else selectedIds.delete(assetId);
        renderAttachmentAssetTray();
        focusAttachmentAssetSequenceChoice(assetId);
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
     * Renders reusable images in the sidebar, separate from the frame timeline.
     * @returns {void}
     */
    function renderAttachmentAssetTray() {
      attachmentAssetTrayHost.innerHTML = "";
      const currentGroup = getCurrentGroup();
      if (!currentGroup) return;
      const groupAssets = getAttachmentAssets().filter(
        (asset) => asset.groupKey === getAttachmentAssetGroupKey(),
      );
      const groupKey = getAttachmentAssetGroupKey();
      const selectedIds = sequenceSelection(groupKey, groupAssets);
      const selectedAssets = groupAssets.filter((asset) => selectedIds.has(String(asset.id || "")));
      const selectedFrameCount = getSelectedFrameCount();
      const canUndoRemoval = canUndoAttachmentAssetRemoval(groupKey);
      const tray = documentApi.createElement("section");
      tray.className = "attachmentAssetTray";
      tray.innerHTML = `
        <header>
          <strong>${escapeHtml(translate("assetLibrary"))}</strong>
          <div class="attachmentAssetHeaderActions">
            ${canUndoRemoval ? `<button type="button" class="attachmentAssetUndo secondary">${escapeHtml(translate("assetUndoRemove"))}</button>` : ""}
            <button type="button" class="assetImportButton" aria-label="${escapeHtml(translate("assetImport"))}" title="${escapeHtml(translate("assetImport"))}">＋</button>
          </div>
        </header>
        <input class="assetImportInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
        ${
          groupAssets.length
            ? `<div class="attachmentSequenceToolbar">
                <span>${escapeHtml(translate("assetSequenceSelection", { assetCount: selectedAssets.length, frameCount: selectedFrameCount }))}</span>
                <button type="button" class="assetSequenceSelectAll secondary">${escapeHtml(translate(selectedAssets.length === groupAssets.length ? "assetSequenceClear" : "assetSequenceSelectAll"))}</button>
                <button type="button" class="assetSequenceApply">${escapeHtml(translate("assetSequenceApply"))}</button>
                <button type="button" class="assetSequenceRemove" ${selectedAssets.length ? "" : "disabled"}>${escapeHtml(translate("assetRemoveSelected"))}</button>
              </div>`
            : ""
        }
        <div class="attachmentAssetList"></div>
        ${groupAssets.length ? "" : `<small>${escapeHtml(translate("assetLibraryEmpty"))}</small>`}
      `;
      const list = tray.querySelector(".attachmentAssetList");
      groupAssets.forEach((asset) =>
        list?.appendChild(createAttachmentAssetCard(asset, selectedIds, groupKey)),
      );

      const input = tray.querySelector(".assetImportInput");
      tray.querySelector(".assetImportButton")?.addEventListener("click", () => input?.click());
      tray.querySelector(".attachmentAssetUndo")?.addEventListener("click", () => {
        void runAssetLibraryAction(
          () => undoAttachmentAssetRemoval(groupKey),
          "assetRestoreFailed",
          ".assetImportButton",
          ".attachmentAssetUndo",
        );
      });
      tray.querySelector(".assetSequenceSelectAll")?.addEventListener("click", () => {
        if (selectedIds.size === groupAssets.length) selectedIds.clear();
        else groupAssets.forEach((asset) => selectedIds.add(String(asset.id || "")));
        renderAttachmentAssetTray();
        attachmentAssetTrayHost.querySelector(".assetSequenceSelectAll")?.focus();
      });
      tray.querySelector(".assetSequenceApply")?.addEventListener("click", () => {
        Promise.resolve(applyAttachmentAssetSequence(selectedAssets)).catch((error) =>
          status(error instanceof Error ? error.message : String(error)),
        );
      });
      tray.querySelector(".assetSequenceRemove")?.addEventListener("click", () => {
        void runAssetLibraryAction(
          () =>
            removeAttachmentAssets(
              selectedAssets.map((asset) => asset.id),
              groupKey,
            ),
          "assetRemoveFailed",
          ".attachmentAssetUndo",
        );
      });
      input?.addEventListener("change", () => {
        void importAttachmentAssets(input);
      });

      attachmentAssetTrayHost.appendChild(tray);
    }

    return { renderAttachmentAssetTray, syncFrameActions };
  }

  return Object.freeze({ createController });
});
