(function attachBatchCutoutPreview(root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutPreview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const MIN_PREVIEW_ZOOM = 0.12;
  const MAX_PREVIEW_ZOOM = 8;

  /**
   * Calculates the same padded fit zoom used by the frame-tuning stage.
   * @param {number} canvasWidth Preview canvas width in backing pixels.
   * @param {number} canvasHeight Preview canvas height in backing pixels.
   * @param {number} sourceWidth Source image width.
   * @param {number} sourceHeight Source image height.
   * @param {number} [pixelRatio=1] Canvas device-pixel ratio.
   * @returns {number} Clamped CSS-pixel zoom, independent of the backing-store pixel ratio.
   */
  function calculateFitScale(canvasWidth, canvasHeight, sourceWidth, sourceHeight, pixelRatio = 1) {
    const safePixelRatio = Math.max(1, Number(pixelRatio) || 1);
    const cssCanvasWidth = canvasWidth / safePixelRatio;
    const cssCanvasHeight = canvasHeight / safePixelRatio;
    const horizontalPadding = Math.max(96, cssCanvasWidth * 0.14);
    const verticalPadding = Math.max(72, cssCanvasHeight * 0.14);
    const fitScale = Math.min(
      (cssCanvasWidth - horizontalPadding) / sourceWidth,
      (cssCanvasHeight - verticalPadding) / sourceHeight,
    );
    return Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, fitScale));
  }

  /**
   * Calculates the drawing transform for a preview source.
   * @param {{canvasWidth:number,canvasHeight:number,sourceWidth:number,sourceHeight:number,fitScale:number|null,scale:number|null,panX:number,panY:number,pixelRatio?:number}} options View inputs.
   * @returns {{sourceWidth:number,sourceHeight:number,fitScale:number,scale:number,renderScale:number,pixelRatio:number,offsetX:number,offsetY:number}} Preview transform.
   */
  function calculateView(options) {
    const sourceWidth = Math.max(1, Number(options.sourceWidth) || 1);
    const sourceHeight = Math.max(1, Number(options.sourceHeight) || 1);
    const pixelRatio = Math.max(1, Number(options.pixelRatio) || 1);
    const measuredFitScale = calculateFitScale(
      options.canvasWidth,
      options.canvasHeight,
      sourceWidth,
      sourceHeight,
      pixelRatio,
    );
    const fitScale = options.fitScale ?? measuredFitScale;
    const scale = options.scale ?? fitScale;
    const renderScale = scale * pixelRatio;
    return {
      sourceWidth,
      sourceHeight,
      fitScale,
      scale,
      renderScale,
      pixelRatio,
      offsetX: (options.canvasWidth - sourceWidth * renderScale) / 2 + options.panX,
      offsetY: (options.canvasHeight - sourceHeight * renderScale) / 2 + options.panY,
    };
  }

  /**
   * Creates the shared cutout preview viewport controller.
   * @param {{elements:Record<string,HTMLElement>,state:Record<string,any>,renderPreview:()=>void,getDevicePixelRatio?:()=>number}} dependencies Host integration dependencies.
   * @returns {{drawPreviewCanvas:(target:HTMLCanvasElement,source:CanvasImageSource|null)=>void,drawComparisonCanvas:(target:HTMLCanvasElement,left:CanvasImageSource|null,right:CanvasImageSource|null,splitRatio:number)=>void,renderPreviewZoom:()=>void,setPreviewScale:(scale:number|null,target?:HTMLCanvasElement|null,canvasPoint?:{x:number,y:number}|null)=>void,previewCanvasPoint:(event:PointerEvent|WheelEvent,target:HTMLCanvasElement)=>{x:number,y:number},previewSourcePoint:(event:PointerEvent|WheelEvent,target:HTMLCanvasElement)=>{canvasX:number,canvasY:number,sourceX:number,sourceY:number}|null}}
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
      const measuredFitScale = calculateFitScale(width, height, sourceWidth, sourceHeight, pixelRatio);
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
        pixelRatio,
      });
      context.imageSmoothingEnabled = false;
      context.drawImage(
        source,
        view.offsetX,
        view.offsetY,
        sourceWidth * view.renderScale,
        sourceHeight * view.renderScale,
      );
      target._cutoutView = view;
    }

    /**
     * Draws two same-sized candidate canvases through one shared viewport.
     * Candidate A occupies the left side and candidate B the clipped right side.
     * @param {HTMLCanvasElement} target Preview canvas.
     * @param {CanvasImageSource|null} left Candidate A source.
     * @param {CanvasImageSource|null} right Candidate B source.
     * @param {number} splitRatio Divider position from zero to one.
     * @returns {void}
     */
    function drawComparisonCanvas(target, left, right, splitRatio = 0.5) {
      const source = left || right;
      if (!source) {
        drawPreviewCanvas(target, null);
        return;
      }
      drawPreviewCanvas(target, left || source);
      if (!right || !target._cutoutView) return;
      const context = target.getContext("2d");
      if (!context) return;
      const view = target._cutoutView;
      const ratio = Math.max(0.05, Math.min(0.95, Number(splitRatio) || 0.5));
      const dividerX = target.width * ratio;
      context.save();
      context.beginPath();
      context.rect(dividerX, 0, target.width - dividerX, target.height);
      context.clip();
      context.imageSmoothingEnabled = false;
      context.drawImage(
        right,
        view.offsetX,
        view.offsetY,
        view.sourceWidth * view.renderScale,
        view.sourceHeight * view.renderScale,
      );
      context.restore();
    }

    /** Updates zoom controls from the current preview transform. @returns {void} */
    function renderPreviewZoom() {
      const view = elements.cutoutResult._cutoutView || elements.cutoutOriginal._cutoutView;
      const scale = view?.scale || 1;
      const percent = Math.round(scale * 100);
      elements.cutoutZoom.value = String(Math.max(12, Math.min(800, percent)));
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
      const nextScale = Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, Number(scale || 1)));
      if (view && canvasPoint) {
        const sourceX = (canvasPoint.x - view.offsetX) / view.renderScale;
        const sourceY = (canvasPoint.y - view.offsetY) / view.renderScale;
        const nextRenderScale = nextScale * view.pixelRatio;
        const centeredX = (target.width - view.sourceWidth * nextRenderScale) / 2;
        const centeredY = (target.height - view.sourceHeight * nextRenderScale) / 2;
        state.previewPanX = canvasPoint.x - sourceX * nextRenderScale - centeredX;
        state.previewPanY = canvasPoint.y - sourceY * nextRenderScale - centeredY;
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
      const sourceX = (point.x - view.offsetX) / view.renderScale;
      const sourceY = (point.y - view.offsetY) / view.renderScale;
      if (sourceX < 0 || sourceY < 0 || sourceX >= view.sourceWidth || sourceY >= view.sourceHeight) {
        return null;
      }
      return { canvasX: point.x, canvasY: point.y, sourceX, sourceY };
    }

    return {
      drawPreviewCanvas,
      drawComparisonCanvas,
      renderPreviewZoom,
      setPreviewScale,
      previewCanvasPoint,
      previewSourcePoint,
    };
  }

  return { calculateFitScale, calculateView, createController };
});
