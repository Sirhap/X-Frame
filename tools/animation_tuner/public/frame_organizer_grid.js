(function attachFrameOrganizerGrid(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerGrid = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the frame-grid controller.
   * @param {{
   *   elements:Record<string,HTMLElement>,
   *   state:Record<string,any>,
   *   text:(key:string,variables?:Record<string,string|number>)=>string,
   *   getCurrentAnimation:()=>object|null,
   *   canAddAssets:()=>boolean,
   *   canExport:()=>boolean,
   *   browserExportOnly?:boolean,
   *   editImportCutout:(frame:object)=>Promise<void>,
   *   renderPreview:()=>void,
   *   restartPreview:()=>void,
   *   setStatus:(message:string,tone?:string)=>void,
   *   document?:Document
   * }} dependencies Organizer integration dependencies.
   * @returns {{renderCounts:()=>void,renderGrid:()=>void,selectFrame:(index:number,event:MouseEvent|object)=>void,selectIndexes:(indexes:number[],analysisType?:"jump"|"duplicate"|"")=>void}}
   */
  function createController(dependencies) {
    if (!dependencies?.elements || !dependencies.state || typeof dependencies.text !== "function") {
      throw new TypeError("Frame organizer grid dependencies are required.");
    }
    const elements = dependencies.elements;
    const state = dependencies.state;
    const text = dependencies.text;
    const documentApi = dependencies.document || root.document;

    /** @returns {object[]} Frames included in the active workset. */
    function includedFrames() {
      return state.frames.filter((frame) => frame.included);
    }

    /** @returns {object[]} Selected frame records. */
    function selectedFrames() {
      return state.frames.filter((frame) => frame.selected);
    }

    /** Updates workset counts and action availability. @returns {void} */
    function renderCounts() {
      const included = includedFrames().length;
      const selected = selectedFrames().length;
      const animation = dependencies.getCurrentAnimation();
      const canAddAssets = dependencies.canAddAssets();
      const canExport = dependencies.canExport();
      elements.organizerCount.textContent = text("workset", { included, total: state.frames.length });
      elements.organizerSelection.textContent = text("selected", { count: selected });
      elements.organizerApply.disabled =
        !included || state.busy || (state.mode === "edit" && !animation?.frames?.length);
      elements.organizerGodotPlaceholder.disabled =
        dependencies.browserExportOnly !== true || state.mode !== "import" || !included || state.busy;
      elements.organizerDeleteSelected.disabled = !selected || state.busy;
      elements.organizerInvert.disabled = !state.frames.length || state.busy;
      elements.organizerFlip.disabled = (!selected && !included) || state.busy;
      elements.organizerDeleteExcluded.disabled = included === state.frames.length || state.busy;
      elements.organizerFileInput.disabled = state.busy;
      elements.organizerVideoInput.disabled = state.busy;
      elements.organizerAddAssets.hidden = !canAddAssets;
      elements.organizerAddAssets.disabled = !included || state.busy || !canAddAssets;
      elements.organizerExport.hidden = !canExport;
      elements.organizerExport.disabled = !included || state.busy || !canExport;
      elements.organizerReduce.disabled = !included || state.busy;
      elements.organizerAutoSort.disabled = state.frames.length < 2 || state.busy;
      elements.organizerFindJump.disabled = included < 3 || state.busy || state.sequenceAnalyzing;
      elements.organizerFindDuplicate.disabled = included < 3 || state.busy || state.sequenceAnalyzing;
      elements.organizerFindLoop.disabled = included < 4 || state.busy || state.sequenceAnalyzing;
      elements.organizerGrid.querySelectorAll(".organizerFrameCutout").forEach((button) => {
        button.disabled = state.busy;
      });
      elements.organizerReduce.title = included ? "" : text("needFrames");
      elements.organizerAddAssets.title = included ? "" : text("needFrames");
      elements.organizerExport.title = included ? "" : text("needFrames");
      elements.organizerFindJump.title = included >= 3 ? "" : text("needThreeFrames");
      elements.organizerFindDuplicate.title = included >= 3 ? "" : text("needThreeFrames");
      elements.organizerFindLoop.title = included >= 4 ? "" : text("needFourFrames");
    }

    /**
     * Chooses frames while respecting platform selection modifiers.
     * @param {number} index Frame index.
     * @param {MouseEvent|{shiftKey?:boolean,metaKey?:boolean,ctrlKey?:boolean}} event Selection event.
     * @returns {void}
     */
    function selectFrame(index, event) {
      if (event.shiftKey && state.anchorIndex >= 0) {
        const start = Math.min(index, state.anchorIndex);
        const end = Math.max(index, state.anchorIndex);
        state.frames.forEach((frame, cursor) => {
          frame.selected = cursor >= start && cursor <= end;
        });
      } else if (event.metaKey || event.ctrlKey) {
        state.frames[index].selected = !state.frames[index].selected;
        state.anchorIndex = index;
      } else {
        state.frames.forEach((frame, cursor) => {
          frame.selected = cursor === index;
        });
        state.anchorIndex = index;
      }
      state.previewIndex = index;
      renderGrid();
      dependencies.renderPreview();
    }

    /**
     * Selects frame indexes and optionally labels their sequence-analysis reason.
     * @param {number[]} indexes Frame indexes.
     * @param {"jump"|"duplicate"|""} [analysisType] Analysis marker applied to matched frames.
     * @returns {void}
     */
    function selectIndexes(indexes, analysisType = "") {
      const selected = new Set(indexes);
      state.frames.forEach((frame, index) => {
        frame.selected = selected.has(index);
        frame.analysisMatch = frame.selected ? analysisType : "";
      });
      state.anchorIndex = indexes[0] ?? -1;
      renderGrid();
      if (analysisType && indexes.length) {
        const firstMatch = elements.organizerGrid.querySelector(".organizerFrame.analysisMatch");
        firstMatch?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    }

    /** @param {object} frame Organizer frame. @returns {string} Cached PNG thumbnail. */
    function frameThumbnail(frame) {
      const cacheKey = state.viewMode === "original" ? "original" : "edited";
      if (!frame.thumbnails[cacheKey]) {
        const canvas = cacheKey === "original" ? frame.originalCanvas : frame.editedCanvas;
        frame.thumbnails[cacheKey] = canvas.toDataURL("image/png");
      }
      return frame.thumbnails[cacheKey];
    }

    /** @param {object} frame Organizer frame. @returns {HTMLElement} Reusable card. */
    function createFrameCard(frame) {
      const card = documentApi.createElement("article");
      card.dataset.frameUid = frame.uid;
      card.innerHTML = `
          <button type="button" class="organizerFrameSelect"></button>
          <span class="organizerFrameNumber"></span>
          <span class="organizerFrameAnalysisBadge"></span>
          <img alt="" width="156" height="156" loading="lazy">
          <span class="organizerFrameName"></span>
          <span class="organizerFrameTag"></span>
          <label class="organizerFrameInclude"><input type="checkbox"><span aria-hidden="true">✓</span></label>
          <button type="button" class="organizerFrameCutout" aria-label="${text("editCutout")}" title="${text("editCutout")}">✎</button>
        `;
      card.querySelector("input").addEventListener("click", (event) => {
        event.stopPropagation();
        const currentFrame = state.frames.find((entry) => entry.uid === card.dataset.frameUid);
        if (!currentFrame) return;
        currentFrame.included = event.currentTarget.checked;
        renderCounts();
        dependencies.restartPreview();
      });
      card.querySelector(".organizerFrameCutout").addEventListener("click", (event) => {
        event.stopPropagation();
        const currentFrame = state.frames.find((entry) => entry.uid === card.dataset.frameUid);
        if (!currentFrame) return;
        dependencies.editImportCutout(currentFrame).catch((error) => {
          dependencies.setStatus(text("failed", { message: error.message }), "error");
        });
      });
      card.querySelector(".organizerFrameSelect").addEventListener("click", (event) => {
        const index = state.frames.findIndex((entry) => entry.uid === card.dataset.frameUid);
        if (index >= 0) selectFrame(index, event);
      });
      return card;
    }

    /** Renders frame cards while reusing nodes and cached thumbnails. @returns {void} */
    function renderGrid() {
      const existingCards = new Map(
        Array.from(elements.organizerGrid.children).map((card) => [card.dataset.frameUid, card]),
      );
      const fragment = documentApi.createDocumentFragment();
      state.frames.forEach((frame, index) => {
        const card = existingCards.get(frame.uid) || createFrameCard(frame);
        card.className = `organizerFrame ${frame.selected ? "selected" : ""} ${frame.included ? "included" : "excluded"} ${frame.analysisMatch ? `analysisMatch analysis-${frame.analysisMatch}` : ""}`;
        card.querySelector(".organizerFrameNumber").textContent = String(index + 1).padStart(3, "0");
        card.querySelector(".organizerFrameName").textContent = frame.name;
        card.querySelector(".organizerFrameTag").textContent = frame.tag;
        const analysisBadge = card.querySelector(".organizerFrameAnalysisBadge");
        analysisBadge.textContent = frame.analysisMatch ? text(`${frame.analysisMatch}Badge`) : "";
        analysisBadge.hidden = !frame.analysisMatch;
        const includeInput = card.querySelector("input");
        includeInput.checked = frame.included;
        includeInput.setAttribute("aria-label", text("includeFrame", { name: frame.name }));
        const selectButton = card.querySelector(".organizerFrameSelect");
        selectButton.setAttribute("aria-label", text("selectFrame", { name: frame.name }));
        selectButton.setAttribute("aria-pressed", String(frame.selected));
        const image = card.querySelector("img");
        const thumbnail = frameThumbnail(frame);
        if (image.src !== thumbnail) image.src = thumbnail;
        const cutoutButton = card.querySelector(".organizerFrameCutout");
        cutoutButton.hidden = false;
        cutoutButton.disabled = state.busy;
        cutoutButton.setAttribute("aria-label", text("editCutout"));
        cutoutButton.title = text("editCutout");
        fragment.appendChild(card);
      });
      elements.organizerGrid.replaceChildren(fragment);
      renderCounts();
    }

    return { renderCounts, renderGrid, selectFrame, selectIndexes };
  }

  return { createController };
});
