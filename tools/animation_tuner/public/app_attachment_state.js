(function attachXsxbAttachmentState(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAttachmentState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the in-memory attachment data and layer-order controller.
   * @param {{
   *   getConfig?:()=>object|null,
   *   getAttachments?:()=>object[],
   *   setAttachments?:(value:object[])=>void,
   *   getAssets?:()=>object[],
   *   setAssets?:(value:object[])=>void,
   *   getSelectedAttachmentId?:()=>string,
   *   setSelectedAttachmentId?:(value:string)=>void,
   *   getSelectedFrame?:()=>number,
   *   getCurrentGroup?:()=>object|null,
   *   getFrameKey:(index:number,group:object|null)=>string,
   *   getFrameMetadata:(index:number,group:object|null)=>object|null,
   *   normalizeAttachment:(raw:object)=>object,
   *   newLocalId:(prefix:string)=>string,
   *   attachmentLayerOrder:(attachment:object)=>number,
   *   selectedFrameIndexes?:()=>number[],
   *   clampFrameIndex?:(index:number,group:object)=>number,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   loadFromProject:()=>void,
   *   loadAssetsFromProject:()=>void,
   *   forFrame:(index?:number,group?:object|null)=>object[],
   *   layerStackItems:(index?:number,group?:object|null)=>object[],
   *   drawableForFrame:(index?:number,layer?:string,group?:object|null)=>object[],
   *   nextAboveLayerOrder:(index?:number,group?:object|null)=>number,
   *   selectedAttachment:()=>object|null,
   *   implicitSingleFrameAttachment:()=>object|null,
   *   directManipulationAttachment:()=>object|null,
   *   attachmentFrameIndex:(attachment:object,group?:object|null)=>number,
   * }} Attachment state operations.
   */
  function createController(dependencies = {}) {
    const {
      getConfig = () => null,
      getAttachments = () => [],
      setAttachments = () => {},
      getAssets = () => [],
      setAssets = () => {},
      getSelectedAttachmentId = () => "",
      setSelectedAttachmentId = () => {},
      getSelectedFrame = () => 0,
      getCurrentGroup = () => null,
      getFrameKey,
      getFrameMetadata,
      normalizeAttachment,
      newLocalId,
      attachmentLayerOrder,
      selectedFrameIndexes = () => [getSelectedFrame()],
      clampFrameIndex = (index) => index,
    } = dependencies;

    /**
     * Loads valid persisted frame attachments and clears stale selection.
     * @returns {void}
     */
    function loadFromProject() {
      const config = getConfig();
      const attachments = (Array.isArray(config?.frameImageAttachments) ? config.frameImageAttachments : [])
        .map(normalizeAttachment)
        .filter((attachment) => attachment.path && attachment.key);
      setAttachments(attachments);
      if (!attachments.some((attachment) => attachment.id === getSelectedAttachmentId())) {
        setSelectedAttachmentId("");
      }
    }

    /**
     * Loads the reusable project attachment asset library.
     * @returns {void}
     */
    function loadAssetsFromProject() {
      const config = getConfig();
      const assets = (Array.isArray(config?.attachmentAssets) ? config.attachmentAssets : [])
        .filter((asset) => asset && asset.path)
        .map((asset) => ({
          id: String(asset.id || asset.assetHash || newLocalId("asset")),
          name: String(asset.name || "image"),
          path: String(asset.path),
          assetHash: String(asset.assetHash || ""),
          type: String(asset.type || "image/png"),
          width: Number(asset.width || 0),
          height: Number(asset.height || 0),
          groupKey: String(asset.groupKey || ""),
        }));
      setAssets(assets);
    }

    /**
     * Returns all attachments owned by one frame key.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {object[]} Attachments for the frame.
     */
    function forFrame(index = getSelectedFrame(), group = getCurrentGroup()) {
      const key = getFrameKey(index, group);
      return getAttachments().filter((attachment) => attachment.key === key);
    }

    /**
     * Builds the main-image and attachment layer stack for a frame.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {object[]} Ordered layer stack entries.
     */
    function layerStackItems(index = getSelectedFrame(), group = getCurrentGroup()) {
      const allAttachments = getAttachments();
      const attachments = forFrame(index, group).map((attachment) => ({
        type: "attachment",
        attachment,
        id: attachment.id,
        order: attachmentLayerOrder(attachment),
        sourceIndex: allAttachments.indexOf(attachment),
      }));
      const above = attachments
        .filter((entry) => entry.order > 0)
        .sort((a, b) => b.order - a.order || a.sourceIndex - b.sourceIndex);
      const below = attachments
        .filter((entry) => entry.order < 0)
        .sort((a, b) => b.order - a.order || a.sourceIndex - b.sourceIndex);
      return [...above, { type: "main", id: "main", index, group }, ...below];
    }

    /**
     * Returns attachments for one side of the main frame, in draw order.
     * @param {number} [index] Frame index.
     * @param {string} [layer="above"] Layer side.
     * @param {object|null} [group] Animation group.
     * @returns {object[]} Drawable attachments.
     */
    function drawableForFrame(index = getSelectedFrame(), layer = "above", group = getCurrentGroup()) {
      return forFrame(index, group)
        .filter((attachment) =>
          layer === "below" ? attachmentLayerOrder(attachment) < 0 : attachmentLayerOrder(attachment) > 0,
        )
        .sort(
          (a, b) =>
            attachmentLayerOrder(a) - attachmentLayerOrder(b) ||
            getAttachments().indexOf(b) - getAttachments().indexOf(a),
        );
    }

    /**
     * Returns the next positive layer order for a frame.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {number} Next positive layer order.
     */
    function nextAboveLayerOrder(index = getSelectedFrame(), group = getCurrentGroup()) {
      const maxOrder = forFrame(index, group).reduce(
        (max, attachment) => Math.max(max, attachmentLayerOrder(attachment)),
        0,
      );
      return Math.max(1, maxOrder + 1);
    }

    /**
     * Returns the explicitly selected attachment.
     * @returns {object|null} Selected attachment.
     */
    function selectedAttachment() {
      const selectedId = getSelectedAttachmentId();
      if (!selectedId) return null;
      return getAttachments().find((attachment) => attachment.id === selectedId) || null;
    }

    /**
     * Returns the only attachment when exactly one frame and layer exist.
     * @returns {object|null} Implicitly selected attachment.
     */
    function implicitSingleFrameAttachment() {
      const indexes = selectedFrameIndexes();
      const group = getCurrentGroup();
      if (!group || indexes.length !== 1) return null;
      const attachments = forFrame(indexes[0], group);
      return attachments.length === 1 ? attachments[0] : null;
    }

    /**
     * Returns the attachment eligible for direct manipulation.
     * @returns {object|null} Direct manipulation target.
     */
    function directManipulationAttachment() {
      const indexes = selectedFrameIndexes();
      if (indexes.length !== 1) return null;
      const selected = selectedAttachment();
      if (selected && attachmentFrameIndex(selected, getCurrentGroup()) === indexes[0]) return selected;
      return implicitSingleFrameAttachment();
    }

    /**
     * Resolves an attachment's frame index from metadata or its key.
     * @param {object|null|undefined} attachment Attachment record.
     * @param {object|null} [group] Animation group.
     * @returns {number} Resolved frame index.
     */
    function attachmentFrameIndex(attachment, group = getCurrentGroup()) {
      if (!attachment || !group?.frames?.length) return getSelectedFrame();
      const frame = Number(attachment.metadata?.displayFrame ?? attachment.metadata?.frame);
      if (Number.isFinite(frame)) return clampFrameIndex(frame, group);
      const key = String(attachment.key || "");
      for (let index = 0; index < group.frames.length; index += 1) {
        if (getFrameKey(index, group) === key) return index;
      }
      return getSelectedFrame();
    }

    return {
      attachmentFrameIndex,
      directManipulationAttachment,
      drawableForFrame,
      forFrame,
      implicitSingleFrameAttachment,
      layerStackItems,
      loadAssetsFromProject,
      loadFromProject,
      nextAboveLayerOrder,
      selectedAttachment,
    };
  }

  return { createController };
});
