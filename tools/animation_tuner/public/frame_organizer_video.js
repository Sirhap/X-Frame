(function attachFrameOrganizerVideo(root, factory) {
  "use strict";

  const sequenceOrder =
    root?.FrameSequenceOrder ||
    (typeof module === "object" && module.exports ? require("./frame_sequence_order") : null);
  const api = factory(root, sequenceOrder);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerVideo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root, sequenceOrder) => {
  "use strict";

  if (!sequenceOrder?.nextImportBatchIndex) throw new Error("FrameSequenceOrder is required.");

  const DEFAULT_MAX_DIMENSION = 2048;
  const EXTRACTION_YIELD_INTERVAL = 2;

  /**
   * Keeps a numeric value inside an inclusive range.
   * @param {number|string} value Candidate value.
   * @param {number} minimum Inclusive minimum.
   * @param {number} maximum Inclusive maximum.
   * @returns {number}
   */
  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value) || 0));
  }

  /**
   * Formats seconds as a compact minute timestamp.
   * @param {number} seconds Time in seconds.
   * @returns {string}
   */
  function formatVideoTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds - minutes * 60;
    return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
  }

  /**
   * Calculates normalized video extraction settings without touching the DOM.
   * @param {{duration:number,width:number,height:number,start:number|string,end:number|string,fps:number|string,maxDimension?:number}} input Raw selection values.
   * @returns {{start:number,end:number,fps:number,count:number,pixelCount:number,width:number,height:number}}
   */
  function calculateSelection(input) {
    const duration = Math.max(0, Number(input.duration) || 0);
    const start = clamp(input.start, 0, duration);
    const end = clamp(input.end, 0, duration);
    const fps = clamp(Math.round(Number(input.fps) || 0), 1, 60);
    const count = end > start ? Math.max(1, Math.floor((end - start) * fps)) : 0;
    const sourceWidth = Math.max(0, Number(input.width) || 0);
    const sourceHeight = Math.max(0, Number(input.height) || 0);
    const maxDimension = Math.max(1, Number(input.maxDimension) || DEFAULT_MAX_DIMENSION);
    const scale = Math.min(1, maxDimension / Math.max(1, sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    return { start, end, fps, count, pixelCount: count * width * height, width, height };
  }

  /**
   * Creates the organizer video-import controller.
   * @param {{
   *   elements:Record<string,HTMLElement>,
   *   state:Record<string,any>,
   *   text:(key:string,variables?:Record<string,string|number>)=>string,
   *   formatVideoTime:(seconds:number)=>string,
   *   createFrame:(image:HTMLCanvasElement,options:object)=>object,
   *   renderCounts:()=>void,
   *   renderGrid:()=>void,
   *   restartPreview:()=>void,
   *   setStatus:(message:string,tone?:string)=>void,
   *   setDefaultAnimationName?:(filename:string)=>void,
   *   document?:Document,
   *   window?:Window,
   *   urlApi?:typeof URL
   * }} dependencies Organizer integration dependencies.
   * @returns {{close:(force?:boolean)=>void,loadFile:(file?:File)=>Promise<void>,extract:()=>Promise<void>,syncControls:(changedControl?:string)=>void,bindEvents:()=>void}}
   */
  function createController(dependencies) {
    if (!dependencies?.elements || !dependencies.state) {
      throw new TypeError("Frame organizer video dependencies are required.");
    }
    const elements = dependencies.elements;
    const state = dependencies.state;
    const text = dependencies.text;
    const documentApi = dependencies.document || root.document;
    const windowApi = dependencies.window || root.window;
    const urlApi = dependencies.urlApi || root.URL;
    let eventsBound = false;
    /** @type {AbortController|null} */
    let extractAbortController = null;

    /** @returns {Error} */
    function createAbortError() {
      if (typeof DOMException === "function") {
        return new DOMException("Video extract cancelled.", "AbortError");
      }
      const error = new Error("Video extract cancelled.");
      error.name = "AbortError";
      return error;
    }

    /** @param {AbortSignal} [signal] @returns {void} */
    function throwIfExtractAborted(signal) {
      if (signal?.aborted) throw createAbortError();
    }

    /** @param {string} message @param {string} [tone] @returns {void} */
    function setVideoStatus(message, tone = "idle") {
      elements.organizerVideoStatus.textContent = message;
      elements.organizerVideoStatus.dataset.tone = tone;
    }

    /** @returns {ReturnType<typeof calculateSelection>} */
    function selection() {
      return calculateSelection({
        duration: state.videoDuration,
        width: state.videoWidth,
        height: state.videoHeight,
        start: elements.organizerVideoStart.value,
        end: elements.organizerVideoEnd.value,
        fps: elements.organizerVideoFpsNumber.value,
      });
    }

    /** @param {string} [changedControl] @returns {void} */
    function syncControls(changedControl = "") {
      if (!state.videoDuration) {
        elements.organizerVideoEstimate.textContent = "0";
        elements.organizerVideoExtract.disabled = true;
        return;
      }
      let start = clamp(elements.organizerVideoStart.value, 0, state.videoDuration);
      let end = clamp(elements.organizerVideoEnd.value, 0, state.videoDuration);
      if (start > end) {
        if (changedControl === "start") end = start;
        else start = end;
      }
      const fps = clamp(Math.round(elements.organizerVideoFpsNumber.value), 1, 60);
      elements.organizerVideoStart.value = start.toFixed(2);
      elements.organizerVideoEnd.value = end.toFixed(2);
      elements.organizerVideoStartRange.value = String(start);
      elements.organizerVideoEndRange.value = String(end);
      elements.organizerVideoFps.value = String(fps);
      elements.organizerVideoFpsNumber.value = String(fps);
      const current = selection();
      elements.organizerVideoDuration.textContent = `${(dependencies.formatVideoTime || formatVideoTime)(current.start)} → ${(dependencies.formatVideoTime || formatVideoTime)(current.end)}`;
      elements.organizerVideoEstimate.textContent = String(current.count);
      const invalidRange = current.end <= current.start;
      elements.organizerVideoExtract.disabled = invalidRange || state.videoExtracting;
      if (state.videoExtracting) return;
      if (invalidRange) setVideoStatus(text("videoInvalidRange"), "error");
      else setVideoStatus(text("videoLoaded"), "success");
    }

    /** @param {boolean} [force] When true, close after a finished extract without aborting. @returns {void} */
    function close(force = false) {
      if (state.videoExtracting && !force) extractAbortController?.abort();
      elements.organizerVideoElement.pause();
      elements.organizerVideoElement.removeAttribute("src");
      elements.organizerVideoElement.load();
      if (state.videoUrl) urlApi.revokeObjectURL(state.videoUrl);
      state.videoUrl = "";
      state.videoFileName = "";
      state.videoDuration = 0;
      state.videoWidth = 0;
      state.videoHeight = 0;
      elements.organizerVideoInput.value = "";
      elements.organizerVideoName.textContent = text("videoNoFile");
      elements.organizerVideoMeta.textContent = "—";
      elements.organizerVideoPanel.hidden = true;
      elements.organizerVideoExtract.disabled = true;
    }

    /** @param {File} file @returns {Promise<void>} */
    async function loadFile(file) {
      if (
        !file ||
        !(String(file.type || "").startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name || ""))
      ) {
        dependencies.setStatus(text("videoUnsupported"), "error");
        return;
      }
      if (state.videoUrl) urlApi.revokeObjectURL(state.videoUrl);
      state.videoUrl = urlApi.createObjectURL(file);
      state.videoFileName = file.name;
      dependencies.setDefaultAnimationName?.(file.name);
      const downstreamMenu =
        elements.organizerApply?.parentElement?.querySelector(".organizerDownstreamMenu");
      if (downstreamMenu) downstreamMenu.open = false;
      elements.organizerVideoPanel.hidden = false;
      elements.organizerVideoName.textContent = file.name;
      elements.organizerVideoMeta.textContent = "…";
      elements.organizerVideoElement.src = state.videoUrl;
      setVideoStatus(text("videoLoading"), "busy");
      try {
        await new Promise((resolve, reject) => {
          const video = elements.organizerVideoElement;
          const cleanup = () => {
            video.removeEventListener("loadeddata", handleLoaded);
            video.removeEventListener("error", handleError);
          };
          const handleLoaded = () => {
            cleanup();
            resolve();
          };
          const handleError = () => {
            cleanup();
            reject(new Error(text("videoUnsupported")));
          };
          video.addEventListener("loadeddata", handleLoaded, { once: true });
          video.addEventListener("error", handleError, { once: true });
          video.load();
        });
        const video = elements.organizerVideoElement;
        if (
          !Number.isFinite(video.duration) ||
          video.duration <= 0 ||
          !video.videoWidth ||
          !video.videoHeight
        ) {
          throw new Error(text("videoUnsupported"));
        }
        state.videoDuration = video.duration;
        state.videoWidth = video.videoWidth;
        state.videoHeight = video.videoHeight;
        for (const input of [
          elements.organizerVideoStart,
          elements.organizerVideoEnd,
          elements.organizerVideoStartRange,
          elements.organizerVideoEndRange,
        ]) {
          input.max = String(video.duration);
        }
        elements.organizerVideoStart.value = "0";
        elements.organizerVideoEnd.value = video.duration.toFixed(2);
        elements.organizerVideoStartRange.value = "0";
        elements.organizerVideoEndRange.value = String(video.duration);
        elements.organizerVideoMeta.textContent = `${video.videoWidth}×${video.videoHeight} · ${(dependencies.formatVideoTime || formatVideoTime)(video.duration)}`;
        syncControls();
      } catch (error) {
        elements.organizerVideoExtract.disabled = true;
        setVideoStatus(error.message || text("videoUnsupported"), "error");
      }
    }

    /** @param {number} time @param {AbortSignal} [signal] @returns {Promise<void>} */
    function seekFrame(time, signal) {
      throwIfExtractAborted(signal);
      const video = elements.organizerVideoElement;
      const target = clamp(time, 0, Math.max(0, state.videoDuration - 0.001));
      if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          windowApi.clearTimeout(timeout);
          video.removeEventListener("seeked", handleSeeked);
          video.removeEventListener("error", handleError);
          signal?.removeEventListener("abort", handleAbort);
        };
        const timeout = windowApi.setTimeout(() => {
          cleanup();
          reject(new Error("Video seek timed out."));
        }, 10000);
        const handleSeeked = () => {
          cleanup();
          resolve();
        };
        const handleError = () => {
          cleanup();
          reject(new Error(text("videoUnsupported")));
        };
        const handleAbort = () => {
          cleanup();
          reject(createAbortError());
        };
        video.addEventListener("seeked", handleSeeked, { once: true });
        video.addEventListener("error", handleError, { once: true });
        if (signal) {
          if (signal.aborted) {
            handleAbort();
            return;
          }
          signal.addEventListener("abort", handleAbort, { once: true });
        }
        video.currentTime = target;
      });
    }

    /** @returns {Promise<void>} */
    async function extract() {
      const current = selection();
      if (!current.count || current.end <= current.start) {
        setVideoStatus(text("videoInvalidRange"), "error");
        return;
      }
      state.busy = true;
      state.videoExtracting = true;
      const abortController = new AbortController();
      extractAbortController = abortController;
      const signal = abortController.signal;
      const batchIndex = Number.isInteger(state.nextImportBatchIndex)
        ? state.nextImportBatchIndex
        : sequenceOrder.nextImportBatchIndex(state.frames);
      state.nextImportBatchIndex = batchIndex + 1;
      dependencies.renderCounts();
      syncControls();
      elements.organizerVideoElement.pause();
      const extractedFrames = [];
      const baseName = state.videoFileName.replace(/\.[^.]+$/, "") || "video";
      try {
        for (let index = 0; index < current.count; index += 1) {
          throwIfExtractAborted(signal);
          setVideoStatus(text("videoExtracting", { current: index + 1, total: current.count }), "busy");
          const time = Math.min(current.end - 0.001, current.start + index / current.fps);
          await seekFrame(time, signal);
          throwIfExtractAborted(signal);
          const canvas = documentApi.createElement("canvas");
          canvas.width = current.width;
          canvas.height = current.height;
          canvas
            .getContext("2d", { alpha: true })
            .drawImage(elements.organizerVideoElement, 0, 0, current.width, current.height);
          extractedFrames.push(
            dependencies.createFrame(canvas, {
              sourceType: sequenceOrder.SOURCE_TYPES.VIDEO,
              importBatchIndex: batchIndex,
              importSelectionIndex: index,
              importFilenameIndex: index,
              name: `${baseName}_frame_${String(index + 1).padStart(4, "0")}.png`,
              imported: true,
              reuseCanvas: true,
            }),
          );
          if (index % EXTRACTION_YIELD_INTERVAL === EXTRACTION_YIELD_INTERVAL - 1) {
            await new Promise((resolve) => windowApi.setTimeout(resolve, 0));
            throwIfExtractAborted(signal);
          }
        }
        throwIfExtractAborted(signal);
        state.frames.push(...extractedFrames);
        dependencies.restartPreview();
        close(true);
        dependencies.setStatus(text("videoImported", { count: extractedFrames.length }), "success");
      } catch (error) {
        if (signal.aborted || error?.name === "AbortError") {
          dependencies.setStatus(text("videoCancelled"));
        } else {
          setVideoStatus(text("failed", { message: error.message }), "error");
        }
      } finally {
        if (extractAbortController === abortController) extractAbortController = null;
        state.videoExtracting = false;
        state.busy = false;
        dependencies.renderGrid();
        syncControls();
      }
    }

    /** @returns {void} */
    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;
      elements.organizerVideoReselect.addEventListener("click", () => {
        elements.organizerVideoInput.value = "";
        elements.organizerVideoInput.click();
      });
      elements.organizerVideoInput.addEventListener("change", () => {
        const [file] = Array.from(elements.organizerVideoInput.files || []);
        elements.organizerVideoInput.value = "";
        loadFile(file).catch((error) => setVideoStatus(text("failed", { message: error.message }), "error"));
      });
      elements.organizerVideoClose.addEventListener("click", () => close());
      elements.organizerVideoCancel.addEventListener("click", () => close());
      elements.organizerVideoPanel.addEventListener("pointerdown", (event) => {
        if (event.target === elements.organizerVideoPanel) close();
      });
      elements.organizerVideoExtract.addEventListener("click", extract);
      elements.organizerVideoStart.addEventListener("input", () => {
        elements.organizerVideoStartRange.value = elements.organizerVideoStart.value;
        syncControls("start");
      });
      elements.organizerVideoEnd.addEventListener("input", () => {
        elements.organizerVideoEndRange.value = elements.organizerVideoEnd.value;
        syncControls("end");
      });
      elements.organizerVideoStartRange.addEventListener("input", () => {
        elements.organizerVideoStart.value = elements.organizerVideoStartRange.value;
        elements.organizerVideoElement.currentTime = Number(elements.organizerVideoStartRange.value);
        syncControls("start");
      });
      elements.organizerVideoEndRange.addEventListener("input", () => {
        elements.organizerVideoEnd.value = elements.organizerVideoEndRange.value;
        elements.organizerVideoElement.currentTime = Number(elements.organizerVideoEndRange.value);
        syncControls("end");
      });
      elements.organizerVideoFps.addEventListener("input", () => {
        elements.organizerVideoFpsNumber.value = elements.organizerVideoFps.value;
        syncControls("fps");
      });
      elements.organizerVideoFpsNumber.addEventListener("input", () => {
        elements.organizerVideoFps.value = elements.organizerVideoFpsNumber.value;
        syncControls("fps");
      });
    }

    return { close, loadFile, extract, syncControls, bindEvents };
  }

  return { calculateSelection, formatVideoTime, createController };
});
