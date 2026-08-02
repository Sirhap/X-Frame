(function attachBatchCutoutCandidateController(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutCandidateController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const REASON_TEXT_KEYS = Object.freeze({
    "preserve-subject": "candidateReasonPreserveSubject",
    "clean-background": "candidateReasonCleanBackground",
    "sharpen-edge": "candidateReasonSharpenEdge",
    "clean-transparent-color": "candidateReasonCleanTransparentColor",
    "balanced-exploration": "candidateReasonBalancedExploration",
    "refresh-background": "candidateReasonRefreshBackground",
    preset: "candidateReasonPreset",
  });

  /** @param {*} value Serializable value. @returns {*} Independent clone. */
  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
  }

  /**
   * Resolves an application scope against the current queue selection.
   * @param {object} state Mutable cutout session state.
   * @param {"current"|"selected"|"all"} scope Requested scope.
   * @returns {object[]} Included target items.
   */
  function resolveCandidateTargets(state, scope) {
    const included = Array.from(state?.items || []).filter((item) => !item.excluded);
    if (scope === "all") return included;
    if (scope === "selected") {
      return included.filter((item) => state.selectedIds?.has(item.id));
    }
    const selected = state?.items?.[state.selectedIndex] || null;
    return selected && !selected.excluded ? [selected] : [];
  }

  /**
   * Creates the non-destructive A/B generation, comparison, apply, and preset coordinator.
   * @param {object} dependencies Candidate dependencies supplied by the host controller.
   * @returns {object} Candidate interaction API.
   */
  function createController(dependencies = {}) {
    const {
      state,
      elements,
      text,
      selectedItem,
      sessionCore,
      candidateCore,
      presetStore,
      cutoutExecutor,
      cutoutAnalysisExecutor,
      processItem,
      estimateBackgroundColor,
      colorUtils,
      requestConfirmation,
      applyProcessingParametersToControls,
      renderPreview,
      renderQueue,
      renderStatus,
      scheduleBatchThumbnails,
      refreshQualityAnalysis,
      setStatus,
      getCurrentAnimation = () => null,
      documentRef = root?.document,
      imageDataConstructor = root?.ImageData,
    } = dependencies;
    if (
      !state?.comparison ||
      !elements?.cutoutCandidateGenerate ||
      typeof text !== "function" ||
      typeof selectedItem !== "function" ||
      !sessionCore?.applyAutomaticCandidate ||
      !candidateCore?.createSuggestedCandidate ||
      !presetStore?.list ||
      !cutoutExecutor?.process ||
      typeof processItem !== "function" ||
      typeof estimateBackgroundColor !== "function" ||
      !colorUtils?.hexToRgb ||
      typeof renderPreview !== "function"
    ) {
      throw new TypeError("BatchCutoutCandidateController dependencies are required.");
    }

    /** @returns {object} Mutable comparison state. */
    function comparison() {
      return state.comparison;
    }

    /** @param {object} color RGB color. @returns {object} Normalized RGBA color. */
    function normalizeColor(color) {
      return {
        r: Math.max(0, Math.min(255, Math.round(Number(color?.r) || 0))),
        g: Math.max(0, Math.min(255, Math.round(Number(color?.g) || 0))),
        b: Math.max(0, Math.min(255, Math.round(Number(color?.b) || 0))),
        a: Math.max(0, Math.min(255, Math.round(Number(color?.a ?? 255) || 0))),
      };
    }

    /** @param {object} item Source item. @param {object} candidate Candidate state. @returns {object} Worker options. */
    function candidateProcessingOptions(item, candidate) {
      const backgroundSamples = candidate.backgroundSamples?.length
        ? candidate.backgroundSamples.map(normalizeColor)
        : [normalizeColor(colorUtils.hexToRgb(candidate.parameters.backgroundColor))];
      const draft = {
        ...item,
        processingParameters: candidate.parameters,
        backgroundSamples,
        seedPoints: cloneValue(candidate.seedPoints || []),
        automaticCutoutActivated: true,
      };
      return sessionCore.createProcessingOptions(draft, {
        backgroundColor: backgroundSamples[0],
        backgroundColors: backgroundSamples,
        protectedColors: cloneValue(item.protectedColors || []),
      });
    }

    /** @param {object} result Worker result. @param {number} width Width. @param {number} height Height. @returns {HTMLCanvasElement} Result canvas. */
    function resultCanvas(result, width, height) {
      const canvas = documentRef.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas
        .getContext("2d")
        .putImageData(new imageDataConstructor(new Uint8ClampedArray(result.data), width, height), 0, 0);
      return canvas;
    }

    /** @param {object} item Selected item. @returns {Promise<object>} Current-frame quality result. */
    async function analyzeBaseline(item) {
      if (!cutoutAnalysisExecutor?.analyzeQuality) return item.quality || { codes: [] };
      const metrics = state.items.map((candidate) =>
        candidate === item ? item.qualityMetrics : candidate.qualityMetrics,
      );
      try {
        const analysis = await cutoutAnalysisExecutor.analyzeQuality(metrics, {
          circular: getCurrentAnimation()?.loop === true,
        });
        return analysis[state.items.indexOf(item)] || item.quality || { codes: [] };
      } catch (_error) {
        return item.quality || { codes: [] };
      }
    }

    /** @returns {void} Synchronizes preset choices and their actions. */
    function renderPresets() {
      const presets = presetStore.list();
      const previousId = elements.cutoutCandidatePresetSelect.value;
      elements.cutoutCandidatePresetSelect.innerHTML = "";
      if (!presets.length) {
        const option = documentRef.createElement("option");
        option.value = "";
        option.textContent = text("candidatePresetEmpty");
        elements.cutoutCandidatePresetSelect.appendChild(option);
      } else {
        for (const preset of presets) {
          const option = documentRef.createElement("option");
          option.value = preset.id;
          option.textContent = preset.name;
          elements.cutoutCandidatePresetSelect.appendChild(option);
        }
        if (presets.some((preset) => preset.id === previousId)) {
          elements.cutoutCandidatePresetSelect.value = previousId;
        }
      }
      elements.cutoutCandidatePresetName.placeholder = text("candidatePresetName");
      elements.cutoutCandidatePresetLoad.disabled = !presets.length || comparison().status === "generating";
      elements.cutoutCandidatePresetDelete.disabled = !presets.length || comparison().status === "generating";
    }

    /** @returns {void} Renders candidate status, controls, and parameter deltas. */
    function render() {
      const current = comparison();
      const ready = current.status === "ready" && Boolean(current.variants);
      const generating = current.status === "generating";
      elements.cutoutCandidatePanel.dataset.status = current.status;
      elements.cutoutCandidateGenerate.disabled = generating || !selectedItem();
      elements.cutoutCandidateGenerate.textContent = text(
        generating ? "candidateGenerating" : "candidateGenerate",
      );
      elements.cutoutCandidateExit.hidden = !ready && !generating;
      elements.cutoutCandidateReview.hidden = !ready;
      elements.cutoutCandidateStatus.textContent =
        current.message || text(ready ? "candidateReady" : "candidateHint");
      elements.cutoutSettings.inert = ready;
      elements.cutoutRepairTools.inert = ready;
      [
        elements.cutoutViewResult,
        elements.cutoutViewOriginal,
        elements.cutoutViewAlpha,
        elements.cutoutViewDifference,
      ].forEach((button) => {
        button.disabled = ready;
      });
      if (ready) {
        const viewButtons = [
          [elements.cutoutCandidateViewA, "a"],
          [elements.cutoutCandidateViewSplit, "split"],
          [elements.cutoutCandidateViewB, "b"],
        ];
        viewButtons.forEach(([button, mode]) => {
          const active = current.displayMode === mode;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });
        elements.cutoutCandidateSplitRange.value = String(Math.round(current.splitRatio * 100));
        elements.cutoutCandidateSplitRange.disabled = current.displayMode !== "split";
        elements.cutoutCandidateDivider.hidden = current.displayMode !== "split";
        elements.cutoutCandidateDivider.style.left = `${current.splitRatio * 100}%`;
        elements.cutoutCandidateDivider.setAttribute(
          "aria-valuenow",
          String(Math.round(current.splitRatio * 100)),
        );
        elements.cutoutCandidateReasons.replaceChildren(
          ...current.variants.b.reasonCodes.map((code) => {
            const badge = documentRef.createElement("span");
            badge.textContent = text(REASON_TEXT_KEYS[code] || code);
            return badge;
          }),
        );
        elements.cutoutCandidateDifferences.replaceChildren(
          ...current.variants.b.differences.map((difference) => {
            const badge = documentRef.createElement("span");
            badge.textContent = `${text(difference.key)}: ${difference.from} → ${difference.to}`;
            return badge;
          }),
        );
      } else {
        elements.cutoutCandidateDivider.hidden = true;
      }
      const targets = resolveCandidateTargets(state, elements.cutoutCandidateScope.value);
      elements.cutoutCandidateApply.disabled = !ready || !targets.length;
      elements.cutoutCandidateApply.textContent = text("candidateApply", {
        variant: current.activeVariant?.toUpperCase() || "B",
        count: targets.length,
      });
      elements.cutoutCandidatePresetSave.disabled = !ready || generating;
      renderPresets();
      renderStatus?.();
    }

    /**
     * Clears stale comparison artifacts and optionally redraws the normal preview.
     * @param {{cancel?:boolean,redraw?:boolean}} [options] Reset behavior.
     * @returns {void}
     */
    function invalidate(options = {}) {
      const current = comparison();
      current.generation += 1;
      if (options.cancel !== false && current.status === "generating") cutoutExecutor.cancelAll();
      current.status = "idle";
      current.sourceItemId = "";
      current.sourceRevision = -1;
      current.variants = null;
      current.displayMode = "split";
      current.activeVariant = "b";
      current.splitRatio = 0.5;
      current.draggingDivider = false;
      current.message = "";
      render();
      if (options.redraw !== false) renderPreview();
    }

    /** @param {"a"|"split"|"b"} mode Candidate view. @returns {void} */
    function setDisplayMode(mode) {
      if (!comparison().variants || !["a", "split", "b"].includes(mode)) return;
      comparison().displayMode = mode;
      if (mode === "a" || mode === "b") comparison().activeVariant = mode;
      if (mode === "split") comparison().activeVariant = "b";
      render();
      renderPreview();
    }

    /** @param {number} value Divider ratio from zero to one. @returns {void} */
    function setSplitRatio(value) {
      comparison().splitRatio = Math.max(0.05, Math.min(0.95, Number(value) || 0.5));
      render();
      if (comparison().status === "ready") renderPreview();
    }

    /**
     * Generates A from current state and B from local rules or one saved preset.
     * @param {{preset?:object|null}} [options] Optional preset override for B.
     * @returns {Promise<boolean>} Whether a comparison became ready.
     */
    async function generate(options = {}) {
      const item = selectedItem();
      if (!item || state.busy) return false;
      invalidate({ cancel: true, redraw: false });
      const current = comparison();
      const token = ++current.generation;
      current.status = "generating";
      current.sourceItemId = item.id;
      current.sourceRevision = Number(item.processingRevision || 0);
      current.message = text("candidateGenerating");
      render();
      try {
        await processItem(item, { preview: false });
        if (token !== current.generation || item !== selectedItem()) return false;
        const baselineParameters = sessionCore.normalizeProcessingParameters(item.processingParameters);
        const baselineQuality = await analyzeBaseline(item);
        const estimatedBackground = estimateBackgroundColor(
          item.sourceImageData.data,
          item.sourceImageData.width,
          item.sourceImageData.height,
        );
        let suggestion;
        if (options.preset) {
          const parameters = sessionCore.normalizeProcessingParameters(
            options.preset.parameters,
            baselineParameters,
          );
          const manualBackground = Boolean(item.seedPoints?.length);
          suggestion = {
            parameters,
            backgroundSamples: manualBackground
              ? cloneValue(item.backgroundSamples || [])
              : [normalizeColor(colorUtils.hexToRgb(parameters.backgroundColor))],
            seedPoints: cloneValue(item.seedPoints || []),
            reasonCodes: ["preset"],
          };
        } else {
          suggestion = candidateCore.createSuggestedCandidate({
            parameters: baselineParameters,
            quality: baselineQuality,
            metric: item.qualityMetrics,
            backgroundSamples: item.backgroundSamples,
            seedPoints: item.seedPoints,
            estimatedBackground,
          });
        }
        const differences = candidateCore.diffProcessingParameters(baselineParameters, suggestion.parameters);
        if (!differences.length) {
          current.status = "idle";
          current.message = text("candidateNoDifference");
          render();
          return false;
        }
        const { width, height, data } = item.sourceImageData;
        const result = await cutoutExecutor.process(
          data,
          width,
          height,
          candidateProcessingOptions(item, suggestion),
          item.repairs || [],
        );
        if (token !== current.generation || item !== selectedItem()) return false;
        current.variants = {
          a: {
            parameters: baselineParameters,
            backgroundSamples: cloneValue(item.backgroundSamples || []),
            seedPoints: cloneValue(item.seedPoints || []),
            canvas: item.resultCanvas,
            metric: item.qualityMetrics,
            reasonCodes: ["current-settings"],
            differences: [],
          },
          b: {
            ...suggestion,
            canvas: resultCanvas(result, width, height),
            metric: result.qualityMetrics,
            differences,
          },
        };
        current.status = "ready";
        current.displayMode = "split";
        current.activeVariant = "b";
        current.splitRatio = 0.5;
        current.message = options.preset
          ? text("candidatePresetLoaded", { name: options.preset.name })
          : text("candidateReady");
        render();
        renderPreview();
        return true;
      } catch (error) {
        if (token !== current.generation || error?.name === "AbortError") return false;
        current.status = "error";
        current.message = error?.message || String(error);
        setStatus?.(current.message, "error");
        render();
        return false;
      }
    }

    /** @returns {Promise<boolean>} Applies the active candidate to the chosen target scope. */
    async function applyActive() {
      const current = comparison();
      const sourceItem = selectedItem();
      const variant = current.variants?.[current.activeVariant];
      if (!sourceItem || sourceItem.id !== current.sourceItemId || !variant) return false;
      const targets = resolveCandidateTargets(state, elements.cutoutCandidateScope.value);
      if (!targets.length) return false;
      if (targets.length > 1) {
        const confirmed = await requestConfirmation(
          text("candidateApplyConfirm", {
            variant: current.activeVariant.toUpperCase(),
            count: targets.length,
          }),
          [],
        );
        if (!confirmed) return false;
      }
      const variantName = current.activeVariant.toUpperCase();
      sessionCore.applyAutomaticCandidate(targets, sourceItem, variant, {
        live: false,
        mapSeedPoints: true,
      });
      state.previewMode = "result";
      state.thumbnailRevision += 1;
      if (targets.includes(sourceItem)) applyProcessingParametersToControls(variant.parameters);
      invalidate({ cancel: false, redraw: false });
      renderQueue();
      renderPreview();
      scheduleBatchThumbnails();
      refreshQualityAnalysis();
      setStatus(text("candidateApplied", { variant: variantName, count: targets.length }), "success");
      return true;
    }

    /** @returns {Promise<boolean>} Saves the active candidate as a local preset. */
    async function savePreset() {
      const current = comparison();
      const variant = current.variants?.[current.activeVariant];
      if (!variant) {
        setStatus(text("candidatePresetNeedsComparison"), "error");
        return false;
      }
      const name = elements.cutoutCandidatePresetName.value.trim();
      const existing = presetStore.list().find((preset) => preset.name === name);
      if (existing) {
        const confirmed = await requestConfirmation(text("candidatePresetOverwrite", { name }), []);
        if (!confirmed) return false;
      }
      try {
        const saved = presetStore.save({
          id: existing?.id,
          name,
          parameters: variant.parameters,
        });
        elements.cutoutCandidatePresetName.value = "";
        renderPresets();
        elements.cutoutCandidatePresetSelect.value = saved.id;
        setStatus(text("candidatePresetSaved", { name: saved.name }), "success");
        return true;
      } catch (error) {
        setStatus(error.message, "error");
        return false;
      }
    }

    /** @returns {Promise<boolean>} Loads the selected preset into candidate B. */
    async function loadPreset() {
      const preset = presetStore
        .list()
        .find((entry) => entry.id === elements.cutoutCandidatePresetSelect.value);
      return preset ? generate({ preset }) : false;
    }

    /** @returns {Promise<boolean>} Deletes the selected local preset. */
    async function deletePreset() {
      const preset = presetStore
        .list()
        .find((entry) => entry.id === elements.cutoutCandidatePresetSelect.value);
      if (!preset) return false;
      const confirmed = await requestConfirmation(
        text("candidatePresetDeleteConfirm", { name: preset.name }),
        [],
      );
      if (!confirmed) return false;
      try {
        presetStore.remove(preset.id);
        renderPresets();
        setStatus(text("candidatePresetDeleted", { name: preset.name }), "success");
        return true;
      } catch (error) {
        setStatus(error.message, "error");
        return false;
      }
    }

    /** @param {PointerEvent} event Divider pointer event. @returns {void} */
    function moveDivider(event) {
      const bounds = elements.cutoutResult.getBoundingClientRect();
      if (!bounds.width) return;
      setSplitRatio((event.clientX - bounds.left) / bounds.width);
    }

    /** Binds candidate controls once. @returns {void} */
    function bind() {
      elements.cutoutCandidateGenerate.addEventListener("click", () => generate());
      elements.cutoutCandidateExit.addEventListener("click", () => invalidate());
      elements.cutoutCandidateViewA.addEventListener("click", () => setDisplayMode("a"));
      elements.cutoutCandidateViewSplit.addEventListener("click", () => setDisplayMode("split"));
      elements.cutoutCandidateViewB.addEventListener("click", () => setDisplayMode("b"));
      elements.cutoutCandidateSplitRange.addEventListener("input", () => {
        setSplitRatio(Number(elements.cutoutCandidateSplitRange.value) / 100);
      });
      elements.cutoutCandidateScope.addEventListener("change", render);
      elements.cutoutCandidateApply.addEventListener("click", () => applyActive());
      elements.cutoutCandidatePresetSave.addEventListener("click", () => savePreset());
      elements.cutoutCandidatePresetLoad.addEventListener("click", () => loadPreset());
      elements.cutoutCandidatePresetDelete.addEventListener("click", () => deletePreset());
      elements.cutoutCandidateDivider.addEventListener("pointerdown", (event) => {
        comparison().draggingDivider = true;
        elements.cutoutCandidateDivider.setPointerCapture?.(event.pointerId);
        moveDivider(event);
      });
      elements.cutoutCandidateDivider.addEventListener("pointermove", (event) => {
        if (comparison().draggingDivider) moveDivider(event);
      });
      ["pointerup", "pointercancel"].forEach((eventName) => {
        elements.cutoutCandidateDivider.addEventListener(eventName, () => {
          comparison().draggingDivider = false;
        });
      });
      elements.cutoutCandidateDivider.addEventListener("keydown", (event) => {
        const delta = event.key === "ArrowLeft" ? -0.01 : event.key === "ArrowRight" ? 0.01 : 0;
        if (!delta && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        setSplitRatio(
          event.key === "Home" ? 0.05 : event.key === "End" ? 0.95 : comparison().splitRatio + delta,
        );
      });
      render();
    }

    return Object.freeze({
      applyActive,
      bind,
      deletePreset,
      generate,
      invalidate,
      loadPreset,
      render,
      savePreset,
      setDisplayMode,
      setSplitRatio,
    });
  }

  return Object.freeze({ createController, resolveCandidateTargets });
});
