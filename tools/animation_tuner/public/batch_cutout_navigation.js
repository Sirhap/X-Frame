(function attachBatchCutoutNavigation(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutNavigation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the batch frame navigation, playback, and thumbnail scheduler.
   *
   * The controller owns only navigation-related state transitions. Image
   * processing, queue rendering, and status presentation remain host callbacks
   * so the existing batch controller API and execution order stay unchanged.
   * @param {object} dependencies Navigation dependencies supplied by the host.
   * @param {object} dependencies.state Mutable batch state.
   * @param {object} dependencies.elements Batch-cutout DOM elements.
   * @param {()=>object|null} dependencies.selectedItem Selected queue item resolver.
   * @param {(item:object)=>boolean} dependencies.hasQualityIssue Quality predicate.
   * @param {(parameters:object|null|undefined)=>void} dependencies.applyProcessingParametersToControls Control synchronizer.
   * @param {(mode:string)=>void} dependencies.setRepairMode Active-tool setter.
   * @param {()=>void} dependencies.renderSessionMode Single-edit mode renderer.
   * @param {(message:string,tone?:string)=>void} dependencies.setStatus Status callback.
   * @param {(key:string,variables?:object)=>string} dependencies.text Localized text resolver.
   * @param {()=>void} dependencies.renderQueue Queue renderer.
   * @param {()=>void} dependencies.renderPreview Preview renderer.
   * @param {()=>void} dependencies.renderStatus Status renderer.
   * @param {(item:object)=>void} dependencies.updateQueueCard Queue card updater.
   * @param {(item:object)=>Promise<void>} dependencies.processItem Item processor.
   * @param {Window} [dependencies.windowRef] Window implementation.
   * @returns {{selectBatchIndex:Function,selectNextQualityIssue:Function,stopBatchPlayback:Function,toggleBatchPlayback:Function,scheduleBatchThumbnails:Function}}
   */
  function createController(dependencies = {}) {
    const {
      state,
      elements,
      selectedItem,
      hasQualityIssue,
      applyProcessingParametersToControls,
      setRepairMode,
      renderSessionMode,
      setStatus,
      text,
      renderQueue,
      renderPreview,
      renderStatus,
      updateQueueCard,
      processItem,
      onSelectionChange = () => {},
      windowRef = root?.window || root,
    } = dependencies;
    if (
      !state ||
      !elements?.cutoutQueue ||
      !elements.cutoutModal ||
      typeof selectedItem !== "function" ||
      typeof hasQualityIssue !== "function" ||
      typeof applyProcessingParametersToControls !== "function" ||
      typeof setRepairMode !== "function" ||
      typeof renderSessionMode !== "function" ||
      typeof setStatus !== "function" ||
      typeof text !== "function" ||
      typeof renderQueue !== "function" ||
      typeof renderPreview !== "function" ||
      typeof renderStatus !== "function" ||
      typeof updateQueueCard !== "function" ||
      typeof processItem !== "function"
    ) {
      throw new TypeError("BatchCutoutNavigation dependencies are required.");
    }
    if (!windowRef) throw new TypeError("BatchCutoutNavigation requires a window reference.");

    /**
     * Stops automatic batch preview playback.
     * @returns {void}
     */
    function stopBatchPlayback() {
      windowRef.clearInterval(state.playbackTimer);
      state.playbackTimer = 0;
      state.playing = false;
      renderStatus();
    }

    /**
     * Selects an image in the current batch or single-edit workset.
     * Untouched single-edit images reopen on their original view, while edited
     * images restore the generated result and per-image repair history.
     * @param {number} index Requested zero-based image index.
     * @param {{wrap?:boolean,stopPlayback?:boolean}} [options] Navigation options.
     * @returns {void}
     */
    function selectBatchIndex(index, options = {}) {
      if (!state.items.length) return;
      const total = state.items.length;
      const nextIndex = options.wrap
        ? (Number(index) + total) % total
        : Math.max(0, Math.min(total - 1, Number(index) || 0));
      if (options.stopPlayback !== false) stopBatchPlayback();
      if (nextIndex !== state.selectedIndex) onSelectionChange(nextIndex);
      state.selectedIndex = nextIndex;
      if (state.sessionMode === "single") {
        const targetItem = selectedItem();
        applyProcessingParametersToControls(targetItem?.processingParameters);
        state.previewMode = targetItem?.processingActivated ? "result" : "original";
        state.keyboardRepairPoint = null;
        state.repairDrag = null;
        if (!targetItem?.processingActivated) setRepairMode("automatic");
        renderSessionMode();
        setStatus(
          text(targetItem?.processingActivated ? "singleImageEdited" : "singleImageOriginal", {
            current: nextIndex + 1,
            total,
          }),
          "idle",
        );
      }
      state.samplingProtectedColor = false;
      state.samplingBackgroundColor = false;
      const visibleIndex = state.qualityOnly
        ? state.items.slice(0, nextIndex).filter(hasQualityIssue).length
        : nextIndex;
      elements.cutoutQueue.scrollTop = Math.max(
        0,
        visibleIndex * 175 - elements.cutoutQueue.clientHeight / 2,
      );
      renderQueue();
      renderPreview();
      elements.cutoutQueue.querySelector(`[data-index="${nextIndex}"]`)?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
    }

    /**
     * Selects the next detected anomalous frame, wrapping at the batch end.
     * @returns {void}
     */
    function selectNextQualityIssue() {
      const issueIndices = state.items
        .map((item, index) => (hasQualityIssue(item) ? index : -1))
        .filter((index) => index >= 0);
      if (!issueIndices.length) {
        setStatus(text("qualityNone"), "success");
        return;
      }
      const nextIndex = issueIndices.find((index) => index > state.selectedIndex) ?? issueIndices[0];
      selectBatchIndex(nextIndex);
    }

    /**
     * Toggles a lightweight sequential result preview.
     * @returns {void}
     */
    function toggleBatchPlayback() {
      if (state.playing) {
        stopBatchPlayback();
        return;
      }
      if (state.items.length < 2) return;
      state.playing = true;
      state.playbackTimer = windowRef.setInterval(() => {
        selectBatchIndex(state.selectedIndex + 1, { wrap: true, stopPlayback: false });
      }, 320);
      renderStatus();
    }

    /**
     * Refreshes result thumbnails in small asynchronous slices.
     * Failures are isolated to their own frame.
     * @returns {void}
     */
    function scheduleBatchThumbnails() {
      const job = ++state.thumbnailJob;
      const candidates = state.items.filter(
        (item, index) =>
          !item.excluded &&
          index !== state.selectedIndex &&
          item.thumbnailRevision !== state.thumbnailRevision,
      );
      const processNext = async () => {
        if (job !== state.thumbnailJob || elements.cutoutModal.hidden || !candidates.length) return;
        const item = candidates.shift();
        try {
          await processItem(item);
        } catch (error) {
          if (error?.name === "AbortError") return;
          // Per-frame status is rendered below; one bad image must not stop the batch.
        }
        if (job !== state.thumbnailJob) return;
        updateQueueCard(item);
        if (item !== selectedItem()) {
          item.resultCanvas = null;
          item.automaticImageData = null;
          item.resultImageData = null;
          item.diagnosticCanvases = {};
          item.shapeDescriptor = null;
          item.shapeCandidates = [];
        }
        renderStatus();
        windowRef.setTimeout(processNext, 0);
      };
      windowRef.setTimeout(processNext, 0);
    }

    return {
      selectBatchIndex,
      selectNextQualityIssue,
      stopBatchPlayback,
      toggleBatchPlayback,
      scheduleBatchThumbnails,
    };
  }

  return { createController };
});
