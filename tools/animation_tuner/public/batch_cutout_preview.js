(function attachBatchCutoutPreview(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutPreview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Calculates the drawing transform for a preview source.
   * @param {{canvasWidth:number,canvasHeight:number,sourceWidth:number,sourceHeight:number,fitScale:number|null,scale:number|null,panX:number,panY:number}} options View inputs.
   * @returns {{sourceWidth:number,sourceHeight:number,fitScale:number,scale:number,offsetX:number,offsetY:number}} Preview transform.
   */
  function calculateView(options) {
    const sourceWidth = Math.max(1, Number(options.sourceWidth) || 1);
    const sourceHeight = Math.max(1, Number(options.sourceHeight) || 1);
    const measuredFitScale = Math.min(
      1,
      options.canvasWidth / sourceWidth,
      options.canvasHeight / sourceHeight,
    );
    const fitScale = options.fitScale ?? measuredFitScale;
    const scale = options.scale ?? fitScale;
    return {
      sourceWidth,
      sourceHeight,
      fitScale,
      scale,
      offsetX: (options.canvasWidth - sourceWidth * scale) / 2 + options.panX,
      offsetY: (options.canvasHeight - sourceHeight * scale) / 2 + options.panY,
    };
  }

  /**
   * Creates the shared cutout preview viewport controller.
   * @param {{elements:Record<string,HTMLElement>,state:Record<string,any>,renderPreview:()=>void,getDevicePixelRatio?:()=>number}} dependencies Host integration dependencies.
   * @returns {{drawPreviewCanvas:(target:HTMLCanvasElement,source:CanvasImageSource|null)=>void,renderPreviewZoom:()=>void,setPreviewScale:(scale:number|null,target?:HTMLCanvasElement|null,canvasPoint?:{x:number,y:number}|null)=>void,previewCanvasPoint:(event:PointerEvent|WheelEvent,target:HTMLCanvasElement)=>{x:number,y:number},previewSourcePoint:(event:PointerEvent|WheelEvent,target:HTMLCanvasElement)=>{canvasX:number,canvasY:number,sourceX:number,sourceY:number}|null}}
   */
  function createController(dependencies) {
    if (!dependencies?.elements || !dependencies.state || !dependencies.renderPreview) {
      throw new TypeError("Batch cutout preview dependencies are required.");
    }
    const { elements, state, renderPreview } = dependencies;
    const getDevicePixelRatio =
      dependencies.getDevicePixelRatio || (() => Number(root.devicePixelRatio) || 1);

    /**
     * Draws a source through the shared zoom and pan viewport.
     * @param {HTMLCanvasElement} target Preview canvas.
     * @param {CanvasImageSource|null} source Source canvas or image.
     * @returns {void}
     */
    function drawPreviewCanvas(target, source) {
      const context = target.getContext("2d");
      if (!context) return;
      const rect = target.getBoundingClientRect();
      const pixelRatio = Math.max(1, Number(getDevicePixelRatio()) || 1);
      const width = Math.max(Math.round(320 * pixelRatio), Math.round((rect.width || 480) * pixelRatio));
      const height = Math.max(Math.round(240 * pixelRatio), Math.round((rect.height || 360) * pixelRatio));
      if (target.width !== width || target.height !== height) {
        target.width = width;
        target.height = height;
      }
      context.clearRect(0, 0, width, height);
      target._cutoutView = null;
      if (!source) return;
      const sourceWidth = Number(source.naturalWidth || source.width || 1);
      const sourceHeight = Number(source.naturalHeight || source.height || 1);
      const measuredFitScale = Math.min(1, width / sourceWidth, height / sourceHeight);
      if (target === elements.cutoutResult && state.previewFitScale === null) {
        state.previewFitScale = measuredFitScale;
      }
      const view = calculateView({
        canvasWidth: width,
        canvasHeight: height,
        sourceWidth,
        sourceHeight,
        fitScale: target === elements.cutoutResult ? state.previewFitScale : measuredFitScale,
        scale: state.previewScale,
        panX: state.previewPanX,
        panY: state.previewPanY,
      });
      context.imageSmoothingEnabled = false;
      context.drawImage(
        source,
        view.offsetX,
        view.offsetY,
        sourceWidth * view.scale,
        sourceHeight * view.scale,
      );
      target._cutoutView = view;
    }

    /** Updates zoom controls from the current preview transform. @returns {void} */
    function renderPreviewZoom() {
      const view = elements.cutoutResult._cutoutView || elements.cutoutOriginal._cutoutView;
      const scale = view?.scale || 1;
      const percent = Math.round(scale * 100);
      elements.cutoutZoom.value = String(Math.max(10, Math.min(800, percent)));
      elements.cutoutZoomValue.textContent =
        state.previewScale === null ? `FIT · ${percent}%` : `${percent}%`;
      elements.cutoutZoomFit.classList.toggle("active", state.previewScale === null);
      elements.cutoutZoomActual.classList.toggle(
        "active",
        state.previewScale !== null && Math.abs(state.previewScale - 1) < 0.001,
      );
    }

    /**
     * Sets an absolute preview scale while preserving an optional cursor anchor.
     * @param {number|null} scale Absolute source-pixel scale, or null for fit.
     * @param {HTMLCanvasElement|null} [target] Anchor canvas.
     * @param {{x:number,y:number}|null} [canvasPoint] Anchor point in canvas pixels.
     * @returns {void}
     */
    function setPreviewScale(scale, target = null, canvasPoint = null) {
      const view = target?._cutoutView;
      if (scale === null) {
        state.previewScale = null;
        state.previewFitScale = null;
        state.previewPanX = 0;
        state.previewPanY = 0;
        renderPreview();
        return;
      }
      const nextScale = Math.max(0.1, Math.min(8, Number(scale || 1)));
      if (view && canvasPoint) {
        const sourceX = (canvasPoint.x - view.offsetX) / view.scale;
        const sourceY = (canvasPoint.y - view.offsetY) / view.scale;
        const centeredX = (target.width - view.sourceWidth * nextScale) / 2;
        const centeredY = (target.height - view.sourceHeight * nextScale) / 2;
        state.previewPanX = canvasPoint.x - sourceX * nextScale - centeredX;
        state.previewPanY = canvasPoint.y - sourceY * nextScale - centeredY;
      }
      state.previewScale = nextScale;
      renderPreview();
    }

    /**
     * Converts a pointer event to canvas coordinates.
     * @param {PointerEvent|WheelEvent} event Pointer-like event.
     * @param {HTMLCanvasElement} target Preview canvas.
     * @returns {{x:number,y:number}|null}
     */
    function previewCanvasPoint(event, target) {
      const rect = target.getBoundingClientRect();
      if (
        !Number.isFinite(rect.width) ||
        !Number.isFinite(rect.height) ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        return null;
      }
      return {
        x: ((event.clientX - rect.left) / rect.width) * target.width,
        y: ((event.clientY - rect.top) / rect.height) * target.height,
      };
    }

    /**
     * Converts preview coordinates to source-image coordinates.
     * @param {PointerEvent|WheelEvent} event Pointer-like event.
     * @param {HTMLCanvasElement} target Preview canvas.
     * @returns {{canvasX:number,canvasY:number,sourceX:number,sourceY:number}|null}
     */
    function previewSourcePoint(event, target) {
      const view = target._cutoutView;
      if (!view) return null;
      const point = previewCanvasPoint(event, target);
      if (!point) return null;
      const sourceX = (point.x - view.offsetX) / view.scale;
      const sourceY = (point.y - view.offsetY) / view.scale;
      if (sourceX < 0 || sourceY < 0 || sourceX >= view.sourceWidth || sourceY >= view.sourceHeight) {
        return null;
      }
      return { canvasX: point.x, canvasY: point.y, sourceX, sourceY };
    }

    return { drawPreviewCanvas, renderPreviewZoom, setPreviewScale, previewCanvasPoint, previewSourcePoint };
  }

  return { calculateView, createController };
});
