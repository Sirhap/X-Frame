(function attachXsxbStageView(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBStageView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const MIN_ZOOM = 0.12;
  const MAX_ZOOM = 8;

  /**
   * Creates the main-stage viewport controller.
   * @param {{
   *   stage: HTMLCanvasElement,
   *   stageZoom?: HTMLInputElement|null,
   *   stageZoomValue?: HTMLElement|null,
   *   stageZoomFit?: HTMLElement|null,
   *   stageZoomActual?: HTMLElement|null,
   *   getView:()=>{zoom:number,x:number,y:number},
   *   setView:(view:{zoom:number,x:number,y:number})=>void,
   *   getStageViewMode:()=>"fit"|"actual"|"custom",
   *   setStageViewMode:(mode:"fit"|"actual"|"custom")=>void,
   *   getCurrentGroup:()=>object|null,
   *   getImages:()=>Array<object>,
   *   currentFrameRect:()=>{x:number,y:number,width:number,height:number}|null,
   *   draw:()=>void,
   *   getDevicePixelRatio?:()=>number,
   * }} dependencies Stage elements, state accessors, and rendering callbacks.
   * @returns {{
   *   syncStageZoomControls:()=>void,
   *   unitStageContentRect:()=>({x:number,y:number,width:number,height:number}|null),
   *   centerStageContent:(zoom:number,mode?:"fit"|"actual"|"custom")=>void,
   *   fitView:()=>void,
   *   setStageZoom:(nextZoom:number)=>void,
   *   zoomViewAt:(event:WheelEvent)=>void,
   *   resizeCanvas:()=>void,
   * }} Stage viewport operations.
   */
  function createController(dependencies) {
    const {
      stage,
      stageZoom = null,
      stageZoomValue = null,
      stageZoomFit = null,
      stageZoomActual = null,
      getView,
      setView,
      getStageViewMode,
      setStageViewMode,
      getCurrentGroup,
      getImages,
      currentFrameRect,
      draw,
      getDevicePixelRatio = () => globalThis.devicePixelRatio || 1,
    } = dependencies;

    /**
     * Clamps a requested zoom to the supported stage range.
     * @param {number} zoom Requested zoom.
     * @returns {number} Safe zoom.
     */
    function clampZoom(zoom) {
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom || 1)));
    }

    /** Updates the visible zoom percentage and mode buttons. @returns {void} */
    function syncStageZoomControls() {
      const percent = Math.round(getView().zoom * 100);
      if (stageZoom) stageZoom.value = String(Math.max(12, Math.min(800, percent)));
      if (stageZoomValue) stageZoomValue.textContent = `${percent}%`;
      stageZoomFit?.classList.toggle("active", getStageViewMode() === "fit");
      stageZoomActual?.classList.toggle("active", getStageViewMode() === "actual");
    }

    /**
     * Measures the active frame at unit zoom and zero origin.
     * @returns {{x:number,y:number,width:number,height:number}|null} Unit-space content bounds.
     */
    function unitStageContentRect() {
      if (!getCurrentGroup() || !getImages().length) return null;
      const previousView = getView();
      setView({ zoom: 1, x: 0, y: 0 });
      try {
        return currentFrameRect();
      } finally {
        setView(previousView);
      }
    }

    /**
     * Centers the active frame at a requested zoom level.
     * @param {number} zoom Requested stage zoom.
     * @param {"fit"|"actual"|"custom"} [mode="custom"] View mode.
     * @returns {void}
     */
    function centerStageContent(zoom, mode = "custom") {
      const safeZoom = clampZoom(zoom);
      const rect = unitStageContentRect();
      setStageViewMode(mode);
      if (!rect) {
        setView({ zoom: safeZoom, x: stage.width / 2, y: stage.height / 2 });
      } else {
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        setView({
          zoom: safeZoom,
          x: stage.width / 2 - centerX * safeZoom,
          y: stage.height / 2 - centerY * safeZoom,
        });
      }
      syncStageZoomControls();
    }

    /** Fits the active frame inside the stage with editing room around it. @returns {void} */
    function fitView() {
      const rect = unitStageContentRect();
      if (!rect?.width || !rect?.height) {
        centerStageContent(1, "fit");
        return;
      }
      const pixelRatio = getDevicePixelRatio();
      const horizontalPadding = Math.max(96 * pixelRatio, stage.width * 0.14);
      const verticalPadding = Math.max(72 * pixelRatio, stage.height * 0.14);
      const zoom = Math.min(
        (stage.width - horizontalPadding) / rect.width,
        (stage.height - verticalPadding) / rect.height,
      );
      centerStageContent(zoom, "fit");
    }

    /**
     * Changes zoom while preserving the world point under the stage center.
     * @param {number} nextZoom Requested stage zoom.
     * @returns {void}
     */
    function setStageZoom(nextZoom) {
      const zoom = clampZoom(nextZoom);
      const view = getView();
      const centerX = stage.width / 2;
      const centerY = stage.height / 2;
      const worldX = (centerX - view.x) / view.zoom;
      const worldY = (centerY - view.y) / view.zoom;
      setView({ zoom, x: centerX - worldX * zoom, y: centerY - worldY * zoom });
      setStageViewMode("custom");
      syncStageZoomControls();
      draw();
    }

    /**
     * Zooms around the pointer position from a wheel event.
     * @param {WheelEvent} event Stage wheel event.
     * @returns {void}
     */
    function zoomViewAt(event) {
      const bounds = stage.getBoundingClientRect();
      const pixelRatio = getDevicePixelRatio();
      const px = (event.clientX - bounds.left) * pixelRatio;
      const py = (event.clientY - bounds.top) * pixelRatio;
      const view = getView();
      const before = { x: (px - view.x) / view.zoom, y: (py - view.y) / view.zoom };
      const zoom = clampZoom(view.zoom * (event.deltaY < 0 ? 1.08 : 0.92));
      setView({ zoom, x: px - before.x * zoom, y: py - before.y * zoom });
      setStageViewMode("custom");
      syncStageZoomControls();
      draw();
    }

    /** Resizes the backing canvas and restores the selected view mode. @returns {void} */
    function resizeCanvas() {
      const bounds = stage.getBoundingClientRect();
      const pixelRatio = getDevicePixelRatio();
      stage.width = Math.max(640, Math.floor(bounds.width * pixelRatio));
      stage.height = Math.max(420, Math.floor(bounds.height * pixelRatio));
      if (getStageViewMode() === "actual") centerStageContent(1, "actual");
      else fitView();
      draw();
    }

    return {
      syncStageZoomControls,
      unitStageContentRect,
      centerStageContent,
      fitView,
      setStageZoom,
      zoomViewAt,
      resizeCanvas,
    };
  }

  return { createController };
});
