(function attachFrameOrganizerLoop(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerLoop = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const MINIMUM_LOOP_FRAMES = 4;
  const MAX_CACHE_ENTRIES = 12;

  /**
   * Converts an unknown rejection value into a readable error.
   * @param {unknown} reason Rejection reason.
   * @returns {Error}
   */
  function normalizeError(reason) {
    if (reason instanceof Error) return reason;
    return new Error(typeof reason === "string" && reason ? reason : "Unknown loop analysis error");
  }

  /**
   * Creates the complete loop-finder session controller.
   * @param {{
   *   elements:Record<string,HTMLElement>,
   *   state:Record<string,any>,
   *   text:(key:string,variables?:Record<string,string|number>)=>string,
   *   workerClient:{createExecutor:()=>{analyze:Function,cancelAll:()=>void}},
   *   includedFrames:()=>object[],
   *   frameSignature:(frame:object)=>object,
   *   drawFrameToCanvas:(frame:object|null,canvas:HTMLCanvasElement)=>void,
   *   selectIndexes:(indexes:number[])=>void,
   *   playbackDelay:(input:HTMLInputElement)=>number,
   *   renderCounts:()=>void,
   *   restartPreview:()=>void,
   *   setStatus:(message:string,tone?:string)=>void,
   *   onPremiumFeatureUsed?:(featureId:string)=>void,
   *   clamp:(value:number,minimum:number,maximum:number)=>number,
   *   document?:Document,
   *   window?:Window
   * }} dependencies Organizer integration dependencies.
   * @returns {{open:()=>void,close:()=>void,isOpen:()=>boolean,bindEvents:()=>void}}
   */
  function createController(dependencies) {
    if (!dependencies?.elements || !dependencies.state || !dependencies.workerClient) {
      throw new TypeError("Frame organizer loop dependencies are required.");
    }
    const { elements, state, text } = dependencies;
    const documentApi = dependencies.document || root.document;
    const windowApi = dependencies.window || root.window;
    if (!documentApi || !windowApi) throw new Error("Loop finder browser APIs are required.");
    const executor = dependencies.workerClient.createExecutor();
    const resultCache = new Map();
    let eventsBound = false;

    /** @returns {object|null} */
    function currentCandidate() {
      return state.loopCandidates[state.loopCandidateIndex] || null;
    }

    /** @returns {object[]} */
    function currentFrames() {
      const candidate = currentCandidate();
      if (!candidate) return [];
      return state.loopSourceEntries.slice(candidate.start, candidate.end + 1).map((entry) => entry.frame);
    }

    /** @returns {void} */
    function stopPlayback() {
      windowApi.clearTimeout(state.loopTimer);
      state.loopTimer = 0;
      elements.organizerLoopPlay.textContent = text("loopPlay");
    }

    /** @returns {void} */
    function renderPreview() {
      const frames = currentFrames();
      if (!frames.length) {
        dependencies.drawFrameToCanvas(null, elements.organizerLoopCanvas);
        elements.organizerLoopFrameInput.value = "1";
        elements.organizerLoopFrameTotal.textContent = "/ 0";
        elements.organizerLoopFrameRange.max = "1";
        elements.organizerLoopFrameRange.value = "1";
        return;
      }
      state.loopPreviewIndex = ((state.loopPreviewIndex % frames.length) + frames.length) % frames.length;
      const displayIndex = state.loopPreviewIndex + 1;
      dependencies.drawFrameToCanvas(frames[state.loopPreviewIndex], elements.organizerLoopCanvas);
      elements.organizerLoopFrameInput.max = String(frames.length);
      elements.organizerLoopFrameInput.value = String(displayIndex);
      elements.organizerLoopFrameTotal.textContent = `/ ${frames.length}`;
      elements.organizerLoopFrameRange.max = String(frames.length);
      elements.organizerLoopFrameRange.value = String(displayIndex);
    }

    /** @param {number} index Candidate-local frame index. @returns {void} */
    function setPreviewIndex(index) {
      const frames = currentFrames();
      if (!frames.length) return;
      state.loopPreviewIndex = ((Math.round(index) % frames.length) + frames.length) % frames.length;
      renderPreview();
    }

    /** @returns {void} */
    function startPlayback() {
      stopPlayback();
      if (!currentFrames().length) return;
      elements.organizerLoopPlay.textContent = text("loopPause");
      const scheduleNextFrame = () => {
        state.loopTimer = windowApi.setTimeout(() => {
          if (!state.loopTimer) return;
          setPreviewIndex(state.loopPreviewIndex + 1);
          scheduleNextFrame();
        }, dependencies.playbackDelay(elements.organizerLoopSpeed));
      };
      scheduleNextFrame();
    }

    /** @param {number} candidateIndex Ranked candidate index. @returns {void} */
    function selectCandidate(candidateIndex) {
      const candidate = state.loopCandidates[candidateIndex];
      if (!candidate) return;
      stopPlayback();
      state.loopCandidateIndex = candidateIndex;
      state.loopPreviewIndex = 0;
      Array.from(elements.organizerLoopCandidates.children).forEach((button, index) => {
        button.classList.toggle("active", index === candidateIndex);
        button.setAttribute("aria-selected", String(index === candidateIndex));
      });
      dependencies.selectIndexes(
        state.loopSourceEntries.slice(candidate.start, candidate.end + 1).map((entry) => entry.index),
      );
      windowApi.requestAnimationFrame(renderPreview);
    }

    /** @returns {void} */
    function renderCandidates() {
      elements.organizerLoopCandidates.replaceChildren();
      const hasCandidates = state.loopCandidates.length > 0;
      elements.organizerLoopEmpty.hidden = hasCandidates;
      elements.organizerLoopResultContent.hidden = !hasCandidates;
      elements.organizerLoopTrim.hidden = !hasCandidates;
      state.loopCandidates.forEach((candidate, index) => {
        const button = documentApi.createElement("button");
        const period = documentApi.createElement("strong");
        const title = documentApi.createElement("span");
        const details = documentApi.createElement("small");
        button.type = "button";
        button.className = "organizerLoopCandidate";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", "false");
        period.textContent = String(candidate.period).padStart(2, "0");
        title.textContent = text("loopCandidatePeriod", { period: candidate.period });
        details.textContent = `${text("loopCandidateRange", {
          start: candidate.start + 1,
          end: candidate.end + 1,
          count: candidate.length,
        })} · ${text("loopCandidateMetrics", {
          smoothness: Math.round(candidate.smoothness * 100),
          coverage: Math.round(candidate.coverage * 100),
        })}`;
        button.append(period, title, details);
        button.addEventListener("click", () => selectCandidate(index));
        elements.organizerLoopCandidates.appendChild(button);
      });
      if (hasCandidates) selectCandidate(0);
      else renderPreview();
    }

    /** @param {"params"|"search"|"results"} stage Session stage. @returns {void} */
    function setStage(stage) {
      state.loopStage = stage;
      elements.organizerLoopParams.hidden = stage !== "params";
      elements.organizerLoopSearch.hidden = stage !== "search";
      elements.organizerLoopResults.hidden = stage !== "results";
      elements.organizerLoopCancel.hidden = stage === "results";
      elements.organizerLoopRetry.hidden = stage !== "results";
      elements.organizerLoopStartSearch.hidden = stage !== "params";
      elements.organizerLoopTrim.hidden = stage !== "results" || !currentCandidate();
    }

    /** @param {number} current Completed units. @param {number} total Total units. @returns {void} */
    function renderProgress(current, total) {
      const frameCount = Math.max(1, state.loopSourceEntries.length);
      const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
      elements.organizerLoopProgressBar.style.width = `${percentage}%`;
      elements.organizerLoopProgressText.textContent = `${percentage}%`;
      if (current <= frameCount) {
        elements.organizerLoopSearchLabel.textContent = text("loopDecoding", {
          current: Math.min(frameCount, current),
          total: frameCount,
        });
      } else if (current < frameCount * 2) {
        elements.organizerLoopSearchLabel.textContent = text("loopComparing", {
          current: Math.min(frameCount, current - frameCount),
          total: frameCount,
        });
      } else {
        elements.organizerLoopSearchLabel.textContent = text("loopRanking");
      }
    }

    /** @param {Array<{frame:object,index:number}>} entries Source entries. @param {object} options Ranking options. @returns {string} */
    function cacheKey(entries, options) {
      const workset = entries
        .map(({ frame }) => `${frame.uid}:${Number(frame.analysisRevision || 0)}`)
        .join(",");
      return `${workset}|${JSON.stringify(options)}`;
    }

    /** @param {string} key Cache key. @param {object[]} candidates Ranked candidates. @returns {void} */
    function storeResult(key, candidates) {
      resultCache.delete(key);
      resultCache.set(
        key,
        candidates.map((candidate) => ({ ...candidate })),
      );
      while (resultCache.size > MAX_CACHE_ENTRIES) resultCache.delete(resultCache.keys().next().value);
    }

    /** @returns {void} */
    function open() {
      const count = dependencies.includedFrames().length;
      if (count < MINIMUM_LOOP_FRAMES) {
        dependencies.setStatus(text("loopNeedFrames"), "error");
        return;
      }
      stopPlayback();
      state.loopSearchToken += 1;
      state.loopCancelled = false;
      state.loopPreference = "auto";
      state.loopCandidates = [];
      state.loopCandidateIndex = -1;
      state.loopSourceEntries = [];
      elements.organizerLoopStartAuto.checked = true;
      elements.organizerLoopStartCustom.checked = false;
      elements.organizerLoopStartRow.hidden = true;
      elements.organizerLoopStartInput.value = "1";
      elements.organizerLoopStartInput.max = String(count);
      Array.from(elements.organizerLoopPreference.children).forEach((button) => {
        button.classList.toggle("active", button.dataset.loopPreference === "auto");
      });
      renderProgress(0, count * 3);
      setStage("params");
      elements.organizerLoopPanel.hidden = false;
      showDialogError("");
      elements.organizerLoopStartSearch.focus();
    }

    /**
     * Keeps search failures inside the dialog so the overlay no longer hides them.
     * @param {string} message Visible error, or empty to clear.
     * @returns {void}
     */
    function showDialogError(message) {
      const textValue = String(message || "");
      if (elements.organizerLoopError) {
        elements.organizerLoopError.hidden = !textValue;
        elements.organizerLoopError.textContent = textValue;
      }
      if (textValue) dependencies.setStatus(textValue, "error");
    }

    /** @returns {void} */
    function close() {
      state.loopCancelled = true;
      state.loopSearchToken += 1;
      executor.cancelAll();
      state.busy = false;
      stopPlayback();
      elements.organizerLoopPanel.hidden = true;
      dependencies.renderCounts();
      const restoreFocus = elements.organizerFileInput || elements.organizerAddAssets;
      restoreFocus?.focus?.({ preventScroll: true });
    }

    /** @returns {Promise<void>} */
    async function startSearch() {
      dependencies.onPremiumFeatureUsed?.("organizer.loop-finder");
      const sourceEntries = state.frames
        .map((frame, index) => ({ frame, index }))
        .filter((entry) => entry.frame.included);
      if (sourceEntries.length < MINIMUM_LOOP_FRAMES) {
        showDialogError(text("loopNeedFrames"));
        return;
      }
      const searchToken = state.loopSearchToken + 1;
      state.loopSearchToken = searchToken;
      state.loopCancelled = false;
      state.loopSourceEntries = sourceEntries;
      state.busy = true;
      dependencies.renderCounts();
      showDialogError("");
      setStage("search");
      renderProgress(0, sourceEntries.length * 3);
      try {
        const signatures = [];
        for (let index = 0; index < sourceEntries.length; index += 1) {
          if (state.loopCancelled || searchToken !== state.loopSearchToken) return;
          signatures.push(dependencies.frameSignature(sourceEntries[index].frame));
          renderProgress(index + 1, sourceEntries.length * 3);
          if (index % 4 === 3) await new Promise((resolve) => windowApi.setTimeout(resolve, 0));
        }
        const customStart = elements.organizerLoopStartCustom.checked;
        const startFrame = dependencies.clamp(
          Math.round(elements.organizerLoopStartInput.value || 1),
          1,
          sourceEntries.length,
        );
        elements.organizerLoopStartInput.value = String(startFrame);
        const options = {
          minPeriod: 2,
          maxPeriod: Math.max(2, Math.floor((2 * signatures.length) / 3)),
          startFrame: customStart ? startFrame - 1 : 0,
          preference: state.loopPreference,
          boundaryFactor: 0.85,
        };
        const key = cacheKey(sourceEntries, options);
        const cachedCandidates = resultCache.get(key);
        const progressCallbacks = {
          onProgress: (current, total) => {
            if (searchToken === state.loopSearchToken && !state.loopCancelled) {
              renderProgress(current, total);
            }
          },
          isCancelled: () => state.loopCancelled || searchToken !== state.loopSearchToken,
        };
        const candidates = cachedCandidates
          ? cachedCandidates.map((candidate) => ({ ...candidate }))
          : await executor.analyze(signatures, options, progressCallbacks);
        if (!cachedCandidates) storeResult(key, candidates);
        if (state.loopCancelled || searchToken !== state.loopSearchToken) return;
        state.loopCandidates = candidates;
        state.loopCandidateIndex = -1;
        setStage("results");
        renderCandidates();
      } catch (error) {
        if (searchToken !== state.loopSearchToken || state.loopCancelled || error?.name === "AbortError") {
          return;
        }
        setStage("params");
        showDialogError(text("failed", { message: normalizeError(error).message }));
      } finally {
        if (searchToken === state.loopSearchToken) {
          state.busy = false;
          dependencies.renderCounts();
        }
      }
    }

    /** @returns {void} */
    function trim() {
      const candidate = currentCandidate();
      if (!candidate) return;
      const keptEntries = state.loopSourceEntries.slice(candidate.start, candidate.end + 1);
      const keptUids = new Set(keptEntries.map((entry) => entry.frame.uid));
      state.frames.forEach((frame) => {
        frame.included = keptUids.has(frame.uid);
      });
      dependencies.selectIndexes(keptEntries.map((entry) => entry.index));
      dependencies.restartPreview();
      close();
      dependencies.setStatus(
        text("loopTrimmed", {
          start: candidate.start + 1,
          end: candidate.end + 1,
          count: keptEntries.length,
        }),
        "success",
      );
    }

    /** @returns {boolean} */
    function isOpen() {
      return !elements.organizerLoopPanel.hidden;
    }

    /** @returns {void} */
    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;
      elements.organizerLoopPanel.addEventListener("pointerdown", (event) => {
        if (event.target === elements.organizerLoopPanel) close();
      });
      elements.organizerLoopClose.addEventListener("click", close);
      elements.organizerLoopPreference.addEventListener("click", (event) => {
        const button = event.target.closest("[data-loop-preference]");
        if (!button) return;
        state.loopPreference = button.dataset.loopPreference;
        Array.from(elements.organizerLoopPreference.children).forEach((entry) => {
          entry.classList.toggle("active", entry === button);
        });
      });
      [elements.organizerLoopStartAuto, elements.organizerLoopStartCustom].forEach((input) => {
        input.addEventListener("change", () => {
          elements.organizerLoopStartRow.hidden = !elements.organizerLoopStartCustom.checked;
          if (elements.organizerLoopStartCustom.checked) elements.organizerLoopStartInput.focus();
        });
      });
      elements.organizerLoopStartInput.addEventListener("blur", () => {
        const maximum = Math.max(1, state.frames.filter((frame) => frame.included).length);
        elements.organizerLoopStartInput.value = String(
          dependencies.clamp(Math.round(elements.organizerLoopStartInput.value || 1), 1, maximum),
        );
      });
      elements.organizerLoopStartSearch.addEventListener("click", () => {
        startSearch().catch((error) => {
          showDialogError(text("failed", { message: normalizeError(error).message }));
        });
      });
      elements.organizerLoopCancel.addEventListener("click", close);
      elements.organizerLoopRetry.addEventListener("click", () => {
        stopPlayback();
        setStage("params");
        elements.organizerLoopStartSearch.focus();
      });
      elements.organizerLoopTrim.addEventListener("click", trim);
      elements.organizerLoopPrevious.addEventListener("click", () => {
        stopPlayback();
        setPreviewIndex(state.loopPreviewIndex - 1);
      });
      elements.organizerLoopNext.addEventListener("click", () => {
        stopPlayback();
        setPreviewIndex(state.loopPreviewIndex + 1);
      });
      const updateFrameInput = () => {
        stopPlayback();
        const frameCount = Math.max(1, currentFrames().length);
        const value = dependencies.clamp(
          Math.round(elements.organizerLoopFrameInput.value || 1),
          1,
          frameCount,
        );
        setPreviewIndex(value - 1);
      };
      elements.organizerLoopFrameInput.addEventListener("change", updateFrameInput);
      elements.organizerLoopFrameInput.addEventListener("blur", updateFrameInput);
      elements.organizerLoopFrameRange.addEventListener("input", () => {
        stopPlayback();
        setPreviewIndex(Number(elements.organizerLoopFrameRange.value) - 1);
      });
      elements.organizerLoopPlay.addEventListener("click", () => {
        if (state.loopTimer) stopPlayback();
        else startPlayback();
      });
      elements.organizerLoopSpeed.addEventListener("input", () => {
        if (state.loopTimer) startPlayback();
      });
      elements.organizerFindLoop.addEventListener("click", open);
    }

    return { open, close, isOpen, bindEvents };
  }

  return { createController };
});
