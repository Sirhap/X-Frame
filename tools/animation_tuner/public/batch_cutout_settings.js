(function attachBatchCutoutSettings(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates the batch cutout control and presentation helpers.
   *
   * This controller owns only DOM-facing settings, status, and repair-mode
   * transitions. Image processing and queue state remain in the host controller
   * and are accessed through injected callbacks.
   * @param {object} dependencies Settings dependencies supplied by the host.
   * @returns {object} Settings and status helper API.
   */
  function createController(dependencies = {}) {
    const {
      state,
      elements,
      hooks = {},
      imagePixelBudget,
      imagePixelLimits,
      text,
      selectedItem,
      hasQualityIssue,
      selectedBackgroundColor,
      colorUtils,
      recordItemEdit,
      invalidateItem,
      renderPreview,
      schedulePreview,
      syncProtectionPreview,
      renderAdvancedMode,
      advancedSummary,
      advancedPresets = {},
    } = dependencies;
    if (
      !state ||
      !elements ||
      !imagePixelBudget ||
      typeof text !== "function" ||
      typeof selectedItem !== "function" ||
      typeof hasQualityIssue !== "function" ||
      typeof selectedBackgroundColor !== "function" ||
      !colorUtils ||
      typeof recordItemEdit !== "function" ||
      typeof invalidateItem !== "function" ||
      typeof renderPreview !== "function" ||
      typeof schedulePreview !== "function" ||
      typeof syncProtectionPreview !== "function" ||
      typeof renderAdvancedMode !== "function"
    ) {
      throw new TypeError("BatchCutoutSettings dependencies are required.");
    }
    if (!imagePixelLimits || typeof imagePixelLimits !== "object") {
      throw new TypeError("BatchCutoutSettings requires image pixel limits.");
    }
    if (!advancedSummary) throw new TypeError("BatchCutoutSettings requires advanced summary.");

    const numericRangeInputs = new WeakMap();

    /**
     * Validates decoded image memory before allocating processing canvases.
     * @param {CanvasImageSource} source Browser image or canvas source.
     * @param {number} currentPixels Pixels already retained in this batch.
     * @returns {{pixels:number,totalPixels:number}} Accepted pixel metrics.
     * @throws {Error} When the image or batch exceeds its decoded-pixel budget.
     */
    function assertImagePixelBudget(source, currentPixels = 0) {
      const result = imagePixelBudget.evaluate(source, currentPixels, imagePixelLimits);
      if (result.allowed) return result;
      const limit = Math.max(1, Math.floor(result.limit / 1_000_000));
      if (result.reason === "single") {
        throw new Error(text("imagePixelLimit", { width: result.width, height: result.height, limit }));
      }
      if (result.reason === "total") throw new Error(text("batchPixelLimit", { limit }));
      throw new Error("Image has no readable pixels.");
    }

    /**
     * Synchronizes a range, its legacy output, and the editable number field.
     * @param {HTMLInputElement} range Range input that owns the parameter value.
     * @param {HTMLOutputElement} output Existing read-only value output.
     * @param {string} suffix Optional display suffix retained for accessibility.
     * @returns {void}
     */
    function syncNumericRange(range, output, suffix = "") {
      output.textContent = `${range.value}${suffix}`;
      const numberInput = numericRangeInputs.get(range);
      if (!numberInput || document.activeElement === numberInput) return;
      numberInput.value = range.value;
    }

    /**
     * Adds an editable, bounded number field to a slider without duplicating state.
     * Both controls write to the range value so existing processing code has one source of truth.
     * @param {HTMLInputElement} range Range input to enhance.
     * @param {HTMLOutputElement} output Existing range output.
     * @param {{suffix?:string,onInput?:()=>void}} [options] Display and refresh behavior.
     * @returns {HTMLInputElement}
     */
    function bindNumericRange(range, output, options = {}) {
      const numberInput = document.createElement("input");
      numberInput.type = "number";
      numberInput.className = "cutoutParameterNumber";
      numberInput.min = range.min;
      numberInput.max = range.max;
      numberInput.step = range.step || "1";
      numberInput.value = range.value;
      numberInput.inputMode = "decimal";
      const label = range.closest("label")?.querySelector("span")?.textContent?.trim();
      numberInput.setAttribute("aria-label", label || range.id);
      output.hidden = true;
      output.insertAdjacentElement("afterend", numberInput);
      numericRangeInputs.set(range, numberInput);

      const publish = () => {
        syncNumericRange(range, output, options.suffix || "");
        options.onInput?.();
      };
      range.addEventListener("input", publish);
      numberInput.addEventListener("input", () => {
        const value = Number(numberInput.value);
        if (!Number.isFinite(value)) return;
        const minimum = Number.isFinite(Number(range.min)) ? Number(range.min) : value;
        const maximum = Number.isFinite(Number(range.max)) ? Number(range.max) : value;
        range.value = String(Math.max(minimum, Math.min(maximum, value)));
        output.textContent = `${range.value}${options.suffix || ""}`;
        options.onInput?.();
      });
      numberInput.addEventListener("change", () => {
        numberInput.value = range.value;
      });
      numberInput.addEventListener("blur", () => {
        numberInput.value = range.value;
      });
      return numberInput;
    }

    /**
     * Applies a named advanced Alpha preset through existing processing controls.
     * @param {"conservative"|"balanced"|"hard"} presetName Preset identifier.
     * @returns {void}
     */
    function applyAdvancedPreset(presetName) {
      const preset = advancedPresets[presetName];
      if (!preset) return;
      const controls = [
        [elements.cutoutAlphaLow, elements.cutoutAlphaLowValue, preset.alphaLow],
        [elements.cutoutAlphaHigh, elements.cutoutAlphaHighValue, preset.alphaHigh],
        [elements.cutoutAlphaThreshold, elements.cutoutAlphaValue, preset.alphaThreshold],
        [
          elements.cutoutProtectionTolerance,
          elements.cutoutProtectionToleranceValue,
          preset.protectionTolerance,
        ],
      ];
      controls.forEach(([input, output, value]) => {
        input.value = String(value);
        syncNumericRange(input, output);
      });
      renderAdvancedMode();
      schedulePreview();
    }

    /**
     * Publishes a user-visible status message.
     * @param {string} message Message to display.
     * @param {"idle"|"busy"|"success"|"error"} tone Visual tone.
     * @returns {void}
     */
    function setStatus(message, tone = "idle") {
      elements.cutoutStatus.textContent = message;
      elements.cutoutStatus.dataset.tone = tone;
      hooks.onStatus?.(message);
    }

    /**
     * Updates the status and control state without replacing an active message.
     * @returns {void}
     */
    function renderStatus() {
      const item = selectedItem();
      const total = state.items.length;
      const included = state.items.filter((candidate) => !candidate.excluded).length;
      const processed = state.items.filter((candidate) => candidate.status === "processed").length;
      const failed = state.items.filter((candidate) => candidate.status === "failed").length;
      const selected = state.items.filter((candidate) => state.selectedIds.has(candidate.id)).length;
      const issueCount = state.items.filter(hasQualityIssue).length;
      const hasMultipleItems = total > 1;
      const hasBatchItems = state.sessionMode === "batch" && total > 0;
      elements.cutoutCounter.textContent = `/ ${total}`;
      elements.cutoutFrameNumber.value = total ? String(state.selectedIndex + 1) : "1";
      elements.cutoutFrameNumber.max = String(Math.max(1, total));
      elements.cutoutFrameNumber.disabled = total < 2 || state.busy;
      elements.cutoutFrameSlider.max = String(Math.max(1, total));
      elements.cutoutFrameSlider.value = total ? String(state.selectedIndex + 1) : "1";
      elements.cutoutFrameSlider.disabled = total < 2 || state.busy;
      elements.cutoutPrevious.disabled = total < 2 || state.busy;
      elements.cutoutNext.disabled = total < 2 || state.busy;
      elements.cutoutPreviewPlay.disabled = total < 2 || state.busy;
      elements.cutoutPreviewPlay.classList.toggle("playing", state.playing);
      elements.cutoutPreviewPlay.textContent = state.playing ? "■" : "▶";
      elements.cutoutPreviewPlay.setAttribute("aria-pressed", String(state.playing));
      elements.cutoutFrameNavigation.hidden = !hasMultipleItems;
      elements.cutoutBatchTray.hidden = !hasBatchItems;
      elements.cutoutRepairBatch.hidden = !hasMultipleItems;
      elements.cutoutRepairAutomatic.disabled = !item || state.busy;
      elements.cutoutRepairAutomaticQuick.disabled = !item || state.busy;
      elements.cutoutBatchSummary.textContent = text("batchSummary", {
        included,
        total,
        selected,
        processed,
        failed,
      });
      elements.cutoutQualityCount.textContent = String(issueCount);
      elements.cutoutQualityOnly.classList.toggle("active", state.qualityOnly);
      elements.cutoutQualityOnly.setAttribute("aria-pressed", String(state.qualityOnly));
      elements.cutoutQualityOnly.disabled = !total || state.busy;
      elements.cutoutNextIssue.disabled = !issueCount || state.busy;
      const worksetSession = state.sourceKind === "workset" && typeof state.worksetResolver === "function";
      elements.cutoutModal.classList.toggle("hasItems", state.items.length > 0);
      elements.cutoutModal.classList.toggle("batchTrayCollapsed", state.batchTrayCollapsed);
      elements.cutoutBatchTrayToggle.textContent = state.batchTrayCollapsed ? "▾" : "▴";
      elements.cutoutBatchTrayToggle.setAttribute("aria-expanded", String(!state.batchTrayCollapsed));
      const batchTrayToggleLabel = text(state.batchTrayCollapsed ? "expandBatchTray" : "collapseBatchTray");
      elements.cutoutBatchTrayToggle.setAttribute("aria-label", batchTrayToggleLabel);
      elements.cutoutBatchTrayToggle.title = batchTrayToggleLabel;
      elements.cutoutAddFiles.disabled = worksetSession || state.busy || total >= 240;
      elements.cutoutDownload.disabled = !included || state.busy;
      const animation = hooks.getCurrentAnimation?.();
      const hasAnimationTarget = Boolean(animation?.frames?.length);
      elements.cutoutApplyGroup.hidden = !worksetSession && !hasAnimationTarget;
      elements.cutoutApplyGroup.disabled =
        !included ||
        (!worksetSession && !hasAnimationTarget) ||
        (state.sessionMode === "single" && !item?.processingActivated) ||
        state.busy;
      elements.cutoutApplyGroup.textContent = text(
        state.sessionMode === "single" ? "applySingle" : worksetSession ? "applyWorkset" : "applyGroup",
      );
      elements.cutoutClear.disabled = worksetSession || !state.items.length || state.busy;
      elements.cutoutNewBatch.hidden = worksetSession;
      elements.cutoutNewBatch.disabled = worksetSession || !state.items.length || state.busy;
      elements.cutoutLoadGroup.hidden = worksetSession || !hasAnimationTarget;
      elements.cutoutLoadGroup.disabled = worksetSession || !hasAnimationTarget || state.busy;
      elements.cutoutRepairUndo.disabled =
        (!item?.editUndo?.length && !item?.repairs?.length && !item?.propagationUndo) || state.busy;
      elements.cutoutRepairRedo.disabled =
        (!item?.editRedo?.length && !item?.undoneRepairs?.length && !item?.propagationRedo) || state.busy;
      elements.cutoutRepairReset.disabled = !item?.repairs?.length || state.busy;
      elements.cutoutRepairBatch.disabled =
        state.items.length < 2 ||
        (!item?.repairs?.length && !item?.pendingAutomaticPropagation) ||
        state.busy;
      elements.cutoutIncludeAll.disabled = !state.items.length || included === total || state.busy;
      elements.cutoutExcludeAll.disabled = !state.items.length || included === 0 || state.busy;
      elements.cutoutSelectAll.disabled = !total || selected === total || state.busy;
      elements.cutoutInvertSelection.disabled = !total || state.busy;
      elements.cutoutExcludeSelected.disabled = !selected || state.busy;
      elements.cutoutDeleteSelected.disabled = !selected || state.busy;
      elements.cutoutRetryFailed.disabled = !failed || state.busy;
      elements.cutoutCancelProcess.hidden = !state.busy;
      elements.cutoutCancelProcess.disabled = !state.busy || state.cancelRequested;
      [
        elements.cutoutZoomOut,
        elements.cutoutZoom,
        elements.cutoutZoomIn,
        elements.cutoutZoomFit,
        elements.cutoutZoomActual,
        elements.cutoutViewResult,
        elements.cutoutViewOriginal,
        elements.cutoutViewAlpha,
        elements.cutoutViewDifference,
      ].forEach((control) => {
        control.disabled = !item || state.busy;
      });
      elements.cutoutSample.textContent = state.items.length
        ? text("sample", { color: selectedBackgroundColor().hex })
        : text("ready");
      elements.cutoutAddFiles.textContent = state.items.length ? text("appendFiles") : text("addFiles");
    }

    /**
     * Switches the left sidebar between automatic cutout and active-tool parameters.
     * @param {"automatic"|"tool"} mode Sidebar parameter mode.
     * @returns {void}
     */
    function setSettingsMode(mode) {
      state.settingsMode = mode;
      const automatic = mode === "automatic";
      elements.cutoutAutomaticSettings.hidden = !automatic;
      const toolHasParameters = !["automatic", "clear", "restore"].includes(state.repairMode);
      elements.cutoutLocalSettings.hidden = automatic || !toolHasParameters;
      elements.cutoutSettings.classList.toggle("parameterlessTool", !automatic && !toolHasParameters);
      elements.cutoutSettingsAutomatic.classList.toggle("active", automatic);
      elements.cutoutSettingsTool.classList.toggle("active", !automatic);
      elements.cutoutSettingsAutomatic.setAttribute("aria-selected", String(automatic));
      elements.cutoutSettingsTool.setAttribute("aria-selected", String(!automatic));
    }

    /**
     * Selects the active repair mode.
     * @param {string} mode Repair mode identifier.
     * @returns {void}
     */
    function setRepairMode(mode) {
      const leavingSamplingMode =
        mode !== "automatic" && (state.samplingBackgroundColor || state.samplingProtectedColor);
      if (mode !== "automatic") {
        state.samplingBackgroundColor = false;
        state.samplingProtectedColor = false;
      }
      if (leavingSamplingMode) setStatus(text("samplingCancelled"), "idle");
      state.repairMode = mode;
      const item = selectedItem();
      if (mode === "protect") syncProtectionPreview(item);
      state.previewMode = mode === "automatic" && !item?.processingActivated ? "original" : "result";
      if (mode !== "automatic" && state.sessionMode === "single" && item) {
        item.processingActivated = true;
        item.pendingAutomaticPropagation = false;
      }
      if (mode === "recolor" && state.areaColorTransparent) setAreaColorTransparent(false);
      elements.cutoutRepairTools.dataset.repairMode = mode;
      elements.cutoutModal.dataset.repairMode = mode;
      [
        [elements.cutoutRepairBrush, "brush"],
        [elements.cutoutRepairEraser, "eraser"],
        [elements.cutoutRepairSource, "restore-source"],
        [elements.cutoutRepairFill, "fill"],
        [elements.cutoutRepairRecolor, "recolor"],
        [elements.cutoutRepairClear, "clear"],
        [elements.cutoutRepairRestore, "restore"],
        [elements.cutoutRepairProtect, "protect"],
      ].forEach(([button, buttonMode]) => {
        const active = mode === buttonMode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      const optionKind =
        mode === "automatic"
          ? "none"
          : ["brush", "eraser", "restore-source"].includes(mode)
            ? "brush"
            : ["fill", "recolor"].includes(mode)
              ? "area"
              : "selection";
      elements.cutoutLocalSettings.querySelectorAll("[data-cutout-options]").forEach((panel) => {
        panel.hidden = panel.dataset.cutoutOptions !== optionKind;
      });
      elements.cutoutLocalSettings.querySelector(".cutoutBrushColor").hidden = mode !== "brush";
      elements.cutoutLocalSettings.querySelector(".cutoutAreaScope").hidden = mode === "fill";
      const activeToolKey =
        mode === "automatic"
          ? "repairAutomatic"
          : mode === "clear"
            ? "repairClear"
            : mode === "restore"
              ? "repairRestore"
              : mode === "protect"
                ? "repairProtect"
                : mode === "fill"
                  ? "repairFill"
                  : mode === "recolor"
                    ? "repairRecolor"
                    : mode === "eraser"
                      ? "repairEraser"
                      : mode === "restore-source"
                        ? "repairSource"
                        : "repairBrush";
      elements.cutoutActiveToolTitle.textContent = text(activeToolKey);
      if (optionKind === "area") {
        elements.cutoutAreaScope.disabled = mode === "fill";
        if (mode === "fill") elements.cutoutAreaScope.value = "connected";
        elements.cutoutAreaHint.textContent = text(mode === "fill" ? "fillHint" : "recolorHint");
      } else if (optionKind === "selection") {
        const modeKey =
          mode === "clear"
            ? "repairClear"
            : mode === "restore"
              ? "repairRestore"
              : mode === "protect"
                ? "repairProtect"
                : "repairClear";
        elements.cutoutSelectionToolLabel.textContent = text(modeKey);
        elements.cutoutSelectionHint.textContent = text(
          mode === "restore"
            ? "restoreHint"
            : mode === "protect" && elements.cutoutProtectionType.value === "range"
              ? "protectRangeHint"
              : "selectionHint",
        );
      }
      const protectionActive = mode === "protect";
      elements.cutoutProtectionControls.hidden = !protectionActive;
      elements.cutoutProtectionRangeOptions.hidden =
        !protectionActive || elements.cutoutProtectionType.value !== "range";
      setSettingsMode(mode === "automatic" ? "automatic" : "tool");
      renderPreview();
    }

    /**
     * Returns the selected area replacement as RGBA.
     * @returns {{r:number,g:number,b:number,a?:number}} Selected replacement color.
     */
    function selectedAreaColor() {
      if (state.areaColorTransparent) return { r: 0, g: 0, b: 0, a: 0 };
      return colorUtils.hexToRgb(elements.cutoutAreaColor.value || "#00c800");
    }

    /**
     * Synchronizes the transparent-color shortcut with its native color input.
     * @param {boolean} transparent Whether area edits should remove color and alpha.
     * @returns {void}
     */
    function setAreaColorTransparent(transparent) {
      state.areaColorTransparent = Boolean(transparent);
      [elements.cutoutAreaTransparent, elements.cutoutAreaTransparentQuick].forEach((button) => {
        button.classList.toggle("active", state.areaColorTransparent);
        button.setAttribute("aria-pressed", String(state.areaColorTransparent));
      });
      elements.cutoutAreaColor.classList.toggle("inactive", state.areaColorTransparent);
    }

    /**
     * Updates the latest area-color repair so parameters remain live after sampling.
     * @param {object} patch Repair fields to replace.
     * @returns {boolean} Whether an existing repair was updated.
     */
    function updateLatestAreaRepair(patch) {
      const item = selectedItem();
      const repair = item?.repairs?.at(-1);
      if (!repair || repair.mode !== state.repairMode) return false;
      if (!["fill", "recolor"].includes(repair.mode)) return false;
      recordItemEdit(item);
      Object.assign(repair, patch);
      item.undoneRepairs = [];
      invalidateItem(item);
      renderPreview();
      return true;
    }

    return {
      assertImagePixelBudget,
      syncNumericRange,
      bindNumericRange,
      applyAdvancedPreset,
      setStatus,
      renderStatus,
      setSettingsMode,
      setRepairMode,
      selectedAreaColor,
      setAreaColorTransparent,
      updateLatestAreaRepair,
    };
  }

  return { createController };
});
