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
      core,
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
      tracking,
      localTracking,
    } = dependencies;
    if (
      !state ||
      !elements ||
      !core ||
      typeof processItem !== "function" ||
      typeof selectedItem !== "function"
    ) {
      throw new TypeError("BatchCutoutRepairController dependencies are required.");
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
        const region = core.createProtectedRegionMask(
          item.sourceImageData.data,
          previewData,
          item.sourceImageData.width,
          item.sourceImageData.height,
          rectangle,
          {
            backgroundColors: selectedBackgroundColors(item),
            boundaryStrength,
            padding,
          },
        );
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
      const selection = core.selectProtectedColorsInRectangle(
        item.sourceImageData.data,
        item.sourceImageData.width,
        item.sourceImageData.height,
        rectangle,
        {
          maximumSamples: 5000,
          maximumColors: Math.max(0, 32 - effectiveProtectedColors(item).length),
          coverage: 0.95,
          excludeColors: selectedBackgroundColors(item),
          existingColors: effectiveProtectedColors(item),
          previewData,
        },
      );
      const colors = [];
      for (const color of selection.colors) {
        if (effectiveProtectedColors(item).length + colors.length >= 32) break;
        const duplicate = [...effectiveProtectedColors(item), ...colors].some(
          (candidate) => core.colorDistance(color.r, color.g, color.b, candidate) < 2,
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
      };
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
      const sourceItem = selectedItem();
      if (sourceItem?.pendingAutomaticPropagation) {
        if (!sourceItem.processingParameters) {
          sourceItem.processingParameters = captureProcessingParameters();
        }
        const propagatedCount = sessionCore.propagateAutomaticProcessing(state.items, sourceItem, {
          publishedCanvases: state.items.map((item) => item.publishedCanvas || item.sourceCanvas),
          mapSeedPoints: state.sessionMode === "single",
        });
        refreshQualityAnalysis();
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
        await processItem(sourceItem);
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
      const sourceAnchor =
        repair.localAnchor ||
        localTracking.createLocalAnchor(
          fallbackAnchorData?.data,
          fallbackAnchorData?.width,
          fallbackAnchorData?.height,
          repairCenter,
        );
      const sourceRegion =
        repair.sourceRegion ||
        (isPointRepair && repair.scope !== "global" && fallbackAnchorData
          ? localTracking.measureConnectedRegion(
              fallbackAnchorData.data,
              fallbackAnchorData.width,
              fallbackAnchorData.height,
              repairCenter,
              {
                sourceColor: repair.sourceColor,
                tolerance: repair.tolerance,
              },
            )
          : null);
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
        const trackingState = tracking.createTrackingState(sourceDescriptor);
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
            await processItem(item);
          } catch (error) {
            if (error?.name === "AbortError") return;
            skipped += 1;
            continue;
          }
          const match = useCanvasMapping
            ? {
                candidate: item.shapeDescriptor || sourceDescriptor,
                reacquisitionLevel: 0,
              }
            : tracking.selectTrackedCandidate(sourceDescriptor, item.shapeCandidates, trackingState);
          if (!match) {
            tracking.advanceTrackingState(trackingState, null);
            localFailureStreak += 1;
            skipped += 1;
            continue;
          }
          tracking.advanceTrackingState(trackingState, match.candidate);
          const targetDescriptor = match.candidate;
          const pointGeometry = isPointRepair
            ? { ...repair, points: [{ x: repair.x, y: repair.y }] }
            : repair;
          let mappedGeometry =
            useCanvasMapping && (isBrushRepair || isPointRepair)
              ? tracking.mapCanvasBrushStroke(pointGeometry, sourceItem.sourceImageData, item.sourceImageData)
              : useCanvasMapping
                ? tracking.mapCanvasRectangle(repair, sourceItem.sourceImageData, item.sourceImageData)
                : isBrushRepair || isPointRepair
                  ? tracking.mapBrushStroke(pointGeometry, sourceDescriptor, targetDescriptor)
                  : tracking.mapRectangle(repair, sourceDescriptor, targetDescriptor);
          if ((isBrushRepair || isPointRepair) && !mappedGeometry.points.length) {
            skipped += 1;
            continue;
          }
          let mappedCenter = useCanvasMapping
            ? tracking.mapCanvasPoint(repairCenter, sourceItem.sourceImageData, item.sourceImageData)
            : isBrushRepair || isPointRepair
              ? mappedGeometry.points.reduce(
                  (center, point) => ({
                    x: center.x + point.x / mappedGeometry.points.length,
                    y: center.y + point.y / mappedGeometry.points.length,
                  }),
                  { x: 0, y: 0 },
                )
              : {
                  x: (mappedGeometry.x1 + mappedGeometry.x2) / 2,
                  y: (mappedGeometry.y1 + mappedGeometry.y2) / 2,
                };
          const localPrediction = useCanvasMapping
            ? mappedCenter
            : localAnchor && localAnchorDescriptor
              ? tracking.mapPoint(localAnchor.point, localAnchorDescriptor, targetDescriptor)
              : mappedCenter;
          const transparentRegionMatch =
            !useCanvasMapping && trackTransparentRegion
              ? localTracking.findMatchingTransparentRegion(
                  item.resultImageData.data,
                  item.resultImageData.width,
                  item.resultImageData.height,
                  sourceRegion,
                  localPrediction,
                  {
                    tolerance: repair.tolerance,
                    searchRadius: Math.min(
                      180,
                      Math.max(72, targetDescriptor.minorLength * 0.75 + localFailureStreak * 20),
                    ),
                  },
                )
              : null;
          const localMatch = useCanvasMapping
            ? { matched: true, point: mappedCenter }
            : transparentRegionMatch
              ? { matched: true, point: transparentRegionMatch.point }
              : localAnchor && !trackTransparentRegion
                ? localTracking.trackLocalAnchor(
                    localAnchor,
                    item.resultImageData.data,
                    item.resultImageData.width,
                    item.resultImageData.height,
                    localPrediction,
                    {
                      searchRadius: Math.min(
                        96,
                        Math.max(32, targetDescriptor.minorLength * 0.4 + localFailureStreak * 16),
                      ),
                    },
                  )
                : null;
          if ((isPointRepair || match.reacquisitionLevel > 0) && !localMatch?.matched) {
            localFailureStreak += 1;
            skipped += 1;
            continue;
          }
          if (localMatch?.matched) {
            const offsetX = localMatch.point.x - mappedCenter.x;
            const offsetY = localMatch.point.y - mappedCenter.y;
            mappedGeometry =
              isBrushRepair || isPointRepair
                ? {
                    ...mappedGeometry,
                    points: mappedGeometry.points.map((point) => ({
                      x: point.x + offsetX,
                      y: point.y + offsetY,
                    })),
                  }
                : {
                    ...mappedGeometry,
                    x1: mappedGeometry.x1 + offsetX,
                    y1: mappedGeometry.y1 + offsetY,
                    x2: mappedGeometry.x2 + offsetX,
                    y2: mappedGeometry.y2 + offsetY,
                  };
            mappedCenter = { ...localMatch.point };
            localAnchor = localTracking.createLocalAnchor(
              item.resultImageData.data,
              item.resultImageData.width,
              item.resultImageData.height,
              mappedCenter,
            );
            localAnchorDescriptor = targetDescriptor;
            localFailureStreak = 0;
          } else {
            localFailureStreak += 1;
          }
          if (repair.mode === "protect-color") {
            item.repairs = (item.repairs || []).filter((candidate) => candidate.propagatedFrom !== repairId);
            const existingColors = effectiveProtectedColors(item);
            const selection = core.selectProtectedColorsInRectangle(
              item.sourceImageData.data,
              item.sourceImageData.width,
              item.sourceImageData.height,
              mappedGeometry,
              {
                maximumSamples: 5000,
                maximumColors: Math.max(0, 32 - existingColors.length),
                coverage: 0.95,
                excludeColors: selectedBackgroundColors(item),
                existingColors,
                previewData: item.automaticImageData?.data || item.resultImageData?.data || null,
              },
            );
            const colors = selection.colors
              .filter(
                (color) =>
                  !existingColors.some(
                    (candidate) => core.colorDistance(color.r, color.g, color.b, candidate) < 2,
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
          const backgroundColor = tracking.sampleMatchingColor(
            item.sourceImageData.data,
            item.sourceImageData.width,
            item.sourceImageData.height,
            repair.backgroundColor || selectedBackgroundColor(sourceItem),
            mappedCenter,
            15,
          );
          item.repairs = (item.repairs || []).filter((candidate) => candidate.propagatedFrom !== repairId);
          const mappedRepairGeometry = isPointRepair
            ? { x: mappedCenter.x, y: mappedCenter.y }
            : mappedGeometry;
          const sourceOffset =
            (Math.max(0, Math.min(item.sourceImageData.height - 1, Math.round(mappedCenter.y))) *
              item.sourceImageData.width +
              Math.max(0, Math.min(item.sourceImageData.width - 1, Math.round(mappedCenter.x)))) *
            4;
          const targetSourceColor = isPointRepair
            ? {
                r: item.resultImageData.data[sourceOffset],
                g: item.resultImageData.data[sourceOffset + 1],
                b: item.resultImageData.data[sourceOffset + 2],
                a: item.resultImageData.data[sourceOffset + 3],
              }
            : null;
          let propagatedRegion = null;
          if (isPointRepair && repair.scope !== "global") {
            const regionLimit = sourceRegion
              ? Math.max(sourceRegion.count * 6 + 1, sourceRegion.count + 257)
              : Math.round(item.resultImageData.width * item.resultImageData.height * 0.08);
            propagatedRegion =
              transparentRegionMatch?.region ||
              localTracking.measureConnectedRegion(
                item.resultImageData.data,
                item.resultImageData.width,
                item.resultImageData.height,
                mappedCenter,
                {
                  sourceColor: targetSourceColor,
                  tolerance: repair.tolerance,
                  maximumPixels: regionLimit,
                },
              );
            if (!localTracking.compareConnectedRegions(sourceRegion, propagatedRegion).accepted) {
              skipped += 1;
              continue;
            }
          }
          item.repairs.push({
            ...repair,
            ...mappedRepairGeometry,
            id: root.crypto?.randomUUID?.() || `repair_${Date.now()}_${index}`,
            propagatedFrom: repairId,
            backgroundColor,
            ...(isPointRepair
              ? {
                  sourceColor: targetSourceColor,
                  localAnchor,
                  sourceRegion: propagatedRegion,
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
              { length: state.items.length - state.selectedIndex - 1 },
              (_unused, offset) => state.selectedIndex + offset + 1,
            ),
          ),
          propagateDirection(
            Array.from(
              { length: state.selectedIndex },
              (_unused, offset) => state.selectedIndex - offset - 1,
            ),
          ),
        ]);
      } catch (error) {
        if (error?.name !== "AbortError") {
          setStatus(text("failed", { message: error.message }), "error");
        }
        return;
      }
      renderPreview();
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
