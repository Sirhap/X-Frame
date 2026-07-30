(function attachXsxbAttachmentUtils(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAttachmentUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates a stable local identifier without requiring a crypto API.
   * @param {string} [prefix="id"] Identifier prefix.
   * @returns {string} New local identifier.
   */
  function newLocalId(prefix = "id") {
    if (root.crypto?.randomUUID) return `${prefix}_${root.crypto.randomUUID().replaceAll("-", "")}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  /**
   * Normalizes an attached image transform.
   * @param {{scale?:number,scaleX?:number,scaleY?:number,visual_scale?:{x?:number,y?:number},offset?:{x?:number,y?:number},rotation?:number}} [transform]
   * Raw transform.
   * @returns {{scale:number,scaleX:number,scaleY:number,offset:{x:number,y:number},rotation:number}}
   * Normalized transform.
   */
  function normalizeAttachmentTransform(transform = {}) {
    const scale = Math.max(0.001, Number(transform.scale ?? 1));
    return {
      scale,
      scaleX: Math.max(0.001, Number(transform.scaleX ?? transform.visual_scale?.x ?? scale)),
      scaleY: Math.max(0.001, Number(transform.scaleY ?? transform.visual_scale?.y ?? scale)),
      offset: {
        x: Number(transform.offset?.x || 0),
        y: Number(transform.offset?.y || 0),
      },
      rotation: Number(transform.rotation || 0),
    };
  }

  /**
   * Normalizes the signed layer order used by attachment sorting.
   * @param {{layerOrder?:number,layer?:string}|null|undefined} source Raw attachment.
   * @returns {number} Signed layer order.
   */
  function normalizeAttachmentLayerOrder(source = {}) {
    const parsed = Number(source.layerOrder);
    if (Number.isFinite(parsed) && Math.abs(parsed) > 0.0001) return parsed;
    return source.layer === "below" ? -1 : 1;
  }

  /**
   * Normalizes a persisted attached image record.
   * @param {object|null|undefined} raw Raw attachment record.
   * @returns {object} Normalized attachment record.
   */
  function normalizeFrameImageAttachment(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
    const key = String(source.key || source.frameKey || "");
    const layerOrder = normalizeAttachmentLayerOrder(source);
    return {
      id: String(source.id || newLocalId("layer")),
      key,
      frameKey: key,
      metadata,
      name: String(source.name || "image"),
      path: String(source.path || ""),
      assetId: String(source.assetId || source.automation?.assetId || ""),
      assetHash: String(source.assetHash || ""),
      type: String(source.type || ""),
      width: Number(source.width || 0),
      height: Number(source.height || 0),
      layer: layerOrder < 0 ? "below" : "above",
      layerOrder,
      transform: normalizeAttachmentTransform(source.transform),
      automation:
        source.automation && typeof source.automation === "object"
          ? structuredClone(source.automation)
          : undefined,
    };
  }

  /**
   * Creates a clipboard-safe attachment copy without project identity fields.
   * @param {object} attachment Normalized attachment.
   * @returns {object} Clipboard attachment payload.
   */
  function frameImageAttachmentClipboardItem(attachment) {
    return {
      name: attachment.name,
      path: attachment.path,
      ...(attachment.assetId ? { assetId: attachment.assetId } : {}),
      assetHash: attachment.assetHash,
      type: attachment.type,
      width: attachment.width,
      height: attachment.height,
      layer: attachment.layer === "below" ? "below" : "above",
      layerOrder: normalizeAttachmentLayerOrder(attachment),
      transform: structuredClone(normalizeAttachmentTransform(attachment.transform)),
    };
  }

  return {
    attachmentLayerOrder: normalizeAttachmentLayerOrder,
    frameImageAttachmentClipboardItem,
    newLocalId,
    normalizeAttachmentLayerOrder,
    normalizeAttachmentTransform,
    normalizeFrameImageAttachment,
  };
});
