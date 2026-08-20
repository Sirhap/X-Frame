(function attachBatchCutoutSettings(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  const PREVIEW_BACKGROUND_MODES = Object.freeze(["light", "dark", "white"]);

  /**
   * Normalizes a preview background without allowing it to affect processing state.
   * @param {string} mode Requested preview background.
   * @returns {"light"|"dark"|"white"} Supported preview background.
   */
  function normalizePreviewBackground(mode) {
    return PREVIEW_BACKGROUND_MODES.includes(mode) ? mode : "light";
  }

  /**
   * Applies a display-only preview background and synchronizes its toggle buttons.
   * Canvas pixels and automatic processing parameters are intentionally untouched.
   * @param {object} elements Batch-cutout DOM adapter.
   * @param {object} state Mutable batch-cutout session state.
   * @param {string} mode Requested preview background.
   * @returns {"light"|"dark"|"white"} Applied preview background.
   */
  function applyPreviewBackground(elements, state, mode) {
    if (!elements?.cutoutModal || !state) {
      throw new TypeError("Preview background requires modal elements and state.");
    }
    const normalizedMode = normalizePreviewBackground(mode);
    state.previewBackground = normalizedMode;
    elements.cutoutModal.dataset.previewBackground = normalizedMode;
    [
      [elements.cutoutBackgroundLight, "light"],
      [elements.cutoutBackgroundDark, "dark"],
      [elements.cutoutBackgroundWhite, "white"],
    ].forEach(([button, buttonMode]) => {
      if (!button) return;
      const active = normalizedMode === buttonMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    return normalizedMode;
  }

  /**
   * Resolves the automatic-panel hint for the current slider combination.
   * Tolerance -1 is the matching off/closed stop and must not be described as auto-estimate.
   * @param {{itemAvailable?:boolean,automatic?:boolean,hasBackgroundSample?:boolean,tolerance?:number,alphaLow?:number,alphaHigh?:number}} options Current sidebar state.
   * @returns {string} Localization key.
   */
  function resolveAutomaticSettingsHintKey(options = {}) {
    const itemAvailable = Boolean(options.itemAvailable);
    const automatic = Boolean(options.automatic);
    if (!itemAvailable) return "settingsEmptyHint";
    if (!automatic) return "toolSettingsHint";
    if (!options.hasBackgroundSample) return "needsBackgroundSampleHint";
    const tolerance = Number(options.tolerance);
    if (Number.isFinite(tolerance) && tolerance <= -1) return "toleranceClosedHint";
    if (tolerance >= 100) return "toleranceAggressiveHint";
    const alphaLow = Number(options.alphaLow);
    const alphaHigh = Number(options.alphaHigh);
    if (Number.isFinite(alphaHigh) && alphaHigh <= alphaLow) return "alphaWindowRangeHint";
    return "automaticToolSettingsHint";
  }

  /**
   * Resolves which automatic controls have no effect under the current parameter combination.
   * @param {{blendStrength?:number,despillStrength?:number,edgeDespillRadius?:number,edgeRecoveryStrength?:number}} parameters Current automatic parameters.
   * @returns {{blendModeDisabled:boolean,despillModeDisabled:boolean,backgroundRadiusDisabled:boolean}} Dependency state.
   */
  function resolveAutomaticControlDependencies(parameters = {}) {
    const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
    return {
      blendModeDisabled: !positive(parameters.blendStrength),
      despillModeDisabled: !positive(parameters.despillStrength) && !positive(parameters.edgeDespillRadius),
      backgroundRadiusDisabled: !positive(parameters.edgeRecoveryStrength),
    };
  }

  /**
   * Synchronizes automatic control availability without changing persisted values.
   * @param {object} elements Batch-cutout DOM adapter.
   * @param {boolean} unavailable Whether the whole automatic panel is unavailable.
   * @param {(range:object)=>object|null} [numericInputForRange] Optional editable-number resolver.
   * @returns {{blendModeDisabled:boolean,despillModeDisabled:boolean,backgroundRadiusDisabled:boolean}} Applied dependency state.
   */
  function syncAutomaticControlDependencies(elements, unavailable = false, numericInputForRange = null) {
    const dependencies = resolveAutomaticControlDependencies({
      blendStrength: elements.cutoutBlendStrength?.value,
      despillStrength: elements.cutoutDespillStrength?.value,
      edgeDespillRadius: elements.cutoutEdgeDespillRadius?.value,
      edgeRecoveryStrength: elements.cutoutEdgeRecoveryStrength?.value,
    });
    if (elements.cutoutBlendMode) {
      elements.cutoutBlendMode.disabled = unavailable || dependencies.blendModeDisabled;
    }
    if (elements.cutoutDespillMode) {
      elements.cutoutDespillMode.disabled = unavailable || dependencies.despillModeDisabled;
    }
    if (elements.cutoutBackgroundRadius) {
      elements.cutoutBackgroundRadius.disabled = unavailable || dependencies.backgroundRadiusDisabled;
      const numericInput = numericInputForRange?.(elements.cutoutBackgroundRadius);
      if (numericInput) numericInput.disabled = elements.cutoutBackgroundRadius.disabled;
    }
    return dependencies;
  }

  /**
   * Resolves whether the current edit can be propagated and explains unavailable states.
   * Automatic parameters in batch sessions are already shared, while local repairs
   * remain opt-in because their geometry must be tracked across frames.
   * @param {{total:number,item:object|null|undefined,busy:boolean,sessionMode:string}} options Current session state.
   * @returns {{enabled:boolean,labelKey:string,titleKey:string}} Propagation presentation state.
   */
  function resolveRepairPropagationState(options) {
    const total = Math.max(0, Number(options?.total) || 0);
    const item = options?.item;
    const sessionMode = options?.sessionMode || "batch";
    const defaultLabelKey = sessionMode === "single" ? "repairBatchSingle" : "repairBatch";
    if (options?.busy) {
      return { enabled: false, labelKey: defaultLabelKey, titleKey: "repairBatchBusyTitle" };
    }
    if (total < 2) {
      return { enabled: false, labelKey: defaultLabelKey, titleKey: "repairBatchMultipleTitle" };
    }
    if (item?.repairs?.length || item?.pendingAutomaticPropagation) {
      return { enabled: true, labelKey: defaultLabelKey, titleKey: "repairBatchReadyTitle" };
    }
    if (sessionMode === "batch") {
      return {
        enabled: false,
        labelKey: "repairBatchParametersSynced",
        titleKey: "repairBatchParametersSyncedTitle",
      };
    }
    return { enabled: false, labelKey: defaultLabelKey, titleKey: "repairBatchNeedsEditTitle" };
  }

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
      renderAdvancedMode,
      previewLatestRepairAcrossBatch = () => false,
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
     * Applies automatic-parameter dependencies to sliders, selects, and editable number mirrors.
     * @returns {{blendModeDisabled:boolean,despillModeDisabled:boolean,backgroundRadiusDisabled:boolean}} Applied state.
     */
    function synchronizeAutomaticControlDependencies() {
      const dependencies = syncAutomaticControlDependencies(
        elements,
        !selectedItem() || state.busy,
        (range) => numericRangeInputs.get(range) || null,
      );
      setSettingsMode(state.settingsMode || (state.repairMode === "automatic" ? "automatic" : "tool"));
      return dependencies;
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
      synchronizeAutomaticControlDependencies();
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
      [
        elements.cutoutRepairAutomatic,
        elements.cutoutRepairAutomaticQuick,
        elements.cutoutRepairBrush,
        elements.cutoutRepairEraser,
        elements.cutoutRepairSource,
        elements.cutoutRepairRecolor,
        elements.cutoutAreaTransparentQuick,
        elements.cutoutRepairClear,
        elements.cutoutRepairRestore,
        elements.cutoutRepairProtect,
      ].forEach((control) => {
        control.disabled = !item || state.busy;
      });
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
      const propagationState = resolveRepairPropagationState({
        total,
        item,
        busy: state.busy,
        sessionMode: state.sessionMode,
      });
      elements.cutoutRepairBatch.disabled = !propagationState.enabled;
      elements.cutoutRepairBatch.textContent = text(propagationState.labelKey);
      elements.cutoutRepairBatch.title = text(propagationState.titleKey);
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
      setSettingsMode(state.settingsMode || (state.repairMode === "automatic" ? "automatic" : "tool"));
    }

    /**
     * Resolves the localized label used for a repair mode.
     * @param {string} mode Repair mode identifier.
     * @returns {string} Translation key for the active tool.
     */
    function repairModeTextKey(mode) {
      if (mode === "automatic") return "repairAutomatic";
      if (mode === "clear") return "repairClear";
      if (mode === "restore") return "repairRestore";
      if (mode === "protect") return "repairProtect";
      if (mode === "fill") return "repairFill";
      if (mode === "recolor") return "repairRecolor";
      if (mode === "eraser") return "repairEraser";
      if (mode === "restore-source") return "repairSource";
      return "repairBrush";
    }

    /**
     * Synchronizes the left sidebar with the selected tool and image availability.
     * @param {"automatic"|"tool"} mode Sidebar parameter mode.
     * @returns {void}
     */
    function setSettingsMode(mode) {
      state.settingsMode = mode === "tool" ? "tool" : "automatic";
      const itemAvailable = Boolean(selectedItem());
      const automatic = state.settingsMode === "automatic";
      elements.cutoutSettingsEmpty.hidden = itemAvailable;
      elements.cutoutAutomaticSettings.hidden = !itemAvailable || !automatic;
      elements.cutoutLocalSettings.hidden = !itemAvailable || automatic;
      elements.cutoutSettings.classList.toggle("empty", !itemAvailable);
      elements.cutoutActiveToolTitle.textContent = itemAvailable
        ? text(repairModeTextKey(automatic ? "automatic" : state.repairMode))
        : text("settingsEmptyTitle");
      const hasBackgroundSample = Boolean(selectedItem()?.backgroundSamples?.length);
      const tolerance = Number(elements.cutoutTolerance?.value);
      const alphaLow = Number(elements.cutoutAlphaLow?.value);
      const alphaHigh = Number(elements.cutoutAlphaHigh?.value);
      const hintKey = resolveAutomaticSettingsHintKey({
        itemAvailable,
        automatic,
        hasBackgroundSample,
        tolerance,
        alphaLow,
        alphaHigh,
      });
      elements.cutoutActiveToolHint.textContent = text(hintKey);
      const matchingClosed = Number.isFinite(tolerance) && tolerance <= -1;
      if (elements.cutoutToleranceClosedHint) {
        elements.cutoutToleranceClosedHint.hidden = !matchingClosed;
        if (matchingClosed) elements.cutoutToleranceClosedHint.textContent = text("toleranceClosedHint");
      }
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
            : mode === "recolor"
              ? "area"
              : "selection";
      elements.cutoutLocalSettings.querySelectorAll("[data-cutout-options]").forEach((panel) => {
        panel.hidden = panel.dataset.cutoutOptions !== optionKind;
      });
      elements.cutoutLocalSettings.querySelector(".cutoutBrushColor").hidden = mode !== "brush";
      elements.cutoutActiveToolTitle.textContent = text(repairModeTextKey(mode));
      if (optionKind === "area") {
        elements.cutoutAreaScope.disabled = false;
        elements.cutoutAreaHint.textContent = text("recolorHint");
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
              : mode === "protect"
                ? "protectColorHint"
                : "selectionHint",
        );
      }
      const protectionActive = mode === "protect";
      elements.cutoutProtectionRangeOptions.hidden = elements.cutoutProtectionType.value !== "range";
      elements.cutoutProtectionColorOptions.hidden = elements.cutoutProtectionType.value !== "color";
      setSettingsMode(mode === "automatic" || protectionActive ? "automatic" : "tool");
      renderPreview();
    }

    /**
     * Selects the display-only background behind transparent preview pixels.
     * @param {string} mode Requested preview background.
     * @returns {"light"|"dark"|"white"} Applied preview background.
     */
    function setPreviewBackground(mode) {
      return applyPreviewBackground(elements, state, mode);
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
      previewLatestRepairAcrossBatch(item);
      return true;
    }

    /**
     * Updates the latest intelligent protection repair and refreshes its result preview.
     * @param {{boundaryStrength?:number,padding?:number}} patch Protection fields to replace.
     * @returns {boolean} Whether a protection repair was updated.
     */
    function updateLatestProtectionRepair(patch) {
      const item = selectedItem();
      const repair = item?.repairs?.at(-1);
      if (!repair || repair.mode !== "protect-range") return false;
      recordItemEdit(item);
      Object.assign(repair, patch);
      item.undoneRepairs = [];
      state.protectionPreview = null;
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
      setPreviewBackground,
      selectedAreaColor,
      setAreaColorTransparent,
      updateLatestAreaRepair,
      updateLatestProtectionRepair,
      syncAutomaticControlDependencies: synchronizeAutomaticControlDependencies,
    };
  }

  return {
    PREVIEW_BACKGROUND_MODES,
    normalizePreviewBackground,
    applyPreviewBackground,
    createController,
    resolveAutomaticControlDependencies,
    resolveAutomaticSettingsHintKey,
    resolveRepairPropagationState,
    syncAutomaticControlDependencies,
  };
});
