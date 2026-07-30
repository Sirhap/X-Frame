(function attachBatchCutoutRepairEvents(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutRepairEvents = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the preview canvas and repair gesture event controller.
   * @param {object} dependencies Event dependencies and state.
   * @returns {{createController:Function}} Event controller factory.
   */
  function createController(dependencies = {}) {
    const {
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
    } = dependencies;
    if (!elements || !state) {
      throw new TypeError("BatchCutoutRepairEvents requires elements and state.");
    }

    function bind() {
      elements.cutoutOriginal.addEventListener("pointerdown", (event) => {
        if (beginPreviewPan(event, elements.cutoutOriginal)) return;
        if (state.samplingProtectedColor || state.samplingBackgroundColor) {
          samplePreviewColor(event);
        }
      });
      elements.cutoutResult.addEventListener("pointerdown", (event) => {
        if (beginPreviewPan(event, elements.cutoutResult)) return;
        if (state.samplingProtectedColor || state.samplingBackgroundColor) {
          samplePreviewColor(event);
          return;
        }
        if (state.previewMode !== "result") {
          setStatus(text("diagnosticReadOnly"), "idle");
          return;
        }
        if (elements.cutoutResult.dataset.processing === "true") {
          setStatus(text("processing", { current: 1, total: 1 }), "busy");
          return;
        }
        if (state.repairMode === "automatic") {
          setStatus(text("automaticCutoutApplied"), "success");
          return;
        }
        const item = selectedItem();
        if (!item?.resultImageData && ["fill", "recolor"].includes(state.repairMode)) {
          setStatus(text("processing", { current: 1, total: 1 }), "busy");
          renderPreview();
          return;
        }
        const point =
          resultPointerPoint(event, item) ||
          root.BatchCutoutGesturePreview.clampPointerPoint(event, elements.cutoutResult);
        if (!item || !point) return;
        event.preventDefault();
        elements.cutoutResult.focus({ preventScroll: true });
        elements.cutoutResult.setPointerCapture(event.pointerId);
        captureRepairGestureCanvas();
        state.repairDrag = {
          pointerId: event.pointerId,
          startX: point.canvasX,
          startY: point.canvasY,
          currentX: point.canvasX,
          currentY: point.canvasY,
          sourceStartX: point.sourceX,
          sourceStartY: point.sourceY,
          sourceCurrentX: point.sourceX,
          sourceCurrentY: point.sourceY,
          points: [{ x: point.sourceX, y: point.sourceY }],
        };
        scheduleRepairGestureFrame();
      });
      elements.cutoutResult.addEventListener("pointermove", (event) => {
        if (!state.repairDrag || state.repairDrag.pointerId !== event.pointerId) return;
        event.preventDefault();
        updateRepairGesture(event);
      });
      elements.cutoutResult.addEventListener("pointerup", async (event) => {
        const item = selectedItem();
        const drag = state.repairDrag;
        if (!item || !drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        updateRepairGesture(event);
        cancelRepairGestureFrame({ restore: true });
        state.repairDrag = null;
        item.pendingAutomaticPropagation = false;
        if (["brush", "eraser", "restore-source"].includes(state.repairMode)) {
          const colorHex = elements.cutoutBrushColor.value || "#00c800";
          const brushCenter = drag.points.reduce(
            (center, point) => ({
              x: center.x + point.x / Math.max(1, drag.points.length),
              y: center.y + point.y / Math.max(1, drag.points.length),
            }),
            { x: 0, y: 0 },
          );
          recordItemEdit(item);
          item.repairs.push({
            id: root.crypto?.randomUUID?.() || `repair_${Date.now()}`,
            mode: state.repairMode,
            points: drag.points,
            size: Number(elements.cutoutBrushSize.value),
            hardness: Number(elements.cutoutBrushHardness.value) / 100,
            opacity: Number(elements.cutoutBrushOpacity.value) / 100,
            color: {
              r: Number.parseInt(colorHex.slice(1, 3), 16),
              g: Number.parseInt(colorHex.slice(3, 5), 16),
              b: Number.parseInt(colorHex.slice(5, 7), 16),
            },
            ...createRepairTrackingMetadata(item, brushCenter),
          });
          item.undoneRepairs = [];
          invalidateItem(item);
          setStatus(
            text("repaired", {
              mode: text(state.repairMode === "restore-source" ? "repairSourceMode" : state.repairMode),
            }),
            "success",
          );
          renderPreview();
          return;
        }
        if (state.repairMode === "fill" || state.repairMode === "recolor") {
          const sourceX = Math.max(
            0,
            Math.min(item.resultImageData.width - 1, Math.round(drag.sourceStartX)),
          );
          const sourceY = Math.max(
            0,
            Math.min(item.resultImageData.height - 1, Math.round(drag.sourceStartY)),
          );
          const sourceOffset = (sourceY * item.resultImageData.width + sourceX) * 4;
          const sourceColor = {
            r: item.resultImageData.data[sourceOffset],
            g: item.resultImageData.data[sourceOffset + 1],
            b: item.resultImageData.data[sourceOffset + 2],
            a: item.resultImageData.data[sourceOffset + 3],
          };
          const tolerance = Number(elements.cutoutAreaTolerance.value);
          recordItemEdit(item);
          item.repairs.push({
            id: root.crypto?.randomUUID?.() || `repair_${Date.now()}`,
            mode: state.repairMode,
            x: sourceX,
            y: sourceY,
            sourceColor,
            color: selectedAreaColor(),
            tolerance,
            scope: state.repairMode === "fill" ? "connected" : elements.cutoutAreaScope.value,
            ...createRepairTrackingMetadata(
              item,
              { x: sourceX, y: sourceY },
              {
                includeRegion: state.repairMode === "fill" || elements.cutoutAreaScope.value !== "global",
                tolerance,
                sourceColor,
              },
            ),
          });
          item.undoneRepairs = [];
          invalidateItem(item);
          setStatus(
            text("repaired", {
              mode: text(state.repairMode === "fill" ? "repairFillMode" : "repairRecolorMode"),
            }),
            "success",
          );
          renderPreview();
          return;
        }
        if (
          Math.abs(drag.sourceCurrentX - drag.sourceStartX) < 2 &&
          Math.abs(drag.sourceCurrentY - drag.sourceStartY) < 2
        ) {
          renderPreview();
          return;
        }
        if (state.repairMode === "protect") {
          await applyProtectionSelection(item, {
            x1: drag.sourceStartX,
            y1: drag.sourceStartY,
            x2: drag.sourceCurrentX,
            y2: drag.sourceCurrentY,
          });
          return;
        }
        recordItemEdit(item);
        item.repairs.push({
          id: root.crypto?.randomUUID?.() || `repair_${Date.now()}`,
          mode: state.repairMode,
          x1: drag.sourceStartX,
          y1: drag.sourceStartY,
          x2: drag.sourceCurrentX,
          y2: drag.sourceCurrentY,
          backgroundColor: { ...selectedBackgroundColor(item) },
          tolerance: Number(elements.cutoutTolerance.value),
          feather: Number(elements.cutoutFeather.value),
          ...createRepairTrackingMetadata(item, {
            x: (drag.sourceStartX + drag.sourceCurrentX) / 2,
            y: (drag.sourceStartY + drag.sourceCurrentY) / 2,
          }),
        });
        item.undoneRepairs = [];
        invalidateItem(item);
        const modeKey =
          state.repairMode === "clear"
            ? "repairClearMode"
            : state.repairMode === "restore"
              ? "repairRestoreMode"
              : "repairSmartMode";
        setStatus(text("repaired", { mode: text(modeKey) }), "success");
        renderPreview();
      });
      elements.cutoutResult.addEventListener("pointercancel", (event) =>
        root.BatchCutoutGesturePreview.commitLostPointer(elements.cutoutResult, event),
      );
      elements.cutoutResult.addEventListener("lostpointercapture", (event) =>
        root.BatchCutoutGesturePreview.commitLostPointer(elements.cutoutResult, event),
      );
      elements.cutoutResult.addEventListener("keydown", async (event) => {
        const item = selectedItem();
        if (!item || state.previewMode !== "result") return;
        const { width, height } = item.sourceImageData;
        const point = state.keyboardRepairPoint || { x: Math.floor(width / 2), y: Math.floor(height / 2) };
        const step = event.shiftKey ? 10 : 1;
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          elements.cutoutZoomIn.click();
          return;
        }
        if (event.key === "-") {
          event.preventDefault();
          elements.cutoutZoomOut.click();
          return;
        }
        const deltas = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        if (deltas[event.key]) {
          event.preventDefault();
          point.x = Math.max(0, Math.min(width - 1, point.x + deltas[event.key][0]));
          point.y = Math.max(0, Math.min(height - 1, point.y + deltas[event.key][1]));
          state.keyboardRepairPoint = point;
          setStatus(`Keyboard repair cursor: ${point.x + 1}, ${point.y + 1}`, "idle");
          return;
        }
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (state.repairMode === "automatic") {
          setRepairMode("automatic");
          return;
        }
        item.pendingAutomaticPropagation = false;
        const radius = Math.max(2, Math.round(Number(elements.cutoutBrushSize.value) / 2));
        if (state.repairMode !== "protect") recordItemEdit(item);
        if (["brush", "eraser", "restore-source"].includes(state.repairMode)) {
          const colorHex = elements.cutoutBrushColor.value || "#00c800";
          item.repairs.push({
            id: root.crypto?.randomUUID?.() || `repair_${Date.now()}`,
            mode: state.repairMode,
            points: [{ x: point.x, y: point.y }],
            size: radius * 2,
            hardness: Number(elements.cutoutBrushHardness.value) / 100,
            opacity: Number(elements.cutoutBrushOpacity.value) / 100,
            color: {
              r: Number.parseInt(colorHex.slice(1, 3), 16),
              g: Number.parseInt(colorHex.slice(3, 5), 16),
              b: Number.parseInt(colorHex.slice(5, 7), 16),
            },
            ...createRepairTrackingMetadata(item, point),
          });
        } else if (state.repairMode === "fill" || state.repairMode === "recolor") {
          const sourceOffset = (Math.round(point.y) * width + Math.round(point.x)) * 4;
          const sourceColor = {
            r: item.resultImageData.data[sourceOffset],
            g: item.resultImageData.data[sourceOffset + 1],
            b: item.resultImageData.data[sourceOffset + 2],
            a: item.resultImageData.data[sourceOffset + 3],
          };
          const tolerance = Number(elements.cutoutAreaTolerance.value);
          item.repairs.push({
            id: root.crypto?.randomUUID?.() || `repair_${Date.now()}`,
            mode: state.repairMode,
            x: point.x,
            y: point.y,
            sourceColor,
            color: selectedAreaColor(),
            tolerance,
            scope: state.repairMode === "fill" ? "connected" : elements.cutoutAreaScope.value,
            ...createRepairTrackingMetadata(item, point, {
              includeRegion: state.repairMode === "fill" || elements.cutoutAreaScope.value !== "global",
              tolerance,
              sourceColor,
            }),
          });
        } else if (state.repairMode === "protect") {
          await applyProtectionSelection(item, {
            x1: point.x - radius,
            y1: point.y - radius,
            x2: point.x + radius,
            y2: point.y + radius,
          });
          return;
        } else {
          item.repairs.push({
            id: root.crypto?.randomUUID?.() || `repair_${Date.now()}`,
            mode: state.repairMode,
            x1: point.x - radius,
            y1: point.y - radius,
            x2: point.x + radius,
            y2: point.y + radius,
            backgroundColor: { ...selectedBackgroundColor(item) },
            tolerance: Number(elements.cutoutTolerance.value),
            feather: Number(elements.cutoutFeather.value),
            ...createRepairTrackingMetadata(item, point),
          });
        }
        item.undoneRepairs = [];
        invalidateItem(item);
        renderPreview();
        setStatus(text("repaired", { mode: state.repairMode }), "success");
      });
      [elements.cutoutOriginal, elements.cutoutResult].forEach((canvas) => {
        canvas.addEventListener("wheel", (event) => zoomPreviewAtPointer(event, canvas), { passive: false });
        canvas.addEventListener("pointermove", movePreviewPan);
        canvas.addEventListener("pointerup", endPreviewPan);
        canvas.addEventListener("pointercancel", endPreviewPan);
        canvas.addEventListener("lostpointercapture", endPreviewPan);
      });
      elements.cutoutZoomOut.addEventListener("click", () => {
        const view = elements.cutoutResult._cutoutView || elements.cutoutOriginal._cutoutView;
        if (view) setPreviewScale(view.scale / 1.2);
      });
      elements.cutoutZoomIn.addEventListener("click", () => {
        const view = elements.cutoutResult._cutoutView || elements.cutoutOriginal._cutoutView;
        if (view) setPreviewScale(view.scale * 1.2);
      });
      elements.cutoutZoomFit.addEventListener("click", () => setPreviewScale(null));
      elements.cutoutZoomActual.addEventListener("click", () => setPreviewScale(1));
      elements.cutoutZoom.addEventListener("input", () => {
        setPreviewScale(Number(elements.cutoutZoom.value) / 100);
      });
    }

    return { bind };
  }

  return { createController };
});
