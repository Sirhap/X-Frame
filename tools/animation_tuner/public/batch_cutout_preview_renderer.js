(function attachBatchCutoutPreviewRenderer(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutPreviewRenderer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates the selected-preview renderer and its color-list views.
   *
   * This controller only moves existing canvas/DOM rendering code behind
   * injected callbacks. Pixel processing, repair records, and state changes
   * remain owned by the batch controller and its existing cores.
   * @param {object} dependencies Preview rendering dependencies.
   * @returns {{renderPreview:()=>Promise<void>,renderProtectedColors:()=>void,renderBackgroundSamples:()=>void}}
   */
  function createController(dependencies = {}) {
    const {
      state,
      elements,
      text,
      selectedItem,
      selectedBackgroundColor,
      protectedColorEntries,
      recordItemEdit,
      invalidateItem,
      setStatus,
      schedulePreview,
      processItem,
      drawPreviewCanvas,
      renderPreviewMode,
      renderPreviewZoom,
      setPreviewProcessing,
      drawRepairOverlay,
      drawProtectionPreview,
      renderProtectionPreviewInfo,
      renderStatus,
      updateQueueCard,
      createDiagnosticCanvas,
      core,
      backgroundController,
      documentRef = _root?.document,
    } = dependencies;
    if (
      !state ||
      !elements ||
      typeof text !== "function" ||
      typeof selectedItem !== "function" ||
      typeof selectedBackgroundColor !== "function" ||
      typeof protectedColorEntries !== "function" ||
      typeof processItem !== "function"
    ) {
      throw new TypeError("BatchCutoutPreviewRenderer dependencies are required.");
    }

    const documentApi = documentRef;

    /**
     * Processes and redraws the selected preview.
     * @returns {Promise<void>}
     */
    async function renderPreview() {
      const renderToken = ++state.previewRenderToken;
      const finishPreview = () => {
        if (renderToken === state.previewRenderToken) setPreviewProcessing(false);
      };
      setPreviewProcessing(true);
      const item = selectedItem();
      drawPreviewCanvas(elements.cutoutOriginal, item?.sourceCanvas || null);
      if (!item) {
        drawPreviewCanvas(elements.cutoutResult, null);
        renderPreviewMode();
        renderPreviewZoom();
        renderBackgroundSamples();
        renderProtectedColors();
        renderProtectionPreviewInfo();
        renderStatus();
        finishPreview();
        return;
      }
      const showUntouchedOriginal =
        state.sessionMode === "single" && state.previewMode === "original" && !item.processingActivated;
      if (showUntouchedOriginal) {
        drawPreviewCanvas(elements.cutoutResult, item.sourceCanvas);
        renderPreviewMode();
        renderPreviewZoom();
        elements.cutoutColor.value = selectedBackgroundColor(item).hex;
        renderBackgroundSamples();
        renderProtectedColors();
        renderProtectionPreviewInfo();
        renderStatus();
        finishPreview();
        return;
      }
      try {
        item.processingActivated = true;
        await processItem(item);
        if (item !== selectedItem()) {
          finishPreview();
          return;
        }
        const previewSource =
          state.previewMode === "original"
            ? item.sourceCanvas
            : state.previewMode === "alpha" || state.previewMode === "difference"
              ? createDiagnosticCanvas(item, state.previewMode)
              : item.resultCanvas;
        drawPreviewCanvas(elements.cutoutResult, previewSource);
      } catch (error) {
        if (error?.name === "AbortError") {
          finishPreview();
          return;
        }
        drawPreviewCanvas(elements.cutoutResult, null);
        setStatus(
          text("frameFailed", {
            index: state.selectedIndex + 1,
            message: error.message,
          }),
          "error",
        );
      }
      updateQueueCard(item);
      renderPreviewMode();
      drawRepairOverlay();
      drawProtectionPreview();
      renderPreviewZoom();
      elements.cutoutColor.value = selectedBackgroundColor(item).hex;
      renderBackgroundSamples();
      renderProtectedColors();
      renderProtectionPreviewInfo();
      renderStatus();
      finishPreview();
    }

    /**
     * Renders protected-color swatches for the selected image.
     * @returns {void}
     */
    function renderProtectedColors() {
      const item = selectedItem();
      elements.cutoutProtectedColors.innerHTML = "";
      for (const entry of protectedColorEntries(item)) {
        const { color } = entry;
        const button = documentApi.createElement("button");
        button.type = "button";
        button.title = core.rgbToHex(color);
        button.setAttribute("aria-label", `${text("protectedPalette")} ${core.rgbToHex(color)}`);
        button.style.setProperty("--protected-color", core.rgbToHex(color));
        button.addEventListener("click", () => {
          recordItemEdit(item);
          entry.container.splice(entry.index, 1);
          item.repairs = (item.repairs || []).filter(
            (repair) => repair.mode !== "protect-color" || repair.colors?.length,
          );
          invalidateItem(item);
          renderPreview();
        });
        elements.cutoutProtectedColors.appendChild(button);
      }
      elements.cutoutProtectClear.disabled = !protectedColorEntries(item).length;
      elements.cutoutProtectSample.classList.toggle("active", state.samplingProtectedColor);
    }

    /**
     * Renders the selected image's background samples.
     * @returns {void}
     */
    function renderBackgroundSamples() {
      const item = selectedItem();
      elements.cutoutBackgroundColors.innerHTML = "";
      for (const [index, color] of (item?.backgroundSamples || []).entries()) {
        const button = documentApi.createElement("button");
        button.type = "button";
        const colorHex = core.rgbToHex(color);
        button.title = `${text("removeBackgroundSample")} ${colorHex}`;
        button.setAttribute("aria-label", `${text("removeBackgroundSample")} ${colorHex}`);
        button.style.setProperty("--protected-color", core.rgbToHex(color));
        button.addEventListener("click", () => {
          recordItemEdit(item);
          const removedColor = backgroundController.removeBackgroundSample(item, index);
          if (!item.backgroundSamples.length) item.automaticCutoutActivated = false;
          setStatus(
            text("backgroundSampleRemoved", { color: core.rgbToHex(removedColor || color) }),
            "success",
          );
          schedulePreview({ recordHistory: false });
        });
        elements.cutoutBackgroundColors.appendChild(button);
      }
      elements.cutoutBackgroundClear.disabled = !item?.backgroundSamples?.length;
      [elements.cutoutRepairAutomatic, elements.cutoutRepairAutomaticQuick].forEach((button) => {
        button.classList.toggle("active", state.samplingBackgroundColor);
        button.setAttribute("aria-pressed", String(state.samplingBackgroundColor));
        button.title = text(state.samplingBackgroundColor ? "backgroundCancelTitle" : "automaticCutoutTitle");
      });
      elements.cutoutBackgroundHint.textContent = text(
        state.samplingBackgroundColor ? "backgroundSamplingHint" : "backgroundHint",
      );
      elements.cutoutModal.classList.toggle("samplingBackground", state.samplingBackgroundColor);
    }

    return { renderPreview, renderProtectedColors, renderBackgroundSamples };
  }

  return { createController };
});
