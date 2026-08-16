(function attachBatchCutoutRepairController(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutRepairController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the repair-selection and repair-propagation controller.
   * @param {object} dependencies Repair workflow dependencies.
   * @returns {{applyProtectionSelection:(item:object,rectangle:object)=>Promise<boolean>,propagateLatestRepair:()=>Promise<void>}}
   */
  function createController(dependencies = {}) {
    const {
      state,
      elements,
      colorUtils,
      selectionRepairExecutor,
      createSelectionMask,
      encodeSubjectMask,
      detectNativeSubject,
      text,
      processItem,
      selectedItem,
      selectedBackgroundColor,
      selectedBackgroundColors,
      effectiveProtectedColors,
      createColorProtectionPreview,
      recordItemEdit,
      invalidateItem,
      setStatus,
      renderPreview,
      captureProcessingParameters,
      sessionCore,
      refreshQualityAnalysis,
      scheduleBatchThumbnails,
      applyCurrentGroup,
      cutoutAnalysisExecutor,
    } = dependencies;
    if (
      !state ||
      !elements ||
      !colorUtils ||
      !selectionRepairExecutor ||
      !cutoutAnalysisExecutor ||
      typeof createSelectionMask !== "function" ||
      typeof processItem !== "function" ||
      typeof selectedItem !== "function"
    ) {
      throw new TypeError("BatchCutoutRepairController dependencies are required.");
    }

    function engineMessage(error) {
      const code = error?.code || error?.message || "ENGINE_EXECUTION_FAILED";
      if (code === "ENGINE_MEMORY_EXHAUSTED") return text("engineMemoryExhausted");
      if (code === "ENGINE_EXECUTION_FAILED") return text("engineExecutionFailed");
      return code;
    }

    /**
     * Applies either color sampling or an intelligent spatial protection repair.
     * Spatial protection records the coarse rectangle so batch propagation can
     * remap it and redetect the foreground boundary independently in every frame.
     * @param {object} item Active queue item.
     * @param {{x1:number,y1:number,x2:number,y2:number}} rectangle Source-space selection.
     * @returns {Promise<boolean>} Whether a protection operation was created.
     */
    async function applyProtectionSelection(item, rectangle) {
      try {
        await processItem(item);
      } catch (error) {
        if (error?.name !== "AbortError") {
          setStatus(text("failed", { message: error.message }), "error");
        }
        return false;
      }
      const previewData = item.automaticImageData?.data || item.resultImageData?.data || null;
      if (elements.cutoutProtectionType.value === "range") {
        const boundaryStrength = Number(elements.cutoutProtectionBoundary.value);
        const padding = Number(elements.cutoutProtectionPadding.value);
        let region;
        try {
          region =
            typeof detectNativeSubject === "function"
              ? await detectNativeSubject(item.sourceImageData, rectangle).catch(() => null)
              : null;
          region ||= await selectionRepairExecutor.analyze(
            item.sourceImageData.data,
            item.sourceImageData.width,
            item.sourceImageData.height,
            createSelectionMask(rectangle, item.sourceImageData.width, item.sourceImageData.height),
            {
              mode: "protect-range",
              rectangle,
              previewData,
              options: {
                backgroundColors: selectedBackgroundColors(item),
                boundaryStrength,
                padding,
              },
            },
          );
        } catch (error) {
          setStatus(
            text("failed", { message: engineMessage(error) }),
            "error",
          );
          return false;
        }
        if (!region.count) {
          state.protectionPreview = {
            itemId: item.id,
            repairId: "",
            mode: "protect-range",
            rectangle,
            mask: region.mask,
            count: 0,
            bounds: null,
            coarseArea: 0,
            coverage: 0,
            width: item.sourceImageData.width,
            height: item.sourceImageData.height,
          };
          setStatus(text("protectedRangeEmpty"), "error");
          renderPreview();
          return false;
        }
        recordItemEdit(item);
        const repairId = root.crypto?.randomUUID?.() || `repair_${Date.now()}`;
        item.repairs.push({
          id: repairId,
          mode: "protect-range",
          ...rectangle,
          boundaryStrength,
          padding,
          ...(region.subjectMask ? { subjectMask: region.subjectMask } : {}),
        });
        item.undoneRepairs = [];
        state.protectionPreview = {
          itemId: item.id,
          repairId,
          mode: "protect-range",
          rectangle,
          mask: region.mask,
          count: region.count,
          bounds: region.bounds,
          coarseArea: Math.max(1, (rectangle.x2 - rectangle.x1 + 1) * (rectangle.y2 - rectangle.y1 + 1)),
          coverage: region.coverage,
          width: item.sourceImageData.width,
          height: item.sourceImageData.height,
        };
        invalidateItem(item);
        setStatus(
          text("protectedRangeCreated", {
            count: region.count,
            coverage: region.coverage,
          }),
          "success",
        );
        renderPreview();
        return true;
      }
      let selection;
      let samplingMask;
      try {
        const coarseMask = createSelectionMask(
          rectangle,
          item.sourceImageData.width,
          item.sourceImageData.height,
        );
        const nativeSubject =
          typeof detectNativeSubject === "function"
            ? await detectNativeSubject(item.sourceImageData, rectangle).catch(() => null)
            : null;
        const spatialSubject = await selectionRepairExecutor
          .analyze(
            item.sourceImageData.data,
            item.sourceImageData.width,
            item.sourceImageData.height,
            coarseMask,
            {
              mode: "protect-range",
              rectangle,
              previewData,
              options: {
                backgroundColors: selectedBackgroundColors(item),
                boundaryStrength: Number(elements.cutoutProtectionBoundary.value),
                padding: Number(elements.cutoutProtectionPadding.value),
              },
            },
          )
          .catch(() => null);
        samplingMask = nativeSubject?.mask || spatialSubject?.mask || coarseMask;
        if (nativeSubject?.mask && spatialSubject?.mask) {
          const intersection = new Uint8Array(coarseMask.length);
          let intersectionCount = 0;
          for (let index = 0; index < intersection.length; index += 1) {
            if (!nativeSubject.mask[index] || !spatialSubject.mask[index]) continue;
            intersection[index] = 1;
            intersectionCount += 1;
          }
          if (intersectionCount) samplingMask = intersection;
        }
        selection = await selectionRepairExecutor.analyze(
          item.sourceImageData.data,
          item.sourceImageData.width,
          item.sourceImageData.height,
          samplingMask,
          {
            mode: "protect-color",
            rectangle,
            options: {
              maximumSamples: 5000,
              maximumColors: Math.max(0, 32 - effectiveProtectedColors(item).length),
              coverage: 0.95,
              excludeColors: selectedBackgroundColors(item),
              existingColors: effectiveProtectedColors(item),
            },
          },
        );
      } catch (error) {
        setStatus(text("failed", { message: engineMessage(error) }), "error");
        return false;
      }
      const colors = [];
      for (const color of selection.colors) {
        if (effectiveProtectedColors(item).length + colors.length >= 32) break;
        const duplicate = [...effectiveProtectedColors(item), ...colors].some(
          (candidate) => colorUtils.colorDistance(color.r, color.g, color.b, candidate) < 2,
        );
        if (!duplicate) colors.push({ r: color.r, g: color.g, b: color.b });
      }
      const colorPreview = createColorProtectionPreview(
        item.sourceImageData.data,
        item.sourceImageData.width,
        item.sourceImageData.height,
        rectangle,
        colors,
        Number(item.processingParameters?.protectionTolerance ?? elements.cutoutProtectionTolerance.value),
      );
      let repairId = "";
      if (colors.length) {
        recordItemEdit(item);
        repairId = root.crypto?.randomUUID?.() || `repair_${Date.now()}`;
        item.repairs.push({
          id: repairId,
          mode: "protect-color",
          ...rectangle,
          colors,
          ...(typeof encodeSubjectMask === "function"
            ? {
                subjectMask: encodeSubjectMask(samplingMask, rectangle, item.sourceImageData.width),
              }
            : {}),
        });
        item.undoneRepairs = [];
      }
      state.protectionPreview = {
        itemId: item.id,
        repairId,
        mode: "protect-color",
        rectangle,
        mask: colorPreview.mask,
        count: colorPreview.count,
        bounds: colorPreview.bounds,
        coarseArea: colorPreview.coarseArea,
        coverage: colorPreview.coarseArea
          ? Math.round((colorPreview.count * 100) / colorPreview.coarseArea)
          : 0,
        colorCount: colors.length,
        width: item.sourceImageData.width,
        height: item.sourceImageData.height,
      };
      if (!colors.length) {
        setStatus(
          text(selection.count ? "protectedColorsUnchanged" : "protectedRegionEmpty"),
          selection.count ? "idle" : "error",
        );
        renderPreview();
        return false;
      }
      invalidateItem(item);
      const protectionStatusKey = !selection.count
        ? "protectedRegionEmpty"
        : selection.status === 0
          ? "protectedRegionCoverage"
          : "protectedRegionIncomplete";
      setStatus(
        text(protectionStatusKey, {
          count: selection.count,
          coverage: selection.coverage,
        }),
        !selection.count ? "error" : selection.status === 0 ? "success" : "idle",
      );
      renderPreview();
      return selection.count > 0;
    }

    /**
     * Propagates the latest repair with subject pose, local texture, and region-topology tracking.
     * @returns {Promise<void>}
     */
    async function propagateLatestRepair() {
      const stagedSourceItem = state.batchPreviewRepair
        ? state.items.find((item) => item.id === state.batchPreviewRepair.sourceItemId)
        : null;
      const sourceItem = stagedSourceItem || selectedItem();
      const sourceIndex = Math.max(0, state.items.indexOf(sourceItem));
      if (sourceItem?.pendingAutomaticPropagation) {
        if (!sourceItem.processingParameters) {
          sourceItem.processingParameters = captureProcessingParameters();
        }
        const propagatedCount = sessionCore.propagateAutomaticProcessing(state.items, sourceItem, {
          publishedCanvases: state.items.map((item) => item.publishedCanvas || item.sourceCanvas),
          mapSeedPoints: state.sessionMode === "single",
        });
        refreshQualityAnalysis();
        sessionCore.clearBatchRepairPreview(state);
        state.batchPreviewRevision = Number(state.batchPreviewRevision || 0) + 1;
        elements.cutoutModal.dataset.batchPreview = "false";
        elements.cutoutRepairBatch.classList.remove("previewPending");
        elements.cutoutRepairBatch.setAttribute("aria-pressed", "false");
        state.thumbnailRevision += 1;
        renderPreview();
        scheduleBatchThumbnails();
        await applyCurrentGroup({ live: true });
        setStatus(text("automaticCutoutPropagated", { count: propagatedCount }), "success");
        return;
      }
      const repair = sourceItem?.repairs?.at(-1);
      if (!sourceItem || !repair) {
        setStatus(text("batchRepairUnavailable"), "error");
        return;
      }
      try {
        await processItem(sourceItem, { preview: false });
      } catch (error) {
        if (error?.name !== "AbortError") {
          setStatus(text("failed", { message: error.message }), "error");
        }
        return;
      }
      const isBrushRepair = ["brush", "eraser", "restore-source"].includes(repair.mode);
      const isPointRepair = repair.mode === "fill" || repair.mode === "recolor";
      const repairPoints = isBrushRepair && Array.isArray(repair.points) ? repair.points : [];
      const repairCenter = isBrushRepair
        ? repairPoints.reduce(
            (center, point) => ({
              x: center.x + point.x / Math.max(1, repairPoints.length),
              y: center.y + point.y / Math.max(1, repairPoints.length),
            }),
            { x: 0, y: 0 },
          )
        : isPointRepair
          ? { x: repair.x, y: repair.y }
          : {
              x: (repair.x1 + repair.x2) / 2,
              y: (repair.y1 + repair.y2) / 2,
            };
      if (!Number.isFinite(repairCenter.x) || !Number.isFinite(repairCenter.y)) {
        setStatus(text("batchRepairUnavailable"), "error");
        return;
      }
      const sourceDescriptor =
        sourceItem.shapeCandidates.reduce((closest, candidate) => {
          if (!closest) return candidate;
          const candidateDistance = Math.hypot(
            candidate.center.x - repairCenter.x,
            candidate.center.y - repairCenter.y,
          );
          const closestDistance = Math.hypot(
            closest.center.x - repairCenter.x,
            closest.center.y - repairCenter.y,
          );
          return candidateDistance < closestDistance ? candidate : closest;
        }, null) || sourceItem.shapeDescriptor;
      if (!sourceDescriptor) {
        setStatus(text("batchRepairUnavailable"), "error");
        return;
      }
      const fallbackAnchorData = sourceItem.automaticImageData || sourceItem.resultImageData;
      let capturedContext = {};
      if (fallbackAnchorData && (!repair.localAnchor || !repair.sourceRegion)) {
        try {
          capturedContext = await cutoutAnalysisExecutor.captureRepairContext(
            fallbackAnchorData.data,
            fallbackAnchorData.width,
            fallbackAnchorData.height,
            {
              point: repairCenter,
              includeRegion: isPointRepair && repair.scope !== "global",
              regionOptions: { sourceColor: repair.sourceColor, tolerance: repair.tolerance },
            },
          );
        } catch (error) {
          setStatus(engineMessage(error), "error");
          return;
        }
      }
      const sourceAnchor = repair.localAnchor || capturedContext.localAnchor || null;
      const sourceRegion =
        repair.sourceRegion ||
        (isPointRepair && repair.scope !== "global" ? capturedContext.sourceRegion || null : null);
      const trackTransparentRegion = Boolean(
        isPointRepair &&
          repair.scope !== "global" &&
          Number(repair.sourceColor?.a ?? 255) <= 16 &&
          sourceRegion &&
          !sourceRegion.touchesBoundary &&
          !sourceRegion.truncated,
      );
      sessionCore.beginPropagation(state.items, sourceItem, {
        publishedCanvases: state.items.map((item) => item.publishedCanvas || item.sourceCanvas),
      });
      let propagated = 0;
      let skipped = 0;
      const repairId = repair.id || (repair.id = root.crypto?.randomUUID?.() || `repair_${Date.now()}`);
      const useCanvasMapping = state.sessionMode === "single";
      const propagateDirection = async (indices) => {
        let trackingState = null;
        let localAnchor = sourceAnchor;
        let localAnchorDescriptor = sourceDescriptor;
        let localFailureStreak = 0;
        for (const index of indices) {
          const item = state.items[index];
          const previousRepairs = item.repairs || [];
          item.repairs = previousRepairs.filter((candidate) => candidate.propagatedFrom !== repairId);
          if (item.repairs.length !== previousRepairs.length) invalidateItem(item);
          if (sourceItem.automaticCutoutActivated) {
            sessionCore.copyAutomaticProcessingState(item, sourceItem, {
              mapSeedPoints: useCanvasMapping,
            });
          } else {
            item.processingActivated = true;
          }
          try {
            await processItem(item, { preview: false });
          } catch (error) {
            if (error?.name === "AbortError") return;
            skipped += 1;
            continue;
          }
          const mapped = await cutoutAnalysisExecutor.mapRepairTarget(
            item.resultImageData.data,
            item.resultImageData.width,
            item.resultImageData.height,
            {
              sourceDescriptor,
              targetDescriptor: item.shapeDescriptor,
              targetCandidates: item.shapeCandidates,
              trackingState,
              repair,
              repairCenter,
              useCanvasMapping,
              isBrushRepair,
              isPointRepair,
              sourceImage: {
                width: sourceItem.sourceImageData.width,
                height: sourceItem.sourceImageData.height,
              },
              originalData: item.sourceImageData.data,
              localAnchor,
              localAnchorDescriptor,
              sourceRegion,
              trackTransparentRegion,
              localFailureStreak,
              backgroundColor: repair.backgroundColor || selectedBackgroundColor(sourceItem),
            },
          );
          trackingState = mapped.trackingState;
          localFailureStreak = mapped.localFailureStreak;
          if (!mapped.accepted) {
            skipped += 1;
            continue;
          }
          const { mappedGeometry, mappedCenter } = mapped;
          localAnchor = mapped.localAnchor;
          localAnchorDescriptor = mapped.localAnchorDescriptor;
          if (repair.mode === "protect-color") {
            item.repairs = (item.repairs || []).filter((candidate) => candidate.propagatedFrom !== repairId);
            const existingColors = effectiveProtectedColors(item);
            const selection = await selectionRepairExecutor.analyze(
              item.sourceImageData.data,
              item.sourceImageData.width,
              item.sourceImageData.height,
              createSelectionMask(mappedGeometry, item.sourceImageData.width, item.sourceImageData.height),
              {
                mode: "protect-color",
                rectangle: mappedGeometry,
                previewData: item.automaticImageData?.data || item.resultImageData?.data || null,
                options: {
                  maximumSamples: 5000,
                  maximumColors: Math.max(0, 32 - existingColors.length),
                  coverage: 0.95,
                  excludeColors: selectedBackgroundColors(item),
                  existingColors,
                },
              },
            );
            const colors = selection.colors
              .filter(
                (color) =>
                  !existingColors.some(
                    (candidate) => colorUtils.colorDistance(color.r, color.g, color.b, candidate) < 2,
                  ),
              )
              .slice(0, Math.max(0, 32 - existingColors.length))
              .map((color) => ({ r: color.r, g: color.g, b: color.b }));
            if (!colors.length) {
              skipped += 1;
              continue;
            }
            item.repairs.push({
              ...repair,
              ...mappedGeometry,
              id: root.crypto?.randomUUID?.() || `repair_${Date.now()}_${index}`,
              propagatedFrom: repairId,
              colors,
            });
            item.undoneRepairs = [];
            invalidateItem(item);
            propagated += 1;
            continue;
          }
          item.repairs = (item.repairs || []).filter((candidate) => candidate.propagatedFrom !== repairId);
          const mappedRepairGeometry = isPointRepair
            ? { x: mappedCenter.x, y: mappedCenter.y }
            : mappedGeometry;
          item.repairs.push({
            ...repair,
            ...mappedRepairGeometry,
            id: root.crypto?.randomUUID?.() || `repair_${Date.now()}_${index}`,
            propagatedFrom: repairId,
            backgroundColor: mapped.backgroundColor,
            ...(isPointRepair
              ? {
                  sourceColor: mapped.targetSourceColor,
                  localAnchor,
                  sourceRegion: mapped.propagatedRegion,
                }
              : {}),
          });
          item.undoneRepairs = [];
          invalidateItem(item);
          propagated += 1;
        }
      };
      try {
        await Promise.all([
          propagateDirection(
            Array.from(
              { length: state.items.length - sourceIndex - 1 },
              (_unused, offset) => sourceIndex + offset + 1,
            ),
          ),
          propagateDirection(
            Array.from({ length: sourceIndex }, (_unused, offset) => sourceIndex - offset - 1),
          ),
        ]);
      } catch (error) {
        if (error?.name !== "AbortError") {
          setStatus(text("failed", { message: error.message }), "error");
        }
        return;
      }
      renderPreview();
      sessionCore.clearBatchRepairPreview(state);
      state.batchPreviewRevision = Number(state.batchPreviewRevision || 0) + 1;
      elements.cutoutModal.dataset.batchPreview = "false";
      elements.cutoutRepairBatch.classList.remove("previewPending");
      elements.cutoutRepairBatch.setAttribute("aria-pressed", "false");
      scheduleBatchThumbnails();
      await applyCurrentGroup({ live: true });
      setStatus(
        text(state.sessionMode === "single" ? "batchRepairedSingle" : "batchRepaired", {
          count: propagated,
          skipped,
        }),
        "success",
      );
    }

    return { applyProtectionSelection, propagateLatestRepair };
  }

  return { createController };
});
