(function attachBatchCutoutEvents(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutEvents = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Activates automatic processing and exposes its result after a parameter edit.
   * The caller records history before invoking this helper so undo restores the
   * untouched single-frame state instead of an already-activated snapshot.
   * @param {object} state Mutable cutout session state.
   * @param {object|null|undefined} item Selected cutout item.
   * @returns {boolean} Whether a selected item was activated.
   */
  function activateAutomaticPreview(state, item) {
    if (!state || typeof state !== "object") {
      throw new TypeError("Automatic preview activation requires session state.");
    }
    state.previewMode = "result";
    if (!item) return false;
    item.processingActivated = true;
    item.automaticCutoutActivated = true;
    return true;
  }

  /**
   * Creates the batch cutout event wiring controller.
   * @param {object} dependencies Event dependencies and state.
   * @returns {{createController:Function}} Event controller factory.
   */
  function createController(dependencies = {}) {
    const {
      elements,
      state,
      windowRef = root,
      documentRef = root?.document,
      navigatorRef = root?.navigator,
      requestAnimationFrame = (callback) => windowRef.requestAnimationFrame(callback),
      advancedPresetButtons = [],
      ...handlers
    } = dependencies;
    if (!elements || !state || !windowRef || !documentRef) {
      throw new TypeError("BatchCutoutEvents requires elements, state, and browser references.");
    }

    const window = windowRef;
    const document = documentRef;
    const navigator = navigatorRef || {};
    const {
      open,
      setStatus,
      text,
      requestClose,
      loadFiles,
      loadCurrentGroup,
      clear,
      downloadAll,
      addToProject,
      applyCurrentGroup,
      selectBatchIndex,
      toggleBatchPlayback,
      setPreviewMode,
      setPreviewBackground,
      renderStatus,
      selectedItem,
      resolveProtectedColorInput,
      hasQualityIssue,
      renderQueue,
      renderPreview,
      scheduleBatchThumbnails,
      selectNextQualityIssue,
      deleteSelectedItems,
      invalidateItem,
      cutoutExecutor,
      beginPreviewPan,
      samplePreviewColor,
      resultPointerPoint,
      captureRepairGestureCanvas,
      scheduleRepairGestureFrame,
      updateRepairGesture,
      cancelRepairGestureFrame,
      recordItemEdit,
      createRepairTrackingMetadata,
      selectedAreaColor,
      applyProtectionSelection,
      selectedBackgroundColor,
      setPreviewScale,
      zoomPreviewAtPointer,
      movePreviewPan,
      endPreviewPan,
      setRepairMode,
      setAreaColorTransparent,
      updateLatestAreaRepair,
      updateLatestProtectionRepair,
      bindNumericRange,
      renderBackgroundSamples,
      renderProtectedColors,
      backgroundController,
      colorUtils,
      sessionCore,
      applyProcessingParametersToControls,
      refreshQualityAnalysis,
      propagateLatestRepair,
      applyAdvancedPreset,
      trapModalFocus,
      isEditableTarget,
      renderAdvancedMode,
      scrollBatchActionsByWheel,
      scrollBatchActionsByKeyboard,
      resolveConfirmation,
      schedulePreview,
      previewLatestRepairAcrossBatch,
    } = handlers;

    const repairEventsModule = root.BatchCutoutRepairEvents;
    if (!repairEventsModule) throw new Error("BatchCutoutRepairEvents is required.");
    const repairEvents = repairEventsModule.createController({
      elements,
      state,
      beginPreviewPan,
      samplePreviewColor,
      resultPointerPoint,
      captureRepairGestureCanvas,
      scheduleRepairGestureFrame,
      updateRepairGesture,
      cancelRepairGestureFrame,
      selectedItem,
      recordItemEdit,
      createRepairTrackingMetadata,
      selectedAreaColor,
      applyProtectionSelection,
      selectedBackgroundColor,
      invalidateItem,
      setStatus,
      text,
      renderPreview,
      setRepairMode,
      zoomPreviewAtPointer,
      movePreviewPan,
      endPreviewPan,
      setPreviewScale,
      previewLatestRepairAcrossBatch,
    });

    let sidebarCollapsed = false;

    /**
     * Schedules an automatic-processing refresh and switches to its result.
     * @param {{recordHistory?:boolean}} [options] Preview history behavior.
     * @returns {void}
     */
    function scheduleAutomaticPreview(options = {}) {
      schedulePreview(options);
      activateAutomaticPreview(state, selectedItem());
    }

    /**
     * Selects the visible left-workbar surface without changing image-processing state.
     * @param {"parameters"|"batch"} panel Requested sidebar panel.
     * @returns {void}
     */
    function setSidebarPanel(panel) {
      const showBatch = panel === "batch";
      elements.cutoutSidebarParametersTab.classList.toggle("active", !showBatch);
      elements.cutoutSidebarParametersTab.setAttribute("aria-selected", String(!showBatch));
      elements.cutoutSidebarParametersTab.setAttribute("tabindex", showBatch ? "-1" : "0");
      elements.cutoutSidebarBatchTab.classList.toggle("active", showBatch);
      elements.cutoutSidebarBatchTab.setAttribute("aria-selected", String(showBatch));
      elements.cutoutSidebarBatchTab.setAttribute("tabindex", showBatch ? "0" : "-1");
      elements.cutoutSidebarParametersPanel.hidden = showBatch;
      elements.cutoutSidebarBatchPanel.hidden = !showBatch;
      elements.cutoutModal.dataset.sidebarPanel = showBatch ? "batch" : "parameters";
      if (showBatch && state.batchTrayCollapsed) {
        state.batchTrayCollapsed = false;
        renderStatus();
      }
    }

    /**
     * Collapses or restores the desktop sidebar while keeping its selected panel.
     * @param {boolean} collapsed Whether the sidebar should use its rail state.
     * @returns {void}
     */
    function setSidebarCollapsed(collapsed) {
      sidebarCollapsed = Boolean(collapsed);
      elements.cutoutModal.classList.toggle("sidebarCollapsed", sidebarCollapsed);
      elements.cutoutSidebarCollapse.textContent = sidebarCollapsed ? "›" : "‹";
      elements.cutoutSidebarCollapse.setAttribute("aria-expanded", String(!sidebarCollapsed));
      const label = text(sidebarCollapsed ? "expandSidebar" : "collapseSidebar");
      elements.cutoutSidebarCollapse.setAttribute("aria-label", label);
      elements.cutoutSidebarCollapse.title = label;
      state.previewFitScale = null;
      renderPreview();
    }

    function bind() {
      elements.cutoutOpen.addEventListener("click", open);
      elements.cutoutCopyLink.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setStatus(text("linkCopied"), "success");
        } catch (_error) {
          setStatus(text("linkCopyFailed"), "error");
        }
      });
      elements.cutoutHome.addEventListener("click", () => {
        requestClose().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
      });
      elements.cutoutClose.addEventListener("click", () => {
        requestClose().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
      });
      elements.cutoutAddFiles.addEventListener("click", () => elements.cutoutFileInput.click());
      elements.cutoutFileInput.addEventListener("change", () => loadFiles(elements.cutoutFileInput.files));
      root.ClipboardMedia?.bindPaste({
        target: document,
        accept: ["image"],
        isActive: () => !elements.cutoutModal.hidden && elements.cutoutConfirmPanel.hidden && !state.busy,
        onPaste: ({ images }) => loadFiles(images),
        onUnsupported: () => setStatus(text("pasteUnsupported"), "error"),
        onError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          setStatus(text("failed", { message }), "error");
        },
      });
      elements.cutoutLoadGroup.addEventListener("click", loadCurrentGroup);
      elements.cutoutClear.addEventListener("click", () => {
        clear().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
      });
      elements.cutoutNewBatch.addEventListener("click", async () => {
        try {
          const cleared = await clear({ mode: "new" });
          if (cleared) elements.cutoutAddFiles.focus();
        } catch (error) {
          setStatus(text("failed", { message: error.message }), "error");
        }
      });
      elements.cutoutDownload.addEventListener("click", downloadAll);
      elements.cutoutAddProject?.addEventListener("click", addToProject);
      elements.cutoutApplyGroup.addEventListener("click", applyCurrentGroup);
      elements.cutoutPrevious.addEventListener("click", () => {
        selectBatchIndex(state.selectedIndex - 1, { wrap: true });
      });
      elements.cutoutNext.addEventListener("click", () => {
        selectBatchIndex(state.selectedIndex + 1, { wrap: true });
      });
      elements.cutoutFrameNumber.addEventListener("change", () => {
        selectBatchIndex(Number(elements.cutoutFrameNumber.value) - 1);
      });
      elements.cutoutFrameSlider.addEventListener("input", () => {
        selectBatchIndex(Number(elements.cutoutFrameSlider.value) - 1);
      });
      elements.cutoutPreviewPlay.addEventListener("click", toggleBatchPlayback);
      elements.cutoutViewResult.addEventListener("click", () => setPreviewMode("result"));
      elements.cutoutViewOriginal.addEventListener("click", () => setPreviewMode("original"));
      elements.cutoutViewAlpha.addEventListener("click", () => setPreviewMode("alpha"));
      elements.cutoutViewDifference.addEventListener("click", () => setPreviewMode("difference"));
      elements.cutoutBackgroundLight.addEventListener("click", () => setPreviewBackground("light"));
      elements.cutoutBackgroundDark.addEventListener("click", () => setPreviewBackground("dark"));
      elements.cutoutBackgroundWhite.addEventListener("click", () => setPreviewBackground("white"));
      elements.cutoutSidebarParametersTab.addEventListener("click", () => setSidebarPanel("parameters"));
      elements.cutoutSidebarBatchTab.addEventListener("click", () => setSidebarPanel("batch"));
      elements.cutoutSidebarCollapse.addEventListener("click", () => {
        setSidebarCollapsed(!sidebarCollapsed);
      });
      [elements.cutoutSidebarParametersTab, elements.cutoutSidebarBatchTab].forEach((tab, index, tabs) => {
        tab.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const nextIndex =
            event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
          const nextTab = tabs[nextIndex];
          setSidebarPanel(nextTab === elements.cutoutSidebarBatchTab ? "batch" : "parameters");
          nextTab.focus();
        });
      });
      elements.cutoutBatchTrayToggle.addEventListener("click", () => {
        state.batchTrayCollapsed = !state.batchTrayCollapsed;
        renderStatus();
      });
      elements.cutoutBatchTrayActions.addEventListener("wheel", scrollBatchActionsByWheel, {
        passive: false,
      });
      elements.cutoutBatchTrayActions.addEventListener("keydown", scrollBatchActionsByKeyboard);
      elements.cutoutQualityOnly.addEventListener("click", () => {
        state.qualityOnly = !state.qualityOnly;
        if (state.qualityOnly) {
          state.batchTrayCollapsed = false;
          const current = selectedItem();
          if (!hasQualityIssue(current)) {
            const firstIssue = state.items.findIndex(hasQualityIssue);
            if (firstIssue >= 0) state.selectedIndex = firstIssue;
          }
        }
        renderQueue();
        renderPreview();
      });
      elements.cutoutNextIssue.addEventListener("click", selectNextQualityIssue);
      elements.cutoutShowResult.addEventListener("click", () => {
        state.thumbnailMode = "result";
        renderQueue();
        scheduleBatchThumbnails();
      });
      elements.cutoutShowOriginal.addEventListener("click", () => {
        state.thumbnailMode = "original";
        renderQueue();
      });
      elements.cutoutIncludeAll.addEventListener("click", () => {
        state.items.forEach((item) => {
          item.excluded = false;
        });
        renderQueue();
        scheduleBatchThumbnails();
      });
      elements.cutoutExcludeAll.addEventListener("click", () => {
        state.thumbnailJob += 1;
        state.items.forEach((item) => {
          item.excluded = true;
        });
        renderQueue();
      });
      elements.cutoutSelectAll.addEventListener("click", () => {
        state.selectedIds = new Set(state.items.map((item) => item.id));
        renderQueue();
      });
      elements.cutoutInvertSelection.addEventListener("click", () => {
        const nextSelection = new Set();
        state.items.forEach((item) => {
          if (!state.selectedIds.has(item.id)) nextSelection.add(item.id);
        });
        state.selectedIds = nextSelection;
        renderQueue();
      });
      elements.cutoutExcludeSelected.addEventListener("click", () => {
        state.thumbnailJob += 1;
        state.items.forEach((item) => {
          if (state.selectedIds.has(item.id)) item.excluded = true;
        });
        renderQueue();
        scheduleBatchThumbnails();
      });
      elements.cutoutDeleteSelected.addEventListener("click", () => {
        deleteSelectedItems().catch((error) =>
          setStatus(text("failed", { message: error.message }), "error"),
        );
      });
      elements.cutoutRetryFailed.addEventListener("click", () => {
        state.items.filter((item) => item.status === "failed").forEach(invalidateItem);
        renderQueue();
        renderPreview();
        scheduleBatchThumbnails();
      });
      elements.cutoutCancelProcess.addEventListener("click", () => {
        state.cancelRequested = true;
        cutoutExecutor.cancelAll();
        renderStatus();
      });
      elements.cutoutQueue.addEventListener(
        "scroll",
        () => {
          if (state.queueRenderFrame) return;
          state.queueRenderFrame = requestAnimationFrame(() => {
            state.queueRenderFrame = 0;
            const nextStart = Math.max(0, Math.floor(elements.cutoutQueue.scrollTop / 175) - 10);
            if (Math.abs(nextStart - state.queueWindowStart) >= 5) renderQueue();
          });
        },
        { passive: true },
      );
      elements.cutoutConfirmCancel.addEventListener("click", () => resolveConfirmation(false));
      elements.cutoutConfirmApply.addEventListener("click", () => resolveConfirmation(true));
      elements.cutoutConfirmPanel.addEventListener("click", (event) => {
        if (event.target === elements.cutoutConfirmPanel) resolveConfirmation(false);
      });
      repairEvents.bind();
      /**
       * Toggles background sampling from either the source-settings button or the persistent toolbar shortcut.
       * @returns {void}
       */
      function toggleBackgroundSampling() {
        const item = selectedItem();
        if (!item) return;
        setRepairMode("automatic");
        state.samplingBackgroundColor = !state.samplingBackgroundColor;
        state.samplingProtectedColor = false;
        setStatus(
          text(state.samplingBackgroundColor ? "backgroundSampling" : "backgroundSamplingCancelled"),
          state.samplingBackgroundColor ? "busy" : "idle",
        );
        renderBackgroundSamples();
        renderProtectedColors();
      }
      elements.cutoutRepairAutomatic.addEventListener("click", toggleBackgroundSampling);
      elements.cutoutRepairAutomaticQuick.addEventListener("click", toggleBackgroundSampling);
      elements.cutoutRepairBrush.addEventListener("click", () => setRepairMode("brush"));
      elements.cutoutRepairEraser.addEventListener("click", () => setRepairMode("eraser"));
      elements.cutoutRepairSource.addEventListener("click", () => setRepairMode("restore-source"));
      elements.cutoutRepairRecolor.addEventListener("click", () => setRepairMode("recolor"));
      elements.cutoutRepairClear.addEventListener("click", () => setRepairMode("clear"));
      elements.cutoutRepairRestore.addEventListener("click", () => setRepairMode("restore"));
      elements.cutoutRepairProtect.addEventListener("click", () => setRepairMode("protect"));
      elements.cutoutAreaTransparentQuick.addEventListener("click", () => {
        setRepairMode("recolor");
        setAreaColorTransparent(!state.areaColorTransparent);
        updateLatestAreaRepair({ color: selectedAreaColor() });
      });
      elements.cutoutAreaTransparent.addEventListener("click", () => {
        setAreaColorTransparent(!state.areaColorTransparent);
        updateLatestAreaRepair({ color: selectedAreaColor() });
      });
      elements.cutoutAreaColor.addEventListener("input", () => {
        setAreaColorTransparent(false);
        updateLatestAreaRepair({ color: selectedAreaColor() });
      });
      elements.cutoutProtectionType.addEventListener("change", () => {
        state.protectionPreview = null;
        elements.cutoutProtectionRangeOptions.hidden = elements.cutoutProtectionType.value !== "range";
        elements.cutoutProtectionColorOptions.hidden = elements.cutoutProtectionType.value !== "color";
        elements.cutoutSelectionHint.textContent = text(
          state.repairMode === "restore"
            ? "restoreHint"
            : elements.cutoutProtectionType.value === "range"
              ? "protectRangeHint"
              : "protectColorHint",
        );
        renderPreview();
      });
      [
        [elements.cutoutBrushSize, elements.cutoutBrushSizeValue, ""],
        [elements.cutoutBrushHardness, elements.cutoutBrushHardnessValue, "%"],
        [elements.cutoutBrushOpacity, elements.cutoutBrushOpacityValue, "%"],
      ].forEach(([input, output, suffix]) => {
        bindNumericRange(input, output, { suffix });
      });
      bindNumericRange(elements.cutoutProtectionBoundary, elements.cutoutProtectionBoundaryValue, {
        onInput: () => {
          updateLatestProtectionRepair({ boundaryStrength: Number(elements.cutoutProtectionBoundary.value) });
        },
      });
      bindNumericRange(elements.cutoutProtectionPadding, elements.cutoutProtectionPaddingValue, {
        onInput: () => {
          updateLatestProtectionRepair({ padding: Number(elements.cutoutProtectionPadding.value) });
        },
      });
      bindNumericRange(elements.cutoutAreaTolerance, elements.cutoutAreaToleranceValue, {
        onInput: () => {
          updateLatestAreaRepair({ tolerance: Number(elements.cutoutAreaTolerance.value) });
        },
      });
      elements.cutoutAreaScope.addEventListener("change", () => {
        updateLatestAreaRepair({ scope: elements.cutoutAreaScope.value });
      });

      /** @returns {boolean} Whether the latest logical edit was undone. */
      async function undoLatestRepair() {
        const item = selectedItem();
        const outcome = sessionCore.undoEdit(state.items, item);
        if (!outcome.changed) return false;
        applyProcessingParametersToControls(item?.processingParameters);
        state.samplingBackgroundColor = false;
        state.samplingProtectedColor = false;
        state.protectionPreview = null;
        refreshQualityAnalysis();
        renderPreview();
        previewLatestRepairAcrossBatch(item);
        if (outcome.live) {
          await applyCurrentGroup({ live: true, publishedCanvases: outcome.publishedCanvases });
        }
        return true;
      }

      /** @returns {boolean} Whether the latest logical edit was restored. */
      async function redoLatestRepair() {
        const item = selectedItem();
        const outcome = sessionCore.redoEdit(state.items, item);
        if (!outcome.changed) return false;
        applyProcessingParametersToControls(item?.processingParameters);
        state.samplingBackgroundColor = false;
        state.samplingProtectedColor = false;
        state.protectionPreview = null;
        refreshQualityAnalysis();
        renderPreview();
        previewLatestRepairAcrossBatch(item);
        if (outcome.live) {
          await applyCurrentGroup({ live: true, publishedCanvases: outcome.publishedCanvases });
        }
        return true;
      }

      elements.cutoutRepairUndo.addEventListener("click", undoLatestRepair);
      elements.cutoutRepairRedo.addEventListener("click", redoLatestRepair);
      elements.cutoutRepairReset.addEventListener("click", () => {
        const item = selectedItem();
        if (item) {
          recordItemEdit(item);
          item.repairs = [];
          item.undoneRepairs = [];
          invalidateItem(item);
        }
        state.protectionPreview = null;
        renderPreview();
        previewLatestRepairAcrossBatch(item);
      });
      elements.cutoutRepairBatch.addEventListener("click", propagateLatestRepair);
      elements.cutoutProtectSample.addEventListener("click", () => {
        state.samplingProtectedColor = !state.samplingProtectedColor;
        state.samplingBackgroundColor = false;
        if (state.samplingProtectedColor) setStatus(text("protectSampling"), "busy");
        renderBackgroundSamples();
        renderProtectedColors();
      });

      /**
       * Clears manually entered and automatically detected protected colors.
       * @returns {void}
       */
      function clearProtectedColors() {
        const item = selectedItem();
        if (item) {
          recordItemEdit(item);
          item.protectedColors = [];
          item.repairs = (item.repairs || []).filter((repair) => repair.mode !== "protect-color");
          item.undoneRepairs = (item.undoneRepairs || []).filter((repair) => repair.mode !== "protect-color");
          invalidateItem(item);
        }
        state.samplingProtectedColor = false;
        renderPreview();
      }

      /**
       * Adds a validated manual HEX color to the selected image palette.
       * @returns {void}
       */
      function addProtectionColorFromInput() {
        const item = selectedItem();
        const input = elements.cutoutProtectionColorHex;
        const resolution = resolveProtectedColorInput(item, input.value);
        input.setCustomValidity("");
        if (resolution.status === "invalid") {
          input.setCustomValidity(text("protectedColorInvalid"));
          input.reportValidity();
          setStatus(text("protectedColorInvalid"), "error");
          return;
        }
        if (resolution.status === "limit") {
          setStatus(text("protectedColorLimit"), "error");
          return;
        }
        if (resolution.status === "duplicate") {
          setStatus(text("protectedColorDuplicate"), "idle");
          return;
        }
        recordItemEdit(item);
        item.protectedColors ||= [];
        item.protectedColors.push(resolution.color);
        input.value = resolution.hex;
        elements.cutoutProtectionColorPicker.value = resolution.hex;
        invalidateItem(item);
        setStatus(text("protectedColorAdded", { color: resolution.hex }), "success");
        renderPreview();
      }

      elements.cutoutProtectClear.addEventListener("click", clearProtectedColors);
      elements.cutoutProtectionColorClear.addEventListener("click", clearProtectedColors);
      elements.cutoutProtectionColorPicker.addEventListener("input", () => {
        elements.cutoutProtectionColorHex.value = elements.cutoutProtectionColorPicker.value;
        elements.cutoutProtectionColorHex.setCustomValidity("");
      });
      elements.cutoutProtectionColorHex.addEventListener("input", () => {
        const value = String(elements.cutoutProtectionColorHex.value || "").trim();
        if (/^#[0-9a-f]{6}$/i.test(value)) {
          elements.cutoutProtectionColorPicker.value = value;
          elements.cutoutProtectionColorHex.setCustomValidity("");
        }
      });
      elements.cutoutProtectionColorHex.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        addProtectionColorFromInput();
      });
      elements.cutoutProtectionColorAdd.addEventListener("click", addProtectionColorFromInput);
      elements.cutoutBackgroundClear.addEventListener("click", () => {
        const item = selectedItem();
        if (item) {
          recordItemEdit(item);
          backgroundController.clearBackgroundSamples(item);
          item.automaticCutoutActivated = false;
          setStatus(text("backgroundSamplesCleared"), "success");
          schedulePreview({ recordHistory: false });
        }
        state.samplingBackgroundColor = false;
        renderBackgroundSamples();
      });
      document.querySelectorAll("[data-cutout-tab]").forEach((button) => {
        button.addEventListener("click", () => {
          const tab = button.dataset.cutoutTab;
          document.querySelectorAll("[data-cutout-tab]").forEach((candidate) => {
            candidate.classList.toggle("active", candidate === button);
            candidate.setAttribute("aria-selected", String(candidate === button));
          });
          document.querySelectorAll("[data-cutout-panel]").forEach((panel) => {
            const active = panel.dataset.cutoutPanel === tab;
            panel.classList.toggle("active", active);
            panel.hidden = !active;
            panel.setAttribute("aria-hidden", String(!active));
          });
        });
        button.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const tabs = Array.from(document.querySelectorAll("[data-cutout-tab]"));
          const currentIndex = tabs.indexOf(button);
          const nextIndex =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          tabs[nextIndex]?.focus();
          tabs[nextIndex]?.click();
        });
      });
      advancedPresetButtons.forEach((button) => {
        button.addEventListener("click", () => applyAdvancedPreset(button.dataset.cutoutPreset));
      });
      elements.cutoutModal.addEventListener("pointerdown", (event) => {
        if (event.target === elements.cutoutModal) {
          requestClose().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
        }
      });
      window.addEventListener(
        "keydown",
        (event) => {
          if (!elements.cutoutModal.hidden && event.key === "Tab") {
            trapModalFocus(event);
            return;
          }
          const commandKey = event.metaKey || event.ctrlKey;
          if (
            !elements.cutoutModal.hidden &&
            elements.cutoutConfirmPanel.hidden &&
            commandKey &&
            !event.altKey &&
            event.key.toLowerCase() === "z" &&
            !isEditableTarget(event.target)
          ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.shiftKey) redoLatestRepair();
            else undoLatestRepair();
            return;
          }
          if (event.key === "Escape" && !elements.cutoutModal.hidden) {
            if (!elements.cutoutConfirmPanel.hidden) resolveConfirmation(false);
            else
              requestClose().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
            return;
          }
          if (
            !elements.cutoutModal.hidden &&
            elements.cutoutConfirmPanel.hidden &&
            !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName) &&
            document.activeElement?.getAttribute("role") !== "tab" &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight")
          ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            selectBatchIndex(state.selectedIndex + (event.key === "ArrowRight" ? 1 : -1), { wrap: true });
            return;
          }
          if (
            event.code === "Space" &&
            !elements.cutoutModal.hidden &&
            !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)
          ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            state.previewSpacePan = true;
            elements.cutoutModal.classList.add("isPreviewPanReady");
          }
        },
        true,
      );
      window.addEventListener(
        "keyup",
        (event) => {
          if (event.code !== "Space") return;
          if (!elements.cutoutModal.hidden) event.stopImmediatePropagation();
          state.previewSpacePan = false;
          elements.cutoutModal.classList.remove("isPreviewPanReady");
        },
        true,
      );
      window.addEventListener("resize", () => {
        if (!elements.cutoutModal.hidden) {
          state.previewFitScale = null;
          renderPreview();
        }
      });
      for (const eventName of ["dragenter", "dragover"]) {
        elements.cutoutDropzone.addEventListener(eventName, (event) => {
          event.preventDefault();
          elements.cutoutDropzone.classList.add("dragOver");
        });
      }
      for (const eventName of ["dragleave", "drop"]) {
        elements.cutoutDropzone.addEventListener(eventName, (event) => {
          event.preventDefault();
          elements.cutoutDropzone.classList.remove("dragOver");
        });
      }
      elements.cutoutDropzone.addEventListener("drop", (event) => loadFiles(event.dataTransfer?.files));
      elements.cutoutConnected.addEventListener("change", scheduleAutomaticPreview);
      elements.cutoutPerceptual.addEventListener("change", scheduleAutomaticPreview);
      elements.cutoutBlendMode.addEventListener("change", scheduleAutomaticPreview);
      elements.cutoutDespillMode.addEventListener("change", scheduleAutomaticPreview);
      elements.cutoutColor.addEventListener("input", () => {
        const item = selectedItem();
        if (item) {
          recordItemEdit(item);
          backgroundController.clearBackgroundSamples(item);
          item.backgroundSamples = [
            backgroundController.normalizeColor(colorUtils.hexToRgb(elements.cutoutColor.value)),
          ];
        }
        scheduleAutomaticPreview({ recordHistory: false });
      });
      [
        [elements.cutoutTolerance, elements.cutoutToleranceValue],
        [elements.cutoutEdgeBoost, elements.cutoutEdgeBoostValue],
        [elements.cutoutBlendStrength, elements.cutoutBlendStrengthValue],
        [elements.cutoutFeather, elements.cutoutFeatherValue],
        [elements.cutoutChromaFeather, elements.cutoutChromaFeatherValue],
        [elements.cutoutAlphaThreshold, elements.cutoutAlphaValue],
        [elements.cutoutDespillStrength, elements.cutoutDespillStrengthValue],
        [elements.cutoutEdgeDespillRadius, elements.cutoutEdgeDespillRadiusValue],
        [elements.cutoutEdgeRecoveryStrength, elements.cutoutEdgeRecoveryStrengthValue],
        [elements.cutoutBackgroundRadius, elements.cutoutBackgroundRadiusValue],
        [elements.cutoutBlurRadius, elements.cutoutBlurRadiusValue],
        [elements.cutoutAlphaLow, elements.cutoutAlphaLowValue],
        [elements.cutoutAlphaHigh, elements.cutoutAlphaHighValue],
        [elements.cutoutProtectionTolerance, elements.cutoutProtectionToleranceValue],
      ].forEach(([input, output]) => {
        bindNumericRange(input, output, {
          onInput: () => {
            renderAdvancedMode();
            scheduleAutomaticPreview();
          },
        });
      });
    }

    return { bind, setSidebarCollapsed, setSidebarPanel };
  }

  return { activateAutomaticPreview, createController };
});
