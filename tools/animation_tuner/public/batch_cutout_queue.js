(function attachBatchCutoutQueue(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutQueue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the batch queue selection and virtual-list renderer.
   * @param {object} dependencies Queue dependencies supplied by the batch controller.
   * @param {object} dependencies.state Mutable batch state.
   * @param {object} dependencies.elements Batch-cutout DOM elements.
   * @param {(key:string)=>string} dependencies.text Localized text resolver.
   * @param {(item:object)=>boolean} dependencies.hasQualityIssue Quality predicate.
   * @param {(quality:object|null|undefined)=>string} dependencies.qualityLabel Quality label resolver.
   * @param {()=>object|null} dependencies.selectedItem Selected item resolver.
   * @param {(index:number)=>void} dependencies.selectBatchIndex Frame navigation callback.
   * @param {()=>void} dependencies.renderPreview Preview renderer.
   * @param {()=>void} dependencies.renderStatus Status renderer.
   * @param {()=>void} dependencies.refreshQualityAnalysis Refreshes sequence-dependent quality data.
   * @param {()=>void} dependencies.stopBatchPlayback Playback cancellation callback.
   * @param {()=>void} dependencies.scheduleBatchThumbnails Thumbnail scheduler.
   * @param {Document} [dependencies.document] Document implementation.
   * @param {{escape:(value:string)=>string}} [dependencies.css] CSS utility implementation.
   * @returns {{updateBatchSelection:(index:number,event:MouseEvent|KeyboardEvent)=>void,reorderBatchItem:(sourceId:string,targetIndex:number,after:boolean)=>void,updateQueueCard:(item:object)=>void,renderQueue:()=>void}} Queue controller.
   */
  function createController(dependencies) {
    const {
      state,
      elements,
      text,
      hasQualityIssue,
      qualityLabel,
      selectedItem,
      selectBatchIndex,
      renderPreview,
      renderStatus,
      refreshQualityAnalysis,
      stopBatchPlayback,
      scheduleBatchThumbnails,
    } = dependencies || {};
    if (!state || !elements?.cutoutQueue) {
      throw new Error("BatchCutoutQueue requires queue state and elements.");
    }
    const documentApi = dependencies.document || root.document;
    const cssApi = dependencies.css || root.CSS;

    /**
     * Updates batch selection using desktop range/toggle conventions.
     * @param {number} index Clicked item index.
     * @param {MouseEvent|KeyboardEvent} event Selection event.
     * @returns {void}
     */
    function updateBatchSelection(index, event) {
      const item = state.items[index];
      if (!item) return;
      if (event.shiftKey) {
        const selectableIndexes = state.items
          .map((entry, cursor) => ({ entry, cursor }))
          .filter(({ entry }) => !state.qualityOnly || hasQualityIssue(entry))
          .map(({ cursor }) => cursor);
        const currentPosition = selectableIndexes.indexOf(index);
        const anchorPosition = selectableIndexes.indexOf(state.selectionAnchorIndex);
        const effectiveAnchor = anchorPosition >= 0 ? anchorPosition : currentPosition;
        const start = Math.min(effectiveAnchor, currentPosition);
        const end = Math.max(effectiveAnchor, currentPosition);
        if (!event.metaKey && !event.ctrlKey) state.selectedIds.clear();
        for (const cursor of selectableIndexes.slice(start, end + 1)) {
          const selectedEntry = state.items[cursor];
          if (selectedEntry) state.selectedIds.add(selectedEntry.id);
        }
      } else if (event.metaKey || event.ctrlKey) {
        if (state.selectedIds.has(item.id)) state.selectedIds.delete(item.id);
        else state.selectedIds.add(item.id);
        state.selectionAnchorIndex = index;
      } else {
        state.selectedIds.clear();
        state.selectedIds.add(item.id);
        state.selectionAnchorIndex = index;
      }
    }

    /**
     * Moves one batch item before or after another item.
     * @param {string} sourceId Dragged item identifier.
     * @param {number} targetIndex Target item index.
     * @param {boolean} after Whether to insert after the target.
     * @returns {void}
     */
    function reorderBatchItem(sourceId, targetIndex, after) {
      const sourceIndex = state.items.findIndex((item) => item.id === sourceId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const currentItemId = selectedItem()?.id;
      const [moved] = state.items.splice(sourceIndex, 1);
      let insertionIndex = targetIndex + (after ? 1 : 0);
      if (sourceIndex < insertionIndex) insertionIndex -= 1;
      state.items.splice(Math.max(0, Math.min(state.items.length, insertionIndex)), 0, moved);
      state.selectedIndex = Math.max(
        0,
        state.items.findIndex((item) => item.id === currentItemId),
      );
      state.selectionAnchorIndex = state.selectedIndex;
      refreshQualityAnalysis();
      renderQueue();
      renderPreview();
    }

    /**
     * Updates one queue card after background processing.
     * @param {object} item Queue item.
     * @returns {void}
     */
    function updateQueueCard(item) {
      const card = elements.cutoutQueue.querySelector(`[data-item-id="${cssApi.escape(item.id)}"]`);
      if (!card) return;
      card.dataset.status = item.status;
      card.dataset.quality = item.quality?.severity || "pending";
      card.classList.toggle("excluded", item.excluded);
      card.classList.toggle("qualityIssue", hasQualityIssue(item));
      card.classList.toggle("qualityCritical", item.quality?.severity === "critical");
      const issueLabel = qualityLabel(item.quality);
      card.title = item.error || (issueLabel ? `${item.name} · ${issueLabel}` : item.name);
      card.setAttribute("aria-label", card.title);
      const image = card.querySelector("img");
      if (image) {
        image.src =
          state.thumbnailMode === "result" && item.resultThumbnail
            ? item.resultThumbnail
            : item.sourceThumbnail;
      }
      const toggle = card.querySelector(".cutoutQueueToggle");
      if (toggle) {
        toggle.textContent = item.excluded ? "○" : "✓";
        toggle.setAttribute("aria-label", text(item.excluded ? "includeFrame" : "excludeFrame"));
      }
      const alert = card.querySelector(".cutoutQueueAlert");
      if (alert) {
        alert.textContent = item.quality?.severity === "critical" ? "!!" : "!";
        alert.setAttribute("aria-label", issueLabel);
      }
    }

    /**
     * Appends a virtual-list spacer to the queue.
     * @param {number} count Number of hidden items represented by the spacer.
     * @param {number} itemStride Queue item width including its gap.
     * @returns {void}
     */
    function appendSpacer(count, itemStride) {
      if (count <= 0) return;
      const spacer = documentApi.createElement("div");
      spacer.className = "cutoutQueueSpacer";
      spacer.style.flexBasis = `${count * itemStride}px`;
      spacer.setAttribute("aria-hidden", "true");
      elements.cutoutQueue.appendChild(spacer);
    }

    /**
     * Renders the selectable, virtualized batch queue.
     * @returns {void}
     */
    function renderQueue() {
      const previousScroll = elements.cutoutQueue.scrollLeft;
      elements.cutoutQueue.innerHTML = "";
      const filteredItems = state.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !state.qualityOnly || hasQualityIssue(item));
      const itemStride = 140;
      const visibleCount = Math.max(
        20,
        Math.ceil((elements.cutoutQueue.clientWidth || 840) / itemStride) + 20,
      );
      const start = Math.max(0, Math.min(filteredItems.length, Math.floor(previousScroll / itemStride) - 10));
      const end = Math.min(filteredItems.length, start + visibleCount);
      state.queueWindowStart = start;
      appendSpacer(start, itemStride);
      filteredItems.slice(start, end).forEach(({ item, index }) => {
        const card = documentApi.createElement("div");
        card.tabIndex = 0;
        card.setAttribute("role", "option");
        card.setAttribute("aria-selected", String(state.selectedIds.has(item.id)));
        card.dataset.index = String(index);
        card.dataset.itemId = item.id;
        card.dataset.status = item.status;
        card.draggable = !state.busy;
        card.className = `cutoutQueueItem ${index === state.selectedIndex ? "active" : ""} ${state.selectedIds.has(item.id) ? "batchSelected" : ""} ${item.excluded ? "excluded" : ""}`;
        card.innerHTML = `
          <img alt="" width="120" height="44" loading="lazy">
          <span class="cutoutQueueName"></span>
          <b class="cutoutQueueIndex">${index + 1}</b>
          <em class="cutoutQueueAlert"></em>
          <i class="cutoutQueueState" aria-hidden="true"></i>
          <button type="button" class="cutoutQueueToggle"></button>
          <button type="button" class="cutoutQueueRemove">×</button>`;
        card.querySelector(".cutoutQueueName").textContent = item.name;
        card.addEventListener("click", (event) => {
          updateBatchSelection(index, event);
          selectBatchIndex(index);
        });
        card.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          updateBatchSelection(index, event);
          selectBatchIndex(index);
        });
        card.addEventListener("dragstart", (event) => {
          if (state.busy) {
            event.preventDefault();
            return;
          }
          state.draggedItemId = item.id;
          card.classList.add("dragging");
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.id);
        });
        card.addEventListener("dragover", (event) => {
          if (!state.draggedItemId || state.draggedItemId === item.id) return;
          event.preventDefault();
          const rect = card.getBoundingClientRect();
          const after = event.clientX >= rect.left + rect.width / 2;
          card.classList.toggle("dragBefore", !after);
          card.classList.toggle("dragAfter", after);
        });
        card.addEventListener("dragleave", () => card.classList.remove("dragBefore", "dragAfter"));
        card.addEventListener("drop", (event) => {
          event.preventDefault();
          const rect = card.getBoundingClientRect();
          const after = event.clientX >= rect.left + rect.width / 2;
          card.classList.remove("dragBefore", "dragAfter");
          reorderBatchItem(state.draggedItemId, index, after);
          state.draggedItemId = "";
        });
        card.addEventListener("dragend", () => {
          state.draggedItemId = "";
          elements.cutoutQueue
            .querySelectorAll(".dragging,.dragBefore,.dragAfter")
            .forEach((node) => node.classList.remove("dragging", "dragBefore", "dragAfter"));
        });
        card.querySelector(".cutoutQueueToggle").addEventListener("click", (event) => {
          event.stopPropagation();
          state.thumbnailJob += 1;
          item.excluded = !item.excluded;
          updateQueueCard(item);
          renderStatus();
          scheduleBatchThumbnails();
        });
        const remove = card.querySelector(".cutoutQueueRemove");
        remove.setAttribute("aria-label", text("removeFrame"));
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          stopBatchPlayback();
          state.thumbnailJob += 1;
          const itemIndex = state.items.indexOf(item);
          if (itemIndex < 0) return;
          const activeItemId = selectedItem()?.id;
          state.items.splice(itemIndex, 1);
          state.selectedIds.delete(item.id);
          const retainedActiveIndex = state.items.findIndex((entry) => entry.id === activeItemId);
          state.selectedIndex =
            retainedActiveIndex >= 0
              ? retainedActiveIndex
              : Math.min(itemIndex, Math.max(0, state.items.length - 1));
          state.selectionAnchorIndex = state.selectedIndex;
          refreshQualityAnalysis();
          renderQueue();
          renderPreview();
          scheduleBatchThumbnails();
        });
        elements.cutoutQueue.appendChild(card);
        updateQueueCard(item);
      });
      appendSpacer(filteredItems.length - end, itemStride);
      if (state.qualityOnly && !filteredItems.length) {
        const empty = documentApi.createElement("div");
        empty.className = "cutoutQueueEmpty";
        empty.textContent = text("qualityFilteredEmpty");
        elements.cutoutQueue.appendChild(empty);
      }
      elements.cutoutQueue.scrollLeft = previousScroll;
      elements.cutoutShowResult.classList.toggle("active", state.thumbnailMode === "result");
      elements.cutoutShowOriginal.classList.toggle("active", state.thumbnailMode === "original");
      renderStatus();
    }

    return { updateBatchSelection, reorderBatchItem, updateQueueCard, renderQueue };
  }

  return { createController };
});
