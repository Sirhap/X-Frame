(function attachXFrameLayerStack(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameLayerStack = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates attachment layer-card and ordering operations.
   * @param {{
   *   getCurrentGroup?:()=>object|null,
   *   getFrameLayerStackItems:(index:number,group:object)=>Array<object>,
   *   getFrameImageAttachments:()=>Array<object>,
   *   getFrameImageAttachmentKey:(index:number,group:object)=>string,
   *   getFrameImageAttachmentMetadata:(index:number,group:object)=>object,
   *   clampFrameIndex:(index:number,group:object)=>number,
   * }} dependencies Controller dependencies.
   * @returns {object} Layer-card and ordering operations.
   */
  function createController(dependencies) {
    const {
      getCurrentGroup = () => null,
      getFrameLayerStackItems,
      getFrameImageAttachments,
      getFrameImageAttachmentKey,
      getFrameImageAttachmentMetadata,
      clampFrameIndex,
    } = dependencies;

    /**
     * Returns a stable identity for a layer card.
     * @param {object|null} info Layer-card info.
     * @returns {string} Layer-card identity.
     */
    function layerCardKey(info) {
      return info?.type === "attachment" ? `attachment:${info.attachmentId}` : "main";
    }

    /**
     * Returns a stable DOM identity for a layer card.
     * @param {object|null} info Layer-card info.
     * @returns {string} DOM identity.
     */
    function layerCardDomKey(info) {
      return `${info?.groupUiId || ""}:${info?.frameIndex ?? ""}:${layerCardKey(info)}`;
    }

    /**
     * Creates layer-card info for an attachment.
     * @param {object} attachment Attachment record.
     * @param {number} index Frame index.
     * @param {object} group Animation group.
     * @returns {object} Layer-card info.
     */
    function layerCardInfoForAttachment(attachment, index, group) {
      return {
        type: "attachment",
        attachmentId: attachment.id,
        frameIndex: index,
        groupUiId: group.uiId,
      };
    }

    /**
     * Creates layer-card info for the main frame image.
     * @param {number} index Frame index.
     * @param {object} group Animation group.
     * @returns {object} Layer-card info.
     */
    function layerCardInfoForMain(index, group) {
      return {
        type: "main",
        frameIndex: index,
        groupUiId: group.uiId,
      };
    }

    /**
     * Converts a frame layer stack into renderable card info.
     * @param {number} index Frame index.
     * @param {object} group Animation group.
     * @returns {Array<object>} Layer-card info list.
     */
    function layerCardInfosForFrame(index, group) {
      return getFrameLayerStackItems(index, group).map((item) =>
        item.type === "attachment"
          ? layerCardInfoForAttachment(item.attachment, index, group)
          : layerCardInfoForMain(index, group),
      );
    }

    /**
     * Calculates a reordered layer list without mutating state.
     * @param {object} dragInfo Dragged layer info.
     * @param {number} insertionIndex Target insertion index.
     * @param {object|null} [group] Animation group.
     * @returns {{before:Array<object>,after:Array<object>}|null} Reorder result.
     */
    function movedLayerCardOrder(dragInfo, insertionIndex, group = getCurrentGroup()) {
      if (!group || dragInfo.groupUiId !== group.uiId) return null;
      const before = layerCardInfosForFrame(clampFrameIndex(dragInfo.frameIndex, group), group);
      const dragIndex = before.findIndex((info) => layerCardKey(info) === layerCardKey(dragInfo));
      if (dragIndex < 0) return null;
      const after = before.slice();
      const [dragged] = after.splice(dragIndex, 1);
      const targetIndex = Math.max(0, Math.min(Number(insertionIndex) || 0, before.length));
      const adjustedIndex = dragIndex < targetIndex ? targetIndex - 1 : targetIndex;
      after.splice(Math.max(0, Math.min(adjustedIndex, after.length)), 0, dragged);
      return { before, after };
    }

    /**
     * Persists layer order and frame metadata for an ordered card list.
     * @param {number} index Frame index.
     * @param {object} group Animation group.
     * @param {Array<object>} orderedInfos Ordered layer-card info.
     * @returns {boolean} Whether a main frame card was present.
     */
    function applyFrameLayerCardOrder(index, group, orderedInfos) {
      const mainIndex = orderedInfos.findIndex((info) => info.type === "main");
      if (mainIndex < 0) return false;
      for (let orderIndex = 0; orderIndex < orderedInfos.length; orderIndex += 1) {
        const info = orderedInfos[orderIndex];
        if (info.type !== "attachment") continue;
        const attachment = getFrameImageAttachments().find((entry) => entry.id === info.attachmentId);
        if (!attachment) continue;
        const layerOrder = orderIndex < mainIndex ? mainIndex - orderIndex : -(orderIndex - mainIndex);
        attachment.layerOrder = layerOrder;
        attachment.layer = layerOrder < 0 ? "below" : "above";
        attachment.key = getFrameImageAttachmentKey(index, group);
        attachment.frameKey = attachment.key;
        attachment.metadata = getFrameImageAttachmentMetadata(index, group);
      }
      return true;
    }

    return {
      applyFrameLayerCardOrder,
      layerCardDomKey,
      layerCardInfoForAttachment,
      layerCardInfoForMain,
      layerCardInfosForFrame,
      layerCardKey,
      movedLayerCardOrder,
    };
  }

  return { createController };
});
