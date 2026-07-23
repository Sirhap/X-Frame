(function attachXsxbFilmstripInteraction(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppFilmstripInteraction = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates filmstrip rendering and frame-layer drag interaction operations.
   *
   * DOM access, workbench state, and mutations are injected so rendering stays
   * testable without coupling this controller to the application singleton.
   *
   * @param {{
   *   elements?:{filmstrip?:HTMLElement|null,chainGroupSelect?:HTMLSelectElement|null,playPause?:HTMLElement|null},
   *   constants?:{frameDurationStepMs?:number,layerCardDragType?:string,attachmentAssetDragType?:string},
   *   state?:object,
   *   handlers?:object,
   *   utils?:object,
   *   documentRef?:Document,
   *   requestAnimationFrameRef?:(callback:FrameRequestCallback)=>number,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   renderFilmstrip:()=>void,
   *   renderFilmstripGroup:(group:object,label:string)=>void,
   *   moveFrameLayerCardToIndex:(dragInfo:object,insertionIndex:number)=>boolean,
   *   moveFrameLayerCardByOffset:(layerInfo:object,offset:number)=>boolean,
   * }} Filmstrip interaction operations.
   */
  function createController(dependencies = {}) {
    const elements = dependencies.elements || {};
    const constants = dependencies.constants || {};
    const state = dependencies.state || {};
    const handlers = dependencies.handlers || {};
    const utils = dependencies.utils || {};
    const documentRef = dependencies.documentRef || root.document;
    const requestAnimationFrameRef =
      dependencies.requestAnimationFrameRef || root.requestAnimationFrame?.bind(root);
    const filmstrip = elements.filmstrip || null;
    const chainGroupSelect = elements.chainGroupSelect || null;
    const frameDurationStepMs = Number(constants.frameDurationStepMs || 50);
    const layerCardDragType = String(constants.layerCardDragType || "application/x-xsxb-layer-card");
    const attachmentAssetDragType = String(
      constants.attachmentAssetDragType || "application/x-xsxb-attachment-asset",
    );

    const getCurrentGroup = state.getCurrentGroup || (() => null);
    const getSelectedFrame = state.getSelectedFrame || (() => 0);
    const getSelectedFrames = state.getSelectedFrames || (() => new Set());
    const getSelectedAttachmentId = state.getSelectedAttachmentId || (() => "");
    const setSelectedAttachmentId = state.setSelectedAttachmentId || (() => {});
    const setPlaying = state.setPlaying || (() => {});
    const setPlaybackPrimaryGroup = state.setPlaybackPrimaryGroup || (() => {});
    const getLayerCardDrag = state.getLayerCardDrag || (() => null);
    const setLayerCardDrag = state.setLayerCardDrag || (() => {});
    const getAttachmentAssets = state.getAttachmentAssets || (() => []);

    const translate = utils.translate || ((key) => key);
    const escapeHtml = utils.escapeHtml || ((value) => String(value ?? ""));
    const assetUrl = utils.assetUrl || ((frame) => String(frame?.path || ""));
    const cssEscape =
      utils.cssEscape || root.CSS?.escape || ((value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"));

    const renderAttachmentAssetTray = handlers.renderAttachmentAssetTray || (() => {});
    const syncFrameActions = handlers.syncFrameActions || (() => {});
    const renderFilmstripGroupOverride = handlers.renderFilmstripGroup;
    const getPlaybackChainGroup = handlers.getPlaybackChainGroup || (() => null);
    const clearSelectedAttachment = handlers.clearSelectedAttachment || (() => {});
    const clampFrameIndex = handlers.clampFrameIndex || ((index) => index);
    const setSingleFrameSelection = handlers.setSingleFrameSelection || (() => {});
    const draw = handlers.draw || (() => {});
    const selectGroup = handlers.selectGroup || (async () => {});
    const selectFilmstripFrame = handlers.selectFilmstripFrame || (() => {});
    const selectFrameImageAttachment = handlers.selectFrameImageAttachment || (() => {});
    const removeFrameImageAttachment = handlers.removeFrameImageAttachment || (() => {});
    const applyAttachmentAsset = handlers.applyAttachmentAsset || (() => {});
    const bindFrameImageAttachmentFile = handlers.bindFrameImageAttachmentFile || (async () => {});
    const bindFrameAudioFile = handlers.bindFrameAudioFile || (async () => {});
    const removeFrameAudioFromCard = handlers.removeFrameAudioFromCard || (async () => {});
    const adjustFrameDurationMs = handlers.adjustFrameDurationMs || (async () => {});
    const imageFileFromList = handlers.imageFileFromList || (() => null);
    const audioFileFromList = handlers.audioFileFromList || (() => null);
    const overrideStore = handlers.overrideStore || (() => ({}));
    const tuningFrameKey = handlers.tuningFrameKey || ((index) => String(index));
    const frameAudioBinding = handlers.frameAudioBinding || (() => null);
    const sourceFrameIndex = handlers.sourceFrameIndex || ((index) => index);
    const canEditFramePlayback = handlers.canEditFramePlayback || (() => false);
    const usesAttachedPlaybackTiming = handlers.usesAttachedPlaybackTiming || (() => false);
    const frameDurationMsLabel = handlers.frameDurationMsLabel || (() => "");
    const framePlayback = handlers.framePlayback || (() => ({ disabled: false }));
    const isReferenceFrame = handlers.isReferenceFrame || (() => false);
    const frameLayerStackItems = handlers.frameLayerStackItems || (() => []);
    const layerCardInfosForFrame = handlers.layerCardInfosForFrame || (() => []);
    const layerCardInfoForAttachment = handlers.layerCardInfoForAttachment || (() => ({}));
    const layerCardInfoForMain = handlers.layerCardInfoForMain || (() => ({}));
    const layerCardDomKey = handlers.layerCardDomKey || ((info) => String(info?.id || ""));
    const layerCardKey = handlers.layerCardKey || ((info) => String(info?.id || ""));
    const movedLayerCardOrder = handlers.movedLayerCardOrder || (() => null);
    const applyFrameLayerCardOrder = handlers.applyFrameLayerCardOrder || (() => false);
    const pushUndo = handlers.pushUndo || (() => {});
    const markDirty = handlers.markDirty || (() => {});
    const attachmentLayerOrder = handlers.attachmentLayerOrder || (() => 0);

    /**
     * Removes temporary layer-shift styling from one card.
     * @param {HTMLElement} card Layer card.
     * @returns {void}
     */
    function clearLayerDropClasses(card) {
      card?.classList.remove("layerShiftPreview");
      if (card) card.style.transform = "";
    }

    /**
     * Clears temporary layer-shift styling from all rendered cards.
     * @returns {void}
     */
    function clearLayerDragPreview() {
      documentRef?.querySelectorAll(".layerShiftPreview").forEach(clearLayerDropClasses);
    }

    /**
     * Returns whether an event belongs to a layer-card drag.
     * @param {DragEvent} event Browser drag event.
     * @returns {boolean} Whether this is a layer-card drag.
     */
    function isLayerCardDragEvent(event) {
      return (
        Boolean(getLayerCardDrag()) || Array.from(event.dataTransfer?.types || []).includes(layerCardDragType)
      );
    }

    /**
     * Finds the layer-stack insertion slot under a pointer.
     * @param {HTMLElement} stack Layer stack element.
     * @param {number} frameIndex Frame index.
     * @param {object} group Animation group.
     * @param {number} clientY Pointer Y coordinate.
     * @returns {number} Insertion index.
     */
    function layerInsertionIndexFromPoint(stack, frameIndex, group, clientY) {
      const infos = layerCardInfosForFrame(frameIndex, group);
      for (let index = 0; index < infos.length; index += 1) {
        const card = stack.querySelector(
          `[data-layer-card-key="${cssEscape(layerCardDomKey(infos[index]))}"]`,
        );
        if (!card) continue;
        const rect = card.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return index;
      }
      return infos.length;
    }

    /**
     * Previews the visual movement caused by a layer-card reorder.
     * @param {object} dragInfo Dragged layer descriptor.
     * @param {number} insertionIndex Target insertion index.
     * @param {HTMLElement|null} stack Layer stack element.
     * @returns {void}
     */
    function previewLayerCardMove(dragInfo, insertionIndex, stack) {
      clearLayerDragPreview();
      const order = movedLayerCardOrder(dragInfo, insertionIndex);
      if (!order || !stack) return;
      const style = root.getComputedStyle?.(stack);
      const gap = Number.parseFloat(style?.rowGap || style?.gap || "0") || 0;
      const currentRects = new Map();
      const cards = new Map();
      for (const info of order.before) {
        const key = layerCardDomKey(info);
        const card = stack.querySelector(`[data-layer-card-key="${cssEscape(key)}"]`);
        if (!card) return;
        cards.set(key, card);
        currentRects.set(key, card.getBoundingClientRect());
      }
      let nextTop = currentRects.get(layerCardDomKey(order.before[0]))?.top || 0;
      const nextTops = new Map();
      for (const info of order.after) {
        const key = layerCardDomKey(info);
        const rect = currentRects.get(key);
        nextTops.set(key, nextTop);
        nextTop += rect.height + gap;
      }
      for (const info of order.before) {
        const key = layerCardDomKey(info);
        if (key === layerCardDomKey(dragInfo)) continue;
        const card = cards.get(key);
        const rect = currentRects.get(key);
        const dy = (nextTops.get(key) || rect.top) - rect.top;
        if (Math.abs(dy) < 1) continue;
        card.classList.add("layerShiftPreview");
        card.style.transform = `translateY(${dy}px)`;
      }
    }

    /**
     * Captures current layer-card rectangles for FLIP animation.
     * @returns {Map<string,DOMRect>} Card rectangles by stable key.
     */
    function captureLayerCardRects() {
      const rects = new Map();
      documentRef?.querySelectorAll("[data-layer-card-key]").forEach((card) => {
        rects.set(card.dataset.layerCardKey, card.getBoundingClientRect());
      });
      return rects;
    }

    /**
     * Animates cards from their pre-reorder positions.
     * @param {Map<string,DOMRect>} previousRects Previous card rectangles.
     * @returns {void}
     */
    function animateLayerCardRects(previousRects) {
      if (!previousRects?.size || typeof requestAnimationFrameRef !== "function") return;
      requestAnimationFrameRef(() => {
        documentRef?.querySelectorAll("[data-layer-card-key]").forEach((card) => {
          const previous = previousRects.get(card.dataset.layerCardKey);
          if (!previous) return;
          const next = card.getBoundingClientRect();
          const dx = previous.left - next.left;
          const dy = previous.top - next.top;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          card.style.transition = "none";
          card.style.transform = `translate(${dx}px, ${dy}px)`;
          card.getBoundingClientRect();
          requestAnimationFrameRef(() => {
            card.style.transition = "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease";
            card.style.transform = "";
          });
        });
      });
    }

    /**
     * Activates a layer card only when the card itself owns Enter or Space.
     * Nested buttons retain their native keyboard behavior.
     * @param {KeyboardEvent} event Keyboard event.
     * @param {HTMLElement} card Layer card.
     * @returns {boolean} Whether the card handled the event.
     */
    function activateLayerCardFromKeyboard(event, card) {
      if (event.target !== event.currentTarget) return false;
      if (event.key !== "Enter" && event.key !== " ") return false;
      event.preventDefault();
      card.click();
      return true;
    }

    /**
     * Installs drag handlers on one layer card.
     * @param {HTMLElement} card Layer card.
     * @param {object} info Layer descriptor.
     * @returns {void}
     */
    function setupLayerCardDrag(card, info) {
      const currentGroup = getCurrentGroup();
      if (!currentGroup || info.groupUiId !== currentGroup.uiId) return;
      card.draggable = true;
      card.classList.add("layerDraggable");
      card.dataset.layerCardKey = layerCardDomKey(info);
      setupLayerOrderActions(card, info);
      card.addEventListener("dragstart", (event) => {
        if (event.target?.closest?.(".attachmentAction, .durationStep, .frameSfxBadge, .layerOrderAction")) {
          event.preventDefault();
          return;
        }
        setLayerCardDrag({ ...info });
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(layerCardDragType, JSON.stringify(getLayerCardDrag()));
        card.classList.add("layerCardDragging");
      });
      card.addEventListener("dragend", () => {
        setLayerCardDrag(null);
        card.classList.remove("layerCardDragging");
        clearLayerDragPreview();
      });
    }

    /**
     * Installs dragover/drop handlers on one frame's layer stack.
     * @param {HTMLElement} stack Layer stack element.
     * @param {number} index Frame index.
     * @param {object} group Animation group.
     * @returns {void}
     */
    function setupLayerStackDrag(stack, index, group) {
      const currentGroup = getCurrentGroup();
      if (!currentGroup || group.uiId !== currentGroup.uiId) return;
      stack.addEventListener("dragover", (event) => {
        const dragInfo = getLayerCardDrag();
        if (!dragInfo || dragInfo.groupUiId !== group.uiId || dragInfo.frameIndex !== index) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        clearLayerDragPreview();
        const insertionIndex = layerInsertionIndexFromPoint(stack, index, group, event.clientY);
        previewLayerCardMove(dragInfo, insertionIndex, stack);
      });
      stack.addEventListener("dragleave", (event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        clearLayerDragPreview();
      });
      stack.addEventListener("drop", (event) => {
        const dragInfo = getLayerCardDrag();
        if (!dragInfo || dragInfo.groupUiId !== group.uiId || dragInfo.frameIndex !== index) return;
        event.preventDefault();
        event.stopPropagation();
        clearLayerDragPreview();
        const insertionIndex = layerInsertionIndexFromPoint(stack, index, group, event.clientY);
        moveFrameLayerCardToIndex(dragInfo, insertionIndex);
        setLayerCardDrag(null);
      });
    }

    /**
     * Applies a layer-card reorder and refreshes the workbench.
     * @param {object} dragInfo Dragged layer descriptor.
     * @param {number} insertionIndex Target insertion index.
     * @returns {boolean} Whether the layer order changed.
     */
    function moveFrameLayerCardToIndex(dragInfo, insertionIndex) {
      const currentGroup = getCurrentGroup();
      if (!currentGroup || dragInfo.groupUiId !== currentGroup.uiId) return false;
      const frameIndex = clampFrameIndex(dragInfo.frameIndex, currentGroup);
      const order = movedLayerCardOrder(dragInfo, insertionIndex, currentGroup);
      if (!order) return false;
      const { before, after } = order;
      if (before.map(layerCardKey).join("|") === after.map(layerCardKey).join("|")) return false;
      const previousRects = captureLayerCardRects();
      clearLayerDragPreview();
      pushUndo("reorder frame layers");
      if (!applyFrameLayerCardOrder(frameIndex, currentGroup, after)) return false;
      if (dragInfo.type === "attachment") setSelectedAttachmentId(dragInfo.attachmentId);
      else clearSelectedAttachment();
      setSingleFrameSelection(frameIndex, currentGroup);
      markDirty();
      renderFilmstrip();
      animateLayerCardRects(previousRects);
      draw();
      return true;
    }

    /**
     * Moves one layer by a single visual slot and restores keyboard focus after rendering.
     * @param {object} layerInfo Layer descriptor.
     * @param {number} offset Negative to move up, positive to move down.
     * @returns {boolean} Whether the layer order changed.
     */
    function moveFrameLayerCardByOffset(layerInfo, offset) {
      const currentGroup = getCurrentGroup();
      if (!currentGroup || layerInfo.groupUiId !== currentGroup.uiId) return false;
      const frameIndex = clampFrameIndex(layerInfo.frameIndex, currentGroup);
      const infos = layerCardInfosForFrame(frameIndex, currentGroup);
      const currentIndex = infos.findIndex(
        (candidate) => layerCardKey(candidate) === layerCardKey(layerInfo),
      );
      const direction = Math.sign(Number(offset) || 0);
      const nextIndex = currentIndex + direction;
      if (!direction || currentIndex < 0 || nextIndex < 0 || nextIndex >= infos.length) return false;
      const insertionIndex = direction < 0 ? nextIndex : nextIndex + 1;
      if (!moveFrameLayerCardToIndex(layerInfo, insertionIndex)) return false;
      documentRef
        ?.querySelector?.(`[data-layer-card-key="${cssEscape(layerCardDomKey(layerInfo))}"]`)
        ?.focus?.();
      return true;
    }

    /**
     * Adds explicit touch and keyboard controls for reordering one layer card.
     * @param {HTMLElement} card Layer card.
     * @param {object} info Layer descriptor.
     * @returns {void}
     */
    function setupLayerOrderActions(card, info) {
      const currentGroup = getCurrentGroup();
      if (!currentGroup || info.groupUiId !== currentGroup.uiId) return;
      const infos = layerCardInfosForFrame(info.frameIndex, currentGroup);
      if (infos.length < 2) return;
      const currentIndex = infos.findIndex((candidate) => layerCardKey(candidate) === layerCardKey(info));
      if (currentIndex < 0) return;

      const actions = documentRef.createElement("span");
      actions.className = "layerOrderActions";
      const actionDefinitions = [
        { direction: -1, label: translate("frameLayerMoveUp"), symbol: "↑" },
        { direction: 1, label: translate("frameLayerMoveDown"), symbol: "↓" },
      ];
      for (const actionDefinition of actionDefinitions) {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.className = "layerOrderAction";
        button.textContent = actionDefinition.symbol;
        button.title = actionDefinition.label;
        button.setAttribute("aria-label", actionDefinition.label);
        button.disabled =
          (actionDefinition.direction < 0 && currentIndex === 0) ||
          (actionDefinition.direction > 0 && currentIndex === infos.length - 1);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          moveFrameLayerCardByOffset(info, actionDefinition.direction);
        });
        actions.appendChild(button);
      }
      card.prepend(actions);
      card.addEventListener("keydown", (event) => {
        if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        moveFrameLayerCardByOffset(info, event.key === "ArrowUp" ? -1 : 1);
      });
    }

    /**
     * Creates a draggable attachment thumbnail card.
     * @param {object} attachment Attachment descriptor.
     * @param {number} index Frame index.
     * @param {object} group Animation group.
     * @param {string} label Display label prefix.
     * @returns {HTMLElement} Attachment card.
     */
    function createFrameImageAttachmentCard(attachment, index, group, label) {
      const currentGroup = getCurrentGroup();
      const isCurrent = group.uiId === currentGroup?.uiId;
      const card = documentRef.createElement("div");
      card.tabIndex = 0;
      card.setAttribute("role", "option");
      const selected = getSelectedAttachmentId() === attachment.id;
      card.setAttribute("aria-selected", String(selected));
      const below = attachmentLayerOrder(attachment) < 0;
      card.className = `thumb attachmentThumb ${selected ? "selectedAttachment" : ""} ${below ? "layerBelow" : "layerAbove"} ${!isCurrent ? "chained" : ""}`;
      const layerTitle = below
        ? translate("frameAttachmentLayerBelow")
        : translate("frameAttachmentLayerAbove");
      card.title = `${label}${index + 1} - ${attachment.name || "image"}\n${layerTitle}`;
      card.innerHTML = `
    <span class="attachmentActions">
      <button type="button" class="attachmentAction" data-action="remove-attachment" title="${escapeHtml(translate("frameAttachmentRemove"))}" aria-label="${escapeHtml(translate("frameAttachmentRemove"))}">×</button>
    </span>
    <img src="${assetUrl(attachment)}" alt="" width="${Math.max(1, Number(attachment.width || 1))}" height="${Math.max(1, Number(attachment.height || 1))}" loading="lazy">
    <span class="thumbLabel">${label}${index + 1}</span>`;
      card.querySelector('[data-action="remove-attachment"]').addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeFrameImageAttachment(attachment.id);
      });
      card.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (group.uiId !== getCurrentGroup()?.uiId) {
          await selectGroup(group, {
            frameIndex: index,
            preserveView: true,
            stopPlayback: false,
            selectedAttachmentId: attachment.id,
          });
          return;
        }
        selectFrameImageAttachment(attachment, index, group);
      });
      card.addEventListener("keydown", (event) => activateLayerCardFromKeyboard(event, card));
      setupLayerCardDrag(card, layerCardInfoForAttachment(attachment, index, group));
      return card;
    }

    /**
     * Renders all frames and attachment layers for one group.
     * @param {object} group Animation group.
     * @param {string} label Display label prefix.
     * @returns {void}
     */
    function renderFilmstripGroup(group, label) {
      const currentGroup = getCurrentGroup();
      const store = overrideStore(group);
      const isCurrent = group.uiId === currentGroup?.uiId;
      (group.frames || []).forEach((frame, index) => {
        const stack = documentRef.createElement("div");
        stack.className = "frameStack";
        const stackItems = frameLayerStackItems(index, group);
        setupLayerStackDrag(stack, index, group);

        const playback = framePlayback(index, group);
        const item = documentRef.createElement("div");
        item.tabIndex = 0;
        item.setAttribute("role", "option");
        item.dataset.frameIndex = String(index);
        const inSelection = isCurrent && getSelectedFrames().has(index) && !getSelectedAttachmentId();
        item.setAttribute("aria-selected", String(inSelection));
        const audioBinding = frameAudioBinding(index, group);
        item.className = `thumb ${inSelection ? "selected" : ""} ${isCurrent && index === getSelectedFrame() ? "primary" : ""} ${isReferenceFrame(index, group) ? "reference" : ""} ${!isCurrent ? "chained" : ""} ${store[tuningFrameKey(index, group)] ? "overridden" : ""} ${playback.disabled ? "disabled" : ""} ${audioBinding ? "hasSfx" : ""}`;
        const sourceLabel =
          Array.isArray(group.sourceFrameIndices) && group.sourceFrameIndices.length
            ? ` (src ${sourceFrameIndex(index, group) + 1})`
            : "";
        item.title = `${label}${index + 1} - ${frame.name}${sourceLabel}`;
        const canAdjustDuration =
          isCurrent && canEditFramePlayback(group) && !usesAttachedPlaybackTiming(group);
        const audioBadge = audioBinding
          ? `<button type="button" class="frameSfxBadge" data-action="delete-sfx" title="${escapeHtml(audioBinding.name || "audio")}" aria-label="${escapeHtml(`Remove ${audioBinding.name || "audio"}`)}"><span class="frameSfxSpeaker" aria-hidden="true">&#128266;</span><span class="frameSfxRemove" aria-hidden="true">x</span></button>`
          : "";
        item.innerHTML = `
      ${audioBadge}
      <img src="${assetUrl(frame)}" alt="" width="${Math.max(1, Number(frame.width || 1))}" height="${Math.max(1, Number(frame.height || 1))}" loading="lazy">
      <span class="thumbLabel">${label}${index + 1}</span>
      <div class="thumbDuration">
        <button type="button" class="durationStep" data-delta="${-frameDurationStepMs}" ${canAdjustDuration ? "" : "disabled"} title="-${frameDurationStepMs}ms" aria-label="-${frameDurationStepMs}ms">-</button>
        <b>${frameDurationMsLabel(index, group)}</b>
        <button type="button" class="durationStep" data-delta="${frameDurationStepMs}" ${canAdjustDuration ? "" : "disabled"} title="+${frameDurationStepMs}ms" aria-label="+${frameDurationStepMs}ms">+</button>
      </div>`;
        const sfxBadge = item.querySelector(".frameSfxBadge");
        if (sfxBadge) {
          sfxBadge.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await removeFrameAudioFromCard(index, group);
          });
        }
        const canDropOnFrame = isCurrent && Boolean(currentGroup);
        for (const eventName of ["dragenter", "dragover"]) {
          item.addEventListener(eventName, (event) => {
            if (!canDropOnFrame || isLayerCardDragEvent(event)) return;
            if (Array.from(event.dataTransfer?.types || []).includes(attachmentAssetDragType)) {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "copy";
              item.classList.add("imageDragOver");
              return;
            }
            const items = Array.from(event.dataTransfer?.items || []);
            const hasFile =
              items.some((entry) => entry.kind === "file") ||
              Array.from(event.dataTransfer?.types || []).includes("Files") ||
              Boolean(event.dataTransfer?.files?.length);
            const imageFile = imageFileFromList(event.dataTransfer?.files);
            const audioFile = audioFileFromList(event.dataTransfer?.files);
            const looksImage =
              Boolean(imageFile) || items.some((entry) => String(entry.type || "").startsWith("image/"));
            const looksAudio =
              Boolean(audioFile) || items.some((entry) => String(entry.type || "").startsWith("audio/"));
            if (!hasFile) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "copy";
            item.classList.toggle("imageDragOver", looksImage || !looksAudio);
            item.classList.toggle("audioDragOver", !looksImage && looksAudio);
          });
        }
        for (const eventName of ["dragleave", "dragend"]) {
          item.addEventListener(eventName, () => {
            item.classList.remove("audioDragOver", "imageDragOver");
          });
        }
        item.addEventListener("drop", async (event) => {
          if (!canDropOnFrame || isLayerCardDragEvent(event)) return;
          event.preventDefault();
          event.stopPropagation();
          item.classList.remove("audioDragOver", "imageDragOver");
          const assetId = event.dataTransfer?.getData(attachmentAssetDragType);
          if (assetId) {
            const asset = getAttachmentAssets().find((entry) => entry.id === assetId);
            if (asset) applyAttachmentAsset(asset, [index], group);
            return;
          }
          const imageFile = imageFileFromList(event.dataTransfer?.files);
          if (imageFile) {
            await bindFrameImageAttachmentFile(imageFile, index, group);
            return;
          }
          const file = audioFileFromList(event.dataTransfer?.files);
          if (!file) {
            handlers.status?.(translate("dropImageFile"));
            return;
          }
          await bindFrameAudioFile(file, index, group);
        });
        item.querySelectorAll(".durationStep").forEach((button) => {
          button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
              await adjustFrameDurationMs(index, Number(button.dataset.delta || 0));
            } catch (error) {
              handlers.status?.(translate("frameMutationFailed", { message: error.message }));
            }
          });
        });
        item.addEventListener("click", async (event) => {
          if (group.uiId !== getCurrentGroup()?.uiId) {
            const previousGroup = getCurrentGroup();
            setPlaying(false);
            setPlaybackPrimaryGroup(null);
            if (elements.playPause) elements.playPause.textContent = translate("play");
            if (chainGroupSelect && previousGroup) chainGroupSelect.value = previousGroup.uiId;
            await selectGroup(group, { frameIndex: index, preserveView: true, stopPlayback: false });
            return;
          }
          selectFilmstripFrame(index, event);
        });
        item.addEventListener("keydown", (event) => activateLayerCardFromKeyboard(event, item));
        setupLayerCardDrag(item, layerCardInfoForMain(index, group));
        for (const stackItem of stackItems) {
          if (stackItem.type === "main") stack.appendChild(item);
          else stack.appendChild(createFrameImageAttachmentCard(stackItem.attachment, index, group, "附 "));
        }
        filmstrip.appendChild(stack);
      });
    }

    /**
     * Rebuilds the active and chained frame filmstrip.
     * @returns {void}
     */
    function renderFilmstrip() {
      if (!filmstrip) return;
      filmstrip.innerHTML = "";
      renderAttachmentAssetTray();
      syncFrameActions();
      const currentGroup = getCurrentGroup();
      if (!currentGroup) return;
      const renderGroup = renderFilmstripGroupOverride || renderFilmstripGroup;
      renderGroup(currentGroup, translate("mainLabel"));
      const chain = getPlaybackChainGroup();
      if (chain && chain.uiId !== currentGroup.uiId) renderGroup(chain, translate("thenLabel"));
    }

    return {
      activateLayerCardFromKeyboard,
      animateLayerCardRects,
      captureLayerCardRects,
      clearLayerDropClasses,
      clearLayerDragPreview,
      createFrameImageAttachmentCard,
      isLayerCardDragEvent,
      layerInsertionIndexFromPoint,
      moveFrameLayerCardByOffset,
      moveFrameLayerCardToIndex,
      previewLayerCardMove,
      renderFilmstrip,
      renderFilmstripGroup,
      setupLayerCardDrag,
      setupLayerOrderActions,
      setupLayerStackDrag,
    };
  }

  return Object.freeze({ createController });
});
