(function attachFrameOrganizerPreview(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerPreview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the standard workset-preview controller.
   * @param {{
   *   elements:Record<string,HTMLElement>,
   *   state:Record<string,any>,
   *   text:(key:string,variables?:Record<string,string|number>)=>string,
   *   includedFrames:()=>object[],
   *   clamp:(value:number,minimum:number,maximum:number)=>number,
   *   window?:Window
   * }} dependencies Organizer preview dependencies.
   * @returns {{drawFrameToCanvas:(frame:object|null,canvas:HTMLCanvasElement)=>void,renderPreview:()=>void,playbackDelay:(input:HTMLInputElement)=>number,schedulePreviewFrame:()=>void,restartPreview:()=>void}}
   */
  function createController(dependencies) {
    if (
      !dependencies?.elements ||
      !dependencies.state ||
      typeof dependencies.text !== "function" ||
      typeof dependencies.includedFrames !== "function" ||
      typeof dependencies.clamp !== "function"
    ) {
      throw new TypeError("Frame organizer preview dependencies are required.");
    }
    const elements = dependencies.elements;
    const state = dependencies.state;
    const text = dependencies.text;
    const windowApi = dependencies.window || root.window;
    if (!windowApi) throw new Error("A window implementation is required for frame organizer preview.");

    /**
     * Draws one organizer frame into a responsive preview canvas.
     * @param {object|null} frame Frame record to draw.
     * @param {HTMLCanvasElement} canvas Target canvas.
     * @returns {void}
     */
    function applyPreviewAspect(canvas, width, height) {
      const safeWidth = Math.max(1, width);
      const safeHeight = Math.max(1, height);
      const ratio = `${safeWidth} / ${safeHeight}`;
      if (canvas.style) canvas.style.aspectRatio = ratio;
      const stage = canvas.closest?.(".organizerPreviewStage");
      if (!stage?.style) return;
      stage.style.aspectRatio = ratio;
      stage.style.setProperty("--organizer-preview-ratio", String(safeWidth / safeHeight));
    }

    function drawFrameToCanvas(frame, canvas) {
      if (!canvas || typeof canvas.getContext !== "function") return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const preferredSource = frame
        ? state.viewMode === "original"
          ? frame.originalCanvas
          : frame.editedCanvas
        : null;
      const source = preferredSource || frame?.editedCanvas || frame?.originalCanvas || null;
      const sourceWidth = Number(source?.width) || 0;
      const sourceHeight = Number(source?.height) || 0;
      const ratio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1;
      // Size the bitmap from width only. Using clientHeight would re-feed the
      // previous layout box and stretch empty checkerboard under the sprite.
      const boxWidth = Math.max(1, Math.round(canvas.clientWidth || 320));
      const boxHeight = Math.max(1, Math.round(boxWidth / ratio));
      applyPreviewAspect(canvas, sourceWidth || 1, sourceHeight || 1);
      canvas.width = boxWidth;
      canvas.height = boxHeight;
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!source || !sourceWidth || !sourceHeight) return;
      context.imageSmoothingEnabled = false;
      context.drawImage(source, 0, 0, boxWidth, boxHeight);
    }

    /** Draws the currently previewed organizer frame. @returns {void} */
    function renderPreview() {
      const frames = dependencies.includedFrames();
      const normalizedIndex = frames.length
        ? dependencies.clamp(Math.round(Number(state.previewIndex) || 0), 0, frames.length - 1)
        : -1;
      state.previewIndex = normalizedIndex >= 0 ? normalizedIndex : 0;
      const frame = normalizedIndex >= 0 ? frames[normalizedIndex] : null;
      const allFrames = Array.from(state.frames || frames);
      const selectedCount = allFrames.filter((candidate) => candidate.selected).length;
      const sourceIndex = frame ? allFrames.indexOf(frame) : -1;
      elements.organizerPreviewFrame.textContent =
        sourceIndex >= 0
          ? selectedCount
            ? `主选帧：第 ${sourceIndex + 1} 帧 · 共选中 ${selectedCount} 帧`
            : text("previewFrame", { current: normalizedIndex + 1, total: frames.length })
          : text("previewFrameEmpty");
      drawFrameToCanvas(frame, elements.organizerPreview);
    }

    /**
     * Converts a left-to-right speed control value into a frame delay.
     * @param {HTMLInputElement} input Playback speed control.
     * @returns {number} Delay between frames in milliseconds.
     */
    function playbackDelay(input) {
      const minimum = Number(input.min || 40);
      const maximum = Number(input.max || 600);
      const speed = dependencies.clamp(Number(input.value || maximum), minimum, maximum);
      return Math.max(40, minimum + maximum - speed);
    }

    /** Schedules the next workset preview frame using the latest speed value. @returns {void} */
    function schedulePreviewFrame() {
      windowApi.clearTimeout(state.previewTimer);
      state.previewTimer = windowApi.setTimeout(() => {
        const frames = dependencies.includedFrames();
        if (frames.length && !elements.organizerModal.hidden) {
          state.previewIndex = (state.previewIndex + 1) % frames.length;
          renderPreview();
        }
        schedulePreviewFrame();
      }, playbackDelay(elements.organizerSpeed));
    }

    /** Restarts the workset animation preview timer. @returns {void} */
    function restartPreview() {
      windowApi.clearTimeout(state.previewTimer);
      state.previewIndex = 0;
      renderPreview();
      schedulePreviewFrame();
    }

    return { drawFrameToCanvas, renderPreview, playbackDelay, schedulePreviewFrame, restartPreview };
  }

  return { createController };
});
