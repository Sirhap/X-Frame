(function attachBatchCutoutGestureController(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutGestureController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the pointer-gesture controller used by the repair preview.
   *
   * The controller owns only gesture coordinates and the temporary canvas
   * snapshot. Repair records and processing remain in the batch controller.
   * @param {object} dependencies Gesture dependencies supplied by the batch controller.
   * @param {object} dependencies.state Mutable batch state.
   * @param {object} dependencies.elements Batch-cutout DOM elements.
   * @param {()=>object|null} dependencies.selectedItem Selected queue item resolver.
   * @param {(event:PointerEvent,canvas:HTMLCanvasElement)=>object|null} dependencies.previewSourcePoint Coordinate mapper.
   * @param {()=>void} dependencies.drawRepairOverlay Repair-selection overlay renderer.
   * @param {()=>void} dependencies.drawProtectionPreview Protection overlay renderer.
   * @param {Window} [dependencies.windowRef] Window implementation.
   * @param {Document} [dependencies.documentRef] Document implementation.
   * @returns {{resultPointerPoint:Function,paintRepairGestureFrame:Function,captureRepairGestureCanvas:Function,scheduleRepairGestureFrame:Function,updateRepairGesture:Function,cancelRepairGestureFrame:Function}}
   */
  function createController(dependencies = {}) {
    const {
      state,
      elements,
      selectedItem,
      previewSourcePoint,
      drawRepairOverlay,
      drawProtectionPreview,
      windowRef = root?.window || root,
      documentRef = root?.document,
    } = dependencies;
    const gesturePreview = root?.BatchCutoutGesturePreview;
    if (
      !state ||
      !elements?.cutoutResult ||
      typeof selectedItem !== "function" ||
      typeof previewSourcePoint !== "function" ||
      typeof drawRepairOverlay !== "function" ||
      typeof drawProtectionPreview !== "function" ||
      !gesturePreview
    ) {
      throw new TypeError("BatchCutoutGestureController dependencies are required.");
    }
    if (!windowRef || !documentRef) {
      throw new TypeError("BatchCutoutGestureController browser references are required.");
    }

    /**
     * Converts result-preview coordinates to source-image coordinates.
     * @param {PointerEvent} event Pointer event.
     * @param {object|null} item Selected queue item.
     * @returns {{canvasX:number,canvasY:number,sourceX:number,sourceY:number}|null}
     */
    function resultPointerPoint(event, item) {
      if (!item) return null;
      return previewSourcePoint(event, elements.cutoutResult);
    }

    /**
     * Repaints only the active result canvas during a pointer gesture.
     * Avoiding queue, status, and async processing work keeps box selection responsive.
     * @returns {void}
     */
    function paintRepairGestureFrame() {
      state.repairRenderFrame = 0;
      const baseCanvas = state.repairGestureCanvas;
      if (!baseCanvas) return;
      const context = elements.cutoutResult.getContext("2d");
      context.clearRect(0, 0, elements.cutoutResult.width, elements.cutoutResult.height);
      context.drawImage(baseCanvas, 0, 0, elements.cutoutResult.width, elements.cutoutResult.height);
      drawRepairOverlay();
      drawProtectionPreview();
      gesturePreview.draw({
        context,
        item: selectedItem(),
        drag: state.repairDrag,
        view: elements.cutoutResult._cutoutView,
        mode: state.repairMode,
        controls: elements,
      });
    }

    /**
     * Captures the already-rendered result canvas once at gesture start.
     * Pointer movement can then repaint the overlay without layout reads,
     * asynchronous processing, or fit-scale recalculation.
     * @returns {void}
     */
    function captureRepairGestureCanvas() {
      const baseCanvas = documentRef.createElement("canvas");
      baseCanvas.width = elements.cutoutResult.width;
      baseCanvas.height = elements.cutoutResult.height;
      baseCanvas.getContext("2d").drawImage(elements.cutoutResult, 0, 0);
      state.repairGestureCanvas = baseCanvas;
    }

    /**
     * Coalesces high-frequency pointer moves into one lightweight canvas repaint.
     * @returns {void}
     */
    function scheduleRepairGestureFrame() {
      if (state.repairRenderFrame) return;
      state.repairRenderFrame = windowRef.requestAnimationFrame(paintRepairGestureFrame);
    }

    /**
     * Updates the active repair gesture from all coalesced pointer samples.
     * @param {PointerEvent} event Pointer event from the result canvas.
     * @returns {boolean} Whether at least one in-bounds sample was accepted.
     */
    function updateRepairGesture(event) {
      const drag = state.repairDrag;
      if (!drag || drag.pointerId !== event.pointerId) return false;
      const samples = [
        ...(typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : []),
        event,
      ];
      let accepted = false;
      for (const sample of samples.length ? samples : [event]) {
        const point =
          resultPointerPoint(sample, selectedItem()) ||
          gesturePreview.clampPointerPoint(sample, elements.cutoutResult);
        if (!point) continue;
        drag.currentX = point.canvasX;
        drag.currentY = point.canvasY;
        drag.sourceCurrentX = point.sourceX;
        drag.sourceCurrentY = point.sourceY;
        accepted = true;
        if (!["brush", "eraser", "restore-source"].includes(state.repairMode)) continue;
        const previous = drag.points.at(-1);
        if (
          !previous ||
          Math.hypot(point.sourceX - previous.x, point.sourceY - previous.y) >=
            Math.max(0.5, (Number(elements.cutoutBrushSize.value) || 1) * 0.25)
        ) {
          drag.points.push({ x: point.sourceX, y: point.sourceY });
        }
      }
      if (accepted) scheduleRepairGestureFrame();
      return accepted;
    }

    /**
     * Cancels a pending gesture-only repaint before committing or abandoning a repair.
     * @param {{restore?:boolean}} [options] Whether to restore the captured base frame.
     * @returns {void}
     */
    function cancelRepairGestureFrame({ restore = false } = {}) {
      if (state.repairRenderFrame) windowRef.cancelAnimationFrame(state.repairRenderFrame);
      state.repairRenderFrame = 0;
      if (restore && state.repairGestureCanvas) {
        const context = elements.cutoutResult.getContext("2d");
        context.clearRect(0, 0, elements.cutoutResult.width, elements.cutoutResult.height);
        context.drawImage(
          state.repairGestureCanvas,
          0,
          0,
          elements.cutoutResult.width,
          elements.cutoutResult.height,
        );
      }
      state.repairGestureCanvas = null;
    }

    return {
      resultPointerPoint,
      paintRepairGestureFrame,
      captureRepairGestureCanvas,
      scheduleRepairGestureFrame,
      updateRepairGesture,
      cancelRepairGestureFrame,
    };
  }

  return { createController };
});
